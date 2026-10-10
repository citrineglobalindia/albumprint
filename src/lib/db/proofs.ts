import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ORDERS } from "../data";
import { notify } from "../store";
import type { Proof, ProofComment } from "../proofs";
import type { DesignCorrection, DesignMeta } from "../design";
import { backendOn, sb, q, registerHydrator, writeThrough, hydrateAll } from "./core";

// Client proofing + designer state in the database. Staff create proofs by inserting the SHA-256 hash of a browser-generated token
// (RLS even hides the hash from staff); the client answers through the public proof_get / proof_respond RPCs (no login).
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const orderUid = (code: string) => ORDERS.find((o) => o.id === code)?.uid;

/** Writes that depend on each other (insert a proof, then revoke it) run in order per key. */
const chains = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => PromiseLike<T>): Promise<T> {
  const next = (chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  chains.set(key, next); return next;
}

// ───────── proofs ─────────
const tokens = new Map<string, string>();   // full links are known only to the browser that created them (the server keeps a hash)
const STATUS: Record<string, Proof["status"]> = { sent: "sent", viewed: "viewed", approved: "approved", corrections_requested: "corrections", expired: "expired", revoked: "revoked" };

export function dbCreateProof(p: Proof, orderUidV: string | undefined, revokeIds: string[], revert: () => void) {
  if (!backendOn || !orderUidV) return;
  tokens.set(p.id, p.token);
  writeThrough("Sending proof", () => serial(p.id, async () => {
    const ins = await sb().from("proofs").insert({ id: p.id, order_id: orderUidV, version: p.version, token_hash: await sha256Hex(p.token), expires_at: p.expiresAt, sent_via: p.sentVia });
    if (ins.error || !revokeIds.length) return ins;
    return sb().from("proofs").update({ status: "revoked" }).in("id", revokeIds);
  }) as never, revert);
}
export function dbRevokeProof(id: string, revert: () => void) {
  if (!backendOn) return;
  writeThrough("Revoking proof link", () => serial(id, () => sb().from("proofs").update({ status: "revoked" }).eq("id", id)) as never, revert);
}
export function dbCommentState(id: string | undefined, patch: { resolved: boolean; in_progress: boolean }, revert: () => void) {
  if (!backendOn || !id) return;
  writeThrough("Updating correction", () => sb().from("proof_comments").update(patch).eq("id", id) as never, revert);
}

// ───────── design state ─────────
export function dbSaveMeta(orderCode: string, meta: DesignMeta) {
  const uid = orderUid(orderCode); if (!backendOn || !uid) return;
  const { orderId: _o, ...rest } = meta; void _o;
  writeThrough("Saving design review state", () => serial("meta:" + uid, () => sb().from("design_docs").upsert({ order_id: uid, meta: rest }, { onConflict: "order_id" })) as never);
}
export function dbAddCorrection(c: DesignCorrection & { uid?: string }) {
  const uid = orderUid(c.orderId); if (!backendOn || !uid || !c.uid) return;
  writeThrough("Saving correction", () => sb().from("design_corrections").insert({ id: c.uid, order_id: uid, code: c.id, page: c.page, text: c.text, by_name: c.by, assignee: c.assignee, status: c.status }) as never);
}
export function dbCorrectionStatus(c: DesignCorrection & { uid?: string }, revert: () => void) {
  if (!backendOn || !c.uid) return;
  const uid = c.uid;
  writeThrough("Updating correction", () => serial("corr:" + uid, () => sb().from("design_corrections").update({ status: c.status }).eq("id", uid)) as never, revert);
}
export async function dbLoadLayout(orderCode: string): Promise<unknown | null> {
  const uid = orderUid(orderCode); if (!backendOn || !uid) return null;
  const row = await q<Row>("Loading album layout", sb().from("design_docs").select("layout").eq("order_id", uid).maybeSingle() as never);
  const l = row?.layout; return l && Array.isArray(l.spreads) && l.spreads.length ? l : null;
}
/** Returns false when the save failed (the caller keeps the layout dirty). */
export async function dbSaveLayout(orderCode: string, layout: unknown): Promise<boolean> {
  const uid = orderUid(orderCode); if (!backendOn || !uid) return true;
  const row = await q<Row[]>("Saving album layout", serial("layout:" + uid, () => sb().from("design_docs").upsert({ order_id: uid, layout }, { onConflict: "order_id" }).select("order_id")) as never);
  return row !== null;
}

// ───────── hydrate / poll ─────────
async function hydrate() {
  const { PROOFS } = await import("../proofs");
  const { DESIGN_META, DESIGN_CORR } = await import("../design");
  const c = sb();
  const [pr, pc, dd, dc] = await Promise.all([
    q<Row[]>("Loading proofs", c.from("proofs").select("id,order_id,version,expires_at,status,responded_at,sent_at,viewed_at,approved_by,sent_via").order("sent_at", { ascending: false }).order("version", { ascending: false }) as never),
    q<Row[]>("Loading client corrections", c.from("proof_comments").select("id,proof_id,page,text,at,resolved,in_progress").order("at") as never),
    q<Row[]>("Loading design state", c.from("design_docs").select("order_id,meta") as never),
    q<Row[]>("Loading design corrections", c.from("design_corrections").select("*").order("created_at") as never),
  ]);
  const code = new Map(ORDERS.filter((o) => o.uid).map((o) => [o.uid!, o]));
  const byProof = new Map<string, ProofComment[]>();
  for (const r of pc ?? []) {
    const l = byProof.get(r.proof_id) ?? []; l.push({ id: r.id, page: r.page, text: r.text, at: r.at, resolved: r.resolved || undefined, inProgress: r.in_progress || undefined }); byProof.set(r.proof_id, l);
  }
  if (pr) {
    const now = Date.now();
    PROOFS.splice(0, PROOFS.length, ...pr.flatMap((r): Proof[] => {
      const o = code.get(r.order_id); if (!o) return [];
      let status = STATUS[r.status] ?? "sent";
      if ((status === "sent" || status === "viewed") && new Date(r.expires_at).getTime() < now) status = "expired";
      return [{ id: r.id, orderId: o.id, version: r.version, token: tokens.get(r.id) ?? "", createdAt: r.sent_at, expiresAt: r.expires_at, sentVia: r.sent_via, status,
        viewedAt: r.viewed_at ?? undefined, respondedAt: r.responded_at ?? undefined, approvedBy: r.approved_by ?? undefined, comments: byProof.get(r.id) ?? [], pages: o.pages }];
    }));
  }
  if (dd) DESIGN_META.splice(0, DESIGN_META.length, ...dd.flatMap((r): DesignMeta[] => { const o = code.get(r.order_id); return o ? [{ notes: [], ...(r.meta as object), orderId: o.id } as DesignMeta] : []; }));
  if (dc) DESIGN_CORR.splice(0, DESIGN_CORR.length, ...dc.flatMap((r): DesignCorrection[] => {
    const o = code.get(r.order_id); return o ? [{ id: r.code, uid: r.id, orderId: o.id, page: r.page, text: r.text, by: r.by_name, status: r.status, assignee: r.assignee, at: r.created_at } as DesignCorrection] : [];
  }));
  notify();
}
if (backendOn) registerHydrator("proofs and design", hydrate);

let busy = false;
/** Polled by the staff screens: the client answers without a login, so statuses (and the order's stage) change behind our back. */
export async function syncProofs() {
  if (!backendOn || busy) return;
  busy = true;
  try {
    const { data } = await sb().auth.getSession(); if (!data.session) return;
    const { PROOFS } = await import("../proofs");
    const sig = () => PROOFS.map((p) => `${p.id}:${p.status}`).join("|");
    const before = sig();
    await hydrate();
    if (sig() !== before) await hydrateAll();      // a client answer also moves the order: reload orders etc.
  } finally { busy = false; }
}

// ───────── public portal (no login) ─────────
export interface PortalView { status: Proof["status"]; version: number; expiresAt: string; respondedAt?: string; approvedBy?: string; comments: ProofComment[]; pages: number; orderCode: string; event: string; customer: string; size: string }
export type PortalError = "invalid" | "revoked" | "expired" | "answered" | "network" | string;
let anon: SupabaseClient | null = null;
/** A client with no session, so the portal always acts as `anon` even in a browser where staff are signed in. */
const portal = () => {
  if (anon) return anon;
  const url = import.meta.env.VITE_SUPABASE_URL as string, key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  // A publishable key (sb_publishable_…, not a JWT) is sent as `apikey` only; some gateways reject it as a Bearer token.
  const fetchNoBearer: typeof fetch = (input, init) => {
    if (key.includes(".")) return fetch(input, init);
    const h = new Headers(init?.headers); if (h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
    return fetch(input, { ...init, headers: h });
  };
  return (anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "albumpro-proof-portal" }, global: { fetch: fetchNoBearer } }));
};
const portalErr = (m: string): PortalError => (m.includes("invalid_link") ? "invalid" : m.includes("link_revoked") ? "revoked" : m.includes("link_expired") ? "expired" : m.includes("already_answered") ? "answered" : m.includes("Failed to fetch") || m.includes("NetworkError") ? "network" : m);

export async function portalGet(token: string): Promise<{ view: PortalView } | { error: PortalError }> {
  const { data, error } = await portal().rpc("proof_get", { token });
  if (error) return { error: portalErr(error.message) };
  const d = data as { proof: Row; order: Row };
  return { view: { status: d.proof.status, version: d.proof.version, expiresAt: d.proof.expiresAt, respondedAt: d.proof.respondedAt ?? undefined, approvedBy: d.proof.approvedBy ?? undefined,
    comments: d.proof.comments ?? [], pages: d.order.pages, orderCode: d.order.code, event: d.order.event, customer: d.order.studio, size: d.order.size } };
}
export async function portalRespond(token: string, action: "approve" | "corrections_requested", comments: ProofComment[], name: string): Promise<{ ok: true } | { error: PortalError }> {
  const { error } = await portal().rpc("proof_respond", { token, action, comments: comments.map((c) => ({ page: c.page, text: c.text })), name });
  return error ? { error: portalErr(error.message) } : { ok: true };
}

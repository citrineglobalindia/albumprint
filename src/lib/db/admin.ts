import { backendOn, sb, q, registerHydrator, reportDbError } from "./core";
import { hydrateJson, hydrateSettings, registerJsonWriter, registerSettingsWriter, loadSettings, SECRET_SETTING_KEYS } from "../localState";
import { applyPricing, pricingDefaults, type PricingSnapshot } from "../pricing";
import { getSlaRules, setSlaRules } from "../sla";
import { bindNotifSync, notifStore, type Notif } from "../notifStore";

// Administration data layer: shared settings (pricing, workflow, company…), masters, products, SLA rules, notification templates,
// the communication log, bell notifications, and the user/invite/permission APIs behind Users & Roles.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Json = Record<string, unknown>;

let canAdmin = false;                              // has_perm('users','write'): only these users may write shared configuration
export const isAdminUser = () => canAdmin;
const NOT_ADMIN = "Only administrators can change shared configuration";
const errText = (e: { message: string } | null) => (e ? e.message : null);

// ───────── settings: flat keys (as the Settings screen edits them) ⇄ one jsonb row per section ─────────
export function sectionOf(k: string): string {
  if (["autoAssign", "deliveryNoPay", "disc_limit", "sla_warn_pct", "wf_stages"].includes(k) || /^(wf_|tat_|bh_)/.test(k)) return "workflow";
  if (["name", "website", "phone", "email", "address", "currency", "tax", "prefix", "nextNo", "clientLink", "notify", "logo", "legal", "gstin", "pan", "state", "caddr"].includes(k)) return "company";
  if (/^(n_|smtp_|from_|wa_)/.test(k) || k === "notif_matrix") return "notification";
  if (/^(inv_|tpl_)/.test(k)) return "invoice";
  if (/^pm_/.test(k) || ["adv_pct", "upi_id", "rcp_prefix", "refund_appr"].includes(k)) return "payment";
  if (/^(mfa|pw_)/.test(k) || ["remember", "captcha", "timeout", "max_fail"].includes(k)) return "security";
  return "operational";
}
const SECTIONS = ["company", "operational", "workflow", "notification", "invoice", "payment", "security"];
function split(flat: Json): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(flat)) { if (SECRET_SETTING_KEYS.includes(k) || v === undefined) continue; (out[sectionOf(k)] ??= {})[k] = v; }
  return out;
}
const rawRows: Record<string, Json> = {};          // last known row values (keeps keys this UI does not own, e.g. the engine's workflow flags)

async function writeSettings(next: Json, prev: Json): Promise<string | null> {
  if (!canAdmin) return NOT_ADMIN;
  const a = split(next), b = split(prev), rows: { key: string; value: Json }[] = [];
  for (const s of SECTIONS) {
    if (JSON.stringify(a[s] ?? {}) === JSON.stringify(b[s] ?? {}) && rawRows[s]) continue;
    const value: Json = { ...(rawRows[s] ?? {}), ...(a[s] ?? {}) };
    if (s === "workflow") { value.allow_delivery_without_full_payment = !!next.deliveryNoPay; value.auto_assign_next_dept = next.autoAssign !== false; }
    rows.push({ key: s, value });
  }
  // the discount-approval threshold is shared with the pricing rules (the database rule reads settings 'pricing')
  if (next.disc_limit !== undefined && next.disc_limit !== prev.disc_limit && Number.isFinite(Number(next.disc_limit))) {
    const cur = pricingRow(); rows.push({ key: "pricing", value: { ...cur, discountApprovalPct: Number(next.disc_limit), discount_approval_pct: Number(next.disc_limit) } });
  }
  if (rows.length) { const { error } = await sb().from("settings").upsert(rows, { onConflict: "key" }); if (error) { reportDbError("Saving settings", error); return error.message; } }
  for (const r of rows) { rawRows[r.key] = r.value; if (r.key === "pricing") applyPricing({ ...pricingDefaults(), ...(r.value as unknown as PricingSnapshot) }, false); }
  // SLA hours per stage live in sla_rules
  try {
    const stages = JSON.parse(String(next.wf_stages ?? "[]")) as { key: string; sla: number }[];
    const have = getSlaRules(), changed = stages.filter((s) => SLA_STAGES.includes(s.key) && s.sla >= 1 && have[s.key] !== Math.round(s.sla));
    if (changed.length) {
      const { error } = await sb().from("sla_rules").upsert(changed.map((s) => ({ stage: s.key, hours: Math.round(s.sla) })), { onConflict: "stage" });
      if (error) { reportDbError("Saving SLA rules", error); return error.message; }
      setSlaRules({ ...have, ...Object.fromEntries(changed.map((s) => [s.key, Math.round(s.sla)])) });
    }
  } catch { /* wf_stages not valid JSON: validated by the Settings screen */ }
  return null;
}
const SLA_STAGES = ["files_received", "colour_grading", "admin_approval", "designing", "design_review", "client_review", "final_approval", "printing", "qc", "ready_for_delivery"];

// ───────── pricing ─────────
const pricingRow = (): Json => { try { return JSON.parse(String(rawRows.pricing ? JSON.stringify(rawRows.pricing) : "{}")) as Json; } catch { return {}; } };
async function writePricing(value: PricingSnapshot): Promise<string | null> {
  if (!canAdmin) return NOT_ADMIN;
  const row = { ...(rawRows.pricing ?? {}), ...value, discount_approval_pct: value.discountApprovalPct, gst_rate: value.gstPct };
  const { error } = await sb().from("settings").upsert({ key: "pricing", value: row }, { onConflict: "key" });
  if (error) { reportDbError("Saving pricing rules", error); return error.message; }
  rawRows.pricing = row;
  hydrateSettings({ ...loadSettings(), disc_limit: String(value.discountApprovalPct) });
  return null;
}

// ───────── masters & products ─────────
export const TAB_KIND: Record<string, string> = { "Printing Options": "printing_option", Materials: "material", "Event Types": "event_type", "Cover Types": "cover_type", "Box Types": "box_type", "Design Styles": "design_style" };
export const OTHER_KIND: Record<string, string> = { "Paper GSM": "paper_gsm", Lamination: "lamination", "Binding Type": "binding", "QC Defects": "qc_defect", "Delivery Modes": "delivery_mode", Priorities: "priority" };
interface Item { id: string; name: string; detail: string; price?: number; active: boolean; archived: boolean }
interface Product { id: string; name: string; category: string; size: string; sheets: number; price: number; active: boolean; archived: boolean; image?: string }
const itemRow = (kind: string, i: Item, sort: number) => ({ kind, ref: i.id, name: i.name, value: { detail: i.detail, ...(i.price !== undefined ? { price: i.price } : {}) }, sort, active: i.active, archived: i.archived });
const itemFrom = (r: Row): Item => ({ id: r.ref ?? r.id, name: r.name, detail: r.value?.detail ?? "", price: typeof r.value?.price === "number" ? r.value.price : undefined, active: r.active, archived: !!r.archived });
const productRow = (p: Product) => ({ sku: p.id, name: p.name, category: p.category, size: p.size, sheets: p.sheets, price: p.price, active: p.active, archived: p.archived, image_path: p.image && !p.image.startsWith("data:") ? p.image : null });
const productFrom = (r: Row): Product => ({ id: r.sku, name: r.name, category: r.category ?? "", size: r.size ?? "", sheets: r.sheets ?? 0, price: Number(r.price), active: r.active, archived: !!r.archived, image: r.image_path ?? undefined });

async function syncItems(kind: string, prev: Item[] | undefined, next: Item[]): Promise<string | null> {
  const before = new Map((prev ?? []).map((i, n) => [i.id, JSON.stringify(itemRow(kind, i, n))]));
  const up = next.map((i, n) => itemRow(kind, i, n)).filter((r) => before.get(r.ref) !== JSON.stringify(r));
  const gone = [...before.keys()].filter((id) => !next.some((i) => i.id === id));
  if (up.length) { const { error } = await sb().from("masters").upsert(up, { onConflict: "kind,ref" }); if (error) return error.message; }
  if (gone.length) { const { error } = await sb().from("masters").delete().eq("kind", kind).in("ref", gone); if (error) return error.message; }
  return null;
}
async function writeMasters(key: string, value: unknown, prev: unknown): Promise<string | null> {
  if (!canAdmin) return NOT_ADMIN;
  if (key === "masters_products") {
    const next = value as Product[], old = new Map(((prev as Product[] | undefined) ?? []).map((p) => [p.id, JSON.stringify(productRow(p))]));
    const up = next.map(productRow).filter((r) => old.get(r.sku) !== JSON.stringify(r));
    const gone = [...old.keys()].filter((id) => !next.some((p) => p.id === id));
    if (up.length) { const { error } = await sb().from("products").upsert(up, { onConflict: "sku" }); if (error) return error.message; }
    if (gone.length) { const { error } = await sb().from("products").delete().in("sku", gone); if (error) return error.message; }
    return null;
  }
  const map = key === "masters_items" ? TAB_KIND : OTHER_KIND, all = value as Record<string, Item[]>, was = (prev ?? {}) as Record<string, Item[]>;
  for (const [label, kind] of Object.entries(map)) {
    if (JSON.stringify(all[label]) === JSON.stringify(was[label])) continue;
    const err = await syncItems(kind, was[label], all[label] ?? []); if (err) return err;
  }
  return null;
}

registerJsonWriter(async (key, value, prev) => {
  if (!backendOn) return null;
  let err: string | null = null;
  try {
    if (key === "pricing") err = await writePricing(value as PricingSnapshot);
    else if (key === "masters_products" || key === "masters_items" || key === "masters_other") err = await writeMasters(key, value, prev);
  } catch (e) { err = e instanceof Error ? e.message : String(e); }
  if (err) {
    reportDbError(key === "pricing" ? "Saving pricing rules" : "Saving masters", { message: err });
    if (key === "pricing" && prev) applyPricing({ ...pricingDefaults(), ...(prev as PricingSnapshot) }, false);
  }
  return err;
});
registerSettingsWriter(async (next, prev) => {
  let err: string | null = null;
  try { err = await writeSettings(next, prev); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  return err;
});

// ───────── hydrate ─────────
async function hydrate() {
  const c = sb();
  const [adm, setRows, slaRows, masterRows, prodRows] = await Promise.all([
    c.rpc("has_perm", { p_module: "users", p_need: "write" }),
    q<Row[]>("Loading settings", c.from("settings").select("key,value") as never),
    q<Row[]>("Loading SLA rules", c.from("sla_rules").select("stage,hours") as never),
    q<Row[]>("Loading masters", c.from("masters").select("*").order("sort") as never),
    q<Row[]>("Loading products", c.from("products").select("*").order("sku") as never),
  ]);
  canAdmin = adm.data === true;
  const flat: Json = {};
  for (const r of setRows ?? []) {
    const v = (r.value ?? {}) as Json;
    rawRows[r.key] = v;
    if (r.key === "pricing") { hydrateJson("pricing", v); applyPricing({ ...pricingDefaults(), ...(v as unknown as PricingSnapshot) }, false); }
    else Object.assign(flat, v);
  }
  if ("allow_delivery_without_full_payment" in flat) flat.deliveryNoPay = !!flat.allow_delivery_without_full_payment;
  if ("auto_assign_next_dept" in flat) flat.autoAssign = flat.auto_assign_next_dept !== false;
  delete flat.allow_delivery_without_full_payment; delete flat.auto_assign_next_dept;
  const disc = (rawRows.pricing as Json | undefined)?.discountApprovalPct; if (disc !== undefined) flat.disc_limit = String(disc);
  hydrateSettings(flat);
  setSlaRules(Object.fromEntries((slaRows ?? []).map((r) => [r.stage as string, Number(r.hours)])));
  if (masterRows) {
    const byKind = (kind: string) => masterRows.filter((r) => r.kind === kind).map(itemFrom);
    hydrateJson("masters_items", Object.fromEntries(Object.entries(TAB_KIND).map(([label, kind]) => [label, byKind(kind)])));
    hydrateJson("masters_other", Object.fromEntries(Object.entries(OTHER_KIND).map(([label, kind]) => [label, byKind(kind)])));
  }
  if (prodRows) hydrateJson("masters_products", prodRows.map(productFrom));
  await hydrateNotifications();
  startNotifPoll();
}
if (backendOn) registerHydrator("settings, masters and notifications", hydrate);

// ───────── bell notifications (own rows) ─────────
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now"; if (s < 3600) return `${Math.round(s / 60)}m ago`; if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return s < 172800 ? "Yesterday" : `${Math.round(s / 86400)} days ago`;
};
async function hydrateNotifications(quiet = false) {
  const { data, error } = await sb().from("notifications").select("id,title,body,link,created_at,read_at").order("created_at", { ascending: false }).limit(50);
  if (error) { if (!quiet) reportDbError("Loading notifications", error); return; }
  notifStore.setAll((data ?? []).map((r: Row): Notif => ({ id: r.id, title: r.title, body: r.body ?? "", time: ago(r.created_at), to: r.link ?? "/notifications", read: !!r.read_at })));
}
let poll: number | undefined;
function startNotifPoll() {
  if (poll || typeof window === "undefined") return;
  poll = window.setInterval(async () => { const { data } = await sb().auth.getSession(); if (data.session) void hydrateNotifications(true); }, 60_000);
}
if (backendOn) bindNotifSync({ read(ids) { void Promise.resolve(sb().from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids)).then(({ error }) => { if (error) reportDbError("Marking notifications read", error); }); } });

// ───────── users, invites, permissions ─────────
export interface DbUser { id: string; name: string; email: string; mobile: string; role: string; dept: string; active: boolean; created: string }
export interface DbInvite { email: string; name: string; role: string; dept: string; mobile: string; created: string; lastSent: string; resends: number; status: "pending" | "accepted" | "revoked" }
const userFrom = (r: Row): DbUser => ({ id: r.id, name: r.full_name, email: r.email ?? "", mobile: r.mobile ?? "", role: r.role, dept: r.department ?? "", active: r.active, created: r.created_at });
const inviteFrom = (r: Row): DbInvite => ({ email: r.email, name: r.full_name ?? "", role: r.role, dept: r.department ?? "", mobile: r.mobile ?? "", created: r.created_at, lastSent: r.last_sent_at, resends: r.resend_count ?? 0, status: r.revoked_at ? "revoked" : r.used_at ? "accepted" : "pending" });

export async function dbListUsers(): Promise<DbUser[]> { return ((await q<Row[]>("Loading users", sb().from("profiles").select("*").order("created_at") as never)) ?? []).map(userFrom); }
export async function dbListInvites(): Promise<DbInvite[]> { return ((await q<Row[]>("Loading invites", sb().from("staff_invites").select("*").order("created_at", { ascending: false }) as never)) ?? []).map(inviteFrom); }
export async function dbUpdateUser(id: string, patch: { name?: string; mobile?: string; role?: string; dept?: string; active?: boolean }): Promise<string | null> {
  const row: Row = {};
  if (patch.name !== undefined) row.full_name = patch.name; if (patch.mobile !== undefined) row.mobile = patch.mobile || null; if (patch.role !== undefined) row.role = patch.role;
  if (patch.dept !== undefined) row.department = patch.dept || null; if (patch.active !== undefined) row.active = patch.active;
  const { data, error } = await sb().from("profiles").update(row).eq("id", id).select("id");
  if (error) return error.message;
  return data && data.length ? null : "Not allowed (no rows changed)";
}
export async function dbInviteUser(i: { email: string; name: string; role: string; dept: string; mobile: string }): Promise<string | null> {
  const email = i.email.trim().toLowerCase();
  const { data: has } = await sb().from("profiles").select("id").eq("email", email).maybeSingle();
  if (has) return "That email already belongs to a user";
  const { data: me } = await sb().auth.getUser();
  const { error } = await sb().from("staff_invites").upsert({ email, role: i.role, full_name: i.name || null, department: i.dept || null, mobile: i.mobile || null, invited_by: me.user?.id ?? null, revoked_at: null, used_at: null, last_sent_at: new Date().toISOString(), resend_count: 0 }, { onConflict: "email" });
  return errText(error);
}
export async function dbResendInvite(email: string, resends: number): Promise<string | null> {
  const { error } = await sb().from("staff_invites").update({ last_sent_at: new Date().toISOString(), resend_count: resends + 1 }).eq("email", email).is("used_at", null).is("revoked_at", null);
  return errText(error);
}
export async function dbRevokeInvite(email: string): Promise<string | null> {
  const { error } = await sb().from("staff_invites").update({ revoked_at: new Date().toISOString() }).eq("email", email).is("used_at", null);
  return errText(error);
}
export interface PermCell { role: string; module: string; level: string }
export async function dbListPerms(): Promise<PermCell[]> { return (await q<PermCell[]>("Loading permissions", sb().from("role_permissions").select("role,module,level") as never)) ?? []; }
export async function dbSavePerms(cells: PermCell[]): Promise<string | null> {
  const { error } = await sb().from("role_permissions").upsert(cells, { onConflict: "role,module" });
  return errText(error);
}

// ───────── notification triggers & communication log ─────────
export interface Tpl { key: string; name: string; recipient: string; behaviour: string; whatsapp: boolean; email: boolean; sms: boolean; inApp: boolean }
export async function dbListTemplates(): Promise<Tpl[]> {
  return ((await q<Row[]>("Loading notification triggers", sb().from("notification_templates").select("*").order("sort") as never)) ?? []).map((r) => ({ key: r.key, name: r.name, recipient: r.recipient ?? "", behaviour: r.behaviour ?? "", whatsapp: r.whatsapp, email: r.email, sms: r.sms, inApp: r.in_app }));
}
export async function dbSetTemplateChannel(key: string, channel: "whatsapp" | "email" | "sms" | "in_app", on: boolean): Promise<string | null> {
  const { data, error } = await sb().from("notification_templates").update({ [channel]: on }).eq("key", key).select("key");
  if (error) return error.message;
  return data && data.length ? null : "Only administrators can change notification triggers";
}
export interface CommMsg { id: string; channel: string; direction: string; template: string; recipient: string; summary: string; status: string; at: string; order: string; orderUid: string | null }
const commFrom = (r: Row): CommMsg => ({ id: r.id, channel: r.channel, direction: r.direction, template: r.template ?? "", recipient: r.recipient ?? "", summary: r.summary ?? "", status: r.status, at: r.sent_at, order: r.orders?.code ?? "—", orderUid: r.order_id });
export async function dbListComm(): Promise<CommMsg[]> {
  return ((await q<Row[]>("Loading communication log", sb().from("comm_log").select("*, orders(code)").order("sent_at", { ascending: false }).limit(500) as never)) ?? []).map(commFrom);
}
/** Record an outbound message. Provider delivery (WhatsApp / e-mail / SMS) is not wired up: it is stored as 'queued' (internal notes as 'sent'). */
export async function dbQueueComm(m: { orderUid: string | null; channel: string; recipient: string; template: string; summary: string }): Promise<{ row?: CommMsg; error?: string }> {
  const { data: me } = await sb().auth.getUser();
  const { data, error } = await sb().from("comm_log").insert({ order_id: m.orderUid, channel: m.channel, direction: "outbound", template: m.template || null, recipient: m.recipient, summary: m.summary, status: m.channel === "internal_note" ? "sent" : "queued", created_by: me.user?.id ?? null }).select("*, orders(code)").single();
  return error ? { error: error.message } : { row: commFrom(data as Row) };
}
export async function dbRequeueComm(ids: string[]): Promise<string | null> {
  const { error } = await sb().from("comm_log").update({ status: "queued" }).in("id", ids);
  return errText(error);
}

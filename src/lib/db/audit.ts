import { AUDIT, notifyAudit, type AuditEntry } from "../audit";
import { ORDERS, stageLabel } from "../data";
import type { RoleKey } from "../auth";
import { stageFromDb } from "./orders";
import { backendOn, sb, q, registerHydrator } from "./core";

// In backend mode the database's audit_log is the audit trail. Triggers write row-level history with the real actor;
// events with no table behind them go through the log_event() RPC. AUDIT (what the UI reads) is hydrated from audit_log (admin only via RLS).
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Events a trigger already records (stage moves, orders, payments, invoices, file rows, proof send/revoke/answer): never double-log them. */
const PROOF_SERVER = new Set(["send", "revoke", "client_approval", "client_corrections"]);
export const serverAudited = (e: { entity: string; action: string }) =>
  e.entity === "payment" || e.entity === "invoice" || e.entity === "file" ||
  (e.entity === "order" && !/^sla_(escalate|nudge)$/.test(e.action)) ||
  (e.entity === "proof" && PROOF_SERVER.has(e.action));

const clean = (s: string, n: number) => s.toLowerCase().replace(/[^a-z0-9_ .:-]+/g, "_").replace(/^[^a-z0-9]+/, "").slice(0, n);

/** Fire-and-forget: record a client-side business event. Failures only warn (the UI action already happened). */
export function dbLogEvent(e: Omit<AuditEntry, "id" | "at" | "actor" | "role">) {
  if (!backendOn || serverAudited(e)) return;
  const entity = clean(e.entity, 40).replace(/ /g, "_"); const action = clean(e.action, 60);
  if (!entity || !action) return;
  void Promise.resolve(sb().rpc("log_event", {
    p_entity: entity, p_entity_id: e.entityId.slice(0, 100), p_action: action, p_detail: e.detail?.slice(0, 1000) ?? null, p_reason: e.reason?.slice(0, 1000) ?? null,
    p_from: e.from?.slice(0, 200) ?? null, p_to: e.to?.slice(0, 200) ?? null, p_override: !!e.override,
  })).then(({ error }) => { if (error) console.warn("[audit] log_event:", error.message); else refreshAudit(); }, (err) => console.warn("[audit] log_event:", err));
}

const ENT: Record<string, string> = { orders: "order", customers: "customer", order_files: "file", payments: "payment", invoices: "invoice", qc_inspections: "qc", deliveries: "delivery",
  profiles: "user", role_permissions: "permission", masters: "master", proofs: "proof", corrections: "correction", print_jobs: "production" };
const SKIP_COLS = new Set(["updated_at", "search", "tsv"]);

async function hydrate() {
  const client = sb();
  const { data: sess } = await client.auth.getSession(); if (!sess.session) return;
  const [rows, people, trans] = await Promise.all([
    q<Row[]>("Loading audit log", client.from("audit_log").select("id,at,actor,actor_role,entity,entity_id,action,old_data,new_data,reason").order("id", { ascending: false }).limit(2000) as never),
    q<Row[]>("Loading staff names", client.from("profiles").select("id,full_name") as never),
    q<Row[]>("Loading transitions", client.from("stage_transitions").select("order_type,from_stage,to_stage") as never),
  ]);
  const names = new Map((people ?? []).map((p) => [p.id as string, String(p.full_name)]));
  const valid = new Set((trans ?? []).map((t) => `${t.order_type}:${t.from_stage}:${t.to_stage}`));
  const code = new Map(ORDERS.filter((o) => o.uid).map((o) => [o.uid!, o.id]));
  const out: AuditEntry[] = (rows ?? []).map((r) => {
    const o = (r.old_data ?? undefined) as Row | undefined, n = (r.new_data ?? undefined) as Row | undefined;
    const d = (n ?? o ?? {}) as Row;
    const client_ = n?.source === "client";
    let actor = r.actor ? names.get(r.actor) ?? "Unknown user" : (n?.actor_name as string | undefined) ?? "System";
    const role = (r.actor_role ?? "system") as RoleKey | "system";
    let entity = ENT[r.entity] ?? r.entity;
    let entityId: string = r.entity_id ?? "";
    let action: string = r.action, detail: string | undefined, from: string | undefined, to: string | undefined, override: boolean | undefined;
    if (client_) {
      detail = n!.detail; from = n!.from; to = n!.to; override = n!.override || undefined;
    } else {
      if (d.order_id && code.has(d.order_id)) entityId = code.get(d.order_id)!;
      else if (r.entity === "orders") entityId = code.get(r.entity_id) ?? d.code ?? entityId;
      else if (r.entity === "profiles") entityId = names.get(r.entity_id) ?? entityId;
      if (r.entity === "orders" && r.action === "update" && o && n && o.stage !== n.stage) {
        action = n.stage === "cancelled" ? "cancel" : n.stage === "closed" ? "close" : o.stage === "closed" ? "reopen" : "stage_change";
        from = stageLabel(stageFromDb(o.stage)); to = stageLabel(stageFromDb(n.stage));
        override = !valid.has(`${n.type}:${o.stage}:${n.stage}`) && n.stage !== "cancelled" ? true : undefined;
      } else if (r.entity === "proofs" && o && n && o.status !== n.status) {
        action = ({ viewed: "viewed", revoked: "revoke", approved: "client_approval", corrections_requested: "client_corrections" } as Record<string, string>)[n.status] ?? n.status;
        detail = `v${n.version}`;
        if (n.status === "approved") actor = `${n.approved_by ?? "Client"} (client)`;
        else if (!r.actor) actor = n.status === "corrections_requested" ? `${n.client_note || "Client"} (client)` : "Client";
      } else if (r.action === "update" && o && n) {
        detail = "changed: " + (Object.keys(n).filter((k) => !SKIP_COLS.has(k) && JSON.stringify(n[k]) !== JSON.stringify(o[k])).join(", ") || "—");
      } else if (r.action === "insert") { action = "create"; if (r.entity === "proofs") detail = `v${n?.version}`; }
      else if (r.action === "delete") action = "delete";
    }
    return { id: Number(r.id), at: r.at, actor, role, entity, entityId, action, detail, from, to, reason: r.reason ?? undefined, override };
  });
  AUDIT.splice(0, AUDIT.length, ...out);
  notifyAudit();
}
if (backendOn) registerHydrator("audit log", hydrate);

let timer: ReturnType<typeof setTimeout> | undefined;
/** Re-read the trail from the server (debounced) after something that may have been audited. No-op in demo mode and for non-admins (RLS returns nothing). */
export function refreshAudit(delay = 700) {
  if (!backendOn) return;
  clearTimeout(timer); timer = setTimeout(() => { hydrate().catch(() => undefined); }, delay);
}

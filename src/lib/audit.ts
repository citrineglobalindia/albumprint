import { persistArray } from "./persist";
import { ROLES, type RoleKey } from "./auth";
import { backendOn } from "./supabase";
import { dbLogEvent } from "./db/audit";

// SRS ALB-FR-0001/0005/§20.2: every state-changing action records user, role, time, entity, old/new, reason. Append-only.
export interface AuditEntry {
  id: number; at: string; actor: string; role: RoleKey | "system"; entity: string; entityId: string; action: string;
  detail?: string; from?: string; to?: string; reason?: string; override?: boolean;
}
export const AUDIT: AuditEntry[] = persistArray<AuditEntry>("audit", [], { cap: 3000 });

export function currentActor(): { name: string; role: RoleKey | "system" } {
  try { const r = localStorage.getItem("albumpro.role") as RoleKey | null; if (r && r in ROLES) return { name: localStorage.getItem("albumpro.actor") || ROLES[r].user, role: r }; } catch { /* ignore */ }
  return { name: "System", role: "system" };
}

type Listener = () => void;
const subs = new Set<Listener>();
export const onAudit = (f: Listener) => { subs.add(f); return () => { subs.delete(f); }; };

export const notifyAudit = () => subs.forEach((f) => f());

export function logAudit(e: Omit<AuditEntry, "id" | "at" | "actor" | "role">): AuditEntry {
  const a = currentActor();
  // Backend: the server's audit_log is the trail (triggers + log_event, stamped with the real user). Nothing is kept in the browser.
  if (backendOn) { dbLogEvent(e); return { id: 0, at: new Date().toISOString(), actor: a.name, role: a.role, ...e }; }
  const entry: AuditEntry = { id: (AUDIT[0]?.id ?? 0) + 1, at: new Date().toISOString(), actor: a.name, role: a.role, ...e };
  AUDIT.unshift(entry);          // newest first
  subs.forEach((f) => f());
  return entry;
}

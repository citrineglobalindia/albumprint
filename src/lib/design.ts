import { persistArray } from "./persist";
import { logAudit } from "./audit";
import { notify } from "./store";
import { ORDERS } from "./data";
import { PROOFS } from "./proofs";
import { FILES } from "./files";
import { AUDIT } from "./audit";
import { backendOn } from "./supabase";
import { dbAddCorrection, dbCorrectionStatus, dbSaveMeta } from "./db/proofs";

// Designer-side state (SRS §9/§10): admin corrections, review flags and notes, kept per order.
export interface DesignCorrection { id: string; uid?: string; orderId: string; page: number; text: string; by: string; status: "Open" | "In Progress" | "Resolved"; assignee: string; at: string }
export interface DesignNote { text: string; by: string; when: string }
export interface DesignMeta { orderId: string; submitted?: boolean; adminApproved?: boolean; submittedAt?: string; notes: DesignNote[] }
export const DESIGN_CORR: DesignCorrection[] = persistArray<DesignCorrection>("design_corrections", []);
export const DESIGN_META: DesignMeta[] = persistArray<DesignMeta>("design_meta", []);

export function metaFor(orderId: string): DesignMeta {
  let m = DESIGN_META.find((x) => x.orderId === orderId);
  if (!m) { m = { orderId, notes: backendOn ? [] : [{ text: "Include couple name on cover and check colour tone for page 12.", by: "Admin", when: "2 hours ago" }] }; DESIGN_META.push(m); }
  return m;
}
export const correctionsFor = (orderId: string) => DESIGN_CORR.filter((c) => c.orderId === orderId);

export function addCorrection(orderId: string, page: number, text: string, by: string, assignee: string) {
  const n = Math.max(0, ...DESIGN_CORR.map((c) => Number(c.id.slice(4)))) + 1;
  const c: DesignCorrection = { id: `COR-${String(n).padStart(3, "0")}`, uid: backendOn ? crypto.randomUUID() : undefined, orderId, page, text, by, status: "Open", assignee, at: new Date().toISOString() };
  DESIGN_CORR.push(c); notify(); dbAddCorrection(c); logAudit({ entity: "design", entityId: orderId, action: "correction_added", detail: `${c.id} p${page}: ${text}` }); return c;
}
export function setCorrectionStatus(c: DesignCorrection, status: DesignCorrection["status"]) {
  const prev = c.status; c.status = status; notify(); dbCorrectionStatus(c, () => { c.status = prev; notify(); }); logAudit({ entity: "design", entityId: c.orderId, action: "correction_" + status.toLowerCase().replace(" ", "_"), detail: `${c.id} p${c.page}` });
}
export function save(orderId: string, patch: Partial<DesignMeta>, action: string, reason?: string) {
  Object.assign(metaFor(orderId), patch); notify(); dbSaveMeta(orderId, metaFor(orderId)); logAudit({ entity: "design", entityId: orderId, action, reason });
}
/** Persist a direct edit of the meta (e.g. notes) to the database (no-op in demo mode). */
export const persistMeta = (orderId: string) => dbSaveMeta(orderId, metaFor(orderId));

// Cross-tab sync: the public proof portal runs in another tab and writes to localStorage; refresh our in-memory copies when it does.
const SYNC: Record<string, unknown[]> = { proofs: PROOFS, orders: ORDERS, audit: AUDIT, files: FILES, design_corrections: DESIGN_CORR, design_meta: DESIGN_META };
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    const k = e.key?.replace("albumpro.v1.", "");
    const arr = k && e.key?.startsWith("albumpro.v1.") ? SYNC[k] : undefined;
    if (!arr || !e.newValue) return;
    try { const j = JSON.parse(e.newValue); if (Array.isArray(j)) { arr.splice(0, arr.length, ...j); notify(); } } catch { /* ignore */ }
  });
}

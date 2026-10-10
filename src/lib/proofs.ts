import { persistArray } from "./persist";
import { logAudit } from "./audit";
import { ORDERS } from "./data";
import { backendOn } from "./supabase";
import { dbCreateProof, dbRevokeProof, dbCommentState } from "./db/proofs";

// SRS §11 client proofing. Demo mode keeps the token to drive the demo portal; with the backend on only a SHA-256 hash is stored server-side
// (the full link exists in the browser that created it, shown once) and the client answers through the public proof_get / proof_respond functions.
export interface ProofComment { id?: string; page: number; text: string; at: string; resolved?: boolean; inProgress?: boolean }
export interface Proof {
  id: string; orderId: string; version: number; token: string; createdAt: string; expiresAt: string; sentVia: "WhatsApp" | "Email" | "Link";
  status: "sent" | "viewed" | "approved" | "corrections" | "expired" | "revoked"; viewedAt?: string; respondedAt?: string; approvedBy?: string; comments: ProofComment[]; pages: number;
}
export const PROOFS: Proof[] = persistArray<Proof>("proofs", []);

const rand = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
export function createProof(orderId: string, pages: number, via: Proof["sentVia"] = "Link", days = 7): Proof {
  const live = PROOFS.filter((p) => p.orderId === orderId && ["sent", "viewed"].includes(p.status));
  const prev = live.map((p) => [p, p.status] as const);
  live.forEach((p) => { p.status = "revoked"; });   // only the newest link is live
  const version = Math.max(0, ...PROOFS.filter((p) => p.orderId === orderId).map((p) => p.version)) + 1;
  const p: Proof = { id: backendOn ? crypto.randomUUID() : `PF${Date.now().toString(36)}`, orderId, version, token: rand(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 864e5).toISOString(), sentVia: via, status: "sent", comments: [], pages };
  PROOFS.unshift(p); logAudit({ entity: "proof", entityId: orderId, action: "send", detail: `v${version} via ${via}` });
  dbCreateProof(p, ORDERS.find((o) => o.id === orderId)?.uid, prev.map(([x]) => x.id), () => { const i = PROOFS.indexOf(p); if (i >= 0) PROOFS.splice(i, 1); prev.forEach(([x, s]) => { x.status = s; }); });
  return p;
}
export const proofByToken = (t: string) => {
  const p = PROOFS.find((x) => x.token === t);
  if (p && ["sent", "viewed"].includes(p.status) && new Date(p.expiresAt) < new Date()) p.status = "expired";
  return p;
};
export const latestProof = (orderId: string) => PROOFS.find((p) => p.orderId === orderId);
export const proofApproved = (orderId: string) => PROOFS.some((p) => p.orderId === orderId && p.status === "approved");
/** The full link exists only where the proof was created (the server keeps a hash); later sessions must send a new version. */
export const hasLink = (p: Proof) => !!p.token;
export const proofUrl = (p: Proof) => `${location.origin}/proof/${p.token}`;
// Demo-mode portal actions (with the backend on, the portal uses the proof_get / proof_respond RPCs instead).
export function markViewed(p: Proof) { if (p.status === "sent") { p.status = "viewed"; p.viewedAt = new Date().toISOString(); } }
export function approveProof(p: Proof, by: string) { p.status = "approved"; p.approvedBy = by; p.respondedAt = new Date().toISOString(); logAudit({ entity: "proof", entityId: p.orderId, action: "client_approval", detail: `v${p.version} by ${by}` }); }
export function requestCorrections(p: Proof, comments: ProofComment[]) { p.status = "corrections"; p.comments = comments; p.respondedAt = new Date().toISOString(); logAudit({ entity: "proof", entityId: p.orderId, action: "client_corrections", detail: `${comments.length} correction(s) on v${p.version}` }); }
export function revokeProof(p: Proof) {
  const prev = p.status; p.status = "revoked"; logAudit({ entity: "proof", entityId: p.orderId, action: "revoke", detail: `v${p.version}` });
  dbRevokeProof(p.id, () => { p.status = prev; });
}
/** Staff work a client correction (resolve / reopen / in progress). */
export function setCommentState(p: Proof, c: ProofComment, patch: { resolved?: boolean; inProgress?: boolean }, action: string) {
  const prev = { resolved: c.resolved, inProgress: c.inProgress };
  if (patch.resolved !== undefined) c.resolved = patch.resolved;
  if (patch.inProgress !== undefined) c.inProgress = patch.inProgress;
  logAudit({ entity: "proof", entityId: p.orderId, action, detail: `v${p.version} page ${c.page}` });
  dbCommentState(c.id, { resolved: !!c.resolved, in_progress: !!c.inProgress }, () => { c.resolved = prev.resolved; c.inProgress = prev.inProgress; });
}

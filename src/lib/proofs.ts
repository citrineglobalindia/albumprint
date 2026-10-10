import { persistArray } from "./persist";
import { logAudit } from "./audit";

// SRS §11 client proofing. In production only a hash of the token is stored server-side; here the token is kept to drive the demo portal.
export interface ProofComment { page: number; text: string; at: string; resolved?: boolean }
export interface Proof {
  id: string; orderId: string; version: number; token: string; createdAt: string; expiresAt: string; sentVia: "WhatsApp" | "Email" | "Link";
  status: "sent" | "viewed" | "approved" | "corrections" | "expired" | "revoked"; viewedAt?: string; respondedAt?: string; approvedBy?: string; comments: ProofComment[]; pages: number;
}
export const PROOFS: Proof[] = persistArray<Proof>("proofs", []);

const rand = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
export function createProof(orderId: string, pages: number, via: Proof["sentVia"] = "Link", days = 7): Proof {
  PROOFS.filter((p) => p.orderId === orderId && ["sent", "viewed"].includes(p.status)).forEach((p) => { p.status = "revoked"; });   // only the newest link is live
  const version = Math.max(0, ...PROOFS.filter((p) => p.orderId === orderId).map((p) => p.version)) + 1;
  const p: Proof = { id: `PF${Date.now().toString(36)}`, orderId, version, token: rand(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + days * 864e5).toISOString(), sentVia: via, status: "sent", comments: [], pages };
  PROOFS.unshift(p); logAudit({ entity: "proof", entityId: orderId, action: "send", detail: `v${version} via ${via}` }); return p;
}
export const proofByToken = (t: string) => {
  const p = PROOFS.find((x) => x.token === t);
  if (p && ["sent", "viewed"].includes(p.status) && new Date(p.expiresAt) < new Date()) p.status = "expired";
  return p;
};
export const latestProof = (orderId: string) => PROOFS.find((p) => p.orderId === orderId);
export const proofApproved = (orderId: string) => PROOFS.some((p) => p.orderId === orderId && p.status === "approved");
export const proofUrl = (p: Proof) => `${location.origin}/proof/${p.token}`;
export function markViewed(p: Proof) { if (p.status === "sent") { p.status = "viewed"; p.viewedAt = new Date().toISOString(); } }
export function approveProof(p: Proof, by: string) { p.status = "approved"; p.approvedBy = by; p.respondedAt = new Date().toISOString(); logAudit({ entity: "proof", entityId: p.orderId, action: "client_approval", detail: `v${p.version} by ${by}` }); }
export function requestCorrections(p: Proof, comments: ProofComment[]) { p.status = "corrections"; p.comments = comments; p.respondedAt = new Date().toISOString(); logAudit({ entity: "proof", entityId: p.orderId, action: "client_corrections", detail: `${comments.length} correction(s) on v${p.version}` }); }
export function revokeProof(p: Proof) { p.status = "revoked"; logAudit({ entity: "proof", entityId: p.orderId, action: "revoke", detail: `v${p.version}` }); }

import { persistArray } from "./persist";
import { logAudit, currentActor } from "./audit";

// SRS §7 file register. Binary content is not stored client-side; only metadata (a storage path would be set by the backend).
export type FileCategory = "Source Photos" | "Graded" | "Design Draft" | "Final Print" | "Cover" | "QC Evidence" | "Invoice" | "Other";
export type FileState = "Draft" | "Submitted" | "Approved" | "Rejected" | "Locked";
export interface FileRec { id: string; orderId: string; category: FileCategory; name: string; ext: string; size: number; version: number; state: FileState; archived?: boolean; by: string; at: string; checksum?: string }
export const FILES: FileRec[] = persistArray<FileRec>("files", []);
export const ALLOWED_EXT = ["jpg", "jpeg", "png", "tif", "tiff", "psd", "pdf", "zip", "ai", "indd", "cdr"];
export const MAX_BYTES = 5 * 1024 ** 3;

export function addFile(orderId: string, category: FileCategory, name: string, size: number): { ok: true; file: FileRec } | { ok: false; error: string } {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.includes(ext)) return { ok: false, error: `.${ext} is not an allowed file type` };
  if (size > MAX_BYTES) return { ok: false, error: "File exceeds the 5 GB limit" };
  const version = Math.max(0, ...FILES.filter((f) => f.orderId === orderId && f.category === category && f.name === name).map((f) => f.version)) + 1;   // never overwrite silently
  const file: FileRec = { id: `F${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, orderId, category, name, ext, size, version, state: "Draft", by: currentActor().name, at: new Date().toISOString() };
  FILES.unshift(file);
  logAudit({ entity: "file", entityId: orderId, action: "upload", detail: `${category}: ${name} v${version}` });
  return { ok: true, file };
}
export const filesFor = (orderId: string) => FILES.filter((f) => f.orderId === orderId && !f.archived);
export const hasPrintReadyFile = (orderId: string) => FILES.some((f) => f.orderId === orderId && f.category === "Final Print" && !f.archived);
export function lockFile(id: string) {
  const f = FILES.find((x) => x.id === id); if (!f) return;
  f.state = "Locked"; logAudit({ entity: "file", entityId: f.orderId, action: "lock", detail: `${f.name} v${f.version}` });
}
export function archiveFile(id: string) {
  const f = FILES.find((x) => x.id === id); if (!f || f.state === "Locked") return false;
  f.archived = true; logAudit({ entity: "file", entityId: f.orderId, action: "archive", detail: f.name }); return true;
}
export const fmtSize = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

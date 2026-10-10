import { persistArray } from "./persist";
import { logAudit, currentActor } from "./audit";
import { backendOn } from "./supabase";
import { notify } from "./store";
import { reportDbError, writeThrough } from "./db/core";
import { dbArchiveFile, dbLockFile, signedUrl, storagePathFor, uploadAndRegister } from "./db/files";

// SRS §7 file register. Demo mode keeps metadata only. With the backend on, the bytes go to the private Supabase Storage bucket
// `order-files` (path <order code>/<category>/<name>-v<n>), the row to public.order_files (size, sha-256, storage path), and downloads
// use short-lived signed URLs. Locking and archiving are enforced by the database (lock_final_print_file, immutability triggers).
export type FileCategory = "Source Photos" | "Graded" | "Design Draft" | "Final Print" | "Cover" | "QC Evidence" | "Invoice" | "Other";
export type FileState = "Draft" | "Submitted" | "Approved" | "Rejected" | "Locked";
export interface FileRec { id: string; orderId: string; category: FileCategory; name: string; ext: string; size: number; version: number; state: FileState; archived?: boolean; by: string; at: string; checksum?: string; path?: string; pending?: boolean }
export const FILES: FileRec[] = persistArray<FileRec>("files", []);
export const ALLOWED_EXT = ["jpg", "jpeg", "png", "tif", "tiff", "psd", "pdf", "zip", "ai", "indd", "cdr"];
export const MAX_BYTES = 5 * 1024 ** 3;
export type FileResult = { ok: true; file: FileRec; done?: Promise<{ ok: boolean; error?: string }> } | { ok: false; error: string };

/**
 * Register a file. The record shows up at once (optimistic). With the backend on and a `file` given, the bytes are uploaded and the row inserted in the
 * background (`done` resolves when stored; on failure the record is removed and the error is shown). Without a `file` the backend only gets the metadata row.
 */
export function addFile(orderId: string, category: FileCategory, name: string, size: number, file?: File): FileResult {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.includes(ext)) return { ok: false, error: `.${ext} is not an allowed file type` };
  if (size > MAX_BYTES) return { ok: false, error: "File exceeds the 5 GB limit" };
  const version = Math.max(0, ...FILES.filter((f) => f.orderId === orderId && f.category === category && f.name === name).map((f) => f.version)) + 1;   // never overwrite silently
  const id = backendOn && typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `F${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const rec: FileRec = { id, orderId, category, name, ext, size, version, state: "Draft", by: currentActor().name, at: new Date().toISOString() };
  FILES.unshift(rec);
  logAudit({ entity: "file", entityId: orderId, action: "upload", detail: `${category}: ${name} v${version}` });
  if (!backendOn) return { ok: true, file: rec };
  rec.path = storagePathFor(orderId, category, name, version); rec.pending = true;
  const done = uploadAndRegister(rec, file).then((s) => {
    rec.pending = false; rec.path = s.path; rec.version = s.version; rec.checksum = s.row.checksum ?? undefined; rec.at = s.row.uploaded_at ?? rec.at; notify(); return { ok: true as const };
  }, (e) => {
    const i = FILES.indexOf(rec); if (i >= 0) FILES.splice(i, 1);
    reportDbError(`Uploading ${name}`, e); notify(); return { ok: false as const, error: String((e as { message?: string })?.message ?? e) };
  });
  return { ok: true, file: rec, done };
}
export const filesFor = (orderId: string) => FILES.filter((f) => f.orderId === orderId && !f.archived && !f.pending);
export const hasPrintReadyFile = (orderId: string) => FILES.some((f) => f.orderId === orderId && f.category === "Final Print" && !f.archived && !f.pending);
export function lockFile(id: string) {
  const f = FILES.find((x) => x.id === id); if (!f) return;
  const prev = f.state; f.state = "Locked"; logAudit({ entity: "file", entityId: f.orderId, action: "lock", detail: `${f.name} v${f.version}` });
  writeThrough("Locking file", () => dbLockFile(id), () => { f.state = prev; notify(); });
}
export function archiveFile(id: string) {
  const f = FILES.find((x) => x.id === id); if (!f || f.state === "Locked") return false;
  f.archived = true; logAudit({ entity: "file", entityId: f.orderId, action: "archive", detail: f.name });
  writeThrough("Archiving file", () => dbArchiveFile(id), () => { f.archived = undefined; notify(); }); return true;
}
/** Download the stored bytes through a signed URL (backend) — or explain that demo mode stores no binary. */
export async function downloadFile(f: FileRec): Promise<{ ok: boolean; msg: string }> {
  if (!backendOn) return { ok: true, msg: `Download started: ${f.name} v${f.version} (${fmtSize(f.size)}). Demo: no binary is stored` };
  if (f.pending || !f.path) return { ok: false, msg: `${f.name} is still uploading` };
  try {
    const url = await signedUrl(f.path, f.name);
    const a = document.createElement("a"); a.href = url; a.download = f.name; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
    return { ok: true, msg: `Download started: ${f.name} v${f.version} (${fmtSize(f.size)})` };
  } catch (e) { return { ok: false, msg: `Download failed: ${String((e as { message?: string })?.message ?? e)}` }; }
}
/** URL for an in-browser preview (images/PDF) of a stored file; null in demo mode. */
export async function previewUrl(f: FileRec): Promise<string | null> { if (!backendOn || !f.path || f.pending) return null; try { return await signedUrl(f.path); } catch { return null; } }
export const fmtSize = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

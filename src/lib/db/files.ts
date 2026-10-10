import { ORDERS } from "../data";
import { notify } from "../store";
import { FILES, type FileRec, type FileCategory, type FileState } from "../files";
import { backendOn, sb, q, registerHydrator } from "./core";
import { staffName } from "./production";

// File register ⇄ public.order_files, bytes ⇄ the private Storage bucket `order-files` (path <order code>/<category>/<name>-v<n>).
// The browser uploads straight to Storage with the user's session, so the bucket's row-level-security policies decide who may write.
export const BUCKET = "order-files";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const CAT: Record<string, FileCategory> = { source_photos: "Source Photos", graded: "Graded", design_draft: "Design Draft", final_print: "Final Print", cover: "Cover", qc_evidence: "QC Evidence", invoice: "Invoice", other: "Other" };
export const CAT_DB = Object.fromEntries(Object.entries(CAT).map(([k, v]) => [v, k])) as Record<FileCategory, string>;
const STATE: Record<string, FileState> = { draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected", locked: "Locked" };
export const stateToDb = (s: FileState) => s.toLowerCase();

export const orderUidOf = (code: string) => ORDERS.find((o) => o.id === code)?.uid;
const codeOf = (uid: string) => ORDERS.find((o) => o.uid === uid)?.id;

export function fileFromRow(r: Row): FileRec | null {
  const orderId = codeOf(r.order_id); if (!orderId) return null;
  return { id: r.id, orderId, category: CAT[r.category] ?? "Other", name: r.file_name, ext: r.ext, size: Number(r.size_bytes), version: r.version, state: STATE[r.state] ?? "Draft",
    archived: r.archived || undefined, by: staffName(r.uploaded_by) ?? "—", at: r.uploaded_at, checksum: r.checksum ?? undefined, path: r.storage_path };
}

async function hydrate() {
  const rows = await q<Row[]>("Loading files", sb().from("order_files").select("*").order("uploaded_at", { ascending: false }) as never);
  FILES.splice(0, FILES.length, ...(rows ?? []).map(fileFromRow).filter((f): f is FileRec => !!f));
  notify();
}
if (backendOn) registerHydrator("files", hydrate);

/** Safe object key segment: Storage rejects many characters; the original name is kept in order_files.file_name. */
export const safeKey = (name: string) => name.normalize("NFKD").replace(/[^A-Za-z0-9._()-]+/g, "_").replace(/^\.+/, "_");
export const storagePathFor = (orderCode: string, cat: FileCategory, name: string, version: number) => `${orderCode}/${CAT_DB[cat]}/${safeKey(name)}-v${version}`;

/** sha-256 of the bytes (hex). Skipped for very large files (WebCrypto has no streaming digest) or insecure contexts. */
export async function sha256(file: Blob): Promise<string | undefined> {
  try {
    if (!globalThis.crypto?.subtle || file.size > 512 * 1024 ** 2) return undefined;
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
    return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return undefined; }
}

export interface StoredFile { path: string; version: number; row: Row }
/** Upload the bytes, then register the row. Retries with the next version if the object name is already taken. Throws on failure. */
export async function uploadAndRegister(rec: FileRec, file: File | undefined): Promise<StoredFile> {
  const client = sb(); const orderUid = orderUidOf(rec.orderId); if (!orderUid) throw new Error("Order not found");
  const checksum = file ? await sha256(file) : undefined;
  let version = rec.version; let path = rec.path ?? storagePathFor(rec.orderId, rec.category, rec.name, version);
  if (file) {
    for (let attempt = 0; ; attempt++) {
      const { error } = await client.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream", cacheControl: "3600" });
      if (!error) break;
      const dup = /already exists|Duplicate/i.test(error.message) || String((error as { statusCode?: string }).statusCode) === "409";
      if (!dup || attempt >= 8) throw error;
      version += 1; path = storagePathFor(rec.orderId, rec.category, rec.name, version);
    }
  }
  const { data, error } = await client.from("order_files").insert({ id: rec.id, order_id: orderUid, category: CAT_DB[rec.category], file_name: rec.name, ext: rec.ext, size_bytes: rec.size, storage_path: path, checksum: checksum ?? null }).select().single();
  if (error) throw error;
  return { path, version: data.version, row: data };
}

/** A short-lived signed link to the stored bytes (the bucket is private). */
export async function signedUrl(path: string, downloadAs?: string): Promise<string> {
  const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, 120, downloadAs ? { download: downloadAs } : undefined);
  if (error || !data) throw error ?? new Error("Could not create a download link");
  return data.signedUrl;
}
export async function dbLockFile(id: string) { return sb().rpc("lock_final_print_file", { p_file: id }) as never as PromiseLike<{ error: { message: string } | null }>; }
export function dbArchiveFile(id: string) { return sb().from("order_files").update({ archived: true }).eq("id", id) as never as PromiseLike<{ error: { message: string } | null }>; }

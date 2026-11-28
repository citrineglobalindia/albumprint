import { ORDERS, CUSTOMERS } from "./data";
import { persistArray } from "./persist";
import { notify } from "./store";
import { backendOn } from "./supabase";
import { currentActor, logAudit } from "./audit";
import { loadSettings } from "./localState";

// Album preview for clients (migration 0075): the designer uploads an album's pages (images, or a PDF that is turned into page
// images right here in the browser), the client opens a private link and turns the pages like a real album, then approves it
// or asks for changes. Pages are stored as JPEGs under a random folder in the public bucket `album-previews`.
export type PreviewStatus = "shared" | "approved" | "changes";
export interface Feedback { id: string; page?: number; name?: string; message: string; kind: "comment" | "changes" | "approve"; resolved: boolean; at: string }
export interface Preview { id: string; orderId: string; album: number; title: string; version: number; token: string; folder: string; pages: number; spreads: boolean; status: PreviewStatus; approvedBy?: string; at: string; by?: string; feedback: Feedback[]; demoPages?: string[] }
export const PREVIEWS: Preview[] = persistArray<Preview>("album_previews", []);
export const BUCKET = "album-previews";
export const STATUS_LABEL: Record<PreviewStatus, string> = { shared: "Shared · waiting for client", approved: "Approved by client", changes: "Changes requested" };

/** Page images picked in this browser (demo mode keeps no bytes, and it makes the preview instant after an upload). */
const LOCAL = new Map<string, string[]>();
export const previewsOf = (orderId: string, album?: number) => PREVIEWS.filter((p) => p.orderId === orderId && (album === undefined || p.album === album)).sort((a, b) => b.version - a.version);
export const linkOf = (p: Pick<Preview, "token">) => `${location.origin}/album/${p.token}`;
/** URLs of a preview's page images, in order. */
export function pageUrls(p: Pick<Preview, "folder" | "pages"> & { demoPages?: string[] }): string[] {
  const local = LOCAL.get(p.folder); if (local) return local;
  if (p.demoPages?.length) return p.demoPages;
  if (!backendOn) return [];
  const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");
  return Array.from({ length: p.pages }, (_, i) => `${base}/storage/v1/object/public/${BUCKET}/${p.folder}/${i + 1}.jpg`);
}
export const canUpload = () => ["admin", "designer", "reception"].includes(currentActor().role);
const rand = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
type Res = { ok: boolean; msg: string };

/* ───────── turning the upload into page images ───────── */
const MAX_W = 2400;
async function toJpeg(src: CanvasImageSource & { width: number; height: number }, w: number, h: number): Promise<Blob> {
  const scale = Math.min(1, MAX_W / w), c = document.createElement("canvas");
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not read the page"))), "image/jpeg", 0.85));
}
async function imageToJpeg(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const blob = await toJpeg(bmp, bmp.width, bmp.height); const r = { blob, w: bmp.width, h: bmp.height }; bmp.close(); return r;
}
async function pdfToJpegs(file: File, onPage: (i: number, n: number) => void): Promise<{ blob: Blob; w: number; h: number }[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: { blob: Blob; w: number; h: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onPage(i, doc.numPages);
    const page = await doc.getPage(i), base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(3, MAX_W / base.width) });
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp, canvas: c } as never).promise;
    out.push({ blob: await toJpeg(c, c.width, c.height), w: c.width, h: c.height });
    page.cleanup();
  }
  await doc.destroy();
  return out;
}
/** The pages of an upload: one PDF, or images (sorted by name: 01.jpg, 02.jpg, …). */
export async function pagesFrom(files: File[], onStep: (msg: string) => void): Promise<{ blob: Blob; w: number; h: number }[]> {
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name)), imgs = files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name));
  if (pdfs.length > 1 || (pdfs.length && imgs.length)) throw new Error("Upload one PDF, or the page images (JPG / PNG)");
  if (pdfs.length) return pdfToJpegs(pdfs[0]!, (i, n) => onStep(`Reading page ${i} of ${n}…`));
  if (!imgs.length) throw new Error("Choose a PDF or JPG / PNG page images");
  const sorted = [...imgs].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const out = [];
  for (const [i, f] of sorted.entries()) { onStep(`Preparing page ${i + 1} of ${sorted.length}…`); out.push(await imageToJpeg(f)); }
  return out;
}

/** Upload an album for the client to preview: a new version for that album with its own link. */
export async function createPreview(orderId: string, album: number, title: string, files: File[], spreads: boolean | "auto", onStep: (msg: string, pct?: number) => void): Promise<Res & { preview?: Preview }> {
  if (!canUpload()) return { ok: false, msg: "Your role can't upload albums" };
  const o = ORDERS.find((x) => x.id === orderId); if (!o) return { ok: false, msg: "Order not found" };
  let pages: { blob: Blob; w: number; h: number }[];
  try { pages = await pagesFrom(files, (m) => onStep(m)); } catch (e) { return { ok: false, msg: String((e as Error).message ?? e) }; }
  if (!pages.length) return { ok: false, msg: "No pages found" };
  if (pages.length > 400) return { ok: false, msg: "An album can have at most 400 pages" };
  const isSpreads = spreads === "auto" ? pages.filter((p) => p.w / p.h > 1.3).length * 2 >= pages.length : spreads;   // most images wide = an album of spreads (the cover may be portrait)
  const version = Math.max(0, ...previewsOf(orderId, album).map((p) => p.version)) + 1;
  let id = `AP${Date.now().toString(36)}`, token = rand(), folder = rand();
  if (backendOn) {
    if (!o.uid) return { ok: false, msg: "Order not found" };
    const { sb } = await import("./db/core");
    const { data, error } = await sb().from("album_previews").insert({ order_id: o.uid, album, title: title.trim() || `Album ${album}`, version, pages: 0, spreads: isSpreads }).select("id, token, folder").single();
    if (error || !data) return { ok: false, msg: error?.message ?? "Could not create the preview" };
    id = String(data.id); token = String(data.token); folder = String(data.folder);
    for (const [i, pg] of pages.entries()) {
      onStep(`Uploading page ${i + 1} of ${pages.length}…`, Math.round(((i + 1) / pages.length) * 100));
      const up = await sb().storage.from(BUCKET).upload(`${folder}/${i + 1}.jpg`, pg.blob, { upsert: false, contentType: "image/jpeg", cacheControl: "31536000" });
      if (up.error) { await sb().from("album_previews").delete().eq("id", id); return { ok: false, msg: `Upload failed on page ${i + 1}: ${up.error.message}` }; }
    }
    const { error: e2 } = await sb().from("album_previews").update({ pages: pages.length }).eq("id", id);
    if (e2) return { ok: false, msg: e2.message };
  } else logAudit({ entity: "order", entityId: orderId, action: "album_preview", detail: `Album ${album} v${version}: ${pages.length} pages` });
  LOCAL.set(folder, pages.map((p) => URL.createObjectURL(p.blob)));
  // demo mode stores no files: keep small albums in this browser so the client link works after a reload
  const demoPages = !backendOn && pages.reduce((a, x) => a + x.blob.size, 0) < 2_500_000 ? await Promise.all(pages.map((x) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(x.blob); }))) : undefined;
  const p: Preview = { id, orderId, album, title: title.trim() || `Album ${album}`, version, token, folder, pages: pages.length, spreads: isSpreads, status: "shared", at: new Date().toISOString(), by: currentActor().name, feedback: [], demoPages };
  PREVIEWS.unshift(p); notify();
  return { ok: true, msg: `${p.title} v${version} uploaded — ${pages.length} ${isSpreads ? "spreads" : "pages"} · share the link with the client`, preview: p };
}

/** Delete an uploaded album preview (its link stops working). */
export async function deletePreview(id: string): Promise<Res> {
  const p = PREVIEWS.find((x) => x.id === id); if (!p) return { ok: false, msg: "Not found" };
  if (currentActor().role !== "admin" && p.by !== currentActor().name && !canUpload()) return { ok: false, msg: "Your role can't delete albums" };
  if (backendOn) {
    const { sb } = await import("./db/core");
    const { error, count } = await sb().from("album_previews").delete({ count: "exact" }).eq("id", id);
    if (error) return { ok: false, msg: error.message };
    if (!count) return { ok: false, msg: "Only the person who uploaded this album or an admin can delete it" };
    void sb().storage.from(BUCKET).remove(Array.from({ length: p.pages }, (_, i) => `${p.folder}/${i + 1}.jpg`));
  } else logAudit({ entity: "order", entityId: p.orderId, action: "album_preview_delete", detail: `${p.title} v${p.version}` });
  PREVIEWS.splice(PREVIEWS.indexOf(p), 1); LOCAL.delete(p.folder); notify();
  return { ok: true, msg: `${p.title} v${p.version} deleted — its link no longer works` };
}

/** WhatsApp the client the album link. */
export function shareOnWhatsApp(p: Preview): string | null {
  const o = ORDERS.find((x) => x.id === p.orderId);
  const c = CUSTOMERS.find((x) => x.studio === o?.customer || x.name === o?.customer);
  const num = (c?.whatsapp || c?.mobile || o?.mobile || "").replace(/\D/g, ""), wa = num.length === 10 ? `91${num}` : num;
  const studio = String(loadSettings().name || "Innovative Photo Designers");
  const text = `Hello ${c?.name || o?.customer || ""}, your album "${p.title}" (order ${p.orderId}) is ready to preview from ${studio}:\n${linkOf(p)}\nTurn the pages, and tap "Request changes" for anything you'd like changed, or "Approve album" when it's perfect.`;
  window.open(`https://wa.me/${wa.length >= 11 ? wa : ""}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  return wa.length >= 11 ? null : "No WhatsApp number on this customer — choose the chat in WhatsApp";
}

/** Staff mark a client's feedback as done (or not). */
export async function setResolved(previewId: string, feedbackId: string, resolved: boolean): Promise<Res> {
  const p = PREVIEWS.find((x) => x.id === previewId), f = p?.feedback.find((x) => x.id === feedbackId); if (!p || !f) return { ok: false, msg: "Not found" };
  if (backendOn) { const { sb } = await import("./db/core"); const { error } = await sb().from("album_preview_feedback").update({ resolved }).eq("id", feedbackId); if (error) return { ok: false, msg: error.message }; }
  f.resolved = resolved; notify(); return { ok: true, msg: resolved ? "Marked as done" : "Marked as not done" };
}

/* ───────── the client's side (public link, no login) ───────── */
export interface PublicView { title: string; version: number; pages: string[]; spreads: boolean; status: PreviewStatus; approvedBy?: string; orderCode: string; customer: string; feedback: Feedback[] }
export async function publicGet(token: string): Promise<PublicView | null> {
  if (!backendOn) {
    const p = PREVIEWS.find((x) => x.token === token); if (!p) return null;
    const o = ORDERS.find((x) => x.id === p.orderId);
    return { title: p.title, version: p.version, pages: pageUrls(p), spreads: p.spreads, status: p.status, approvedBy: p.approvedBy, orderCode: p.orderId, customer: o?.customer ?? "", feedback: p.feedback };
  }
  const { portalClient } = await import("./db/proofs");
  const { data, error } = await portalClient().rpc("album_preview_get", { p_token: token });
  const d = data as Record<string, unknown> | null;
  if (error || !d || d.error) return null;
  return { title: String(d.title), version: Number(d.version), pages: pageUrls({ folder: String(d.folder), pages: Number(d.pages) }), spreads: !!d.spreads, status: d.status as PreviewStatus,
    approvedBy: (d.approved_by as string | null) ?? undefined, orderCode: String(d.order_code), customer: String(d.customer ?? ""),
    feedback: ((d.feedback as Record<string, unknown>[]) ?? []).map((f, i) => ({ id: String(i), page: (f.page as number | null) ?? undefined, name: (f.name as string | null) ?? undefined, message: String(f.message), kind: f.kind as Feedback["kind"], resolved: !!f.resolved, at: String(f.at) })) };
}
export async function publicFeedback(token: string, d: { page?: number; name: string; message: string; kind: Feedback["kind"] }): Promise<Res> {
  if (d.kind !== "approve" && !d.message.trim()) return { ok: false, msg: "Write what you would like changed" };
  if (!backendOn) {
    const p = PREVIEWS.find((x) => x.token === token); if (!p) return { ok: false, msg: "This link is not valid any more" };
    p.feedback.push({ id: `FB${Date.now().toString(36)}`, page: d.page, name: d.name.trim() || undefined, message: d.message.trim() || "Approved", kind: d.kind, resolved: false, at: new Date().toISOString() });
    if (d.kind === "approve") { p.status = "approved"; p.approvedBy = d.name.trim() || undefined; } else if (d.kind === "changes" && p.status !== "approved") p.status = "changes";
    notify(); return { ok: true, msg: d.kind === "approve" ? "Thank you — the album is approved" : "Thank you — the studio will see your note" };
  }
  const { portalClient } = await import("./db/proofs");
  const { error } = await portalClient().rpc("album_preview_feedback_add", { p_token: token, p_page: d.page ?? null, p_name: d.name, p_message: d.message, p_kind: d.kind });
  if (error) return { ok: false, msg: error.message };
  return { ok: true, msg: d.kind === "approve" ? "Thank you — the album is approved" : "Thank you — the studio will see your note" };
}

/** Database: load the previews and their feedback (staff). */
export async function hydratePreviews() {
  if (!backendOn) return;
  const { sb } = await import("./db/core"); const { staffName } = await import("./db/production");
  const [p, f] = await Promise.all([sb().from("album_previews").select("*").order("created_at", { ascending: false }), sb().from("album_preview_feedback").select("*").order("created_at")]);
  if (p.error) throw new Error(p.error.message);
  const code = new Map(ORDERS.filter((o) => o.uid).map((o) => [o.uid!, o.id]));
  const fb = new Map<string, Feedback[]>();
  for (const r of (f.data ?? []) as Record<string, unknown>[]) { const l = fb.get(String(r.preview_id)) ?? []; l.push({ id: String(r.id), page: (r.page as number | null) ?? undefined, name: (r.name as string | null) ?? undefined, message: String(r.message), kind: r.kind as Feedback["kind"], resolved: !!r.resolved, at: String(r.created_at) }); fb.set(String(r.preview_id), l); }
  PREVIEWS.splice(0, PREVIEWS.length, ...((p.data ?? []) as Record<string, unknown>[]).flatMap((r) => { const id = code.get(String(r.order_id)); return id && Number(r.pages) > 0 ? [{
    id: String(r.id), orderId: id, album: Number(r.album), title: String(r.title), version: Number(r.version), token: String(r.token), folder: String(r.folder), pages: Number(r.pages), spreads: !!r.spreads,
    status: r.status as PreviewStatus, approvedBy: (r.approved_by as string | null) ?? undefined, at: String(r.created_at), by: staffName(r.created_by as string) ?? undefined, feedback: fb.get(String(r.id)) ?? [] }] : []; }));
  notify();
}

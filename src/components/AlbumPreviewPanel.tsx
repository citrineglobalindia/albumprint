import { useState } from "react";
import { BookOpen, Check, Copy, ExternalLink, Eye, Link2, MessageCircle, RotateCcw, Share2, Trash2, Upload, X } from "lucide-react";
import { Panel, Pill, cx } from "./ui";
import { AlbumFlipbook } from "./AlbumFlipbook";
import { useStore } from "../lib/store";
import { fmtDate } from "../lib/format";
import type { Order } from "../lib/data";
import { albumsOf } from "../lib/labs";
import { FILES, previewUrl } from "../lib/files";
import { STATUS_LABEL, canUpload, createPreview, deletePreview, linkOf, pageUrls, previewsOf, setResolved, shareOnWhatsApp, type Preview } from "../lib/albumPreview";

const TONE = { shared: "blue", approved: "green", changes: "amber" } as const;
type Res = { ok: boolean; msg: string };

/** Order page: upload each album for the client, preview it as a page-turning book, share the link on WhatsApp,
 *  and see the client's changes / approval. */
export function AlbumPreviewPanel({ o, onDone, className = "mt-5" }: { o: Order; onDone: (msg: string, ok: boolean) => void; className?: string }) {
  useStore();
  const albums = albumsOf(o);
  const [viewing, setViewing] = useState<Preview | null>(null);
  return (
    <Panel className={className} title="Album preview for the client" subtitle="Upload the album (PDF or page images), check it as a page-turning book, then share the link on WhatsApp — the client can ask for changes or approve" bodyClassName="space-y-3">
      {albums.map((a) => <AlbumBlock key={a.position} o={o} album={a.position} title={a.title} onDone={onDone} onView={setViewing} />)}
      {viewing && <PreviewModal p={viewing} onClose={() => setViewing(null)} />}
    </Panel>
  );
}

/** Full-screen page-turning preview of an uploaded album. */
export function PreviewModal({ p, onClose }: { p: Preview; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-3 sm:p-6" role="dialog" aria-label={`Preview of ${p.title}`} onClick={onClose}>
      <div className="mx-auto flex w-full max-w-6xl flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center gap-2 text-white"><BookOpen className="size-5" /><b className="flex-1">{p.title} · v{p.version} · {STATUS_LABEL[p.status]}</b><button type="button" aria-label="Close preview" onClick={onClose} className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20"><X className="size-5" /></button></div>
        <AlbumFlipbook pages={pageUrls(p)} spreads={p.spreads} />
      </div>
    </div>
  );
}

function AlbumBlock({ o, album, title, onDone, onView }: { o: Order; album: number; title: string; onDone: (msg: string, ok: boolean) => void; onView: (p: Preview) => void }) {
  const list = previewsOf(o.id, album), cur = list[0];
  const [step, setStep] = useState<{ msg: string; pct?: number } | null>(null);
  const [spreads, setSpreads] = useState<"auto" | "yes" | "no">("auto");
  const [old, setOld] = useState(false);
  const up = canUpload();
  const drafts = FILES.filter((f) => f.orderId === o.id && f.category === "Design Draft" && !f.archived && !f.pending && /^(pdf|jpe?g|png|webp)$/i.test(f.ext));
  const fromDesignFiles = async () => {
    const pdfs = drafts.filter((f) => /^pdf$/i.test(f.ext)), imgs = drafts.filter((f) => !/^pdf$/i.test(f.ext));
    const pick = pdfs.length ? [pdfs.sort((a, b) => b.at.localeCompare(a.at))[0]!] : imgs;    // the newest PDF, else all the page images
    setStep({ msg: "Fetching the design files…" });
    const files: File[] = [];
    for (const f of pick) {
      const url = await previewUrl(f);
      if (!url) { setStep(null); onDone(`${f.name} is not available in this browser — upload the album here instead`, false); return; }
      const blob = await (await fetch(url)).blob(); files.push(new File([blob], f.name, { type: blob.type }));
    }
    await upload(files);
  };
  const upload = async (files: File[]) => {
    setStep({ msg: "Reading the album…" });
    const r = await createPreview(o.id, album, title, files, spreads === "auto" ? "auto" : spreads === "yes", (msg, pct) => setStep({ msg, pct }));
    setStep(null); onDone(r.msg, r.ok);
  };
  const run = (p: Promise<Res>) => void p.then((r) => onDone(r.msg, r.ok));
  const open = cur ? cur.feedback.filter((f) => f.kind !== "approve" && !f.resolved).length : 0;
  return (
    <div className="rounded-xl border border-line p-3" data-testid={`preview-album-${album}`}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="min-w-0 flex-1 truncate text-[14px]">{title}</b>
        {cur ? <span data-testid="preview-status"><Pill tone={TONE[cur.status]}>{STATUS_LABEL[cur.status]}{cur.status === "approved" && cur.approvedBy ? ` · ${cur.approvedBy}` : ""}</Pill></span> : <Pill tone="slate">Not uploaded</Pill>}
      </div>

      {cur && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-sub">v{cur.version} · {cur.pages} {cur.spreads ? "spreads" : "pages"} · {fmtDate(cur.at)}{cur.by ? ` · ${cur.by}` : ""}</span>
          <span className="flex-1" />
          <button type="button" onClick={() => onView(cur)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand px-3 font-bold text-white hover:bg-brand-dark"><Eye className="size-3.5" />Preview</button>
          <button type="button" onClick={() => { const e = shareOnWhatsApp(cur); onDone(e ?? "WhatsApp opened with the album link", !e); }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 font-bold text-emerald-700 hover:bg-emerald-100"><MessageCircle className="size-3.5" />Share on WhatsApp</button>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(linkOf(cur)).then(() => onDone("Album link copied", true), () => onDone(linkOf(cur), true)); }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-3 font-bold hover:bg-slate-50"><Copy className="size-3.5" />Copy link</button>
          {up && <button type="button" aria-label={`Delete ${title} v${cur.version}`} onClick={() => { if (window.confirm(`Delete ${title} v${cur.version}? Its link stops working.`)) run(deletePreview(cur.id)); }} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 font-bold text-rose-600 hover:bg-rose-50"><Trash2 className="size-3.5" />Delete</button>}
        </div>
      )}

      {cur && <ShareBox p={cur} onDone={onDone} />}

      {cur && cur.feedback.length > 0 && (
        <div className="mt-2 rounded-lg bg-amber-50/60 p-2" data-testid="preview-feedback">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-amber-800">Client feedback{open ? ` · ${open} to do` : ""}</div>
          <ul className="space-y-1">{cur.feedback.map((f) => (
            <li key={f.id} className={cx("flex items-start gap-2 rounded-md bg-white px-2 py-1.5 text-[12px]", f.resolved && "opacity-60")}>
              <span className="w-20 shrink-0 font-semibold text-sub">{f.kind === "approve" ? "Approved" : f.page ? `${cur.spreads ? "Spread" : "Page"} ${f.page}` : "General"}</span>
              <span className="min-w-0 flex-1"><span className={cx(f.resolved && "line-through")}>{f.message}</span><span className="block text-[10px] text-sub">{f.name ? `${f.name} · ` : ""}{fmtDate(f.at)}</span></span>
              {f.kind !== "approve" && <button type="button" aria-label={f.resolved ? "Mark not done" : "Mark done"} onClick={() => run(setResolved(cur.id, f.id, !f.resolved))} className={cx("inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-bold", f.resolved ? "text-sub hover:bg-slate-100" : "bg-emerald-600 text-white hover:bg-emerald-700")}>{f.resolved ? <><RotateCcw className="size-3" />Undo</> : <><Check className="size-3" />Done</>}</button>}
            </li>))}</ul>
        </div>
      )}

      {up && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <label className={cx("inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-brand px-3 font-bold text-brand hover:bg-brand-soft", step && "pointer-events-none opacity-50")}>
            <Upload className="size-3.5" />{cur ? "Upload new version" : "Upload album"}
            <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" aria-label={`Upload album pages for ${title}`} className="sr-only" onChange={(e) => { const fl = Array.from(e.target.files ?? []); e.target.value = ""; if (fl.length) void upload(fl); }} />
          </label>
          {drafts.length > 0 && <button type="button" disabled={!!step} onClick={() => void fromDesignFiles()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 font-bold text-white hover:bg-brand-dark disabled:opacity-50"><BookOpen className="size-3.5" />Make preview from design files ({drafts.length})</button>}
          <select aria-label="Page layout" className="h-9 rounded-lg border border-line px-2 text-xs" value={spreads} onChange={(e) => setSpreads(e.target.value as typeof spreads)}>
            <option value="auto">Layout: detect</option><option value="yes">Each image is a spread (2 pages)</option><option value="no">Each image is one page</option>
          </select>
          <span className="text-[11px] text-sub">One PDF, or JPG / PNG pages named in order (01, 02, …)</span>
        </div>
      )}
      {step && <div className="mt-2" role="status"><div className="text-[11px] font-semibold text-brand">{step.msg}</div>{step.pct !== undefined && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand transition-all" style={{ width: `${step.pct}%` }} /></div>}</div>}

      {list.length > 1 && (
        <div className="mt-2 text-xs">
          <button type="button" onClick={() => setOld(!old)} className="font-bold text-sub hover:text-brand">{old ? "Hide" : "Show"} earlier versions ({list.length - 1})</button>
          {old && <ul className="mt-1 space-y-1">{list.slice(1).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 text-sub">v{p.version} · {p.pages} {p.spreads ? "spreads" : "pages"} · {STATUS_LABEL[p.status]} · {fmtDate(p.at)}
              <button type="button" onClick={() => onView(p)} className="font-bold text-brand hover:underline">Preview</button>
              {up && <button type="button" aria-label={`Delete ${title} v${p.version}`} onClick={() => { if (window.confirm(`Delete ${title} v${p.version}?`)) run(deletePreview(p.id)); }} className="font-bold text-rose-600 hover:underline">Delete</button>}
            </li>))}</ul>}
        </div>
      )}
    </div>
  );
}

/** The client link of an uploaded album, shown in full, with Copy / Open / WhatsApp / Share (the phone's share menu). */
function ShareBox({ p, onDone }: { p: Preview; onDone: (msg: string, ok: boolean) => void }) {
  const url = linkOf(p);
  const copy = () => { void (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(() => onDone("Album link copied — paste it in WhatsApp, SMS or email", true), () => onDone("Select the link and copy it", false)); };
  const share = () => {
    if (navigator.share) void navigator.share({ title: p.title, text: `Your album "${p.title}" is ready to preview`, url }).catch(() => undefined);
    else copy();
  };
  const b = "inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold";
  return (
    <div className="mt-2 rounded-lg border border-brand/30 bg-brand-soft/40 p-2" data-testid="share-box">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand"><Link2 className="size-3.5" />Client link · v{p.version}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input readOnly aria-label="Album link" value={url} onFocus={(e) => e.currentTarget.select()} className="h-8 min-w-[200px] flex-1 rounded-lg border border-line bg-white px-2 font-mono text-[11px]" />
        <button type="button" onClick={copy} className={cx(b, "bg-brand text-white hover:bg-brand-dark")}><Copy className="size-3.5" />Copy</button>
        <a href={url} target="_blank" rel="noreferrer" className={cx(b, "border border-line bg-white hover:bg-slate-50")}><ExternalLink className="size-3.5" />Open</a>
        <button type="button" onClick={() => { const e = shareOnWhatsApp(p); onDone(e ?? "WhatsApp opened with the album link", !e); }} className={cx(b, "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100")}><MessageCircle className="size-3.5" />WhatsApp</button>
        <button type="button" onClick={share} className={cx(b, "border border-line bg-white hover:bg-slate-50")}><Share2 className="size-3.5" />Share…</button>
      </div>
    </div>
  );
}

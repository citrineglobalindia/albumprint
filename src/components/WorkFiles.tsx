import { useEffect, useRef, useState } from "react";
import { Download, FileText, ImageIcon, Trash2, UploadCloud, X, FileArchive } from "lucide-react";
import { cx, Pill } from "./ui";
import { useStore } from "../lib/store";
import { FILES, MAX_TEXT, archiveFile, downloadFile, fmtSize, previewUrl, type FileCategory, type FileRec } from "../lib/files";

// The files a department works from and the files it produces, side by side: thumbnails, a preview, download, and an upload
// box for images (JPG, PNG, TIFF) or PDF. Used by Colour Grading (source photos → graded files) and Album Designing
// (graded photos → design pages).
const IMG = /^(jpe?g|png|webp|gif)$/;
const kindIcon = (ext: string) => (ext === "pdf" ? FileText : ext === "zip" ? FileArchive : ImageIcon);

function Tile({ f, onOpen, onRemove }: { f: FileRec; onOpen: (f: FileRec) => void; onRemove?: (f: FileRec) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {                                                    // signed preview links only for tiles that scroll into view
    if (!IMG.test(f.ext) || f.pending) return;
    let live = true; const el = ref.current;
    const load = () => void previewUrl(f).then((u) => { if (live) setUrl(u); });
    if (!el || typeof IntersectionObserver === "undefined") { load(); return () => { live = false; }; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { load(); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el); return () => { live = false; io.disconnect(); };
  }, [f.id, f.pending, f.path]);
  const I = kindIcon(f.ext);
  return (
    <div ref={ref} data-testid="work-file" className="group relative overflow-hidden rounded-lg border border-line bg-white">
      <button type="button" onClick={() => onOpen(f)} disabled={f.pending} aria-label={`Preview ${f.name}`} className="block aspect-[4/3] w-full bg-slate-50">
        {url ? <img src={url} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-sub"><I className="size-7" /><span className="sr-only">{f.ext}</span></span>}
      </button>
      {f.pending && <div className="absolute inset-x-0 bottom-0 h-1 bg-line"><div className="h-full bg-brand transition-all" style={{ width: `${f.progress ?? 5}%` }} /></div>}
      <div className="flex items-center gap-1 px-2 py-1.5">
        <div className="min-w-0 flex-1"><div className="truncate text-[11px] font-bold" title={f.name}>{f.name}</div><div className="text-[10px] text-sub">{f.pending ? `uploading${f.progress != null ? ` ${f.progress}%` : "…"}` : `v${f.version} · ${fmtSize(f.size)}`}</div></div>
        {!f.pending && <button type="button" aria-label={`Download ${f.name}`} onClick={() => void downloadFile(f)} className="grid size-6 place-items-center rounded text-sub hover:bg-brand-soft hover:text-brand"><Download className="size-3.5" /></button>}
        {onRemove && !f.pending && f.state !== "Locked" && <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f)} className="grid size-6 place-items-center rounded text-sub hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-3.5" /></button>}
      </div>
    </div>
  );
}

function Preview({ f, onClose }: { f: FileRec; onClose: () => void }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => { void previewUrl(f).then(setUrl); }, [f.id]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const canShow = IMG.test(f.ext) || f.ext === "pdf";
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-ink/85 p-4" onMouseDown={onClose} role="dialog" aria-label={`Preview ${f.name}`} data-testid="file-preview">
      <div className="mb-2 flex items-center gap-3 text-white" onMouseDown={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{f.name} <span className="font-normal opacity-70">v{f.version} · {fmtSize(f.size)}</span></span>
        <button type="button" onClick={() => void downloadFile(f)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-bold hover:bg-white/25"><Download className="size-4" />Download</button>
        <button type="button" onClick={onClose} aria-label="Close preview" className="grid size-9 place-items-center rounded-lg bg-white/15 hover:bg-white/25"><X className="size-4" /></button>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center" onMouseDown={(e) => e.stopPropagation()}>
        {url === undefined ? <span className="text-sm text-white/70">Loading…</span>
          : !url || !canShow ? <div className="rounded-xl bg-white p-6 text-center text-sm"><p className="font-bold">No preview for this file</p><p className="mt-1 text-sub">{f.ext.toUpperCase()} files open in your own software. Download it instead.</p></div>
          : f.ext === "pdf" ? <iframe title={f.name} src={url} className="size-full rounded-lg bg-white" />
          : <img src={url} alt={f.name} className="max-h-full max-w-full rounded-lg object-contain" />}
      </div>
    </div>
  );
}

export interface WorkFilesProps {
  orderId: string;
  /** What this department works from (shown read-only), e.g. Source Photos. */
  inputs: { category: FileCategory; label: string }[];
  /** What it produces. */
  output: { category: FileCategory; label: string };
  /** Upload one file; return the result to show. Omit to make the output read-only. */
  upload?: (file: File) => { ok: boolean; msg: string };
  accept: string;
  hint: string;
  onMessage: (msg: string, ok: boolean) => void;
  canRemove?: boolean;
}

/** Inputs and outputs of one job, with previews and an upload box. */
export function WorkFiles({ orderId, inputs, output, upload, accept, hint, onMessage, canRemove }: WorkFilesProps) {
  useStore();
  const [open, setOpen] = useState<FileRec | null>(null);
  const [over, setOver] = useState(false);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const input = useRef<HTMLInputElement>(null);
  const of = (c: FileCategory) => FILES.filter((f) => f.orderId === orderId && f.category === c && !f.archived);
  const send = (list: FileList | File[]) => {
    if (!upload) return;
    const bad: string[] = []; let n = 0;
    Array.from(list).forEach((file) => { const r = upload(file); if (r.ok) n++; else bad.push(r.msg); });
    if (bad.length) onMessage(bad.join(" · "), false); else if (n) onMessage(`${n} file${n > 1 ? "s" : ""} uploading to ${output.label}`, true);
  };
  const remove = (f: FileRec) => { if (archiveFile(f.id)) onMessage(`${f.name} removed`, true); else onMessage(`${f.name} is locked and can't be removed`, false); };
  const grid = (key: string, files: FileRec[], removable: boolean) => {
    const LIMIT = 12, all = showAll[key], shown = all ? files : files.slice(0, LIMIT);
    return files.length === 0 ? null : (<>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{shown.map((f) => <Tile key={f.id} f={f} onOpen={setOpen} onRemove={removable ? remove : undefined} />)}</div>
      {files.length > LIMIT && <button type="button" onClick={() => setShowAll({ ...showAll, [key]: !all })} className="mt-2 text-xs font-bold text-brand hover:underline">{all ? "Show fewer" : `Show all ${files.length}`}</button>}
    </>);
  };
  const outFiles = of(output.category);
  return (
    <div className="space-y-4" data-testid="work-files">
      {inputs.map((i) => {
        const files = of(i.category);
        return (
          <section key={i.category} data-testid={`inputs-${i.category}`}>
            <div className="mb-1.5 flex items-center gap-2 text-sm font-extrabold">{i.label} <Pill tone="slate">{files.length}</Pill>
              {files.length > 1 && <button type="button" onClick={() => { files.filter((f) => !f.pending).forEach((f, k) => setTimeout(() => void downloadFile(f), k * 400)); onMessage(`Downloading ${files.length} files`, true); }} className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline"><Download className="size-3.5" />Download all</button>}
            </div>
            {grid(i.category, files, false) ?? <p className="rounded-lg border border-dashed border-line px-3 py-3 text-xs text-sub">No {i.label.toLowerCase()} on this order yet{i.category === "Source Photos" ? " — reception adds them on the order page (Files › Source Photos)" : ""}.</p>}
          </section>
        );
      })}
      <section data-testid={`outputs-${output.category}`}>
        <div className="mb-1.5 flex items-center gap-2 text-sm font-extrabold">{output.label} <Pill tone="blue">{outFiles.length}</Pill></div>
        {grid(output.category, outFiles, !!canRemove)}
        {upload && (
          <div role="button" tabIndex={0} aria-label={`Upload ${output.label}`} data-testid="work-dropzone"
            onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
            className={cx("mt-2 flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-4 text-center transition", over ? "border-brand bg-brand-soft ring-2 ring-brand/40" : "border-brand/50 bg-brand-soft/40")}>
            <span className="inline-flex items-center gap-2 text-sm font-extrabold"><UploadCloud className="size-5 text-brand" />{over ? "Drop to upload" : `Upload ${output.label}`}</span>
            <span className="text-xs text-sub">{hint} · max {MAX_TEXT} per file · same name = new version</span>
            <input ref={input} data-testid="work-input" type="file" multiple accept={accept} className="hidden" onChange={(e) => { if (e.target.files) send(e.target.files); e.target.value = ""; }} />
          </div>
        )}
        {!upload && outFiles.length === 0 && <p className="text-xs text-sub">Nothing uploaded yet.</p>}
      </section>
      {open && <Preview f={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

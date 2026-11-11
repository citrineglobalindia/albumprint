import { useState } from "react";
import { Copy, FolderOpen, Plus, Save } from "lucide-react";
import { Pill, cx, inputCls } from "./ui";
import { useStore } from "../lib/store";
import { WORK_STATUS, canUpdate, progressOf, saveProgress, statusLabel, type Dept } from "../lib/jobProgress";
import { fmtDT } from "../lib/production";

/** A department's own update on a job: an optional count (photos graded, sheets designed…) of a total, a status and a note. */
export function JobProgress({ orderId, dept, album = 0, title = "My update", countLabel, of, pathLabel, onDone }: { orderId: string; dept: Dept; album?: number; title?: string; countLabel?: string; of?: number; pathLabel?: string; onDone: (m: string, ok: boolean) => void }) {
  useStore();
  const p = progressOf(orderId, dept, album), can = canUpdate(dept);
  const [count, setCount] = useState<string | null>(null), [status, setStatus] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null), [add, setAdd] = useState("");
  const c = count ?? (p?.count != null ? String(p.count) : ""), s = status ?? p?.status ?? "", n = note ?? p?.note ?? "", fp = path ?? p?.filesPath ?? "";
  const dirty = (count !== null && c !== (p?.count != null ? String(p.count) : "")) || (status !== null && s !== (p?.status ?? "")) || (note !== null && n !== (p?.note ?? "")) || (path !== null && fp !== (p?.filesPath ?? ""));
  /** Add this sitting's count to the total so far (e.g. 500 more → 1000). */
  const addMore = async () => {
    const more = Number(add.trim()); if (!add.trim() || !Number.isInteger(more) || more <= 0) { onDone("Enter how many more were done, e.g. 500", false); return; }
    const base = Number(c.trim() === "" ? 0 : c), total = (Number.isFinite(base) ? base : 0) + more;
    const r = await saveProgress(orderId, dept, { count: total, ...(status !== null ? { status: (s || null) as never } : {}), ...(note !== null ? { note: n } : {}) }, album);
    onDone(r.ok ? `${countLabel}: +${more} → ${total}${of ? ` of ${of}` : ""}` : r.msg, r.ok); if (r.ok) { setAdd(""); setCount(null); setStatus(null); setNote(null); }
  };
  const pct = of && p?.count != null ? Math.min(100, Math.round((p.count / of) * 100)) : null;
  const save = async () => {
    const r = await saveProgress(orderId, dept, { ...(countLabel ? { count: c.trim() === "" ? null : Number(c) } : {}), status: (s || null) as never, note: n, ...(pathLabel && path !== null ? { filesPath: fp } : {}) }, album);
    onDone(r.msg, r.ok); if (r.ok) { setCount(null); setStatus(null); setNote(null); setPath(null); }
  };
  return (
    <div className="mt-3 rounded-xl border border-line p-3 text-[13px]" data-testid={album ? `progress-${dept}-album-${album}` : `progress-${dept}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-sub">{title}
        {p?.status && <Pill tone={WORK_STATUS.find((x) => x.key === p.status)?.tone ?? "slate"}>{statusLabel(p.status)}</Pill>}
        {p?.at && <span className="ml-auto font-normal normal-case tracking-normal">{p.by ? `${p.by} · ` : ""}{fmtDT(p.at)}</span>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {countLabel && (
          <label className="block"><span className="mb-1 block text-[11px] font-semibold text-sub">{countLabel}{of ? ` (of ${of})` : ""}</span>
            <input aria-label={countLabel} type="number" min={0} step={1} disabled={!can} className={cx(inputCls, "h-9 w-28 text-sm")} value={c} onChange={(e) => setCount(e.target.value)} /></label>
        )}
        {countLabel && can && (
          <label className="block"><span className="mb-1 block text-[11px] font-semibold text-sub">Add more done now</span>
            <span className="flex gap-1"><input aria-label="Add more done now" type="number" min={1} step={1} className={cx(inputCls, "h-9 w-24 text-sm")} placeholder="+ e.g. 500" value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addMore(); } }} />
              <button type="button" disabled={!add.trim()} onClick={() => void addMore()} className="inline-flex h-9 items-center gap-1 rounded-lg border border-brand px-2.5 text-xs font-bold text-brand hover:bg-brand-soft disabled:opacity-40"><Plus className="size-3.5" />Add</button></span></label>
        )}
        <label className="block"><span className="mb-1 block text-[11px] font-semibold text-sub">Status</span>
          <select aria-label={`${dept} status`} disabled={!can} className={cx(inputCls, "h-9 w-44 text-sm")} value={s} onChange={(e) => setStatus(e.target.value)}>
            <option value="">—</option>{WORK_STATUS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
        <label className="block min-w-[160px] flex-1"><span className="mb-1 block text-[11px] font-semibold text-sub">Note</span>
          <input aria-label={`${dept} note`} disabled={!can} maxLength={300} className={cx(inputCls, "h-9 text-sm")} value={n} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 120 of 400 done, rest tomorrow" /></label>
        {can && <button type="button" disabled={!dirty} onClick={() => void save()} className="inline-flex h-9 items-center gap-1 rounded-lg bg-brand px-3 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-40"><Save className="size-3.5" />Update</button>}
      </div>
      {pathLabel && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block min-w-[220px] flex-1"><span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-sub"><FolderOpen className="size-3" />{pathLabel}</span>
            <input aria-label={pathLabel} disabled={!can} maxLength={500} className={cx(inputCls, "h-9 text-sm")} value={fp} onChange={(e) => setPath(e.target.value)} placeholder="e.g. D:\Orders\IDP00018\Graded, or a Google Drive link" /></label>
          {fp && <button type="button" onClick={() => { void navigator.clipboard?.writeText(fp).then(() => onDone("Path copied", true), () => onDone("Could not copy — select the text instead", false)); }} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-slate-50"><Copy className="size-3.5" />Copy</button>}
          {fp && /^https?:\/\//i.test(fp) && <a href={fp} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-lg border border-line px-2.5 text-xs font-bold text-brand hover:bg-brand-soft">Open</a>}
        </div>
      )}
      {pct !== null && <div className="mt-2 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded bg-line"><div className="h-full bg-brand" style={{ width: `${pct}%` }} /></div><span className="text-[11px] font-bold text-sub" data-testid={`progress-${dept}-pct`}>{p?.count} / {of} · {pct}%</span></div>}
    </div>
  );
}

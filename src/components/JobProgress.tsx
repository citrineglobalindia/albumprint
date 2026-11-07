import { useState } from "react";
import { Save } from "lucide-react";
import { Pill, cx, inputCls } from "./ui";
import { useStore } from "../lib/store";
import { WORK_STATUS, canUpdate, progressOf, saveProgress, statusLabel, type Dept } from "../lib/jobProgress";
import { fmtDT } from "../lib/production";

/** A department's own update on a job: an optional count (photos graded, sheets designed…) of a total, a status and a note. */
export function JobProgress({ orderId, dept, countLabel, of, onDone }: { orderId: string; dept: Dept; countLabel?: string; of?: number; onDone: (m: string, ok: boolean) => void }) {
  useStore();
  const p = progressOf(orderId, dept), can = canUpdate(dept);
  const [count, setCount] = useState<string | null>(null), [status, setStatus] = useState<string | null>(null), [note, setNote] = useState<string | null>(null);
  const c = count ?? (p?.count != null ? String(p.count) : ""), s = status ?? p?.status ?? "", n = note ?? p?.note ?? "";
  const dirty = count !== null || status !== null || note !== null;
  const pct = of && p?.count != null ? Math.min(100, Math.round((p.count / of) * 100)) : null;
  const save = async () => {
    const r = await saveProgress(orderId, dept, { ...(countLabel ? { count: c.trim() === "" ? null : Number(c) } : {}), status: (s || null) as never, note: n });
    onDone(r.msg, r.ok); if (r.ok) { setCount(null); setStatus(null); setNote(null); }
  };
  return (
    <div className="mt-3 rounded-xl border border-line p-3 text-[13px]" data-testid={`progress-${dept}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-sub">My update
        {p?.status && <Pill tone={WORK_STATUS.find((x) => x.key === p.status)?.tone ?? "slate"}>{statusLabel(p.status)}</Pill>}
        {p?.at && <span className="ml-auto font-normal normal-case tracking-normal">{p.by ? `${p.by} · ` : ""}{fmtDT(p.at)}</span>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {countLabel && (
          <label className="block"><span className="mb-1 block text-[11px] font-semibold text-sub">{countLabel}{of ? ` (of ${of})` : ""}</span>
            <input aria-label={countLabel} type="number" min={0} step={1} disabled={!can} className={cx(inputCls, "h-9 w-28 text-sm")} value={c} onChange={(e) => setCount(e.target.value)} /></label>
        )}
        <label className="block"><span className="mb-1 block text-[11px] font-semibold text-sub">Status</span>
          <select aria-label={`${dept} status`} disabled={!can} className={cx(inputCls, "h-9 w-44 text-sm")} value={s} onChange={(e) => setStatus(e.target.value)}>
            <option value="">—</option>{WORK_STATUS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
        <label className="block min-w-[160px] flex-1"><span className="mb-1 block text-[11px] font-semibold text-sub">Note</span>
          <input aria-label={`${dept} note`} disabled={!can} maxLength={300} className={cx(inputCls, "h-9 text-sm")} value={n} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 120 of 400 done, rest tomorrow" /></label>
        {can && <button type="button" disabled={!dirty} onClick={() => void save()} className="inline-flex h-9 items-center gap-1 rounded-lg bg-brand px-3 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-40"><Save className="size-3.5" />Update</button>}
      </div>
      {pct !== null && <div className="mt-2 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded bg-line"><div className="h-full bg-brand" style={{ width: `${pct}%` }} /></div><span className="text-[11px] font-bold text-sub" data-testid={`progress-${dept}-pct`}>{p?.count} / {of} · {pct}%</span></div>}
    </div>
  );
}

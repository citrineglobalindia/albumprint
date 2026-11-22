import { useState } from "react";
import { Plus } from "lucide-react";
import { cx } from "./ui";
import { canUpdate, progressOf, saveProgress, type Dept } from "../lib/jobProgress";
import { advanceAfter } from "../lib/albumFlow";

/** Right in a table row: type how many were done in this sitting (e.g. 500 photos graded) and Add — it is added to the total so far.
 *  The order moves on by itself when everything is done (e.g. every photo given graded → sent to the admin). */
export function QuickCount({ orderId, dept, album = 0, label = "photos", prepare, onDone }: { orderId: string; dept: Dept; album?: number; label?: string; prepare?: () => string | null; onDone: (m: string, ok: boolean) => void }) {
  const [v, setV] = useState(""); const [busy, setBusy] = useState(false);
  if (!canUpdate(dept)) return null;
  const add = async () => {
    const n = Number(v.trim());
    if (!v.trim() || !Number.isInteger(n) || n <= 0) { onDone(`Enter how many ${label} were done, e.g. 500`, false); return; }
    const e = prepare?.(); if (e) { onDone(e, false); return; }                       // e.g. start the job on its first count
    setBusy(true);
    const cur = progressOf(orderId, dept, album);
    const total = (cur?.count ?? 0) + n;
    const r = await saveProgress(orderId, dept, { count: total, ...(cur?.status ? {} : { status: "working" as const }) }, album);
    setBusy(false);
    onDone(r.ok ? `${orderId}: +${n} ${label} → ${total}` : r.msg, r.ok);
    if (r.ok) { setV(""); const a = advanceAfter(orderId, dept); if (a) onDone(a.msg, a.ok); }
  };
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()} data-testid={`quick-${dept}-${orderId}${album ? `-${album}` : ""}`}>
      <input aria-label={`Add ${label} done for ${orderId}`} type="number" min={1} step={1} value={v} onChange={(e) => setV(e.target.value)} placeholder={`+ ${label}`}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }} className="h-7 w-20 rounded-md border border-line px-1.5 text-xs outline-none focus:border-brand" />
      <button type="button" disabled={busy || !v.trim()} onClick={() => void add()} className={cx("inline-flex h-7 items-center gap-0.5 rounded-md bg-brand px-2 text-[11px] font-bold text-white hover:bg-brand-dark disabled:opacity-40")}><Plus className="size-3" />Add</button>
    </span>
  );
}

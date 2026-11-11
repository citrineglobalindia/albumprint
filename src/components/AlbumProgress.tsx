import { useState } from "react";
import { Pencil } from "lucide-react";
import { Pill, cx } from "./ui";
import { JobProgress } from "./JobProgress";
import { useStore } from "../lib/store";
import { WORK_STATUS, canUpdate, photosGiven, progressOf, statusLabel, type Dept } from "../lib/jobProgress";
import type { Order } from "../lib/data";

// Per-album progress on an order with several albums: each album keeps its own count and status per department
// (photos graded, sheets designed, printing / QC / delivery). The order still moves through its stages as one (migration 0064).
const COLS: { dept: Dept; label: string; count?: string }[] = [
  { dept: "grading", label: "Colour Grading", count: "Photos graded" },
  { dept: "design", label: "Designing", count: "Sheets designed" },
  { dept: "printing", label: "Printing", count: "Sheets printed" },
  { dept: "qc", label: "QC" },
  { dept: "delivery", label: "Delivery" },
];

export function AlbumProgress({ o, only, onDone }: { o: Order; only?: Dept[]; onDone: (m: string, ok: boolean) => void }) {
  useStore();
  const albums = o.albums ?? [];
  const [sel, setSel] = useState<{ album: number; dept: Dept } | null>(null);
  if (albums.length < 2) return null;                                                     // one album: the order's own progress is enough
  const cols = COLS.filter((c) => (only ? only.includes(c.dept) : o.workflow !== "Printing" || ["printing", "qc", "delivery"].includes(c.dept)));
  const total = (dept: Dept, i: number) => (dept === "design" || dept === "printing" ? albums[i]!.sheets || undefined : undefined);
  const doneCount = (dept: Dept) => albums.filter((_, i) => progressOf(o.id, dept, i + 1)?.status === "done").length;
  const col = sel ? cols.find((c) => c.dept === sel.dept) : undefined;
  return (
    <div className="mb-3 rounded-xl border border-line p-3" data-testid="album-progress">
      <div className="mb-2 flex flex-wrap items-baseline gap-2"><h3 className="text-sm font-extrabold">Albums · progress</h3>
        <span className="text-xs text-sub">{albums.length} albums on this order — each keeps its own progress{photosGiven(o.id) ? ` · photos given ${photosGiven(o.id)}` : ""}</span></div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead><tr className="text-[11px] uppercase tracking-wide text-sub"><th className="py-1.5 pr-3 font-bold">Album</th>{cols.map((c) => <th key={c.dept} className="py-1.5 pr-3 font-bold">{c.label}<span className="ml-1 font-semibold normal-case tracking-normal">({doneCount(c.dept)}/{albums.length} done)</span></th>)}</tr></thead>
          <tbody>{albums.map((a, i) => (
            <tr key={i} className="border-t border-line" data-testid={`album-row-${i + 1}`}>
              <td className="py-2 pr-3"><div className="font-bold">{a.title || `Album ${i + 1}`}</div><div className="text-[11px] text-sub">{[a.sheets ? `${a.sheets} sheets` : "", a.size && a.size !== "—" ? a.size : "", a.eventDate ?? ""].filter(Boolean).join(" · ")}</div></td>
              {cols.map((c) => { const p = progressOf(o.id, c.dept, i + 1); const of = total(c.dept, i); const active = sel?.album === i + 1 && sel.dept === c.dept; return (
                <td key={c.dept} className="py-2 pr-3 align-top">
                  <button type="button" onClick={() => setSel(active ? null : { album: i + 1, dept: c.dept })} aria-label={`${a.title || `Album ${i + 1}`} ${c.label}`} data-testid={`cell-${i + 1}-${c.dept}`}
                    className={cx("w-full rounded-lg border px-2 py-1.5 text-left hover:bg-brand-soft/50", active ? "border-brand bg-brand-soft/40" : "border-transparent")}>
                    {p?.count != null && c.count && <div className="text-xs font-semibold">{p.count}{of ? ` / ${of}` : ""}</div>}
                    {p?.status ? <Pill tone={WORK_STATUS.find((x) => x.key === p.status)?.tone ?? "slate"}>{statusLabel(p.status)}</Pill> : p?.count == null && <span className="inline-flex items-center gap-1 text-xs text-sub">{canUpdate(c.dept) ? <><Pencil className="size-3" />Update</> : "—"}</span>}
                  </button>
                </td>); })}
            </tr>))}</tbody>
        </table>
      </div>
      {sel && col && <JobProgress key={`${sel.album}-${sel.dept}`} orderId={o.id} dept={sel.dept} album={sel.album} title={`${albums[sel.album - 1]?.title || `Album ${sel.album}`} · ${col.label}`} countLabel={col.count} of={total(sel.dept, sel.album - 1)} onDone={onDone} />}
    </div>
  );
}

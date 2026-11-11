import { useEffect, useState } from "react";
import { PackageCheck, Pencil, Send } from "lucide-react";
import { Pill, cx } from "./ui";
import { JobProgress } from "./JobProgress";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import type { Order } from "../lib/data";
import { advanceAfter, loadMods, people, personLabel, pickFor } from "../lib/albumFlow";
import { WORK_STATUS, assignAlbum, canUpdate, photosGiven, progressOf, statusLabel, type Dept } from "../lib/jobProgress";
import { LABS, LAB_STATUS_LABEL, albumLab, canMoveLabWork, labName, setAlbumLab, setLabStatus } from "../lib/labs";

// Per-album progress on an order with several albums: each album keeps its own assignee, count and status per department
// (photos graded, sheets designed, printing / QC / delivery) and its printing lab. The order still moves through its stages as one,
// and moves on by itself once every album is done for the stage it is at (migrations 0064, 0066).
const COLS: { dept: Dept; label: string; count?: string; assign?: boolean }[] = [
  { dept: "grading", label: "Colour Grading", count: "Photos graded", assign: true },
  { dept: "design", label: "Designing", count: "Sheets designed", assign: true },
  { dept: "printing", label: "Printing", count: "Sheets printed" },
  { dept: "qc", label: "QC" },
  { dept: "delivery", label: "Delivery" },
];
export function AlbumProgress({ o, only, onDone }: { o: Order; only?: Dept[]; onDone: (m: string, ok: boolean) => void }) {
  useStore();
  const { role } = useAuth();
  const albums = o.albums ?? [];
  const [sel, setSel] = useState<{ album: number; dept: Dept } | null>(null);
  const [, setMods] = useState(0);
  useEffect(() => { void loadMods().then((ok) => ok && setMods((n) => n + 1)); }, []);
  if (albums.length < 1) return null;
  const printing = o.workflow === "Printing";
  const cols = COLS.filter((c) => (only ? only.includes(c.dept) : !printing || ["printing", "qc", "delivery"].includes(c.dept)));
  const showLab = !only || only.includes("printing");
  const canAssign = role === "admin" || role === "reception";
  const total = (dept: Dept, i: number) => (dept === "design" || dept === "printing" ? albums[i]!.sheets || undefined : undefined);
  const doneCount = (dept: Dept) => albums.filter((_, i) => ["done", "client_approved"].includes(progressOf(o.id, dept, i + 1)?.status ?? "")).length;
  const col = sel ? cols.find((c) => c.dept === sel.dept) : undefined;
  const after = (dept: Dept) => (m: string, ok: boolean) => {                              // a saved update may finish the stage for the whole order
    onDone(m, ok);
    if (!ok) return;
    const adv = advanceAfter(o.id, dept);
    if (adv) onDone(adv.msg, adv.ok);
  };
  const run = (dept: Dept, p: Promise<{ ok: boolean; msg: string }>) => void p.then((r) => after(dept)(r.msg, r.ok));
  const staff = people();
  const labs = LABS.filter((l) => l.active), moveLab = canMoveLabWork();
  return (
    <div className="mb-3 rounded-xl border border-line p-3" data-testid="album-progress">
      <div className="mb-2 flex flex-wrap items-baseline gap-2"><h3 className="text-sm font-extrabold">Albums · progress</h3>
        <span className="text-xs text-sub">{albums.length} albums on this order — each keeps its own work; the order moves on when every album is done{photosGiven(o.id) ? ` · photos given ${photosGiven(o.id)}` : ""}</span></div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead><tr className="text-[11px] uppercase tracking-wide text-sub"><th className="py-1.5 pr-3 font-bold">Album</th>
            {cols.map((c) => <th key={c.dept} className="py-1.5 pr-3 font-bold">{c.label}<span className="ml-1 font-semibold normal-case tracking-normal">({doneCount(c.dept)}/{albums.length} done)</span></th>)}
            {showLab && <th className="py-1.5 pr-3 font-bold">Lab</th>}</tr></thead>
          <tbody>{albums.map((a, i) => { const k = i + 1, name = a.title || `Album ${k}`, al = albumLab(o.id, k); return (
            <tr key={i} className="border-t border-line" data-testid={`album-row-${k}`}>
              <td className="py-2 pr-3 align-top"><div className="font-bold">{name}</div><div className="text-[11px] text-sub">{[a.sheets ? `${a.sheets} sheets` : "", a.size && a.size !== "—" ? a.size : "", a.eventDate ?? ""].filter(Boolean).join(" · ")}</div></td>
              {cols.map((c) => { const p = progressOf(o.id, c.dept, k); const of = total(c.dept, i); const active = sel?.album === k && sel.dept === c.dept; const pick = c.assign ? pickFor(c.dept) : null; return (
                <td key={c.dept} className="py-2 pr-3 align-top">
                  {c.assign && (canAssign
                    ? <select aria-label={`Assign ${c.label} for ${name}`} data-testid={`assign-${k}-${c.dept}`} className={cx("mb-1 h-7 w-full max-w-[230px] rounded-md border px-1.5 text-xs", p?.assigneeId ? "border-brand/40 bg-brand-soft/40 font-semibold" : "border-line text-sub")}
                        value={p?.assigneeId ?? ""} onChange={(e) => { const s = staff.find((x) => x.id === e.target.value); run(c.dept, assignAlbum(o.id, k, c.dept, s ? { id: s.id, name: s.name } : null)); }}>
                        <option value="">Assign…</option>
                        {pick!.fit.length > 0 && <optgroup label={c.label}>{pick!.fit.map((s) => <option key={s.id} value={s.id}>{personLabel(s)}</option>)}</optgroup>}
                        <optgroup label="Other staff">{pick!.other.map((s) => <option key={s.id} value={s.id}>{personLabel(s)}</option>)}</optgroup>
                        {p?.assigneeId && !staff.some((s) => s.id === p.assigneeId) && <option value={p.assigneeId}>{p.assignee ?? "Former staff"}</option>}
                      </select>
                    : <div className="mb-1 text-xs text-sub" data-testid={`assignee-${k}-${c.dept}`}>{p?.assignee ? <>With <b className="text-ink">{p.assignee}</b></> : "Not assigned"}</div>)}
                  <button type="button" onClick={() => setSel(active ? null : { album: k, dept: c.dept })} aria-label={`${name} ${c.label}`} data-testid={`cell-${k}-${c.dept}`}
                    className={cx("w-full rounded-lg border px-2 py-1.5 text-left hover:bg-brand-soft/50", active ? "border-brand bg-brand-soft/40" : "border-transparent")}>
                    {p?.count != null && c.count && <div className="text-xs font-semibold">{p.count}{of ? ` / ${of}` : ""}</div>}
                    {p?.status ? <Pill tone={WORK_STATUS.find((x) => x.key === p.status)?.tone ?? "slate"}>{statusLabel(p.status)}</Pill> : p?.count == null && <span className="inline-flex items-center gap-1 text-xs text-sub">{canUpdate(c.dept) ? <><Pencil className="size-3" />Update</> : "—"}</span>}
                  </button>
                </td>); })}
              {showLab && <td className="py-2 pr-3 align-top" data-testid={`lab-cell-${k}`}>
                <select aria-label={`Lab for ${name}`} disabled={!moveLab} className="mb-1 h-7 w-full max-w-[170px] rounded-md border border-line px-1.5 text-xs" value={al?.labId ?? ""} onChange={(e) => run("printing", setAlbumLab(o.id, k, e.target.value || undefined))}>
                  <option value="">{moveLab ? "Choose lab…" : "No lab"}</option>{labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  {al?.labId && !labs.some((l) => l.id === al.labId) && <option value={al.labId}>{labName(al.labId)} (inactive)</option>}
                </select>
                <div className="flex flex-wrap items-center gap-1">
                  {al?.labId && <Pill tone={al.status === "received" ? "green" : al.status === "sent" ? "amber" : "slate"}>{LAB_STATUS_LABEL[al.status]}</Pill>}
                  {moveLab && al?.labId && al.status === "not_sent" && <button type="button" onClick={() => run("printing", setLabStatus(o.id, k, "sent"))} className="inline-flex h-6 items-center gap-1 rounded-md bg-brand px-2 text-[11px] font-bold text-white"><Send className="size-3" />Send</button>}
                  {moveLab && al?.status === "sent" && <button type="button" onClick={() => run("printing", setLabStatus(o.id, k, "received"))} className="inline-flex h-6 items-center gap-1 rounded-md bg-emerald-600 px-2 text-[11px] font-bold text-white"><PackageCheck className="size-3" />Received</button>}
                </div>
              </td>}
            </tr>); })}</tbody>
        </table>
      </div>
      {sel && col && <JobProgress key={`${sel.album}-${sel.dept}`} orderId={o.id} dept={sel.dept} album={sel.album} title={`${albums[sel.album - 1]?.title || `Album ${sel.album}`} · ${col.label}`} countLabel={col.count} of={total(sel.dept, sel.album - 1)} pathLabel={sel.dept === "grading" ? "Graded files path / link" : sel.dept === "design" ? "Design files path / link" : undefined} onDone={after(sel.dept)} />}
    </div>
  );
}

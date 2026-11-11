import { useEffect, useState } from "react";
import { PackageCheck, Pencil, Send } from "lucide-react";
import { Pill, cx } from "./ui";
import { JobProgress } from "./JobProgress";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { backendOn } from "../lib/supabase";
import { STAFF as DEMO_STAFF, stageLabel, type Order, type StageKey } from "../lib/data";
import { staffPeople } from "../lib/db/production";
import { moveStage } from "../lib/workflow";
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
/** When every album is done for a department, the order moves from that department's stage to the next one. */
const NEXT: Partial<Record<Dept, [StageKey, StageKey]>> = { grading: ["colour_grading", "admin_approval"], printing: ["printing", "qc"], delivery: ["ready_for_delivery", "delivered"] };
const ROLE_OF: Partial<Record<Dept, RegExp>> = { grading: /^colou?r/i, design: /^designer/i };

type Person = { id: string; name: string; role: string };
const people = (): Person[] => (backendOn ? staffPeople() : DEMO_STAFF.filter((s) => s.status === "Active").map((s) => ({ id: s.id, name: s.name, role: s.role })));
const ROLE_LABEL: Record<string, string> = { admin: "Administrator", reception: "Reception", colour: "Colour Grader", designer: "Designer", printing: "Printing", qc: "QC", accounts: "Accounts" };
const MODULE_LABEL: Record<string, string> = { grading: "Colour Grading", design: "Designing", printing: "Printing", qc: "QC", delivery: "Delivery", order: "Orders", payments: "Payments", invoices: "Invoices", customer: "Customers", reports: "Reports" };
const MODULE_OF: Partial<Record<Dept, string>> = { grading: "grading", design: "design" };
/** Extra modules of every user (database mode; whatever this user may read), so the pickers show "Sanjay — Administrator + Designing". */
let MODS: Record<string, string[]> = {}; let modsLoaded = false;
async function loadMods(): Promise<boolean> {
  if (!backendOn || modsLoaded) return false;
  modsLoaded = true;
  const { sb } = await import("../lib/db/core");
  const { data, error } = await sb().from("user_modules").select("user_id,module");
  if (error) return false;
  MODS = {}; for (const r of (data ?? []) as { user_id: string; module: string }[]) (MODS[r.user_id] ??= []).push(r.module);
  return true;
}
const label = (p: Person) => `${p.name} — ${[ROLE_LABEL[p.role] ?? p.role, ...(MODS[p.id] ?? []).map((m) => MODULE_LABEL[m] ?? m)].join(" + ")}`;

/** Every album of the order is done for this department (printing: done, or received back from its lab). */
export function allAlbumsDone(o: Order, dept: Dept) {
  const n = o.albums?.length ?? 0;
  return n > 0 && Array.from({ length: n }, (_, i) => i + 1).every((k) => progressOf(o.id, dept, k)?.status === "done" || (dept === "printing" && albumLab(o.id, k)?.status === "received"));
}
/** Move the order on when its current stage's work is done for every album. Returns a message, or null when nothing moved. */
export function advanceIfAllDone(o: Order, dept: Dept): { ok: boolean; msg: string } | null {
  const step = NEXT[dept]; if (!step || o.stage !== step[0] || o.hold || !allAlbumsDone(o, dept)) return null;
  const r = moveStage(o.id, step[1]);
  return r.ok ? { ok: true, msg: `All albums done — ${o.id} moved to ${stageLabel(step[1])}` } : { ok: false, msg: `All albums done, but ${o.id} could not move to ${stageLabel(step[1])}: ${r.error}` };
}

export function AlbumProgress({ o, only, onDone }: { o: Order; only?: Dept[]; onDone: (m: string, ok: boolean) => void }) {
  useStore();
  const { role } = useAuth();
  const albums = o.albums ?? [];
  const [sel, setSel] = useState<{ album: number; dept: Dept } | null>(null);
  const [, setMods] = useState(0);
  useEffect(() => { void loadMods().then((ok) => ok && setMods((n) => n + 1)); }, []);
  if (albums.length < 2) return null;                                                     // one album: the order's own progress is enough
  const printing = o.workflow === "Printing";
  const cols = COLS.filter((c) => (only ? only.includes(c.dept) : !printing || ["printing", "qc", "delivery"].includes(c.dept)));
  const showLab = !only || only.includes("printing");
  const canAssign = role === "admin" || role === "reception";
  const total = (dept: Dept, i: number) => (dept === "design" || dept === "printing" ? albums[i]!.sheets || undefined : undefined);
  const doneCount = (dept: Dept) => albums.filter((_, i) => progressOf(o.id, dept, i + 1)?.status === "done").length;
  const col = sel ? cols.find((c) => c.dept === sel.dept) : undefined;
  const after = (dept: Dept) => (m: string, ok: boolean) => {                              // a saved update may finish the stage for the whole order
    onDone(m, ok);
    if (!ok) return;
    const adv = advanceIfAllDone(o, dept);
    if (adv) onDone(adv.msg, adv.ok);
    else if (dept === "design" && o.stage === "designing" && allAlbumsDone(o, "design")) onDone("All albums designed — send the proof to the client (Designing)", true);
  };
  const run = (dept: Dept, p: Promise<{ ok: boolean; msg: string }>) => void p.then((r) => after(dept)(r.msg, r.ok));
  const staff = people();
  const pickFor = (dept: Dept) => {
    const re = ROLE_OF[dept], mod = MODULE_OF[dept];
    const fit = staff.filter((s) => re?.test(s.role) || ROLE_LABEL[s.role] && re?.test(ROLE_LABEL[s.role]!) || (!!mod && (MODS[s.id] ?? []).includes(mod)));
    return { fit, other: staff.filter((s) => !fit.includes(s)) };
  };
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
                        {pick!.fit.length > 0 && <optgroup label={c.label}>{pick!.fit.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</optgroup>}
                        <optgroup label="Other staff">{pick!.other.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</optgroup>
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

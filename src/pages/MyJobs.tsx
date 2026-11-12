import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ClipboardList, Hourglass, PlayCircle } from "lucide-react";
import { KpiRow, LineTabs, PageHeader, Panel, Pill, PriorityPill, Td, Th, cx, tableCls, trCls, type Kpi } from "../components/ui";
import { JobProgress } from "../components/JobProgress";
import { useToast } from "../components/Toast";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { hasModule } from "../lib/access";
import { currentActor } from "../lib/audit";
import { ORDERS, stageLabel, stageTone, type Order, type Priority } from "../lib/data";
import { fmtDate } from "../lib/format";
import { GJOBS } from "../lib/production";
import { djob } from "../lib/designJobs";
import { WORK_STATUS, photosGiven, progressOf, statusLabel } from "../lib/jobProgress";
import { WORK_STAGE, advanceAfter, albumStatus, startAlbumWork } from "../lib/albumFlow";

// My Jobs: every album this person works on (colour grading and/or designing), one line each, with its own Start / Continue
// and update box — the order moves on by itself when every album is through the step.
type D = "grading" | "design";
type Row = { o: Order; k: number; title: string; sheets: number; dept: D };
const LABEL: Record<D, string> = { grading: "Colour Grading", design: "Designing" };
const COUNT: Record<D, string> = { grading: "Photos graded", design: "Sheets designed" };
const finished = (s?: string) => s === "done" || s === "client_approved";

function myRows(me: string, depts: D[]): Row[] {
  const out: Row[] = [];
  for (const o of ORDERS) {
    if (o.workflow === "Printing" || o.hold === "Cancelled" || o.closed) continue;
    const albums = o.albums?.length ? o.albums : [{ title: o.event || "Album 1", sheets: o.pages }];
    for (const dept of depts) {
      const owner = dept === "grading" ? GJOBS.find((j) => j.orderId === o.id)?.colorist : djob(o.id)?.designer;
      const orderMine = owner === me || (o.assignee === me && o.stage === WORK_STAGE[dept]);
      albums.forEach((a, i) => {
        const asg = progressOf(o.id, dept, i + 1)?.assignee;
        if (asg ? asg === me : orderMine) out.push({ o, k: i + 1, title: a.title || `Album ${i + 1}`, sheets: Number(a.sheets) || 0, dept });
      });
    }
  }
  return out;
}

export default function MyJobs() {
  useStore();
  const { role } = useAuth();
  const [toast, show] = useToast();
  const me = currentActor().name;
  const depts: D[] = [...(role === "colour" || hasModule("grading") ? ["grading" as D] : []), ...(role === "designer" || hasModule("design") ? ["design" as D] : [])];
  const [tab, setTab] = useState<"todo" | "done">("todo");
  const [open, setOpen] = useState<string | null>(null);
  const all = myRows(me, depts.length ? depts : ["grading", "design"]);
  const st = (r: Row) => albumStatus(r.o, r.dept, r.k).status;
  const todo = all.filter((r) => !finished(st(r))), done = all.filter((r) => finished(st(r)));
  const rows = tab === "todo" ? todo : done;
  const key = (r: Row) => `${r.o.id}-${r.dept}-${r.k}`;
  const kpis: Kpi[] = [
    { label: "To start", value: todo.filter((r) => !st(r) && r.o.stage === WORK_STAGE[r.dept]).length, icon: ClipboardList, tone: "blue" },
    { label: "In progress", value: todo.filter((r) => !!st(r)).length, icon: PlayCircle, tone: "violet" },
    { label: "Coming up", value: todo.filter((r) => !st(r) && r.o.stage !== WORK_STAGE[r.dept]).length, icon: Hourglass, tone: "amber" },
    { label: "Done", value: done.length, icon: CheckCircle2, tone: "green" },
  ];
  const start = async (r: Row) => { const x = await startAlbumWork(r.o, r.dept, r.k); show(x.msg); if (x.ok) setOpen(key(r)); };
  return (
    <>
      <PageHeader title="My Jobs" subtitle={`Every album you work on, one line each: start it, update how much is done, finish it. Signed in as ${me}.`} />
      <KpiRow items={kpis} cols={4} />
      <Panel className="mt-5" title="My albums" subtitle="The order moves on by itself when every album is through the step" bodyClassName="p-0">
        <div className="px-5 pt-3"><LineTabs className="!border-0" value={tab} onChange={(t) => { setTab(t); setOpen(null); }} tabs={[{ key: "todo", label: "To do", count: todo.length }, { key: "done", label: "Done", count: done.length }]} /></div>
        <div className="overflow-x-auto">
          <table className={tableCls} data-testid="my-jobs">
            <thead><tr><Th>Order</Th><Th>Album</Th><Th>Customer</Th><Th>Work</Th><Th>Order stage</Th><Th>Done so far</Th><Th>Status</Th><Th>Priority</Th><Th>Due</Th><Th className="text-right">Action</Th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const s = albumStatus(r.o, r.dept, r.k), p = progressOf(r.o.id, r.dept, r.k), here = r.o.stage === WORK_STAGE[r.dept];
                const of = r.dept === "design" ? r.sheets || undefined : (r.o.albums?.length ?? 1) <= 1 ? photosGiven(r.o.id) : undefined;
                const id = key(r);
                return (
                  <Fragment key={id}>
                    <tr className={cx(trCls, open === id && "bg-brand-soft")} data-testid={`myjob-${r.o.id}-${r.dept}-${r.k}`}>
                      <Td className="font-bold"><Link to={`/orders/${r.o.id}`} className="hover:underline">{r.o.id}</Link></Td>
                      <Td><span className="font-semibold">{r.title}</span>{r.sheets ? <span className="block text-[11px] text-sub">{r.sheets} sheets</span> : null}</Td>
                      <Td>{r.o.customer}</Td>
                      <Td>{LABEL[r.dept]}</Td>
                      <Td><Pill tone={stageTone(r.o.stage)} dot>{stageLabel(r.o.stage)}</Pill></Td>
                      <Td>{p?.count != null ? <b>{p.count}{of ? <span className="font-normal text-sub"> / {of}</span> : null}</b> : <span className="text-sub">—</span>}</Td>
                      <Td>{s.status ? <Pill tone={WORK_STATUS.find((x) => x.key === s.status)?.tone ?? "slate"}>{statusLabel(s.status)}</Pill> : <span className="text-xs text-sub">Not started</span>}</Td>
                      <Td><PriorityPill p={r.o.priority as Priority} /></Td>
                      <Td>{fmtDate(r.o.due)}</Td>
                      <td className="px-3 py-3 text-right">
                        {!s.status && here ? <button onClick={() => void start(r)} data-testid={`mystart-${r.o.id}-${r.dept}-${r.k}`} className="h-8 rounded-lg bg-brand px-4 text-xs font-bold text-white hover:bg-brand-dark">Start</button>
                          : !s.status ? <span className="inline-flex h-8 items-center rounded-lg bg-slate-100 px-3 text-[11px] font-semibold text-sub">Waiting · {stageLabel(r.o.stage)}</span>
                          : <button onClick={() => setOpen(open === id ? null : id)} data-testid={`myopen-${r.o.id}-${r.dept}-${r.k}`} className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft">{finished(s.status) ? "Open" : open === id ? "Close" : "Continue"}</button>}
                      </td>
                    </tr>
                    {open === id && (
                      <tr><td colSpan={10} className="bg-brand-soft/30 px-4 pb-3">
                        <JobProgress orderId={r.o.id} dept={r.dept} album={r.k} title={`${r.o.id} · ${r.title} · ${LABEL[r.dept]}`} countLabel={COUNT[r.dept]} of={of}
                          pathLabel={r.dept === "grading" ? "Graded files path / link" : "Design files path / link"}
                          onDone={(m, ok) => { show(m); const a = ok ? advanceAfter(r.o.id, r.dept) : null; if (a) show(a.msg); }} />
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={10} className="px-5 py-10 text-center text-sm text-sub">{tab === "todo" ? "Nothing to do right now — albums appear here when they are assigned to you." : "No finished albums yet."}</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      {toast}
    </>
  );
}

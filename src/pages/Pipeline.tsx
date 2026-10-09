import { useMemo, useState } from "react";
import { ClipboardList, Settings, Users, Printer, Truck, ShieldCheck, CalendarDays, LayoutGrid, List, MoreVertical, Plus, ArrowRight, ChevronDown, User } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { PageHeader, PrimaryButton, KpiRow, Panel, Pill, Thumb, SearchInput, FilterSelect, ProgressBar, PriorityPill, TONE, cx, tableCls, Th, Td, trCls, type Kpi } from "../components/ui";
import { ORDERS, STAGES, EVENTS, PRIORITIES, ASSIGNEES, stageLabel, stageTone, type StageKey } from "../lib/data";
import { fmtDate, TODAY } from "../lib/format";

const kpis: Kpi[] = [
  { label: "Total Orders", value: 72, delta: 12, icon: ClipboardList, tone: "blue" },
  { label: "In Production", value: 46, delta: 18, icon: Settings, tone: "violet" },
  { label: "Awaiting Approval", value: 31, delta: -8, icon: Users, tone: "pink" },
  { label: "Printing & QC", value: 17, delta: 21, icon: Printer, tone: "blue" },
  { label: "Ready for Delivery", value: 6, delta: 50, icon: Truck, tone: "teal" },
  { label: "Delivered", value: 28, delta: 27, icon: ShieldCheck, tone: "green" },
];
const workload = Array.from({ length: 30 }, (_, i) => ({ d: `${i + 1} Oct`, pipeline: Math.round(30 + 50 * Math.sin(i / 7) * (i < 12 ? 1 : 0.5) + (i * 3) % 11), done: Math.round(12 + 15 * Math.sin(i / 6 + 1) + (i % 5)) }));

export default function Pipeline() {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [event, setEvent] = useState("All Events");
  const [prio, setPrio] = useState("All Priorities");
  const [asg, setAsg] = useState("All Assignees");
  const [range, setRange] = useState("Last 30 Days");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => ORDERS.filter((o) => {
    const s = q.trim().toLowerCase();
    if (s && ![o.id, o.customer, o.event, o.mobile].some((v) => v.toLowerCase().includes(s))) return false;
    if (event !== "All Events" && o.event !== event) return false;
    if (prio !== "All Priorities" && o.priority !== prio) return false;
    if (asg !== "All Assignees" && o.assignee !== asg) return false;
    return true;
  }), [q, event, prio, asg]);
  const clear = () => { setQ(""); setEvent("All Events"); setPrio("All Priorities"); setAsg("All Assignees"); setRange("Last 30 Days"); };
  const byStage = (k: StageKey) => filtered.filter((o) => o.stage === k);
  const MAX = 3;

  return (
    <div>
      <PageHeader title="Production Pipeline" subtitle="Track and manage your album production from order to delivery.">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-2">
          <CalendarDays className="size-6 text-sub" />
          <div className="text-xs leading-tight text-sub">Today<div className="text-sm font-semibold text-ink">{TODAY.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</div></div>
        </div>
        <PrimaryButton>New Order</PrimaryButton>
        <button className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold">More <ChevronDown className="size-4" /></button>
      </PageHeader>
      <KpiRow items={kpis} />

      <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel title="Production Workload" action={<span className="flex gap-3 text-xs text-sub"><span><i className="mr-1 inline-block size-2 rounded-full bg-sky-500" />Orders in Pipeline</span><span><i className="mr-1 inline-block size-2 rounded-full bg-emerald-500" />Completed</span></span>}>
          <div className="h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={workload}>
                <CartesianGrid stroke="#eef0f8" vertical={false} />
                <XAxis dataKey="d" tick={{ fontSize: 11 }} interval={4} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                <Tooltip />
                <Line type="monotone" dataKey="pipeline" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="done" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Orders by Stage" action={<button className="inline-flex items-center gap-1 text-xs font-bold text-brand">View Details <ArrowRight className="size-3.5" /></button>}>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 xl:grid-cols-11">
            {STAGES.map((s) => (
              <div key={s.key} className="flex flex-col items-center text-center">
                <span className={cx("grid size-11 place-items-center rounded-xl text-sm font-extrabold", TONE[s.tone].soft, TONE[s.tone].text)}>{byStage(s.key).length}</span>
                <span className="mt-1.5 text-[11px] font-semibold leading-tight text-sub">{s.label}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterSelect value={range} onChange={setRange} options={["Last 7 Days", "Last 30 Days", "Last 90 Days"]} />
        <FilterSelect value={event} onChange={setEvent} options={["All Events", ...EVENTS]} />
        <FilterSelect value={prio} onChange={setPrio} options={["All Priorities", ...PRIORITIES]} />
        <FilterSelect value={asg} onChange={setAsg} options={["All Assignees", ...ASSIGNEES]} />
        <SearchInput className="min-w-[220px] flex-1" value={q} onChange={setQ} placeholder="Search orders, customer, event..." />
        <button onClick={clear} className="h-10 rounded-lg border border-line bg-white px-4 text-[13px] font-semibold">Clear Filters</button>
        <div className="flex overflow-hidden rounded-lg border border-line bg-white">
          {([["grid", LayoutGrid], ["list", List]] as const).map(([k, I]) => (
            <button key={k} aria-label={k} onClick={() => setView(k)} className={cx("grid size-10 place-items-center", view === k ? "bg-brand text-white" : "text-sub")}><I className="size-4" /></button>
          ))}
        </div>
      </div>

      {view === "grid" ? (
        <div className="scroll-thin flex gap-3 overflow-x-auto pb-3">
          {STAGES.map((s) => {
            const list = byStage(s.key); const t = TONE[s.tone];
            return (
              <div key={s.key} className={cx("w-[210px] shrink-0 rounded-2xl border p-2", t.border, t.soft)}>
                <div className="flex items-center justify-between px-1.5 py-1 text-[13px] font-extrabold"><span>{s.label}</span><span className={cx("rounded-md bg-white px-2 py-0.5 text-xs", t.text)}>{list.length}</span></div>
                <button className="mb-2 flex items-center gap-1 px-1.5 text-[11px] font-bold text-sub"><Plus className="size-3" />Add</button>
                <div className="space-y-2">
                  {list.slice(0, MAX).map((o) => (
                    <div key={o.id} className="rounded-xl border border-line bg-white p-2.5 text-[11px]">
                      <div className="flex items-start gap-2">
                        <Thumb seed={o.customer} size={34} />
                        <div className="min-w-0 flex-1 leading-tight"><div className="font-extrabold">{o.id}</div><div className="truncate text-sub">{o.customer}</div><div className="text-sub">{o.event}</div></div>
                        <MoreVertical className="size-3.5 text-sub" />
                      </div>
                      <div className="mt-1.5 flex items-center gap-1 text-sub"><CalendarDays className="size-3 text-rose-500" />{fmtDate(o.due)}</div>
                      <div className="mt-1"><PriorityPill p={o.priority} /></div>
                      <div className="mt-1.5 flex items-center justify-between"><span className="inline-flex items-center gap-1"><User className="size-3 text-sub" />{o.assignee}</span><span className="text-sub">{o.progress}%</span></div>
                      <ProgressBar value={o.progress} tone={s.tone} className="mt-1" />
                    </div>
                  ))}
                  {list.length === 0 && <div className="py-4 text-center text-[11px] text-sub">No orders</div>}
                </div>
                {list.length > MAX && <div className="pt-2 text-center text-[11px] font-bold text-sub">+ {list.length - MAX} more</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <Panel bodyClassName="!p-4">
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><Th>Order ID</Th><Th>Customer</Th><Th>Event</Th><Th>Stage</Th><Th>Priority</Th><Th>Assignee</Th><Th>Due</Th><Th className="w-40">Progress</Th></tr></thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} className={trCls}>
                    <Td className="font-bold">{o.id}</Td><Td>{o.customer}</Td><Td>{o.event}</Td><Td><Pill tone={stageTone(o.stage)} dot>{stageLabel(o.stage)}</Pill></Td>
                    <Td><PriorityPill p={o.priority} /></Td><Td>{o.assignee}</Td><Td>{fmtDate(o.due)}</Td><Td><ProgressBar value={o.progress} tone={stageTone(o.stage)} /></Td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-sub">No orders match.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

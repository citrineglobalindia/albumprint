import { useEffect, useRef, useState } from "react";
import { useReason } from "../components/ReasonDialog";
import { useAuth } from "../lib/auth";
import { moveStage as engineMove, nextStages } from "../lib/workflow";
import { editOrder } from "../lib/orderEdit";
import { useNavigate } from "react-router-dom";
import { ActionMenu } from "../components/ActionMenu";
import { SlidersHorizontal, ClipboardList, Settings, Users, Printer, Truck, ShieldCheck, CalendarDays, LayoutGrid, List, Plus, ArrowRight, User, RotateCcw, CheckCircle2, Info, GripVertical } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { PageHeader, PrimaryButton, OutlineButton, MoreButton, SlideOver, Field, KpiRow, Panel, Pill, Thumb, SearchInput, ProgressBar, PriorityPill, TONE, TodayChip, cx, tableCls, Th, Td, trCls, type Kpi } from "../components/ui";
import { MultiSelect, DateRangePicker, FilterChips, SavedViews, ColumnsMenu, SortTh, sortRows, Combobox, presetRange, inRange, fmtShort, type DateRange, type SortState } from "../components/controls";
import { useNewOrder } from "../components/NewOrderWizard";
import { ORDERS, STAGES, EVENTS, PRIORITIES, ASSIGNEES, ALBUM_SIZES, stageLabel, stageTone, type StageKey, type Order, type Priority } from "../lib/data";
import { fmtDate } from "../lib/format";
import { useStore, useSlashFocus, packRange, unpackRange } from "../lib/store";

// Soft WIP limits per stage (cards in flight before the column is flagged).
const WIP: Partial<Record<StageKey, number>> = { colour_grading: 8, admin_approval: 6, designing: 10, client_review: 8, final_approval: 5, printing: 8, qc: 6, ready_for_delivery: 8 };
const COLS = [{ key: "id", label: "Order ID" }, { key: "customer", label: "Customer" }, { key: "event", label: "Event" }, { key: "stage", label: "Stage" }, { key: "priority", label: "Priority" }, { key: "assignee", label: "Assignee" }, { key: "due", label: "Due" }, { key: "progress", label: "Progress" }];
const PRIO_RANK: Record<Priority, number> = { Low: 0, Normal: 1, High: 2, Urgent: 3, VIP: 4 };

interface ViewState { q: string; event: string[]; prio: string[]; asg: string[]; wf: string[]; size: string[]; range: ReturnType<typeof packRange>; hidden: string[]; sort: SortState }
interface Toast { msg: string; undo?: () => void; tone?: "ok" | "warn" }

export default function Pipeline() {
  useStore();
  const nav = useNavigate();
  const newOrder = useNewOrder();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [q, setQ] = useState("");
  const [event, setEvent] = useState<string[]>([]);
  const [prio, setPrio] = useState<string[]>([]);
  const [asg, setAsg] = useState<string[]>([]);
  const [wf, setWf] = useState<string[]>([]);
  const [size, setSize] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>(() => presetRange("All Time"));
  const [hidden, setHidden] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>(null);
  const [expanded, setExpanded] = useState<Set<StageKey>>(new Set());
  const [addTo, setAddTo] = useState<StageKey | null>(null);
  const [pick, setPick] = useState("");
  const [perr, setPerr] = useState("");
  const [drag, setDrag] = useState<string | null>(null);
  const [fOpen, setFOpen] = useState(false);
  const [over, setOver] = useState<StageKey | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const tt = useRef<number | undefined>(undefined);
  const searchWrap = useRef<HTMLDivElement>(null);
  useSlashFocus(searchWrap);
  const say = (t: Toast) => { setToast(t); window.clearTimeout(tt.current); tt.current = window.setTimeout(() => setToast(null), 6000); };
  useEffect(() => () => window.clearTimeout(tt.current), []);

  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [reasonDlg, askReason] = useReason();
  const legal = (o: Order, to: StageKey) => nextStages(o).find((n) => n.to === to);
  const stageOpts = STAGES.map((x) => ({ value: x.key, label: x.label }));

  /** The one place stage changes happen (drag, menu, Add dialog): always through the workflow engine, which mirrors the DB rules. */
  const tryMove = (id: string, to: StageKey, reason?: string): boolean => {
    const o = ORDERS.find((x) => x.id === id);
    if (!o || o.stage === to) return false;
    const rule = legal(o, to);
    if (rule?.needsReason && !reason) {
      askReason({ title: `Move ${o.id} to ${stageLabel(to)}`, message: `${stageLabel(o.stage)} → ${stageLabel(to)} needs a reason (rework / correction).`, confirmLabel: "Move" }, (r) => { tryMove(id, to, r); });
      return false;
    }
    const prev = o.stage;
    const r = engineMove(id, to, { reason });
    if (!r.ok) { say({ msg: r.error, tone: "warn" }); return false; }            // illegal drop: nothing moved, the card snaps back
    say({
      msg: `${o.id} moved to ${stageLabel(to)}`,
      undo: () => {
        // Undo goes back through the same engine; only an admin may force a move that is not a normal transition.
        const u = engineMove(id, prev, { reason: "Undo of accidental move", override: isAdmin });
        say(u.ok ? { msg: `${id} moved back to ${stageLabel(prev)}` } : { msg: `Cannot undo: ${u.error}`, tone: "warn" });
      },
    });
    return true;
  };
  const stepTo = (o: Order, to: StageKey) => { tryMove(o.id, to); };
  const confirmAdd = () => {
    if (!pick) { setPerr("Select an order to add"); return; }
    const o = ORDERS.find((x) => x.id === pick)!;
    const r = legal(o, addTo!);
    if (!r) { setPerr(nextStages(o).length ? `${o.id} (${stageLabel(o.stage)}) can only move to ${nextStages(o).map((n) => stageLabel(n.to)).join(" or ")}` : `${o.id} cannot move: ${o.closed ? "order is closed" : o.hold ? `order is ${o.hold.toLowerCase()}` : "no valid next stage for your role"}`); return; }
    const to = addTo!;
    if (tryMove(pick, to) || r.needsReason) { setAddTo(null); setPick(""); setPerr(""); }
  };
  const bump = (o: Order, d: 1 | -1) => {
    const t = PRIORITIES[PRIORITIES.indexOf(o.priority) + d] as Priority | undefined;
    if (!t) { say({ msg: `${o.id} priority is already ${o.priority}`, tone: "warn" }); return; }
    editOrder(o.id, { priority: t }, "priority"); say({ msg: `${o.id} priority set to ${t}` });
  };

  const filtered = ORDERS.filter((o) => {
    const s = q.trim().toLowerCase();
    if (s && ![o.id, o.customer, o.event, o.mobile].some((v) => v.toLowerCase().includes(s))) return false;
    if (event.length && !event.includes(o.event)) return false;
    if (prio.length && !prio.includes(o.priority)) return false;
    if (asg.length && !asg.includes(o.assignee)) return false;
    if (wf.length && !wf.includes(o.workflow)) return false;
    if (size.length && !size.includes(o.size)) return false;
    return inRange(o.pendingAt, range);
  });
  const byStage = (k: StageKey) => filtered.filter((o) => o.stage === k);
  const n = (...k: StageKey[]) => filtered.filter((o) => k.includes(o.stage)).length;
  const MAX = 3;

  const kpis: Kpi[] = [
    { label: "Total Orders", value: filtered.length, icon: ClipboardList, tone: "blue" },
    { label: "In Production", value: n("files_received", "colour_grading", "designing"), icon: Settings, tone: "violet" },
    { label: "Awaiting Approval", value: n("admin_approval", "client_review", "final_approval"), icon: Users, tone: "pink" },
    { label: "Printing & QC", value: n("printing", "qc"), icon: Printer, tone: "blue" },
    { label: "Ready for Delivery", value: n("ready_for_delivery"), icon: Truck, tone: "teal" },
    { label: "Delivered", value: n("delivered"), icon: ShieldCheck, tone: "green" },
  ];

  // Workload derived from ORDERS: cumulative orders intake vs delivered, per day across the visible window.
  const workload = (() => {
    const dates = filtered.map((o) => new Date(o.pendingAt).getTime());
    const end = range.to ? range.to.getTime() : Math.max(...dates, 0);
    const start = range.from ? range.from.getTime() : Math.min(...dates, end);
    const span = Math.max(1, Math.min(60, Math.round((end - start) / 86400000) + 1));
    return Array.from({ length: span }, (_, i) => {
      const d = new Date(end - (span - 1 - i) * 86400000); const iso = d.toISOString().slice(0, 10);
      const upto = filtered.filter((o) => o.pendingAt <= iso);
      return { d: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), pipeline: upto.filter((o) => o.stage !== "delivered").length, done: upto.filter((o) => o.stage === "delivered").length };
    });
  })();

  const reset = () => { setQ(""); setEvent([]); setPrio([]); setAsg([]); setWf([]); setSize([]); setRange(presetRange("All Time")); };
  const chips = [
    ...(range.preset !== "All Time" ? [{ label: `Date: ${range.preset === "Custom" ? `${fmtShort(range.from)} – ${fmtShort(range.to)}` : range.preset}`, onRemove: () => setRange(presetRange("All Time")) }] : []),
    ...([["Event", event, setEvent], ["Priority", prio, setPrio], ["Assignee", asg, setAsg], ["Workflow", wf, setWf], ["Size", size, setSize]] as [string, string[], (v: string[]) => void][]).filter(([, v]) => v.length).map(([l, v, set]) => ({ label: `${l}: ${v.join(", ")}`, onRemove: () => set([]) })),
    ...(q.trim() ? [{ label: `Search: “${q.trim()}”`, onRemove: () => setQ("") }] : []),
  ];
  const vs: ViewState = { q, event, prio, asg, wf, size, range: packRange(range), hidden, sort };
  const applyView = (v: ViewState) => { setQ(v.q); setEvent(v.event); setPrio(v.prio); setAsg(v.asg); setWf(v.wf); setSize(v.size); setRange(unpackRange(v.range)); setHidden(v.hidden); setSort(v.sort); };
  const show_ = (k: string) => !hidden.includes(k);
  const th = (k: string, label: string) => show_(k) && <SortTh key={k} k={k} sort={sort} onSort={setSort}>{label}</SortTh>;
  const listRows = sortRows(filtered, sort, (o, k) => k === "priority" ? PRIO_RANK[o.priority] : k === "stage" ? STAGES.findIndex((s) => s.key === o.stage) : k === "progress" ? o.progress : ((o as unknown as Record<string, string>)[k] ?? ""));

  return (
    <div>
      <PageHeader title="Production Pipeline" subtitle="Track and manage your album production from order to delivery.">
        <TodayChip />
        <PrimaryButton onClick={() => newOrder.open()}>New Order</PrimaryButton>
        <MoreButton />
      </PageHeader>
      <KpiRow items={kpis} />

      <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel title="Production Workload" action={<span className="flex gap-3 text-xs text-sub"><span><i className="mr-1 inline-block size-2 rounded-full bg-sky-500" />Orders in Pipeline</span><span><i className="mr-1 inline-block size-2 rounded-full bg-emerald-500" />Delivered</span></span>}>
          <div className="h-[150px]" data-testid="workload-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={workload}>
                <CartesianGrid stroke="#eef0f8" vertical={false} />
                <XAxis dataKey="d" tick={{ fontSize: 11 }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" name="In pipeline" dataKey="pipeline" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                <Line type="monotone" name="Delivered" dataKey="done" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Orders by Stage" action={<button onClick={() => setView("list")} className="inline-flex items-center gap-1 text-xs font-bold text-brand">View Details <ArrowRight className="size-3.5" /></button>}>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 xl:grid-cols-11">
            {STAGES.map((s) => (
              <button key={s.key} onClick={() => nav(`/orders?stage=${s.key}`)} title={`Open ${s.label} orders`} className="flex flex-col items-center rounded-lg text-center hover:bg-slate-50">
                <span className={cx("grid size-11 place-items-center rounded-xl text-sm font-extrabold", TONE[s.tone].soft, TONE[s.tone].text)}>{byStage(s.key).length}</span>
                <span className="mt-1.5 text-[11px] font-semibold leading-tight text-sub">{s.label}</span>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        <DateRangePicker align="left" value={range} onChange={setRange} />
        <div ref={searchWrap} className="min-w-[200px] flex-1"><SearchInput value={q} onChange={setQ} placeholder="Search orders, customer, event...  ( / )" /></div>
        <button type="button" aria-expanded={fOpen} aria-controls="pipe-filters" onClick={() => setFOpen(!fOpen)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold sm:hidden"><SlidersHorizontal className="size-4" aria-hidden />Filters{chips.length > 0 && <span className="rounded-full bg-brand px-1.5 text-xs text-white">{chips.length}</span>}</button>
        <div id="pipe-filters" className={cx(fOpen ? "flex flex-wrap items-center gap-2.5" : "hidden", "w-full sm:contents")}>
        <MultiSelect className="w-28" label="Event" options={EVENTS} value={event} onChange={setEvent} />
        <MultiSelect className="w-28" label="Priority" options={PRIORITIES} value={prio} onChange={setPrio} />
        <MultiSelect className="w-32" label="Assignee" options={ASSIGNEES} value={asg} onChange={setAsg} />
        <MultiSelect className="w-36" label="Workflow" options={["Design + Printing", "Printing"]} value={wf} onChange={setWf} />
        <MultiSelect className="w-28" label="Size" options={ALBUM_SIZES} value={size} onChange={setSize} />
        <SavedViews<ViewState> storageKey="pipeline" current={vs} onApply={applyView} />
        {view === "list" && <ColumnsMenu columns={COLS} hidden={hidden} onChange={setHidden} />}
        </div>
        <div className="flex overflow-hidden rounded-lg border border-line bg-white">
          {([["grid", LayoutGrid], ["list", List]] as const).map(([k, I]) => (
            <button key={k} aria-label={`${k === "grid" ? "Board" : "List"} view`} aria-pressed={view === k} onClick={() => setView(k)} className={cx("grid size-10 place-items-center", view === k ? "bg-brand text-white" : "text-sub")}><I className="size-4" /></button>
          ))}
        </div>
      </div>
      <FilterChips chips={chips} onClearAll={reset} />

      {view === "grid" ? (
        <div data-testid="board" className={cx("scroll-thin -mx-3 flex gap-3 overflow-x-auto px-3 pb-3 sm:mx-0 sm:px-0", !drag && "snap-board")}
          onDragOver={(e) => {   // edge auto-scroll so far-away columns are reachable while dragging
            const r = e.currentTarget.getBoundingClientRect();
            if (e.clientX > r.right - 70) e.currentTarget.scrollLeft += 18; else if (e.clientX < r.left + 70) e.currentTarget.scrollLeft -= 18;
          }}>
          {STAGES.map((s) => {
            const list = byStage(s.key); const t = TONE[s.tone];
            const lim = WIP[s.key]; const hot = lim !== undefined && list.length > lim;
            const dragging = drag ? ORDERS.find((o) => o.id === drag) : null;
            const nope = !!dragging && dragging.stage !== s.key && !legal(dragging, s.key);
            return (
              <div key={s.key} data-stage={s.key} aria-label={`${s.label} column`} role="group"
                onDragOver={(e) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== s.key) setOver(s.key); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((c) => (c === s.key ? null : c)); }}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain") || drag; setOver(null); setDrag(null); if (id) tryMove(id, s.key); }}
                className={cx("w-[78vw] max-w-[260px] shrink-0 rounded-2xl border p-2 transition sm:w-[210px]", t.border, t.soft, over === s.key && !nope && "ring-2 ring-brand ring-offset-1", over === s.key && nope && "opacity-60 ring-2 ring-rose-400", !!drag && over !== s.key && "outline-dashed outline-1 outline-slate-300")}>
                <div className="flex items-center justify-between px-1.5 py-1 text-[13px] font-extrabold">
                  <span>{s.label}</span>
                  <span className="flex items-center gap-1">
                    {lim !== undefined && <span title={`WIP limit ${lim}`} className={cx("rounded-md px-1.5 py-0.5 text-[10px] font-bold", hot ? "bg-rose-700 text-white" : "bg-white/70 text-sub")}>WIP {list.length}/{lim}</span>}
                    <span data-testid={`count-${s.key}`} className={cx("rounded-md bg-white px-2 py-0.5 text-xs", t.text)}>{list.length}</span>
                  </span>
                </div>
                <button onClick={() => { setAddTo(s.key); setPick(""); setPerr(""); }} className="mb-2 flex items-center gap-1 px-1.5 text-[11px] font-bold text-sub hover:text-brand"><Plus className="size-3" />Add</button>
                <div className="min-h-[40px] space-y-2">
                  {list.slice(0, expanded.has(s.key) ? list.length : MAX).map((o) => (
                    <div key={o.id} data-card={o.id} draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", o.id); e.dataTransfer.effectAllowed = "move"; setDrag(o.id); }}
                      onDragEnd={() => { setDrag(null); setOver(null); }}
                      onClick={() => nav(`/orders/${o.id}`)}
                      className={cx("cursor-grab rounded-xl border border-line bg-white p-2.5 text-[11px] hover:shadow-md active:cursor-grabbing", drag === o.id && "opacity-40")}>
                      <div className="flex items-start gap-2">
                        <Thumb seed={o.customer} size={34} />
                        <div className="min-w-0 flex-1 leading-tight"><div className="font-extrabold">{o.id}{o.hold && <span className="ml-1.5 rounded bg-rose-50 px-1 text-[10px] font-bold text-rose-600">{o.hold}</span>}{o.closed && <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] font-bold text-sub">Closed</span>}</div><div className="truncate text-sub">{o.customer}</div><div className="text-sub">{o.event}{o.workflow === "Printing" ? " · Print only" : ""}</div></div>
                        <ActionMenu width={210} label={`Actions for ${o.id}`} items={[
                          { label: "Open order", onClick: () => nav(`/orders/${o.id}`) },
                          ...nextStages(o).map((n) => ({ label: `Move to ${stageLabel(n.to)}${n.needsReason ? " (reason)" : ""}`, onClick: () => stepTo(o, n.to) })),
                          { label: "Raise priority", onClick: () => bump(o, 1) },
                          { label: "Lower priority", onClick: () => bump(o, -1) },
                        ]} />
                      </div>
                      <div className="mt-1.5 flex items-center gap-1 text-sub"><CalendarDays className="size-3 text-rose-500" />{fmtDate(o.due)}<GripVertical className="ml-auto size-3 text-slate-300" /></div>
                      <div className="mt-1"><PriorityPill p={o.priority} /></div>
                      <div className="mt-1.5 flex items-center justify-between"><span className="inline-flex items-center gap-1"><User className="size-3 text-sub" />{o.assignee}</span><span className="text-sub">{o.progress}%</span></div>
                      <ProgressBar value={o.progress} tone={s.tone} className="mt-1" />
                    </div>
                  ))}
                  {list.length === 0 && <div className="py-4 text-center text-[11px] text-sub">{drag ? "Drop here" : "No orders"}</div>}
                </div>
                {list.length > MAX && (
                  <button onClick={() => setExpanded((p) => { const nx = new Set(p); nx.has(s.key) ? nx.delete(s.key) : nx.add(s.key); return nx; })} className="block w-full pt-2 text-center text-[11px] font-bold text-sub hover:text-brand">
                    {expanded.has(s.key) ? "Show less" : `+ ${list.length - MAX} more`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Panel bodyClassName="!p-4">
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr>{th("id", "Order ID")}{th("customer", "Customer")}{th("event", "Event")}{th("stage", "Stage")}{th("priority", "Priority")}{th("assignee", "Assignee")}{th("due", "Due")}{th("progress", "Progress")}</tr></thead>
              <tbody>
                {listRows.map((o) => (
                  <tr key={o.id} onClick={() => nav(`/orders/${o.id}`)} className={cx(trCls, "cursor-pointer")}>
                    {show_("id") && <Td className="font-bold">{o.id}</Td>}{show_("customer") && <Td>{o.customer}</Td>}{show_("event") && <Td>{o.event}</Td>}
                    {show_("stage") && <Td><Pill tone={stageTone(o.stage)} dot>{stageLabel(o.stage)}</Pill></Td>}
                    {show_("priority") && <Td><PriorityPill p={o.priority} /></Td>}{show_("assignee") && <Td>{o.assignee}</Td>}{show_("due") && <Td>{fmtDate(o.due)}</Td>}
                    {show_("progress") && <Td className="w-40"><ProgressBar value={o.progress} tone={stageTone(o.stage)} /></Td>}
                  </tr>
                ))}
                {listRows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-sub">No orders match.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <SlideOver open={addTo !== null} onClose={() => setAddTo(null)} title={`Add order to ${STAGES.find((x) => x.key === addTo)?.label ?? ""}`}
        footer={<><OutlineButton onClick={() => setAddTo(null)}>Cancel</OutlineButton><PrimaryButton onClick={confirmAdd}>Move to stage</PrimaryButton></>}>
        <Field label="Order" required>
          <Combobox error={!!perr} placeholder="Select an order…" value={pick} onChange={(v) => { setPick(v); setPerr(""); }}
            options={ORDERS.filter((o) => o.stage !== addTo).map((o) => ({ value: o.id, label: o.id, sub: `${o.customer} · ${stageLabel(o.stage)}` }))} />
          {perr && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{perr}</p>}
        </Field>
      </SlideOver>

      {reasonDlg}
      {toast && (
        <div role={toast.tone === "warn" ? "alert" : "status"} aria-live={toast.tone === "warn" ? "assertive" : "polite"} data-testid={toast.tone === "warn" ? "pipeline-warn" : "pipeline-toast"} className={cx("fixed bottom-4 left-4 right-4 z-[80] mx-auto flex max-w-xl items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-2xl sm:bottom-6", toast.tone === "warn" ? "bg-amber-700" : "bg-ink")}>
          {toast.tone === "warn" ? <Info className="size-4" /> : <CheckCircle2 className="size-4 text-emerald-400" />}
          <span className="min-w-0 flex-1">{toast.msg}</span>
          {toast.undo && <button data-testid="undo-move" onClick={() => { const u = toast.undo!; u(); }} className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-bold hover:bg-white/25"><RotateCcw className="size-3" />Undo</button>}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useNotice } from "../components/Notice";
import { useReason } from "../components/ReasonDialog";
import { ActionMenu } from "../components/ActionMenu";
import { ClipboardList, Clock, MonitorPlay, PlusCircle, RotateCcw, ShieldCheck, Users, Check, AlarmClock, ExternalLink, PauseCircle, PlayCircle } from "lucide-react";
import {
  PageHeader, PrimaryButton, OutlineButton, KpiRow, Panel, Pill, Avatar, Thumb, SearchInput, CountTabs,
  Pagination, tableCls, Th, Td, trCls, RowViewButton, PriorityPill, PayPill, SlideOver, Field, inputCls, MoreButton, cx, type Kpi,
} from "../components/ui";
import { MultiSelect, DateRangePicker, FilterChips, SavedViews, ColumnsMenu, SortTh, sortRows, Combobox, presetRange, inRange, fmtShort, type DateRange, type SortState } from "../components/controls";
import { InlinePop } from "../components/InlinePop";
import { useNewOrder } from "../components/NewOrderWizard";
import { ORDERS, CUSTOMERS, STAGES, ASSIGNEES, EVENTS, ALBUM_SIZES, PRIORITIES, stageLabel, stageTone, type Order, type StageKey, type Priority } from "../lib/data";
import { fmtDate, inr, isOverdue, TODAY } from "../lib/format";
import { useStore, useSlashFocus, packRange, unpackRange } from "../lib/store";
import { setHold as holdOrder, cancelOrder, type Result } from "../lib/workflow";
import { editOrder } from "../lib/orderEdit";
import { useAuth } from "../lib/auth";
import { savedKeys } from "../lib/persist";

type TabKey = "all" | "new" | "progress" | "client" | "print" | "out" | "delivered" | "hold" | "cancelled";
const GROUP: Record<TabKey, StageKey[] | null> = {
  all: null, new: ["new_order", "files_received"], progress: ["colour_grading", "admin_approval", "designing", "printing", "qc"],
  client: ["client_review"], print: ["final_approval"], out: ["ready_for_delivery"], delivered: ["delivered"], hold: null, cancelled: null,
};
function inTab(o: Order, t: TabKey) {
  if (t === "all") return true;
  if (t === "hold") return o.hold === "On Hold";
  if (t === "cancelled") return o.hold === "Cancelled";
  return !o.hold && GROUP[t]!.includes(o.stage);
}
const PRIO_RANK: Record<Priority, number> = { Low: 0, Normal: 1, High: 2, Urgent: 3, VIP: 4 };
const COLS = [
  { key: "id", label: "Order ID" }, { key: "customer", label: "Customer" }, { key: "event", label: "Event" }, { key: "workflow", label: "Workflow Type" },
  { key: "size", label: "Album Size" }, { key: "stage", label: "Current Stage" }, { key: "priority", label: "Priority" }, { key: "pendingAt", label: "Order Date" },
  { key: "assignee", label: "Assigned To" }, { key: "due", label: "Due Date" }, { key: "pay", label: "Payment Status" },
];
const PAY = ["Paid", "Partial", "Unpaid", "Overdue"];
const STAGE_LABELS = STAGES.map((s) => s.label);
const isLate = (o: Order) => o.stage !== "delivered" && !o.hold && isOverdue(o.due);
const csv = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

interface ViewState { q: string; wf: string[]; size: string[]; prio: string[]; pay: string[]; asg: string[]; evt: string[]; stages: string[]; late: boolean; range: ReturnType<typeof packRange>; hidden: string[]; sort: SortState }

export default function Orders() {
  useStore();
  const newOrder = useNewOrder();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [toast, show, fail] = useNotice();
  const [reasonDlg, askReason] = useReason();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const init = useRef(params).current;
  const [tab, setTab] = useState<TabKey>(() => (init.get("tab") as TabKey) || "all");
  const [q, setQ] = useState("");
  const [wf, setWf] = useState<string[]>([]);
  const [size, setSize] = useState<string[]>([]);
  const [prio, setPrio] = useState<string[]>(() => csv(init.get("priority")));
  const [pay, setPay] = useState<string[]>(() => csv(init.get("pay")));
  const [asg, setAsg] = useState<string[]>([]);
  const [evt, setEvt] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>(() => csv(init.get("stage")).map((k) => STAGES.find((s) => s.key === k)?.label).filter(Boolean) as string[]);
  const [late, setLate] = useState(() => init.get("overdue") === "1");
  const [range, setRange] = useState<DateRange>(() => presetRange("All Time"));
  const [hidden, setHidden] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<string | null>(null);
  const [editing, setEditing] = useState<Order | null>(null);
  const [ef, setEf] = useState({ size: "12x36", due: "" });
  const [eerr, setEerr] = useState("");
  const searchWrap = useRef<HTMLDivElement>(null);
  useSlashFocus(searchWrap);

  useEffect(() => {
    if (params.get("new") === "1") {
      const name = params.get("customer");
      newOrder.open({ customerId: name ? CUSTOMERS.find((c) => c.name === name || c.id === name)?.id : undefined });
    }
    if (params.toString()) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const show_ = (c: string) => !hidden.includes(c);
  const reset = () => { setQ(""); setWf([]); setSize([]); setPrio([]); setPay([]); setAsg([]); setEvt([]); setStages([]); setLate(false); setRange(presetRange("All Time")); setPage(1); };

  const base = ORDERS.filter((o) => {
    const s = q.trim().toLowerCase();
    if (s && ![o.id, o.customer, o.mobile, o.event].some((v) => v.toLowerCase().includes(s))) return false;
    if (wf.length && !wf.includes(o.workflow)) return false;
    if (size.length && !size.includes(o.size)) return false;
    if (prio.length && !prio.includes(o.priority)) return false;
    if (pay.length && !pay.includes(o.pay)) return false;
    if (asg.length && !asg.includes(o.assignee)) return false;
    if (evt.length && !evt.includes(o.event)) return false;
    if (stages.length && !stages.includes(stageLabel(o.stage))) return false;
    if (late && !isLate(o)) return false;
    if (!inRange(o.pendingAt, range)) return false;
    return true;
  });

  const count = (t: TabKey) => base.filter((o) => inTab(o, t)).length;
  const filtered = sortRows(base.filter((o) => inTab(o, tab)), sort, (o, k) =>
    k === "priority" ? PRIO_RANK[o.priority] : k === "stage" ? STAGES.findIndex((s) => s.key === o.stage) : (o as unknown as Record<string, string>)[k] ?? "");
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const allSel = pageRows.length > 0 && pageRows.every((o) => sel.has(o.id));
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const onSort = (s: SortState) => { setSort(s); setPage(1); };
  const th = (k: string, label: string) => show_(k) && <SortTh key={k} k={k} sort={sort} onSort={onSort}>{label}</SortTh>;

  const kpis: Kpi[] = [
    { label: "Total Orders", value: ORDERS.length, icon: ClipboardList, tone: "blue" },
    { label: "New Orders", value: ORDERS.filter((o) => inTab(o, "new")).length, icon: PlusCircle, tone: "orange" },
    { label: "In Progress", value: ORDERS.filter((o) => inTab(o, "progress")).length, icon: MonitorPlay, tone: "pink" },
    { label: "Client Review Pending", value: ORDERS.filter((o) => inTab(o, "client")).length, icon: Users, tone: "pink" },
    { label: "Ready for Printing", value: ORDERS.filter((o) => inTab(o, "print")).length, icon: ShieldCheck, tone: "green" },
    { label: "Overdue", value: ORDERS.filter(isLate).length, icon: Clock, tone: "red", invert: true },
  ];

  /** Runs one workflow-engine call per selected order; engine refusals are collected and shown, never swallowed. */
  const runBulk = (label: string, call: (o: Order) => Result) => {
    const ids = [...sel]; let done = 0; const errs: string[] = [];
    ids.forEach((id) => { const o = ORDERS.find((x) => x.id === id); if (!o) return; const r = call(o); if (r.ok) done++; else errs.push(`${id}: ${r.error}`); });
    setSel(new Set());
    const msg = `${label}: ${done} of ${ids.length} orders`;
    if (errs.length) fail(`${msg}. ${errs[0]}${errs.length > 1 ? ` (+${errs.length - 1} more refused)` : ""}`); else show(msg);
  };
  const resumeOne = (o: Order): Result => o.hold === "Cancelled" ? { ok: false, error: `${o.id} is cancelled and cannot be resumed` } : o.hold !== "On Hold" ? { ok: false, error: `${o.id} is not on hold` } : holdOrder(o.id, false);
  const bulkHold = () => askReason({ title: `Put ${sel.size} order${sel.size > 1 ? "s" : ""} on hold`, message: "The reason is recorded in each order's audit trail.", confirmLabel: "Put on hold" }, (reason) => runBulk("Put on hold", (o) => holdOrder(o.id, true, reason)));
  const bulkCancel = () => askReason({ title: `Cancel ${sel.size} order${sel.size > 1 ? "s" : ""}`, message: "Cancelled orders keep their history but leave the pipeline.", confirmLabel: "Cancel orders", danger: true }, (reason) => runBulk("Cancelled", (o) => cancelOrder(o.id, reason)));
  const bulkResume = () => runBulk("Resumed", resumeOne);
  const holdOne = (o: Order) => askReason({ title: `Put ${o.id} on hold`, confirmLabel: "Put on hold" }, (reason) => { const r = holdOrder(o.id, true, reason); r.ok ? show(`${o.id} put on hold`) : fail(r.error); });
  const cancelOne = (o: Order) => askReason({ title: `Cancel ${o.id}`, message: "This cannot be undone from the pipeline; history is preserved.", confirmLabel: "Cancel order", danger: true }, (reason) => { const r = cancelOrder(o.id, reason); r.ok ? show(`${o.id} cancelled`) : fail(r.error); });
  const resumeOneToast = (o: Order) => { const r = resumeOne(o); r.ok ? show(`${o.id} resumed`) : fail(r.error); };
  const bulkEdit = (patch: Partial<Order>, action: string, msg: string) => { const n = sel.size; [...sel].forEach((id) => editOrder(id, patch, action)); setSel(new Set()); show(`${msg} (${n} orders)`); };
  const openEdit = (o: Order) => { setEf({ due: o.due, size: o.size }); setEerr(""); setEditing(o); };
  const saveEdit = () => {
    if (!ef.due) { setEerr("Due date is required."); return; }
    const o = editing!; if (o.closed) { fail(`${o.id} is closed and read-only — reopen it first`); return; }
    editOrder(o.id, ef, "update", "Due date / album size edited"); show(`Order ${o.id} updated`); setEditing(null);
  };

  const chips = [
    ...(range.preset !== "All Time" ? [{ label: `Date: ${range.preset === "Custom" ? `${fmtShort(range.from)} – ${fmtShort(range.to)}` : range.preset}`, onRemove: () => setRange(presetRange("All Time")) }] : []),
    ...([["Stage", stages, setStages], ["Workflow", wf, setWf], ["Size", size, setSize], ["Priority", prio, setPrio], ["Payment", pay, setPay], ["Assignee", asg, setAsg], ["Event", evt, setEvt]] as [string, string[], (v: string[]) => void][])
      .filter(([, v]) => v.length).map(([l, v, set]) => ({ label: `${l}: ${v.join(", ")}`, onRemove: () => { set([]); setPage(1); } })),
    ...(late ? [{ label: "Overdue only", onRemove: () => setLate(false) }] : []),
    ...(q.trim() ? [{ label: `Search: “${q.trim()}”`, onRemove: () => setQ("") }] : []),
  ];
  const view: ViewState = { q, wf, size, prio, pay, asg, evt, stages, late, range: packRange(range), hidden, sort };
  const applyView = (v: ViewState) => { setQ(v.q); setWf(v.wf); setSize(v.size); setPrio(v.prio); setPay(v.pay); setAsg(v.asg); setEvt(v.evt); setStages(v.stages); setLate(v.late); setRange(unpackRange(v.range)); setHidden(v.hidden); setSort(v.sort); setPage(1); show("View applied"); };
  const f = (set: (v: string[]) => void) => (v: string[]) => { set(v); setPage(1); };

  const d = drawer ? ORDERS.find((o) => o.id === drawer) ?? null : null;
  const visibleCols = COLS.filter((c) => show_(c.key)).length + 2;

  return (
    <div>
      <PageHeader title="Orders" subtitle="Manage and track all album orders from design to delivery.">
        <DateRangePicker value={range} onChange={(r) => { setRange(r); setPage(1); }} />
        <MoreButton />
        <PrimaryButton onClick={() => newOrder.open()}>Create Order</PrimaryButton>
      </PageHeader>

      <KpiRow items={kpis} />

      <Panel bodyClassName="!p-4">
        <CountTabs<TabKey> value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={[
          { key: "all", label: "All Orders", count: count("all") }, { key: "new", label: "New Orders", count: count("new"), tone: "blue" },
          { key: "progress", label: "In Progress", count: count("progress"), tone: "violet" }, { key: "client", label: "Client Review", count: count("client"), tone: "amber" },
          { key: "print", label: "Ready for Printing", count: count("print"), tone: "green" }, { key: "out", label: "Out for Delivery", count: count("out"), tone: "amber" },
          { key: "delivered", label: "Delivered", count: count("delivered"), tone: "green" }, { key: "hold", label: "On Hold", count: count("hold"), tone: "pink" },
          { key: "cancelled", label: "Cancelled", count: count("cancelled"), tone: "red" },
        ]} />

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <div ref={searchWrap} className="min-w-[240px] flex-1"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by Order ID, customer, mobile, event...  ( / )" /></div>
          <MultiSelect className="w-36" label="Stage" options={STAGE_LABELS} value={stages} onChange={f(setStages)} />
          <MultiSelect className="w-40" label="Workflow Type" options={["Design + Printing", "Printing"]} value={wf} onChange={f(setWf)} />
          <MultiSelect className="w-32" label="Album Size" options={ALBUM_SIZES} value={size} onChange={f(setSize)} />
          <MultiSelect className="w-28" label="Priority" options={PRIORITIES} value={prio} onChange={f(setPrio)} />
          <MultiSelect className="w-32" label="Payment" options={PAY} value={pay} onChange={f(setPay)} />
          <MultiSelect className="w-32" label="Assignee" options={ASSIGNEES} value={asg} onChange={f(setAsg)} />
          <MultiSelect className="w-28" label="Event" options={EVENTS} value={evt} onChange={f(setEvt)} />
          <button aria-pressed={late} onClick={() => { setLate(!late); setPage(1); }} className={cx("inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold", late ? "border-rose-400 bg-rose-50 text-rose-600" : "border-line bg-white")}><AlarmClock className="size-4" />Overdue</button>
          <SavedViews<ViewState> storageKey="orders" current={view} onApply={applyView} />
          <ColumnsMenu columns={COLS} hidden={hidden} onChange={setHidden} />
          <button onClick={reset} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-brand"><RotateCcw className="size-4" />Reset</button>
        </div>
        <div className="mt-3"><FilterChips chips={chips} onClearAll={reset} /></div>

        {sel.size > 0 && (
          <div data-testid="bulk-bar" className="mt-1 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft px-3 py-2 text-[13px]">
            <b>{sel.size} selected</b>
            <OutlineButton onClick={bulkHold}>Put On Hold</OutlineButton>
            <OutlineButton onClick={bulkResume}>Resume</OutlineButton>
            {isAdmin && <OutlineButton onClick={bulkCancel}>Cancel</OutlineButton>}
            <OutlineButton onClick={() => bulkEdit({ priority: "High" }, "priority", "Priority set to High")}>Set High priority</OutlineButton>
            <div className="w-44"><Combobox options={ASSIGNEES.map((a) => ({ value: a, label: a }))} value="" placeholder="Assign to…" onChange={(v) => bulkEdit({ assignee: v }, "reassign", `Assigned to ${v}`)} /></div>
            <button onClick={() => setSel(new Set())} className="ml-auto text-xs font-bold text-brand">Clear</button>
          </div>
        )}
        <div className="mt-2 overflow-x-auto">
          <table className={tableCls}>
            <thead>
              <tr>
                <Th><input type="checkbox" aria-label="Select page" checked={allSel} onChange={() => setSel((p) => { const n = new Set(p); pageRows.forEach((o) => allSel ? n.delete(o.id) : n.add(o.id)); return n; })} /></Th>
                {th("id", "Order ID")}{th("customer", "Customer")}{th("event", "Event")}{th("workflow", "Workflow Type")}{th("size", "Album Size")}
                {th("stage", "Current Stage")}{th("priority", "Priority")}{th("pendingAt", "Order Date")}{th("assignee", "Assigned To")}{th("due", "Due Date")}{th("pay", "Payment Status")}
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o) => (
                <tr key={o.id} data-row={o.id} onClick={() => setDrawer(o.id)} className={cx(trCls, "cursor-pointer", sel.has(o.id) && "bg-brand-soft/60")}>
                  <Td><input type="checkbox" aria-label={`Select ${o.id}`} checked={sel.has(o.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(o.id)} /></Td>
                  {show_("id") && <Td className="font-bold">{o.id}</Td>}
                  {show_("customer") && <Td><div className="flex items-center gap-3"><Thumb seed={o.customer} size={36} /><div className="leading-tight"><div className="font-semibold">{o.customer}</div><div className="text-xs text-sub">{o.mobile}</div></div></div></Td>}
                  {show_("event") && <Td>{o.event}</Td>}
                  {show_("workflow") && <Td>{o.workflow}</Td>}
                  {show_("size") && <Td>{o.size}</Td>}
                  {show_("stage") && <Td>{o.hold ? <Pill tone={o.hold === "On Hold" ? "pink" : "red"} dot>{o.hold}</Pill> : <Pill tone={stageTone(o.stage)} dot>{stageLabel(o.stage)}</Pill>}</Td>}
                  {show_("priority") && (
                    <Td>
                      <InlinePop title="Change priority" label={`Change priority of ${o.id}`} trigger={<PriorityPill p={o.priority} />}>
                        {(close) => PRIORITIES.map((p) => (
                          <button key={p} onClick={() => { editOrder(o.id, { priority: p }, "priority"); show(`${o.id} priority set to ${p}`); close(); }} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 hover:bg-brand-soft"><PriorityPill p={p} />{p === o.priority && <Check className="size-4 text-brand" />}</button>
                        ))}
                      </InlinePop>
                    </Td>
                  )}
                  {show_("pendingAt") && <Td>{fmtDate(o.pendingAt)}</Td>}
                  {show_("assignee") && (
                    <Td>
                      <InlinePop title="Reassign to" label={`Reassign ${o.id}`} trigger={<span className="inline-flex items-center gap-2"><Avatar name={o.assignee} size={24} />{o.assignee}</span>}>
                        {(close) => <Combobox options={ASSIGNEES.map((a) => ({ value: a, label: a }))} value={o.assignee} onChange={(v) => { editOrder(o.id, { assignee: v }, "reassign"); show(`${o.id} reassigned to ${v}`); close(); }} />}
                      </InlinePop>
                    </Td>
                  )}
                  {show_("due") && <Td className={cx("font-medium", isLate(o) && "text-rose-600")}>{fmtDate(o.due)}</Td>}
                  {show_("pay") && <Td><PayPill s={o.pay} /></Td>}
                  <Td className="text-right">
                    <span className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}><RowViewButton to={`/orders/${o.id}`} />
                      <ActionMenu items={[
                        { label: "Quick view", onClick: () => setDrawer(o.id) },
                        { label: "View details", onClick: () => nav(`/orders/${o.id}`) },
                        { label: "Edit", onClick: () => openEdit(o) },
                        { label: "Resume", hidden: o.hold !== "On Hold", onClick: () => resumeOneToast(o) },
                        { label: "Put On Hold", hidden: !!o.hold, onClick: () => holdOne(o) },
                        { label: "Cancel Order", danger: true, hidden: !isAdmin || o.hold === "Cancelled", onClick: () => cancelOne(o) },
                      ]} /></span>
                  </Td>
                </tr>
              ))}
              {pageRows.length === 0 && <tr><td colSpan={visibleCols} className="py-10 text-center text-sub">No orders match the current filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="orders" />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-sub"><SavedStamp />{sel.size} selected · today {fmtDate(TODAY)} · <span className="hidden sm:inline">press <kbd className="rounded border border-line px-1">/</kbd> to search, <kbd className="rounded border border-line px-1">n</kbd> for new order</span></div>
      </Panel>

      <SlideOver open={!!d} onClose={() => setDrawer(null)} title={d ? `${d.id} · ${d.customer}` : ""} width={520}
        footer={d && <><OutlineButton onClick={() => setDrawer(null)}>Close</OutlineButton><PrimaryButton icon={ExternalLink} onClick={() => nav(`/orders/${d.id}`)}>Open full page</PrimaryButton></>}>
        {d && (
          <div data-testid="order-drawer">
            <div className="flex flex-wrap items-center gap-2">
              {d.hold ? <Pill tone={d.hold === "On Hold" ? "pink" : "red"} dot>{d.hold}</Pill> : <Pill tone={stageTone(d.stage)} dot>{stageLabel(d.stage)}</Pill>}
              <PriorityPill p={d.priority} /><PayPill s={d.pay} />
              {isLate(d) && <Pill tone="red">Overdue</Pill>}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              {([["Customer", d.customer], ["Mobile", d.mobile], ["Event", d.event], ["Workflow", d.workflow], ["Album", `${d.size} · ${d.pages} pages`], ["Order date", fmtDate(d.pendingAt)], ["Due date", fmtDate(d.due)], ["Assigned to", d.assignee], ["Order value", inr(d.total)], ["Paid", `${inr(d.paid)} (${d.pay})`]] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-sub">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
            </dl>
            <h3 className="mb-2 mt-6 text-sm font-extrabold">Progress · {d.progress}%</h3>
            <ol className="space-y-1.5">
              {STAGES.map((s, i) => {
                const cur = STAGES.findIndex((x) => x.key === d.stage);
                const skipped = d.workflow === "Printing" && ["colour_grading", "admin_approval", "designing", "client_review", "final_approval"].includes(s.key);
                return (
                  <li key={s.key} className={cx("flex items-center gap-2.5 text-[13px]", skipped && "opacity-40")}>
                    <span className={cx("grid size-5 place-items-center rounded-full text-[10px] font-bold", i < cur ? "bg-emerald-500 text-white" : i === cur ? "bg-brand text-white" : "bg-slate-100 text-sub")}>{i < cur ? <Check className="size-3" /> : i + 1}</span>
                    <span className={cx(i === cur && "font-extrabold text-brand")}>{s.label}</span>{skipped && <span className="text-xs text-sub">(not required)</span>}
                  </li>
                );
              })}
            </ol>
            <h3 className="mb-2 mt-6 text-sm font-extrabold">Quick actions</h3>
            <div className="space-y-3">
              <div>
                <span className="mb-1 block text-xs font-semibold text-sub">Priority</span>
                <div className="flex flex-wrap gap-1.5">
                  {PRIORITIES.map((p) => <button key={p} aria-pressed={d.priority === p} onClick={() => { editOrder(d.id, { priority: p }, "priority"); show(`${d.id} priority set to ${p}`); }} className={cx("rounded-full border px-3 py-1 text-xs font-bold", d.priority === p ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{p}</button>)}
                </div>
              </div>
              <div>
                <span className="mb-1 block text-xs font-semibold text-sub">Reassign</span>
                <Combobox options={ASSIGNEES.map((a) => ({ value: a, label: a }))} value={d.assignee} onChange={(v) => { editOrder(d.id, { assignee: v }, "reassign"); show(`${d.id} reassigned to ${v}`); }} />
              </div>
              <div className="flex gap-2">
                {d.hold === "On Hold" ? <OutlineButton icon={PlayCircle} onClick={() => resumeOneToast(d)}>Resume</OutlineButton> : !d.hold ? <OutlineButton icon={PauseCircle} onClick={() => holdOne(d)}>Put on hold</OutlineButton> : null}
                <OutlineButton onClick={() => openEdit(d)}>Edit dates / size</OutlineButton>
              </div>
            </div>
          </div>
        )}
      </SlideOver>

      <SlideOver open={!!editing} onClose={() => setEditing(null)} title={`Edit ${editing?.id ?? ""}`} width={420}
        footer={<><OutlineButton onClick={() => setEditing(null)}>Cancel</OutlineButton><PrimaryButton icon={Check} onClick={saveEdit}>Save changes</PrimaryButton></>}>
        {eerr && <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-600">{eerr}</div>}
        <Field label="Album size"><Combobox options={ALBUM_SIZES.map((s) => ({ value: s, label: s }))} value={ef.size} onChange={(v) => setEf({ ...ef, size: v })} /></Field>
        <Field label="Due date" required><input type="date" className={inputCls} value={ef.due} onChange={(e) => setEf({ ...ef, due: e.target.value })} /></Field>
      </SlideOver>
      {reasonDlg}
      {toast}
    </div>
  );
}

/** "Last saved" — watches the browser copy of the orders list that boot.ts/persist.ts autosaves. */
function SavedStamp() {
  const [at, setAt] = useState<Date | null>(null);
  useEffect(() => {
    let last = ""; const read = () => { try { return localStorage.getItem("albumpro.v1.orders") ?? ""; } catch { return ""; } };
    last = read(); if (last) setAt(new Date());
    const t = window.setInterval(() => { const n = read(); if (n && n !== last) { last = n; setAt(new Date()); } }, 1000);
    return () => window.clearInterval(t);
  }, []);
  const ok = savedKeys().length > 0 || !!at;
  return <span data-testid="last-saved" className="text-xs text-sub">{ok && at ? `Saved in this browser · ${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Autosave on"}</span>;
}

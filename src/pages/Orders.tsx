import { useMemo, useState } from "react";
import { ArrowUpDown, CalendarDays, ClipboardList, Clock, Filter, MoreVertical, MonitorPlay, PlusCircle, RotateCcw, ShieldCheck, Users, Plus } from "lucide-react";
import {
  PageHeader, PrimaryButton, OutlineButton, KpiRow, Panel, Pill, Avatar, Thumb, SearchInput, FilterSelect, CountTabs,
  Pagination, tableCls, Th, Td, trCls, RowViewButton, PriorityPill, PayPill, SlideOver, Field, inputCls, cx, type Kpi,
} from "../components/ui";
import {
  ORDERS, CUSTOMERS, STAGES, ASSIGNEES, EVENTS, ALBUM_SIZES, PRIORITIES, stageLabel, stageTone,
  type Order, type StageKey, type Priority, type WorkflowType,
} from "../lib/data";
import { fmtDate, isOverdue, TODAY } from "../lib/format";

type Hold = "On Hold" | "Cancelled";
type Row = Order & { hold?: Hold };
type TabKey = "all" | "new" | "progress" | "client" | "print" | "out" | "delivered" | "hold" | "cancelled";

const GROUP: Record<TabKey, StageKey[] | null> = {
  all: null, new: ["new_order", "files_received"], progress: ["colour_grading", "admin_approval", "designing", "printing", "qc"],
  client: ["client_review"], print: ["final_approval"], out: ["ready_for_delivery"], delivered: ["delivered"], hold: null, cancelled: null,
};

function inTab(o: Row, t: TabKey) {
  if (t === "all") return true;
  if (t === "hold") return o.hold === "On Hold";
  if (t === "cancelled") return o.hold === "Cancelled";
  return !o.hold && GROUP[t]!.includes(o.stage);
}

type SortKey = "customer" | "stage" | "priority" | "pendingAt" | "assignee" | "due";
const PRIO_RANK: Record<Priority, number> = { Low: 0, Normal: 1, High: 2, Urgent: 3, VIP: 4 };

// SRS §4.3 / §6.1 — order intake fields (ALB-FR-OR-xxxx)
const emptyForm = {
  customer: "", orderType: "Design + Printing" as WorkflowType, orderDate: "2026-10-03", expectedDelivery: "", eventName: "", eventType: "Wedding",
  bride: "", groom: "", priority: "Normal" as Priority, albumType: "Wedding Album", size: "12x36", orientation: "Landscape", pages: "30",
  copies: "1", paper: "Matte", cover: "Leatherette", lamination: "Matte", binding: "Flush Mount", box: "Yes", notes: "",
};

export default function Orders() {
  const [rows, setRows] = useState<Row[]>(ORDERS);
  const [tab, setTab] = useState<TabKey>("all");
  const [q, setQ] = useState("");
  const [wf, setWf] = useState("All Workflow Types");
  const [size, setSize] = useState("All Album Sizes");
  const [prio, setPrio] = useState("All Priority");
  const [pay, setPay] = useState("All Payment Status");
  const [asg, setAsg] = useState("All Assigned To");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState("");

  const reset = () => { setQ(""); setWf("All Workflow Types"); setSize("All Album Sizes"); setPrio("All Priority"); setPay("All Payment Status"); setAsg("All Assigned To"); setPage(1); };

  const base = useMemo(() => rows.filter((o) => {
    const s = q.trim().toLowerCase();
    if (s && ![o.id, o.customer, o.mobile, o.event].some((v) => v.toLowerCase().includes(s))) return false;
    if (wf !== "All Workflow Types" && o.workflow !== wf) return false;
    if (size !== "All Album Sizes" && o.size !== size) return false;
    if (prio !== "All Priority" && o.priority !== prio) return false;
    if (pay !== "All Payment Status" && o.pay !== pay) return false;
    if (asg !== "All Assigned To" && o.assignee !== asg) return false;
    return true;
  }), [rows, q, wf, size, prio, pay, asg]);

  const count = (t: TabKey) => base.filter((o) => inTab(o, t)).length;
  const filtered = useMemo(() => {
    const l = base.filter((o) => inTab(o, tab));
    if (!sort) return l;
    const v = (o: Row) => sort.k === "priority" ? PRIO_RANK[o.priority] : sort.k === "stage" ? STAGES.findIndex((s) => s.key === o.stage) : o[sort.k];
    return [...l].sort((a, b) => (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * sort.dir);
  }, [base, tab, sort]);

  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const allSel = pageRows.length > 0 && pageRows.every((o) => sel.has(o.id));
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const sortBy = (k: SortKey) => setSort((p) => (p?.k === k ? (p.dir === 1 ? { k, dir: -1 } : null) : { k, dir: 1 }));
  const SortTh = ({ k, children }: { k: SortKey; children: string }) => (
    <Th><button onClick={() => sortBy(k)} className="inline-flex items-center gap-1 font-bold uppercase">{children}<ArrowUpDown className={cx("size-3", sort?.k === k ? "text-brand" : "text-slate-400")} /></button></Th>
  );

  const kpis: Kpi[] = [
    { label: "Total Orders", value: rows.length, delta: 12, icon: ClipboardList, tone: "blue" },
    { label: "New Orders", value: rows.filter((o) => inTab(o, "new")).length, delta: 25, icon: PlusCircle, tone: "orange" },
    { label: "In Progress", value: rows.filter((o) => inTab(o, "progress")).length, delta: 8, icon: MonitorPlay, tone: "pink" },
    { label: "Client Review Pending", value: rows.filter((o) => inTab(o, "client")).length, delta: 20, icon: Users, tone: "pink" },
    { label: "Ready for Printing", value: rows.filter((o) => inTab(o, "print")).length, delta: 50, icon: ShieldCheck, tone: "green" },
    { label: "Overdue", value: rows.filter((o) => o.stage !== "delivered" && !o.hold && isOverdue(o.due)).length, delta: 75, icon: Clock, tone: "red", invert: true },
  ];

  const setF = (k: keyof typeof emptyForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const submit = () => {
    if (!form.customer || !form.expectedDelivery) { setErr("Customer and expected delivery date are required."); return; }
    const c = CUSTOMERS.find((x) => x.name === form.customer);
    const next = Math.max(...rows.map((r) => Number(r.id.slice(3)))) + 1;
    const o: Row = {
      id: `IDP${String(next).padStart(5, "0")}`, customer: form.customer, mobile: c?.mobile ?? "—", event: form.eventType, workflow: form.orderType,
      size: form.size, pages: Number(form.pages) || 30, stage: "new_order", priority: form.priority, pendingAt: form.orderDate, assignee: "Priya",
      due: form.expectedDelivery, pay: "Unpaid", total: 0, paid: 0, progress: 0,
    };
    setRows((r) => [o, ...r]); setCreate(false); setForm(emptyForm); setErr(""); setTab("all"); setPage(1);
  };

  const sel2 = (k: keyof typeof emptyForm, opts: string[]) => <FilterSelect value={form[k]} onChange={(v) => setF(k, v)} options={opts} />;

  return (
    <div onClick={() => menu && setMenu(null)}>
      <PageHeader title="Orders" subtitle="Manage and track all album orders from design to delivery.">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-2">
          <CalendarDays className="size-6 text-sub" />
          <div className="text-xs leading-tight text-sub">Last 30 Days<div className="text-sm font-semibold text-ink">{fmtDate("2026-10-01")} - {fmtDate("2026-10-30")}</div></div>
        </div>
        <OutlineButton icon={Filter} className="!h-11 !rounded-xl !px-4 !text-sm !font-bold">More Filters</OutlineButton>
        <PrimaryButton onClick={() => setCreate(true)}>Create Order</PrimaryButton>
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

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SearchInput className="min-w-[240px] flex-1" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by Order ID, customer name, mobile, event..." />
          <FilterSelect value={wf} onChange={(v) => { setWf(v); setPage(1); }} options={["All Workflow Types", "Design + Printing", "Printing"]} />
          <FilterSelect value={size} onChange={(v) => { setSize(v); setPage(1); }} options={["All Album Sizes", ...ALBUM_SIZES]} />
          <FilterSelect value={prio} onChange={(v) => { setPrio(v); setPage(1); }} options={["All Priority", ...PRIORITIES]} />
          <FilterSelect value={pay} onChange={(v) => { setPay(v); setPage(1); }} options={["All Payment Status", "Paid", "Partial", "Unpaid", "Overdue"]} />
          <FilterSelect value={asg} onChange={(v) => { setAsg(v); setPage(1); }} options={["All Assigned To", ...ASSIGNEES]} />
          <button onClick={reset} className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-bold text-brand"><RotateCcw className="size-4" />Reset</button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className={tableCls}>
            <thead>
              <tr>
                <Th><input type="checkbox" checked={allSel} onChange={() => setSel((p) => { const n = new Set(p); pageRows.forEach((o) => allSel ? n.delete(o.id) : n.add(o.id)); return n; })} /></Th>
                <Th>Order ID</Th><SortTh k="customer">Customer</SortTh><Th>Event</Th><Th>Workflow Type</Th><Th>Album Size</Th>
                <SortTh k="stage">Current Stage</SortTh><SortTh k="priority">Priority</SortTh><SortTh k="pendingAt">Pending At</SortTh>
                <SortTh k="assignee">Assigned To</SortTh><SortTh k="due">Due Date</SortTh><Th>Payment Status</Th><Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((o, i) => (
                <tr key={o.id} className={cx(trCls, sel.has(o.id) && "bg-brand-soft/60")}>
                  <Td><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} /></Td>
                  <Td className="font-bold">{o.id}</Td>
                  <Td><div className="flex items-center gap-3"><Thumb seed={o.customer} size={36} /><div className="leading-tight"><div className="font-semibold">{o.customer}</div><div className="text-xs text-sub">{o.mobile}</div></div></div></Td>
                  <Td>{o.event}</Td><Td>{o.workflow}</Td><Td>{o.size}</Td>
                  <Td>{o.hold ? <Pill tone={o.hold === "On Hold" ? "pink" : "red"} dot>{o.hold}</Pill> : <Pill tone={stageTone(o.stage)} dot>{stageLabel(o.stage)}</Pill>}</Td>
                  <Td><PriorityPill p={o.priority} /></Td><Td>{fmtDate(o.pendingAt)}</Td>
                  <Td><span className="inline-flex items-center gap-2"><Avatar name={o.assignee} size={24} />{o.assignee}</span></Td>
                  <Td className={cx("font-medium", isOverdue(o.due) && o.stage !== "delivered" ? "text-rose-600" : "")}>{fmtDate(o.due)}</Td>
                  <Td><PayPill s={o.pay} /></Td>
                  <Td className="relative text-right">
                    <span className="inline-flex items-center gap-2"><RowViewButton />
                      <button aria-label="More" onClick={(e) => { e.stopPropagation(); setMenu(menu === o.id ? null : o.id); }} className="grid size-8 place-items-center rounded-lg hover:bg-slate-100"><MoreVertical className="size-4" /></button></span>
                    {menu === o.id && (
                      <div className={cx("absolute right-3 z-20 w-36 rounded-lg border border-line bg-white py-1 text-left shadow-lg", i > pageRows.length - 3 && i > 2 ? "bottom-8" : "top-10")}>
                        {(o.hold ? ["Resume"] : ["Put On Hold", "Cancel Order"]).map((a) => (
                          <button key={a} className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-brand-soft" onClick={() => setRows((r) => r.map((x) => x.id === o.id ? { ...x, hold: a === "Resume" ? undefined : a === "Put On Hold" ? "On Hold" : "Cancelled" } : x))}>{a}</button>
                        ))}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
              {pageRows.length === 0 && <tr><td colSpan={13} className="py-10 text-center text-sub">No orders match the current filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="orders" />
        {sel.size > 0 && <div className="mt-1 text-xs text-sub">{sel.size} selected · today {fmtDate(TODAY)}</div>}
      </Panel>

      <SlideOver open={create} onClose={() => setCreate(false)} title="Create Order" width={560}
        footer={<><OutlineButton onClick={() => setCreate(false)}>Cancel</OutlineButton><PrimaryButton icon={Plus} onClick={submit}>Create Order</PrimaryButton></>}>
        {err && <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-600">{err}</div>}
        <h3 className="mb-3 text-sm font-extrabold">Order details</h3>
        <Field label="Customer" required>
          <input list="cust-list" className={inputCls} value={form.customer} onChange={(e) => setF("customer", e.target.value)} placeholder="Search or select customer" />
          <datalist id="cust-list">{CUSTOMERS.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        </Field>
        <div className="grid grid-cols-2 gap-x-4">
          <Field label="Order Type" required>{sel2("orderType", ["Design + Printing", "Printing"])}</Field>
          <Field label="Priority">{sel2("priority", PRIORITIES)}</Field>
          <Field label="Order Date" required><input type="date" className={inputCls} value={form.orderDate} onChange={(e) => setF("orderDate", e.target.value)} /></Field>
          <Field label="Expected Delivery" required><input type="date" className={inputCls} value={form.expectedDelivery} onChange={(e) => setF("expectedDelivery", e.target.value)} /></Field>
          <Field label="Event Name"><input className={inputCls} value={form.eventName} onChange={(e) => setF("eventName", e.target.value)} /></Field>
          <Field label="Event Type">{sel2("eventType", EVENTS)}</Field>
          <Field label="Bride Name"><input className={inputCls} value={form.bride} onChange={(e) => setF("bride", e.target.value)} /></Field>
          <Field label="Groom Name"><input className={inputCls} value={form.groom} onChange={(e) => setF("groom", e.target.value)} /></Field>
        </div>
        <h3 className="mb-3 mt-2 text-sm font-extrabold">Album specification</h3>
        <div className="grid grid-cols-2 gap-x-4">
          <Field label="Album Type">{sel2("albumType", ["Wedding Album", "Pre Wedding Album", "Reception Album", "Engagement Album", "Highlight Book"])}</Field>
          <Field label="Album Size">{sel2("size", ALBUM_SIZES)}</Field>
          <Field label="Orientation">{sel2("orientation", ["Landscape", "Portrait", "Square"])}</Field>
          <Field label="No. of Pages"><input type="number" min={10} className={inputCls} value={form.pages} onChange={(e) => setF("pages", e.target.value)} /></Field>
          <Field label="No. of Copies"><input type="number" min={1} className={inputCls} value={form.copies} onChange={(e) => setF("copies", e.target.value)} /></Field>
          <Field label="Paper Type">{sel2("paper", ["Matte", "Glossy", "Lustre", "Silk", "Canvas"])}</Field>
          <Field label="Cover Type">{sel2("cover", ["Leatherette", "Fabric", "Acrylic", "Photo Cover", "Wood"])}</Field>
          <Field label="Lamination">{sel2("lamination", ["Matte", "Glossy", "Velvet", "None"])}</Field>
          <Field label="Binding">{sel2("binding", ["Flush Mount", "Layflat", "Spiral", "Perfect Bound"])}</Field>
          <Field label="Box / Case">{sel2("box", ["Yes", "No"])}</Field>
        </div>
        <Field label="Special Instructions"><textarea rows={3} className={cx(inputCls, "h-auto py-2")} value={form.notes} onChange={(e) => setF("notes", e.target.value)} /></Field>
      </SlideOver>
    </div>
  );
}

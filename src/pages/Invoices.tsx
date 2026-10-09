import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Download, FileText, FileEdit, Send, Trash2, Plus, Camera, Pencil, Copy, ChevronLeft, ChevronRight } from "lucide-react";
import { Field, KpiRow, Panel, PageHeader, Pagination, Pill, PrimaryButton, SearchInput, SlideOver, Td, TodayChip, MoreButton, Toggle, inputCls, tableCls, trCls, cx } from "../components/ui";
import { ColumnsMenu, Combobox, DateRangePicker, FilterChips, MultiSelect, SavedViews, SortTh, sortRows, type DateRange, type SortState } from "../components/controls";
import { ALL_TIME, Banner, DateField, Err, FieldBox, PrintStyle, Segmented, Steps, TODAY_ISO, addDaysIso, desRange, inRangeOpt, orderOpt, rangeLabel, serRange, usePersisted, useSlashSearch, StatusMenu, type SavedRange } from "../components/pageKit";
import { RowMenu } from "../components/RowMenu";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { ORDERS, type Tone } from "../lib/data";
import { fmtDate, inr } from "../lib/format";
import { downloadCsv } from "../lib/csv";

type InvStatus = "Draft" | "Sent" | "Paid" | "Partially Paid" | "Overdue";
const STATUSES: InvStatus[] = ["Draft", "Sent", "Paid", "Partially Paid", "Overdue"];
interface Line { desc: string; qty: number; price: number }
interface Pay { date: string; mode: string; ref: string; amount: number }
interface Invoice { no: string; orderId: string; customer: string; event: string; date: string; due: string; lines: Line[]; gstPct: number; discount: number; status: InvStatus; payments: Pay[]; notes?: string }

const sub = (i: Invoice) => i.lines.reduce((a, l) => a + l.qty * l.price, 0) - i.discount;
const gst = (i: Invoice) => Math.round((sub(i) * i.gstPct) / 100);
const total = (i: Invoice) => sub(i) + gst(i);
const paidOf = (i: Invoice) => i.payments.reduce((a, p) => a + p.amount, 0);
const TONE_OF: Record<InvStatus, Tone> = { Draft: "slate", Sent: "violet", Paid: "green", "Partially Paid": "amber", Overdue: "red" };

const seed = (): Invoice[] =>
  ORDERS.slice(0, 40).map((o, i) => {
    const s = Math.round(o.total / 1.18 / 100) * 100;
    const lines: Line[] = [
      { desc: `Premium Wedding Album ${o.size} (${o.pages} Pages)`, qty: 1, price: Math.round(s * 0.76 / 100) * 100 },
      { desc: "Colour Grading & Design", qty: 1, price: Math.round(s * 0.19 / 100) * 100 },
      { desc: "Album Satin Lamination", qty: 1, price: 0 },
    ];
    lines[2]!.price = s - lines[0]!.price - lines[1]!.price;
    const inv: Invoice = {
      no: "", orderId: o.id, customer: o.customer, event: o.event,
      date: `2026-09-${String(30 - (i % 28)).padStart(2, "0")}`, due: `2026-10-${String(10 - (i % 8)).padStart(2, "0")}`, lines, gstPct: 18, discount: 0, status: "Sent", payments: [],
    };
    const t = total(inv);
    const pay = o.pay === "Paid" ? t : o.pay === "Partial" ? Math.round(t / 2) : 0;
    if (pay > 0) inv.payments = [{ date: "2026-10-01", mode: i % 2 ? "UPI (PhonePe)" : "Bank Transfer", ref: `UPI${1234567890 + i}`, amount: pay }];
    inv.status = o.pay === "Paid" ? "Paid" : o.pay === "Partial" ? "Partially Paid" : o.pay === "Overdue" || i % 4 === 2 ? "Overdue" : i % 7 === 5 ? "Draft" : "Sent";
    return inv;
  });
const initial = (): Invoice[] => seed().map((v, i, a) => ({ ...v, no: `INV-2026-${String(a.length - i).padStart(4, "0")}` }));
const nextNo = (l: Invoice[]) => `INV-2026-${String(Math.max(0, ...l.map((i) => Number(i.no.split("-").pop()))) + 1).padStart(4, "0")}`;

const COLS = [{ key: "no", label: "Invoice No" }, { key: "order", label: "Order ID" }, { key: "customer", label: "Customer" }, { key: "date", label: "Invoice Date" }, { key: "due", label: "Due Date" }, { key: "total", label: "Total" }, { key: "gst", label: "Tax (GST)" }, { key: "paid", label: "Paid" }, { key: "balance", label: "Balance" }, { key: "status", label: "Status" }];
interface ViewState { status: string[]; range: SavedRange; q: string; hidden: string[]; sort: SortState }

const TERMS = ["Net 7", "Net 15", "Net 30", "Custom"] as const;
type Terms = (typeof TERMS)[number];
const GST_RATES = ["5", "12", "18", "28"];
interface Draft { orderId: string; date: string; terms: Terms; due: string; gstOn: boolean; gstRate: string; discPct: string; lines: Line[] }
const draftFromOrder = (orderId: string, base?: Partial<Draft>): Draft => {
  const o = ORDERS.find((x) => x.id === orderId);
  const s = o ? Math.round(o.total / 1.18) : 16000;
  const l1 = Math.round(s * 0.8);
  const date = base?.date ?? TODAY_ISO;
  return {
    orderId, date, terms: "Net 15", due: addDaysIso(date, 15), gstOn: true, gstRate: "18", discPct: "0",
    lines: o ? [{ desc: `${o.event} Album ${o.size} (${o.pages} pages)`, qty: 1, price: l1 }, { desc: "Colour grading & design", qty: 1, price: s - l1 }] : [{ desc: "Premium Wedding Album", qty: 1, price: 16000 }],
    ...base,
  };
};
const calc = (d: Draft) => {
  const subtotal = d.lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const pct = Math.max(0, Number(d.discPct) || 0);
  const discount = Math.round((subtotal * pct) / 100);
  const taxable = subtotal - discount;
  const gstAmt = d.gstOn ? Math.round((taxable * Number(d.gstRate)) / 100) : 0;
  return { subtotal, pct, discount, taxable, gstAmt, total: taxable + gstAmt };
};

const applyOrderPayment = (orderId: string, amt: number) => {
  const o = ORDERS.find((x) => x.id === orderId);
  if (!o) return;
  o.paid = Math.min(o.total, o.paid + amt);
  o.pay = o.paid >= o.total ? "Paid" : o.paid > 0 ? "Partial" : o.pay;
};

export default function Invoices() {
  const [list, setList] = usePersisted<Invoice[]>("invoices.list", initial);
  const [viewNo, setViewNo] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>(ALL_TIME());
  const [sort, setSort] = useState<SortState>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [toast, show] = useToast();
  const [dialog, confirm] = useConfirm();
  useSlashSearch();

  // create / edit form
  const [open, setOpen] = useState(false);
  const [editNo, setEditNo] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(() => draftFromOrder(""));
  const [errs, setErrs] = useState<Record<string, string>>({});
  // add payment (inside drawer)
  const [payOpen, setPayOpen] = useState(false);
  const [pAmt, setPAmt] = useState("");
  const [pMode, setPMode] = useState("UPI");
  const [pRef, setPRef] = useState("");
  const [pErr, setPErr] = useState("");

  useEffect(() => { setPage(1); }, [q, fStatus, range]);
  useEffect(() => { setPayOpen(false); setPErr(""); }, [viewNo]);

  const update = (no: string, fn: (i: Invoice) => Invoice) => setList((l) => l.map((i) => (i.no === no ? fn(i) : i)));
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const rows = list.filter((i) => (!fStatus.length || fStatus.includes(i.status)) && inRangeOpt(i.date, range) && (!t || i.no.toLowerCase().includes(t) || i.orderId.toLowerCase().includes(t) || i.customer.toLowerCase().includes(t)));
    return sortRows(rows, sort, (i, k) => {
      switch (k) { case "no": return i.no; case "order": return i.orderId; case "customer": return i.customer.toLowerCase(); case "date": return i.date; case "due": return i.due; case "total": return total(i); case "gst": return gst(i); case "paid": return paidOf(i); case "balance": return total(i) - paidOf(i); default: return i.status; }
    });
  }, [list, q, fStatus, range, sort]);
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const cur = list.find((i) => i.no === viewNo);
  const count = (s: InvStatus) => list.filter((i) => i.status === s).length;

  const send = (inv: Invoice) => { update(inv.no, (i) => ({ ...i, status: i.status === "Draft" ? "Sent" : i.status })); show(`Invoice ${inv.no} sent to ${inv.customer}`); };
  const settle = (inv: Invoice, amount: number, mode: string, ref: string) => {
    const t = total(inv);
    update(inv.no, (i) => { const paid = paidOf(i) + amount; return { ...i, status: paid >= t ? "Paid" : "Partially Paid", payments: [...i.payments, { date: TODAY_ISO, mode, ref, amount }] }; });
    applyOrderPayment(inv.orderId, amount);
  };
  const markPaid = (inv: Invoice) => {
    const bal = total(inv) - paidOf(inv);
    if (bal <= 0) return show("Invoice is already fully paid");
    settle(inv, bal, "Cash", `MP${Date.now() % 100000}`); show(`${inv.no} marked as paid`);
  };
  const setStatus = (inv: Invoice, s: InvStatus) => {
    if (s === inv.status) return;
    if (s === "Paid") return markPaid(inv);
    if (s === "Partially Paid" && paidOf(inv) === 0) return show("Add a payment first to mark partially paid");
    if (s === "Draft" && paidOf(inv) > 0) return show("An invoice with payments cannot go back to Draft");
    update(inv.no, (i) => ({ ...i, status: s })); show(`${inv.no} status: ${s}`);
  };
  const submitPay = (inv: Invoice) => {
    const bal = total(inv) - paidOf(inv);
    const a = Number(pAmt);
    if (!a || a <= 0) return setPErr("Enter a valid amount");
    if (a > bal) return setPErr(`Amount exceeds balance of ${inr(bal)}`);
    if (pMode !== "Cash" && pRef.trim().length < 4) return setPErr("Reference no. is required for non-cash payments");
    settle(inv, a, pMode, pRef.trim() || "-"); setPayOpen(false); setPAmt(""); setPRef(""); setPErr(""); show(`Payment of ${inr(a)} added to ${inv.no}`);
  };
  const print = () => { show("Choose Save as PDF in the print dialog"); setTimeout(() => window.print(), 250); };

  const setDraft = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const openCreate = () => { setEditNo(null); setStep(0); setErrs({}); setD(draftFromOrder("")); setOpen(true); };
  const openEdit = (inv: Invoice) => {
    const subBefore = inv.lines.reduce((a, l) => a + l.qty * l.price, 0);
    const days = Math.round((+new Date(inv.due) - +new Date(inv.date)) / 86400000);
    const terms: Terms = days === 7 ? "Net 7" : days === 15 ? "Net 15" : days === 30 ? "Net 30" : "Custom";
    setEditNo(inv.no); setStep(0); setErrs({});
    setD({ orderId: inv.orderId, date: inv.date, terms, due: inv.due, gstOn: inv.gstPct > 0, gstRate: inv.gstPct > 0 ? String(inv.gstPct) : "18", discPct: subBefore ? String(Math.round((inv.discount / subBefore) * 1000) / 10) : "0", lines: inv.lines.map((l) => ({ ...l })) });
    setOpen(true);
  };
  const pickOrder = (id: string) => {
    const fresh = draftFromOrder(id, { date: d.date });
    setD((x) => ({ ...fresh, date: x.date, due: x.terms === "Custom" ? x.due : addDaysIso(x.date, Number(x.terms.split(" ")[1])), terms: x.terms, gstOn: x.gstOn, gstRate: x.gstRate, discPct: x.discPct }));
    setErrs({});
  };
  const setTerms = (t: Terms) => setD((x) => ({ ...x, terms: t, due: t === "Custom" ? x.due : addDaysIso(x.date, Number(t.split(" ")[1])) }));
  const setLine = (idx: number, p: Partial<Line>) => setD((x) => ({ ...x, lines: x.lines.map((l, k) => (k === idx ? { ...l, ...p } : l)) }));
  const T = calc(d);

  const validate = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!d.orderId) e.order = "Select an order to bill";
      if (!d.date) e.date = "Invoice date is required";
      if (!d.due) e.due = "Due date is required"; else if (d.due < d.date) e.due = "Due date cannot be before the invoice date";
    }
    if (s === 1) {
      if (d.lines.length === 0) e.lines = "Add at least one line item";
      d.lines.forEach((l, i) => {
        if (!l.desc.trim()) e[`desc${i}`] = "Description required";
        if (!(Number(l.qty) > 0)) e[`qty${i}`] = "Qty must be above 0";
        if (!(Number(l.price) >= 0) || l.price === ("" as unknown as number)) e[`price${i}`] = "Enter a rate";
      });
      if (T.pct < 0 || T.pct > 100) e.disc = "Discount must be between 0 and 100%";
    }
    setErrs(e);
    return Object.keys(e).length === 0;
  };
  const next = () => { if (validate(step)) setStep(step + 1); };
  const create = () => {
    if (!validate(0)) return setStep(0);
    if (!validate(1)) return setStep(1);
    const o = ORDERS.find((x) => x.id === d.orderId)!;
    const lines = d.lines.map((l) => ({ desc: l.desc.trim(), qty: Number(l.qty), price: Number(l.price) }));
    const patch = { orderId: d.orderId, customer: o.customer, event: o.event, date: d.date, due: d.due, lines, gstPct: d.gstOn ? Number(d.gstRate) : 0, discount: T.discount };
    if (editNo) { update(editNo, (i) => ({ ...i, ...patch })); setOpen(false); show(`Invoice ${editNo} updated`); return; }
    const no = nextNo(list);
    setList((l) => [{ ...patch, no, status: "Draft", payments: [] }, ...l]);
    setViewNo(no); setOpen(false); setPage(1); setSort(null);
    show(`Invoice ${no} created as Draft`);
  };
  const duplicate = (inv: Invoice) => {
    const no = nextNo(list);
    setList((l) => [{ ...inv, no, status: "Draft", payments: [], lines: inv.lines.map((x) => ({ ...x })) }, ...l]);
    setViewNo(no); setPage(1); show(`Duplicated as ${no} (Draft)`);
  };
  const remove = (nos: string[]) => confirm({ title: `Delete ${nos.length} invoice${nos.length > 1 ? "s" : ""}?`, message: "This cannot be undone.", confirmLabel: "Delete", danger: true }, () => {
    setList((l) => l.filter((i) => !nos.includes(i.no)));
    setChecked(new Set()); if (viewNo && nos.includes(viewNo)) setViewNo(null); show(`Deleted ${nos.length} invoice(s)`);
  });
  const bulk = (fn: (i: Invoice) => Invoice, msg: string) => { setList((l) => l.map((i) => (checked.has(i.no) ? fn(i) : i))); show(msg); setChecked(new Set()); };
  const exportRows = (rs: Invoice[]) => { downloadCsv("invoices.csv", [["Invoice", "Order", "Customer", "Date", "Due", "Total", "Paid", "Balance", "Status"], ...rs.map((i) => [i.no, i.orderId, i.customer, i.date, i.due, total(i), paidOf(i), total(i) - paidOf(i), i.status])]); show(`Exported ${rs.length} invoice(s)`); };

  const chips = [
    ...fStatus.map((s) => ({ label: `Status: ${s}`, onRemove: () => setFStatus(fStatus.filter((x) => x !== s)) })),
    ...(range.preset !== "All Time" ? [{ label: `Invoice date: ${range.preset === "Custom" ? rangeLabel(range) : range.preset}`, onRemove: () => setRange(ALL_TIME()) }] : []),
    ...(q ? [{ label: `Search: ${q}`, onRemove: () => setQ("") }] : []),
  ];
  const clearAll = () => { setFStatus([]); setRange(ALL_TIME()); setQ(""); };
  const view: ViewState = { status: fStatus, range: serRange(range), q, hidden, sort };
  const applyView = (v: ViewState) => { setFStatus(v.status); setRange(desRange(v.range)); setQ(v.q); setHidden(v.hidden); setSort(v.sort); };
  const vis = (k: string) => !hidden.includes(k);
  const allOnPage = rows.length > 0 && rows.every((r) => checked.has(r.no));
  const selOrder = ORDERS.find((o) => o.id === d.orderId);
  const STEPS = ["Order & terms", "Line items", "Review"];

  return (
    <div className="min-w-0">
      {toast}{dialog}
      <PageHeader title="Invoices" subtitle="Manage and track all invoices for your album design and printing orders.">
        <TodayChip />
        <PrimaryButton onClick={openCreate}>Create Invoice</PrimaryButton>
        <MoreButton />
      </PageHeader>

      <KpiRow items={[
        { label: "Total Invoices", value: list.length, delta: 12, icon: FileText, tone: "blue" },
        { label: "Draft Invoices", value: count("Draft"), delta: 20, icon: FileEdit, tone: "orange", invert: true },
        { label: "Sent Invoices", value: count("Sent"), delta: 18, icon: ClipboardList, tone: "violet" },
        { label: "Paid Invoices", value: count("Paid"), delta: 28, icon: CheckCircle2, tone: "green" },
        { label: "Partially Paid", value: count("Partially Paid"), delta: 6, icon: FileText, tone: "amber" },
        { label: "Overdue Invoices", value: count("Overdue"), delta: 14, icon: AlertTriangle, tone: "red", invert: true },
      ]} />

      <Panel title="All Invoices" subtitle="Click a row for the invoice preview, payments and actions" action={<button onClick={() => exportRows(filtered)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-brand-soft"><Download className="size-4 text-sub" />Export</button>}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} align="left" />
          <MultiSelect className="w-44" label="Invoice status" options={STATUSES} value={fStatus} onChange={setFStatus} />
          <SearchInput className="w-72" value={q} onChange={setQ} placeholder="Search invoice no, order ID, customer... ( / )" />
          <div className="ml-auto flex gap-2">
            <SavedViews<ViewState> storageKey="invoices" current={view} onApply={applyView} />
            <ColumnsMenu columns={COLS} hidden={hidden} onChange={setHidden} />
          </div>
        </div>
        <FilterChips chips={chips} onClearAll={clearAll} />
        {checked.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-brand-soft px-4 py-2 text-[13px] font-semibold">
            {checked.size} selected
            <button onClick={() => bulk((i) => (i.status === "Draft" ? { ...i, status: "Sent" } : i), "Sent selected drafts")} className="rounded-lg bg-brand px-3 py-1 text-xs font-bold text-white">Send</button>
            <button onClick={() => exportRows(list.filter((i) => checked.has(i.no)))} className="rounded-lg border border-line bg-white px-3 py-1 text-xs font-bold">Export CSV</button>
            <button onClick={() => remove([...checked])} className="rounded-lg border border-rose-200 bg-white px-3 py-1 text-xs font-bold text-rose-600">Delete</button>
            <button onClick={() => setChecked(new Set())} className="ml-auto text-xs font-bold text-brand">Clear</button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead>
              <tr>
                <th className="px-3 py-3"><input aria-label="Select all" type="checkbox" checked={allOnPage} onChange={(e) => setChecked((c) => { const n = new Set(c); rows.forEach((r) => (e.target.checked ? n.add(r.no) : n.delete(r.no))); return n; })} /></th>
                {vis("no") && <SortTh k="no" sort={sort} onSort={setSort}>Invoice No</SortTh>}
                {vis("order") && <SortTh k="order" sort={sort} onSort={setSort}>Order ID</SortTh>}
                {vis("customer") && <SortTh k="customer" sort={sort} onSort={setSort}>Customer</SortTh>}
                {vis("date") && <SortTh k="date" sort={sort} onSort={setSort}>Invoice Date</SortTh>}
                {vis("due") && <SortTh k="due" sort={sort} onSort={setSort}>Due Date</SortTh>}
                {vis("total") && <SortTh k="total" sort={sort} onSort={setSort}>Total</SortTh>}
                {vis("gst") && <SortTh k="gst" sort={sort} onSort={setSort}>Tax (GST)</SortTh>}
                {vis("paid") && <SortTh k="paid" sort={sort} onSort={setSort}>Paid</SortTh>}
                {vis("balance") && <SortTh k="balance" sort={sort} onSort={setSort}>Balance</SortTh>}
                {vis("status") && <SortTh k="status" sort={sort} onSort={setSort}>Status</SortTh>}
                <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const bal = total(i) - paidOf(i);
                return (
                  <tr key={i.no} onClick={() => setViewNo(i.no)} className={cx(trCls, "cursor-pointer", i.no === viewNo && "bg-brand-soft")}>
                    <Td><input aria-label={`Select ${i.no}`} type="checkbox" checked={checked.has(i.no)} onClick={(e) => e.stopPropagation()} onChange={(e) => setChecked((c) => { const n = new Set(c); if (e.target.checked) n.add(i.no); else n.delete(i.no); return n; })} /></Td>
                    {vis("no") && <Td className="font-semibold">{i.no}</Td>}
                    {vis("order") && <Td>{i.orderId}</Td>}
                    {vis("customer") && <Td>{i.customer}</Td>}
                    {vis("date") && <Td>{fmtDate(i.date)}</Td>}
                    {vis("due") && <Td className={i.status === "Overdue" ? "text-rose-600" : ""}>{fmtDate(i.due)}</Td>}
                    {vis("total") && <Td className="font-bold">{inr(total(i))}</Td>}
                    {vis("gst") && <Td>{inr(gst(i))}</Td>}
                    {vis("paid") && <Td>{inr(paidOf(i))}</Td>}
                    {vis("balance") && <Td className={bal > 0 ? "font-semibold text-rose-600" : ""}>{inr(bal)}</Td>}
                    {vis("status") && (
                      <Td>
                        <StatusMenu<InvStatus> label={`Change status of ${i.no}`} trigger={<Pill tone={TONE_OF[i.status]} dot>{i.status}</Pill>} options={STATUSES.map((s) => ({ value: s }))} onPick={(s) => setStatus(i, s)} />
                      </Td>
                    )}
                    <Td>
                      <div className="flex items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); setViewNo(i.no); }} className="h-8 rounded-lg border border-line bg-white px-3 text-xs font-bold hover:bg-brand-soft">View</button>
                        <RowMenu items={[
                          { label: "Edit", icon: Pencil, onClick: () => openEdit(i) },
                          { label: "Send", icon: Send, onClick: () => send(i) },
                          { label: "Duplicate", icon: Copy, onClick: () => duplicate(i) },
                          { label: "Delete", icon: Trash2, danger: true, onClick: () => remove([i.no]) },
                        ]} />
                      </div>
                    </Td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={12} className="py-10 text-center text-sub">No invoices found.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="invoices" />
      </Panel>

      {/* ───── invoice drawer ───── */}
      <SlideOver open={!!cur} onClose={() => setViewNo(null)} title={cur ? `Invoice ${cur.no}` : "Invoice"} width={600} footer={cur && <>
        <button onClick={() => openEdit(cur)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-bold"><Pencil className="size-4" />Edit</button>
        <button onClick={() => send(cur)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-soft px-3 text-sm font-bold text-brand"><Send className="size-4" />Send Invoice</button>
        <button onClick={print} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-soft px-3 text-sm font-bold text-brand"><Download className="size-4" />Download PDF</button>
        <button onClick={() => markPaid(cur)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white"><CheckCircle2 className="size-4" />Mark as Paid</button>
      </>}>
        {cur && (
          <div className="space-y-4">
            <PrintStyle />
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-2.5 text-[13px]">
              <span className="text-sub">Status</span>
              <StatusMenu<InvStatus> label="Change invoice status" trigger={<Pill tone={TONE_OF[cur.status]} dot>{cur.status} ▾</Pill>} options={STATUSES.map((s) => ({ value: s }))} onPick={(s) => setStatus(cur, s)} />
            </div>
            <InvoiceDoc inv={cur} onSaveNotes={(t) => { update(cur.no, (i) => ({ ...i, notes: t })); show("Notes saved"); }}
              payControls={
                <div className="print:hidden">
                  {!payOpen ? (
                    <button onClick={() => { setPayOpen(true); setPAmt(String(Math.max(0, total(cur) - paidOf(cur)))); }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-xs font-bold text-brand"><Plus className="size-3.5" />Add Payment</button>
                  ) : (
                    <div className="mt-2 w-full space-y-2 rounded-xl border border-line bg-slate-50 p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <input aria-label="Payment amount" type="number" value={pAmt} onChange={(e) => setPAmt(e.target.value)} placeholder="Amount" className="h-9 rounded-lg border border-line px-2 text-xs outline-none focus:border-brand" />
                        <select aria-label="Payment mode" value={pMode} onChange={(e) => setPMode(e.target.value)} className="h-9 rounded-lg border border-line bg-white px-2 text-xs">{["UPI", "Cash", "Bank Transfer", "Cheque"].map((m) => <option key={m}>{m}</option>)}</select>
                      </div>
                      {pMode !== "Cash" && <input aria-label="Payment reference" value={pRef} onChange={(e) => setPRef(e.target.value)} placeholder="Reference / UTR / cheque no." className="h-9 w-full rounded-lg border border-line px-2 text-xs outline-none focus:border-brand" />}
                      {pErr && <Err>{pErr}</Err>}
                      <div className="flex gap-2"><button onClick={() => submitPay(cur)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white">Save payment</button><button onClick={() => setPayOpen(false)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold">Cancel</button></div>
                    </div>
                  )}
                </div>
              }
            />
          </div>
        )}
      </SlideOver>

      {/* ───── create / edit ───── */}
      <SlideOver open={open} onClose={() => setOpen(false)} title={editNo ? `Edit ${editNo}` : "Create Invoice"} width={560} footer={<>
        {step > 0 ? <button onClick={() => setStep(step - 1)} className="mr-auto inline-flex h-11 items-center gap-1 px-3 text-sm font-bold text-sub"><ChevronLeft className="size-4" />Back</button> : <button onClick={() => setOpen(false)} className="mr-auto h-11 px-3 text-sm font-bold text-sub">Cancel</button>}
        {step < 2 ? <PrimaryButton icon={ChevronRight} onClick={next}>Next</PrimaryButton> : <PrimaryButton icon={FileText} onClick={create}>{editNo ? "Save Changes" : "Create Invoice"}</PrimaryButton>}
      </>}>
        <Steps steps={STEPS} step={step} />
        {step === 0 && (
          <>
            <FieldBox label="Order" required>
              <Combobox error={!!errs.order} placeholder="Search order or customer…" value={d.orderId} onChange={pickOrder} options={ORDERS.filter((o) => o.total > o.paid || o.id === d.orderId).map(orderOpt)} />
              <Err>{errs.order}</Err>
            </FieldBox>
            {selOrder && (
              <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-line bg-slate-50/60 p-3 text-xs text-sub">
                <div className="col-span-3 text-sm font-bold text-ink">{selOrder.customer} <span className="font-normal text-sub">· {selOrder.event} · {selOrder.size}</span></div>
                <div>Order total<div className="text-sm font-bold text-ink">{inr(selOrder.total)}</div></div>
                <div>Paid<div className="text-sm font-bold text-ink">{inr(selOrder.paid)}</div></div>
                <div>Balance<div className="text-sm font-bold text-rose-600">{inr(selOrder.total - selOrder.paid)}</div></div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <FieldBox label="Invoice Date" required>
                <DateField label="Invoice date" value={d.date} error={!!errs.date} onChange={(v) => setD((x) => ({ ...x, date: v, due: x.terms === "Custom" ? x.due : addDaysIso(v, Number(x.terms.split(" ")[1])) }))} />
                <Err>{errs.date}</Err>
              </FieldBox>
              <FieldBox label="Due Date" required>
                <DateField label="Due date" value={d.due} error={!!errs.due} onChange={(v) => setDraft({ due: v, terms: "Custom" })} />
                <Err>{errs.due}</Err>
              </FieldBox>
            </div>
            <FieldBox label="Payment terms" hint={`Due ${d.due ? fmtDate(d.due) : "-"}${d.terms !== "Custom" ? ` (${d.terms} from invoice date)` : ""}`}>
              <Segmented value={d.terms} options={TERMS} onChange={setTerms} />
            </FieldBox>
          </>
        )}
        {step === 1 && (
          <>
            <div className="mb-2 text-[13px] font-semibold">Line Items</div>
            <div className="mb-1 grid grid-cols-[1fr_56px_92px_88px_28px] gap-2 text-[10px] font-bold uppercase text-sub"><span>Description</span><span>Qty</span><span>Rate</span><span className="text-right">Amount</span><span /></div>
            {d.lines.map((l, idx) => (
              <div key={idx} className="mb-2">
                <div className="grid grid-cols-[1fr_56px_92px_88px_28px] items-center gap-2">
                  <input aria-label={`Description ${idx + 1}`} className={cx(inputCls, errs[`desc${idx}`] && "border-rose-400")} placeholder="Description" value={l.desc} onChange={(e) => setLine(idx, { desc: e.target.value })} />
                  <input aria-label={`Qty ${idx + 1}`} className={cx(inputCls, "px-2", errs[`qty${idx}`] && "border-rose-400")} type="number" min={1} value={l.qty} onChange={(e) => setLine(idx, { qty: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) })} />
                  <input aria-label={`Rate ${idx + 1}`} className={cx(inputCls, "px-2", errs[`price${idx}`] && "border-rose-400")} type="number" min={0} value={l.price} onChange={(e) => setLine(idx, { price: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) })} />
                  <span className="text-right text-[13px] font-bold">{inr((Number(l.qty) || 0) * (Number(l.price) || 0))}</span>
                  <button aria-label={`Remove line ${idx + 1}`} onClick={() => setD((x) => ({ ...x, lines: x.lines.filter((_, k) => k !== idx) }))} className="grid place-items-center text-rose-500"><Trash2 className="size-4" /></button>
                </div>
                <Err>{errs[`desc${idx}`] || errs[`qty${idx}`] || errs[`price${idx}`]}</Err>
              </div>
            ))}
            <Err>{errs.lines}</Err>
            <button onClick={() => setD((x) => ({ ...x, lines: [...x.lines, { desc: "", qty: 1, price: 0 }] }))} className="mb-4 inline-flex items-center gap-1 text-xs font-bold text-brand"><Plus className="size-3.5" />Add line</button>
            <div className="grid grid-cols-2 gap-3">
              <FieldBox label="GST">
                <div className="flex h-10 items-center gap-3">
                  <Toggle on={d.gstOn} onChange={(v) => setDraft({ gstOn: v })} />
                  <select aria-label="GST rate" disabled={!d.gstOn} value={d.gstRate} onChange={(e) => setDraft({ gstRate: e.target.value })} className="h-10 flex-1 rounded-lg border border-line bg-white px-2 text-sm disabled:opacity-40">{GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}</select>
                </div>
              </FieldBox>
              <Field label="Discount (%)"><input aria-label="Discount percent" type="number" min={0} max={100} className={cx(inputCls, errs.disc && "border-rose-400")} value={d.discPct} onChange={(e) => setDraft({ discPct: e.target.value })} /><Err>{errs.disc}</Err></Field>
            </div>
            {T.pct > 10 && <div className="mb-4"><Banner tone="amber">Discount above 10% ({T.pct}%) requires Admin approval before the invoice can be sent.</Banner></div>}
            <Totals T={T} gstOn={d.gstOn} rate={d.gstRate} />
          </>
        )}
        {step === 2 && (
          <div className="space-y-3 text-[13px]">
            <div className="rounded-xl border border-line p-4">
              <div className="flex justify-between"><span className="text-sub">Customer</span><b>{selOrder?.customer}</b></div>
              <div className="flex justify-between"><span className="text-sub">Order</span><b>{d.orderId}</b></div>
              <div className="flex justify-between"><span className="text-sub">Invoice date</span><b>{fmtDate(d.date)}</b></div>
              <div className="flex justify-between"><span className="text-sub">Due date</span><b>{fmtDate(d.due)} <span className="font-normal text-sub">({d.terms})</span></b></div>
            </div>
            <div className="rounded-xl border border-line p-4">
              {d.lines.map((l, i) => <div key={i} className="flex justify-between py-0.5"><span className="truncate pr-3">{l.desc} <span className="text-sub">× {l.qty}</span></span><b>{inr(Number(l.qty) * Number(l.price))}</b></div>)}
            </div>
            <Totals T={T} gstOn={d.gstOn} rate={d.gstRate} />
          </div>
        )}
      </SlideOver>
    </div>
  );
}

function Totals({ T, gstOn, rate }: { T: ReturnType<typeof calc>; gstOn: boolean; rate: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4 text-sm">
      <div className="flex justify-between"><span className="text-sub">Sub Total</span><b>{inr(T.subtotal)}</b></div>
      {T.discount > 0 && <div className="flex justify-between"><span className="text-sub">Discount ({T.pct}%)</span><b>-{inr(T.discount)}</b></div>}
      <div className="flex justify-between"><span className="text-sub">GST {gstOn ? `(${rate}%)` : "(off)"}</span><b>{inr(T.gstAmt)}</b></div>
      <div className="mt-2 flex justify-between border-t border-line pt-2 text-base"><span className="font-bold">Total</span><b data-testid="inv-total">{inr(T.total)}</b></div>
    </div>
  );
}

function InvoiceDoc({ inv, onSaveNotes, payControls }: { inv: Invoice; onSaveNotes: (t: string) => void; payControls: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const t = total(inv);
  const bal = t - paidOf(inv);
  return (
    <div className="space-y-4 text-[12px]">
      <div id="print-area" className="rounded-xl border border-line p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-10 place-items-center rounded-xl bg-brand text-white"><Camera className="size-5" /></span>
            <div><div className="text-lg font-extrabold">AlbumPro</div><div className="text-[11px] text-sub">Memories Printed Beautifully</div></div>
          </div>
          <div className="flex items-center gap-2 font-bold"><span className="text-sub">TAX INVOICE</span><Pill tone={TONE_OF[inv.status]}>{inv.status}</Pill></div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="leading-relaxed">
            <b>AlbumPro Studio Pvt. Ltd.</b><br />123 Creative Street, KPHB<br />Hyderabad, Telangana - 500072<br />GSTIN: 36ABCDE1234F1Z5<br />Phone: +91 98765 43210<br />Email: info@albumpro.in
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-sub">Invoice No</dt><dd className="font-bold">{inv.no}</dd>
            <dt className="text-sub">Invoice Date</dt><dd>{fmtDate(inv.date)}</dd>
            <dt className="text-sub">Due Date</dt><dd className="font-semibold text-rose-600">{fmtDate(inv.due)}</dd>
            <dt className="text-sub">Order ID</dt><dd>{inv.orderId}</dd>
            <dt className="text-sub">Payment Terms</dt><dd>Net {Math.max(0, Math.round((+new Date(inv.due) - +new Date(inv.date)) / 86400000))} Days</dd>
          </dl>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="leading-relaxed"><div className="font-bold">Bill To</div><b>{inv.customer}</b><br />{inv.event} Album<br />12-3-456, Banjara Hills<br />Hyderabad - 500034<br />GSTIN: 36XYZPF9876Q1Z2</div>
          <div className="leading-relaxed"><div className="font-bold">Ship To</div><b>{inv.customer}</b><br />12-3-456, Banjara Hills<br />Hyderabad - 500034</div>
        </div>
        <table className="mt-4 w-full">
          <thead><tr className="bg-slate-50 text-[11px] font-bold text-sub"><th className="p-2 text-left">#</th><th className="p-2 text-left">Description</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit Price</th><th className="p-2 text-right">Amount</th></tr></thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i} className="border-t border-line"><td className="p-2">{i + 1}</td><td className="p-2">{l.desc}</td><td className="p-2 text-right">{l.qty}</td><td className="p-2 text-right">{inr(l.price)}</td><td className="p-2 text-right font-semibold">{inr(l.qty * l.price)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="ml-auto mt-3 w-64 space-y-1">
          <div className="flex justify-between"><span>Sub Total</span><span>{inr(sub(inv) + inv.discount)}</span></div>
          {inv.discount > 0 && <div className="flex justify-between"><span>Discount</span><span>-{inr(inv.discount)}</span></div>}
          <div className="flex justify-between"><span>GST ({inv.gstPct}%)</span><span>{inr(gst(inv))}</span></div>
          <div className="flex justify-between rounded bg-brand-soft px-2 py-1.5 text-sm font-extrabold"><span>Total Amount</span><span>{inr(t)}</span></div>
          <div className="flex justify-between"><span>Paid</span><span>{inr(paidOf(inv))}</span></div>
          <div className="flex justify-between font-bold text-rose-600"><span>Balance Due</span><span>{inr(bal)}</span></div>
        </div>
      </div>

      <div className="rounded-xl border border-line p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-extrabold">Payment History</h3>
          {payControls}
        </div>
        <table className="w-full">
          <thead><tr className="bg-slate-50 text-[11px] font-bold uppercase text-sub"><th className="p-2 text-left">Date</th><th className="p-2 text-left">Mode</th><th className="p-2 text-left">Reference</th><th className="p-2 text-right">Amount</th></tr></thead>
          <tbody>
            {inv.payments.map((p, i) => (
              <tr key={i} className="border-t border-line"><td className="p-2">{fmtDate(p.date)}</td><td className="p-2">{p.mode}</td><td className="p-2">{p.ref}</td><td className="p-2 text-right font-semibold">{inr(p.amount)}</td></tr>
            ))}
            {inv.payments.length === 0 && <tr><td colSpan={4} className="p-3 text-center text-sub">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-center justify-between"><h3 className="text-sm font-extrabold">Notes</h3>
          {!editing && <button onClick={() => { setDraftNote(inv.notes ?? "Thank you for choosing AlbumPro. We appreciate your business!"); setEditing(true); }} className="inline-flex items-center gap-1 text-xs font-bold text-brand print:hidden"><Pencil className="size-3" />Edit</button>}
        </div>
        {editing ? (
          <div className="mt-2 space-y-2">
            <textarea aria-label="Invoice notes" value={draftNote} onChange={(e) => setDraftNote(e.target.value)} className="h-20 w-full rounded-lg border border-line p-2 text-xs outline-none focus:border-brand" />
            <div className="flex gap-2"><button onClick={() => { onSaveNotes(draftNote); setEditing(false); }} className="rounded-lg bg-brand px-3 py-1 text-xs font-bold text-white">Save</button><button onClick={() => setEditing(false)} className="rounded-lg border border-line px-3 py-1 text-xs font-bold">Cancel</button></div>
          </div>
        ) : <p className="mt-1 text-sub">{inv.notes ?? "Thank you for choosing AlbumPro. We appreciate your business!"}</p>}
      </div>
    </div>
  );
}

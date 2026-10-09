import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Download, FileText, FileEdit, Send, Trash2, Plus, Camera } from "lucide-react";
import { FilterSelect, Field, KpiRow, Panel, PageHeader, Pagination, Pill, PrimaryButton, SearchInput, SlideOver, Td, Th, TodayChip, MoreButton, inputCls, tableCls, trCls, cx } from "../components/ui";
import { useToast } from "../components/Toast";
import { ORDERS } from "../lib/data";
import { fmtDate, inr } from "../lib/format";
import type { Tone } from "../lib/data";

type InvStatus = "Draft" | "Sent" | "Paid" | "Partially Paid" | "Overdue";
interface Line { desc: string; qty: number; price: number }
interface Pay { date: string; mode: string; ref: string; amount: number }
interface Invoice { no: string; orderId: string; customer: string; event: string; date: string; due: string; lines: Line[]; gstPct: number; discount: number; status: InvStatus; payments: Pay[] }

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
      no: `INV-2026-${String(18 - i).padStart(4, "0")}`.replace("-00-", "-"), orderId: o.id, customer: o.customer, event: o.event,
      date: `2026-09-${String(30 - (i % 28)).padStart(2, "0")}`, due: `2026-10-${String(10 - (i % 8)).padStart(2, "0")}`, lines, gstPct: 18, discount: 0, status: "Sent", payments: [],
    };
    const t = total(inv);
    const pay = o.pay === "Paid" ? t : o.pay === "Partial" ? Math.round(t / 2) : 0;
    if (pay > 0) inv.payments = [{ date: "2026-10-01", mode: i % 2 ? "UPI (PhonePe)" : "Bank Transfer", ref: `UPI${1234567890 + i}`, amount: pay }];
    inv.status = o.pay === "Paid" ? "Paid" : o.pay === "Partial" ? "Partially Paid" : o.pay === "Overdue" || i % 4 === 2 ? "Overdue" : i % 7 === 5 ? "Draft" : "Sent";
    return inv;
  });
// fix numbering to run INV-2026-0040 .. descending from 0040
const initial = (): Invoice[] => seed().map((v, i, a) => ({ ...v, no: `INV-2026-${String(a.length - i).padStart(4, "0")}` }));

export default function Invoices() {
  const [list, setList] = useState<Invoice[]>(initial);
  const [sel, setSel] = useState<string>(() => initial()[0]!.no);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("All Statuses");
  const [range, setRange] = useState("Last 30 Days");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(14);
  const [open, setOpen] = useState(false);
  const [toast, show] = useToast();

  // create form
  const [cOrder, setCOrder] = useState(ORDERS[0]!.id);
  const [cDate, setCDate] = useState("2026-10-03");
  const [cDue, setCDue] = useState("2026-10-13");
  const [cGst, setCGst] = useState("18");
  const [cDisc, setCDisc] = useState("0");
  const [cLines, setCLines] = useState<Line[]>([{ desc: "Premium Wedding Album", qty: 1, price: 16000 }]);
  const [cErr, setCErr] = useState("");

  const filtered = useMemo(() => list.filter((i) => {
    if (fStatus !== "All Statuses" && i.status !== fStatus) return false;
    const t = q.trim().toLowerCase();
    return !t || i.no.toLowerCase().includes(t) || i.orderId.toLowerCase().includes(t) || i.customer.toLowerCase().includes(t);
  }), [list, q, fStatus]);
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const cur = list.find((i) => i.no === sel) ?? list[0]!;
  const count = (s: InvStatus) => list.filter((i) => i.status === s).length;

  const update = (no: string, fn: (i: Invoice) => Invoice) => setList((l) => l.map((i) => (i.no === no ? fn(i) : i)));

  const send = () => { update(cur.no, (i) => ({ ...i, status: i.status === "Draft" ? "Sent" : i.status })); show(`Invoice ${cur.no} sent to ${cur.customer}`); };
  const markPaid = () => {
    const bal = total(cur) - paidOf(cur);
    if (bal <= 0) return show("Invoice is already fully paid");
    update(cur.no, (i) => ({ ...i, status: "Paid", payments: [...i.payments, { date: "2026-10-03", mode: "Cash", ref: `MP${Date.now() % 100000}`, amount: bal }] }));
    show(`${cur.no} marked as paid`);
  };
  const addPayment = () => {
    const bal = total(cur) - paidOf(cur);
    if (bal <= 0) return show("No balance due");
    const amt = Math.ceil(bal / 2);
    update(cur.no, (i) => ({ ...i, status: paidOf(i) + amt >= total(i) ? "Paid" : "Partially Paid", payments: [...i.payments, { date: "2026-10-03", mode: "UPI", ref: `UPI${Date.now() % 1000000}`, amount: amt }] }));
    show(`Payment of ${inr(amt)} added`);
  };
  const download = () => { show("Preparing PDF - choose Save as PDF in the print dialog"); setTimeout(() => window.print(), 300); };

  const openCreate = () => { setCErr(""); setCLines([{ desc: "Premium Wedding Album", qty: 1, price: 16000 }]); setCDisc("0"); setOpen(true); };
  const draft: Invoice = { no: "", orderId: cOrder, customer: "", event: "", date: cDate, due: cDue, lines: cLines, gstPct: Number(cGst) || 0, discount: Number(cDisc) || 0, status: "Draft", payments: [] };
  const discPct = sub({ ...draft, discount: 0 }) ? (draft.discount / sub({ ...draft, discount: 0 })) * 100 : 0;
  const create = () => {
    if (cLines.some((l) => !l.desc.trim() || l.qty <= 0 || l.price < 0)) return setCErr("Every line needs a description, quantity and price");
    if (draft.discount > sub({ ...draft, discount: 0 })) return setCErr("Discount cannot exceed sub-total");
    const o = ORDERS.find((x) => x.id === cOrder)!;
    const no = `INV-2026-${String(list.length + 1).padStart(4, "0")}`;
    setList((l) => [{ ...draft, no, customer: o.customer, event: o.event }, ...l]);
    setSel(no); setOpen(false); setPage(1);
    show(`Invoice ${no} created as Draft`);
  };

  const allOnPage = rows.length > 0 && rows.every((r) => checked.has(r.no));

  return (
    <div className="min-w-0">
      {toast}
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

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <Panel
          title="All Invoices" subtitle="View, search and manage all invoices"
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <FilterSelect className="w-36" value={fStatus} onChange={(v) => { setFStatus(v); setPage(1); }} options={["All Statuses", "Draft", "Sent", "Paid", "Partially Paid", "Overdue"]} />
              <FilterSelect className="w-36" value={range} onChange={setRange} options={["Last 7 Days", "Last 30 Days", "Last 90 Days"]} />
              <SearchInput className="w-56" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search invoice no, order ID, customer..." />
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead>
                <tr>
                  <Th><input type="checkbox" checked={allOnPage} onChange={(e) => setChecked((c) => { const n = new Set(c); rows.forEach((r) => (e.target.checked ? n.add(r.no) : n.delete(r.no))); return n; })} /></Th>
                  <Th>Invoice No</Th><Th>Order ID</Th><Th>Customer</Th><Th>Invoice Date</Th><Th>Due Date</Th><Th>Total</Th><Th>Tax (GST)</Th><Th>Paid</Th><Th>Balance</Th><Th>Status</Th><Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const bal = total(i) - paidOf(i);
                  return (
                    <tr key={i.no} onClick={() => setSel(i.no)} className={cx(trCls, "cursor-pointer", i.no === cur.no && "bg-brand-soft")}>
                      <Td><input type="checkbox" checked={checked.has(i.no)} onClick={(e) => e.stopPropagation()} onChange={(e) => setChecked((c) => { const n = new Set(c); if (e.target.checked) n.add(i.no); else n.delete(i.no); return n; })} /></Td>
                      <Td className="font-semibold">{i.no}</Td>
                      <Td>{i.orderId}</Td>
                      <Td>{i.customer}</Td>
                      <Td>{fmtDate(i.date)}</Td>
                      <Td className={i.status === "Overdue" ? "text-rose-600" : ""}>{fmtDate(i.due)}</Td>
                      <Td className="font-bold">{inr(total(i))}</Td>
                      <Td>{inr(gst(i))}</Td>
                      <Td>{inr(paidOf(i))}</Td>
                      <Td className={bal > 0 ? "font-semibold text-rose-600" : ""}>{inr(bal)}</Td>
                      <Td><Pill tone={TONE_OF[i.status]} dot>{i.status}</Pill></Td>
                      <Td><button onClick={(e) => { e.stopPropagation(); setSel(i.no); }} className="h-8 rounded-lg border border-line bg-white px-3 text-xs font-bold hover:bg-brand-soft">View</button></Td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={12} className="py-10 text-center text-sub">No invoices found.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="invoices" />
        </Panel>

        <Panel
          title="Invoice Preview" className="min-w-0 print:border-0"
          action={
            <div className="flex flex-wrap gap-2 print:hidden">
              <button onClick={send} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-soft px-3 text-xs font-bold text-brand"><Send className="size-3.5" />Send Invoice</button>
              <button onClick={download} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-soft px-3 text-xs font-bold text-brand"><Download className="size-3.5" />Download PDF</button>
              <button onClick={markPaid} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white"><CheckCircle2 className="size-3.5" />Mark as Paid</button>
            </div>
          }
        >
          <InvoiceDoc inv={cur} onAddPayment={addPayment} />
        </Panel>
      </div>

      <SlideOver open={open} onClose={() => setOpen(false)} title="Create Invoice" width={520} footer={<>
        <button onClick={() => setOpen(false)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={FileText} onClick={create}>Create Invoice</PrimaryButton>
      </>}>
        <Field label="Order" required>
          <select className={inputCls} value={cOrder} onChange={(e) => setCOrder(e.target.value)}>
            {ORDERS.map((o) => <option key={o.id} value={o.id}>{o.id} - {o.customer}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice Date" required><input type="date" className={inputCls} value={cDate} onChange={(e) => setCDate(e.target.value)} /></Field>
          <Field label="Due Date" required><input type="date" className={inputCls} value={cDue} onChange={(e) => setCDue(e.target.value)} /></Field>
        </div>
        <div className="mb-2 text-[13px] font-semibold">Line Items</div>
        {cLines.map((l, idx) => (
          <div key={idx} className="mb-2 grid grid-cols-[1fr_56px_92px_32px] gap-2">
            <input className={inputCls} placeholder="Description" value={l.desc} onChange={(e) => setCLines((a) => a.map((x, k) => (k === idx ? { ...x, desc: e.target.value } : x)))} />
            <input className={inputCls} type="number" min={1} value={l.qty} onChange={(e) => setCLines((a) => a.map((x, k) => (k === idx ? { ...x, qty: Number(e.target.value) } : x)))} />
            <input className={inputCls} type="number" min={0} value={l.price} onChange={(e) => setCLines((a) => a.map((x, k) => (k === idx ? { ...x, price: Number(e.target.value) } : x)))} />
            <button onClick={() => setCLines((a) => a.filter((_, k) => k !== idx))} className="grid place-items-center text-rose-500" aria-label="Remove"><Trash2 className="size-4" /></button>
          </div>
        ))}
        <button onClick={() => setCLines((a) => [...a, { desc: "", qty: 1, price: 0 }])} className="mb-4 inline-flex items-center gap-1 text-xs font-bold text-brand"><Plus className="size-3.5" />Add line</button>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GST %"><select className={inputCls} value={cGst} onChange={(e) => setCGst(e.target.value)}>{["0", "5", "12", "18", "28"].map((g) => <option key={g}>{g}</option>)}</select></Field>
          <Field label="Discount (INR)"><input type="number" min={0} className={inputCls} value={cDisc} onChange={(e) => setCDisc(e.target.value)} /></Field>
        </div>
        {discPct > 10 && <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">Discount above 10% ({discPct.toFixed(1)}%) requires Admin approval before the invoice can be sent.</div>}
        <div className="rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between"><span className="text-sub">Sub Total</span><b>{inr(sub(draft))}</b></div>
          <div className="flex justify-between"><span className="text-sub">GST ({draft.gstPct}%)</span><b>{inr(gst(draft))}</b></div>
          <div className="mt-2 flex justify-between border-t border-line pt-2 text-base"><span className="font-bold">Total</span><b>{inr(total(draft))}</b></div>
        </div>
        {cErr && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{cErr}</div>}
      </SlideOver>
    </div>
  );
}

function InvoiceDoc({ inv, onAddPayment }: { inv: Invoice; onAddPayment: () => void }) {
  const t = total(inv);
  const bal = t - paidOf(inv);
  return (
    <div className="space-y-4 text-[12px]">
      <div className="rounded-xl border border-line p-4">
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
          <button onClick={onAddPayment} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-xs font-bold text-brand print:hidden"><Plus className="size-3.5" />Add Payment</button>
        </div>
        <table className="w-full">
          <thead><tr className="bg-slate-50 text-[11px] font-bold uppercase text-sub"><th className="p-2 text-left">Date</th><th className="p-2 text-left">Payment Mode</th><th className="p-2 text-left">Reference No</th><th className="p-2 text-right">Amount</th><th className="p-2 text-left">Status</th></tr></thead>
          <tbody>
            {inv.payments.map((p, i) => (
              <tr key={i} className="border-t border-line"><td className="p-2">{fmtDate(p.date)}</td><td className="p-2">{p.mode}</td><td className="p-2">{p.ref}</td><td className="p-2 text-right font-semibold">{inr(p.amount)}</td><td className="p-2"><Pill tone="green">Success</Pill></td></tr>
            ))}
            {inv.payments.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-sub">No payments recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-line p-4"><h3 className="text-sm font-extrabold">Notes</h3><p className="mt-1 text-sub">Thank you for choosing AlbumPro. We appreciate your business!</p></div>
    </div>
  );
}

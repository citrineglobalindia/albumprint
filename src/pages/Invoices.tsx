import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, IndianRupee, AlertCircle, ShieldAlert, Plus, Send, Check, Lock, Printer, Trash2 } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, SearchInput, CountTabs, TodayChip, MoreButton, PrimaryButton, SlideOver, Pagination, Td, tableCls, trCls, Field, inputCls, cx, type Kpi } from "../components/ui";
import { Combobox, ColumnsMenu, DateRangePicker, FilterChips, MultiSelect, SavedViews, SortTh, sortRows, type DateRange, type SortState } from "../components/controls";
import { ALL_TIME, Banner, Err, desRange, inRangeOpt, orderOpt, rangeLabel, serRange, useSlashSearch, type SavedRange } from "../components/pageKit";
import { RowMenu } from "../components/RowMenu";
import { BulkBar, BulkBtn, ExportBtn, SelectTd, SelectTh, Toolbar, rangeChip, runBulk, useSelection } from "../components/listKit";
import { useToast } from "../components/Toast";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { ORDERS } from "../lib/data";
import { fmtDate, inr, inrShort } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { can, discountLimit, type Out } from "../lib/production";
import { INVOICES, PAYMENTS, ensureFinance, calc, invTotal, invPaid, invStatus, draftFor, createInvoice, approveDiscount, sendInvoice, type Draft, type Invoice } from "../lib/finance";

type Tab = "all" | "Draft" | "Sent" | "Partially Paid" | "Paid" | "Overdue" | "approval" | "credit";
const ordOf = (id: string) => ORDERS.find((o) => o.id === id)!;
const TONE = { Draft: "slate", Sent: "blue", Paid: "green", "Partially Paid": "amber", Overdue: "red", "Credit note": "violet" } as const;
const COLS = [{ key: "no", label: "Invoice no." }, { key: "order", label: "Order" }, { key: "customer", label: "Customer" }, { key: "date", label: "Date" }, { key: "due", label: "Due" }, { key: "total", label: "Total" }, { key: "paid", label: "Paid" }, { key: "status", label: "Status" }];
interface ViewState { tab: Tab; type: string[]; cust: string[]; range: SavedRange; q: string; hidden: string[]; sort: SortState }
const TAB_LABEL: Record<Tab, string> = { all: "All", Draft: "Draft", Sent: "Sent", "Partially Paid": "Partial", Paid: "Paid", Overdue: "Overdue", approval: "Needs approval", credit: "Credit notes" };

export default function Invoices() {
  const { role } = useAuth();
  const finance = can(role, "finance");
  const isAdmin = role === "admin";
  ensureFinance();
  useStore();
  const nav = useNavigate();
  const [toast, show] = useToast();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [fType, setFType] = useState<string[]>([]);
  const [fCust, setFCust] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>(ALL_TIME());
  const [sort, setSort] = useState<SortState>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [selNo, setSelNo] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const sel = useSelection();
  useSlashSearch();
  const run = (r: Out) => { show(r.msg); return r.ok; };
  const limit = discountLimit();
  const vis = (k: string) => !hidden.includes(k);
  const reset = () => setPage(1);

  const matches = (i: Invoice, t: Tab) => t === "all" || (t === "approval" ? i.approval === "pending" : t === "credit" ? i.kind === "credit_note" : invStatus(i) === t);
  const base = INVOICES.filter((i) => {
    const t = q.trim().toLowerCase();
    if (t && !`${i.no} ${i.orderId} ${i.customer}`.toLowerCase().includes(t)) return false;
    if (fType.length && !fType.includes(i.kind === "credit_note" ? "Credit note" : "Invoice")) return false;
    if (fCust.length && !fCust.includes(i.customer)) return false;
    return inRangeOpt(i.date, range);
  });
  const list = sortRows(base.filter((i) => matches(i, tab)), sort, (i, k) => {
    switch (k) { case "no": return i.no; case "order": return i.orderId; case "customer": return i.customer.toLowerCase(); case "date": return i.date; case "due": return i.due; case "total": return invTotal(i); case "paid": return invPaid(i); default: return invStatus(i); }
  });
  const pageSize = 10;
  const rows = list.slice((page - 1) * pageSize, page * pageSize);
  const selected = sel.within(list.map((i) => i.no));
  const cur = INVOICES.find((i) => i.no === selNo) ?? null;
  const invs = INVOICES.filter((i) => i.kind === "invoice");
  const closed = !!(cur && ordOf(cur.orderId)?.closed);
  const custOpts = [...new Set(INVOICES.map((i) => i.customer))].sort();

  const kpis: Kpi[] = [
    { label: "Invoiced", value: inrShort(invs.reduce((a, i) => a + invTotal(i), 0)), icon: FileText, tone: "blue" },
    { label: "Collected", value: inrShort(invs.reduce((a, i) => a + invPaid(i), 0)), icon: IndianRupee, tone: "green" },
    { label: "Outstanding", value: inrShort(invs.filter((i) => i.status !== "Draft").reduce((a, i) => a + invTotal(i) - invPaid(i), 0)), icon: IndianRupee, tone: "orange", invert: true },
    { label: "Overdue", value: invs.filter((i) => invStatus(i) === "Overdue").length, icon: AlertCircle, tone: "red", invert: true },
    { label: "Needs approval", value: invs.filter((i) => i.approval === "pending").length, icon: ShieldAlert, tone: "pink", invert: true },
  ];
  const tabs: Tab[] = ["all", "Draft", "Sent", "Partially Paid", "Paid", "Overdue", "approval", "credit"];

  const exportRows = (items: Invoice[]) => { downloadCsv("invoices.csv", [["No", "Type", "Order", "Customer", "Date", "Due", "Total", "Status"], ...items.map((i) => [i.no, i.kind, i.orderId, i.customer, i.date, i.due, invTotal(i), invStatus(i)])]); show(`Exported ${items.length} invoices`); };
  const chips = [
    ...(tab !== "all" ? [{ label: `Status: ${TAB_LABEL[tab]}`, onRemove: () => setTab("all") }] : []),
    ...fType.map((s) => ({ label: `Type: ${s}`, onRemove: () => setFType(fType.filter((x) => x !== s)) })),
    ...fCust.map((s) => ({ label: `Customer: ${s}`, onRemove: () => setFCust(fCust.filter((x) => x !== s)) })),
    ...rangeChip("Dated", range.preset, rangeLabel(range), () => setRange(ALL_TIME())),
    ...(q ? [{ label: `Search: ${q}`, onRemove: () => setQ("") }] : []),
  ];
  const clearAll = () => { setTab("all"); setFType([]); setFCust([]); setRange(ALL_TIME()); setQ(""); reset(); };
  const view: ViewState = { tab, type: fType, cust: fCust, range: serRange(range), q, hidden, sort };
  const applyView = (v: ViewState) => { setTab(v.tab); setFType(v.type); setFCust(v.cust); setRange(desRange(v.range)); setQ(v.q); setHidden(v.hidden); setSort(v.sort); reset(); };
  const byNo = (n: string) => INVOICES.find((i) => i.no === n)!;
  const guardSend = (): boolean => { if (finance) return true; show(`Your role (${role}) cannot send invoices`); return false; };

  const newInvoice = () => { if (!finance) { show(`Your role (${role}) cannot create invoices`); return; } setDraft({ ...draftFor(ORDERS.find((o) => o.stage !== "new_order" && !o.closed) ?? ORDERS[0]!), orderId: "" , lines: [{ desc: "", qty: 1, price: 0 }] }); setErrs({}); };
  const save = () => {
    if (!draft) return;
    const e: Record<string, string> = {};
    if (!draft.orderId) e.orderId = "Select an order";
    setErrs(e); if (Object.keys(e).length) return;
    const done = (x: Out) => { if (run(x)) { setDraft(null); setTab("all"); setSelNo(INVOICES[0]?.no ?? null); } };
    const r = createInvoice(draft);
    if (r instanceof Promise) void r.then(done); else done(r);   // backend mode: wait for the server-assigned invoice number
  };
  const T = draft ? calc({ lines: draft.lines, gstPct: draft.gstPct, discountPct: draft.discPct, igst: draft.igst }) : null;

  return (
    <div>
      <PageHeader title="Invoices" subtitle="Manage and track all invoices for your album design and printing orders.">
        <TodayChip />
        {finance && <PrimaryButton icon={Plus} onClick={newInvoice}>New Invoice</PrimaryButton>}
        <MoreButton />
      </PageHeader>
      {!finance && <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-[13px] font-semibold text-amber-800"><Lock className="size-4" />View only — invoicing is limited to Accounts and Admin.</div>}
      <KpiRow items={kpis} cols={5} />

      <Panel title="All Invoices" subtitle="Click an invoice to see its lines, GST breakup and receipts" action={<ExportBtn onClick={() => exportRows(list)} />}>
        <div className="mb-3"><CountTabs<Tab> value={tab} onChange={(t) => { setTab(t); reset(); }} tabs={tabs.map((t) => ({ key: t, label: TAB_LABEL[t], count: base.filter((i) => matches(i, t)).length }))} /></div>
        <Toolbar right={<><SavedViews<ViewState> storageKey="invoices" current={view} onApply={applyView} /><ColumnsMenu columns={COLS} hidden={hidden} onChange={setHidden} /></>}>
          <DateRangePicker value={range} onChange={(r) => { setRange(r); reset(); }} align="left" />
          <MultiSelect className="w-40" label="Type" options={["Invoice", "Credit note"]} value={fType} onChange={(v) => { setFType(v); reset(); }} />
          <MultiSelect className="w-44" label="Customer" options={custOpts} value={fCust} onChange={(v) => { setFCust(v); reset(); }} />
          <SearchInput className="w-64" value={q} onChange={(v) => { setQ(v); reset(); }} placeholder="Search invoice, order, customer… ( / )" />
        </Toolbar>
        <FilterChips chips={chips} onClearAll={clearAll} />
        <BulkBar count={selected.length} onClear={sel.clear}>
          {finance && <BulkBtn tone="primary" testid="bulk-send" onClick={() => { if (guardSend()) { runBulk(selected, (n) => sendInvoice(n), show, "Sent"); sel.clear(); } }}><Send className="size-3.5" />Send selected</BulkBtn>}
          {isAdmin && <BulkBtn testid="bulk-approve" onClick={() => { runBulk(selected.filter((n) => byNo(n).approval === "pending"), (n) => approveDiscount(n), show, "Approved"); }}><Check className="size-3.5" />Approve discounts</BulkBtn>}
          <BulkBtn testid="bulk-export" onClick={() => exportRows(selected.map(byNo))}>Export selected</BulkBtn>
        </BulkBar>
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead><tr>
              <SelectTh rows={rows.map((i) => i.no)} sel={sel} />
              {vis("no") && <SortTh k="no" sort={sort} onSort={setSort}>Invoice no.</SortTh>}
              {vis("order") && <SortTh k="order" sort={sort} onSort={setSort}>Order</SortTh>}
              {vis("customer") && <SortTh k="customer" sort={sort} onSort={setSort}>Customer</SortTh>}
              {vis("date") && <SortTh k="date" sort={sort} onSort={setSort}>Date</SortTh>}
              {vis("due") && <SortTh k="due" sort={sort} onSort={setSort}>Due</SortTh>}
              {vis("total") && <SortTh k="total" sort={sort} onSort={setSort}>Total</SortTh>}
              {vis("paid") && <SortTh k="paid" sort={sort} onSort={setSort}>Paid</SortTh>}
              {vis("status") && <SortTh k="status" sort={sort} onSort={setSort}>Status</SortTh>}
              <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub">Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((i) => { const s = invStatus(i); return (
                <tr key={i.no} data-testid={`inv-${i.no}`} onClick={() => setSelNo(i.no)} className={cx(trCls, "cursor-pointer", sel.has(i.no) && "bg-brand-soft/60")}>
                  <SelectTd id={i.no} sel={sel} />
                  {vis("no") && <Td className="font-bold">{i.no}</Td>}
                  {vis("order") && <Td>{i.orderId}</Td>}
                  {vis("customer") && <Td>{i.customer}</Td>}
                  {vis("date") && <Td>{fmtDate(i.date)}</Td>}
                  {vis("due") && <Td className={s === "Overdue" ? "text-rose-600" : ""}>{fmtDate(i.due)}</Td>}
                  {vis("total") && <Td>{i.kind === "credit_note" ? "−" : ""}{inr(invTotal(i))}</Td>}
                  {vis("paid") && <Td>{i.kind === "invoice" ? inr(invPaid(i)) : "—"}</Td>}
                  {vis("status") && <Td><span className="flex flex-wrap gap-1"><Pill tone={TONE[s]}>{s}</Pill>{i.approval === "pending" && <Pill tone="red">Needs admin approval</Pill>}</span></Td>}
                  <Td><div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setSelNo(i.no)} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold hover:bg-brand-soft">View</button>
                    <RowMenu label={`Actions for ${i.no}`} items={[
                      { label: "View invoice", onClick: () => setSelNo(i.no) },
                      ...(i.kind === "invoice" && i.status === "Draft" ? [{ label: "Send invoice", onClick: () => { if (guardSend()) run(sendInvoice(i.no)); } }] : []),
                      ...(i.approval === "pending" ? [{ label: "Approve discount", onClick: () => { if (isAdmin) run(approveDiscount(i.no)); else show("Only an admin can approve this discount"); } }] : []),
                      { label: "Print", onClick: () => { setSelNo(i.no); setTimeout(() => window.print(), 300); } },
                      { label: "Export row", onClick: () => exportRows([i]) },
                      { label: "Open order", onClick: () => nav(`/orders/${i.orderId}`) },
                    ]} />
                  </div></Td>
                </tr>); })}
              {rows.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-sub">No invoices found.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={list.length} onPage={setPage} noun="invoices" />
      </Panel>

      <SlideOver open={!!cur && !draft} onClose={() => setSelNo(null)} title={cur ? `${cur.kind === "credit_note" ? "Credit note" : "Invoice"} ${cur.no}` : "Invoice"} width={520}>
        {cur && (() => { const T2 = calc(cur); const s = invStatus(cur); const total = invTotal(cur); const paid = invPaid(cur); const receipts = PAYMENTS.filter((p) => p.orderId === cur.orderId); return (
          <div>
            <div className="flex items-start justify-between">
              <div><h3 className="text-xl font-extrabold">{cur.no}</h3><div className="text-[13px] text-sub">{cur.kind === "credit_note" ? "Credit note" : "Tax invoice"} · {cur.customer} · {cur.orderId}</div></div>
              <Pill tone={TONE[s]}>{s}</Pill>
            </div>
            {closed && <div className="mt-3"><Banner tone="amber">Order is closed — invoice is read-only.</Banner></div>}
            {cur.approval === "pending" && <div role="alert" data-testid="approval-banner" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700"><b>Discount {cur.discountPct}% needs admin approval</b> (limit {limit}%). It cannot be sent until an admin approves.</div>}
            {cur.approval === "approved" && <p className="mt-3 text-xs font-semibold text-emerald-700">Discount approved by {cur.approvedBy}</p>}
            <div className="mt-3 text-xs text-sub">Dated {fmtDate(cur.date)} · due {fmtDate(cur.due)}{cur.refNo ? ` · against ${cur.refNo}` : ""}</div>
            <table className="mt-3 w-full text-[13px]"><thead><tr className="text-left text-[11px] uppercase text-sub"><th className="py-1">Description</th><th>Qty</th><th className="text-right">Amount</th></tr></thead>
              <tbody>{cur.lines.map((l, k) => <tr key={k} className="border-t border-line"><td className="py-1.5">{l.desc}</td><td>{l.qty}</td><td className="text-right">{inr(l.qty * l.price)}</td></tr>)}</tbody></table>
            <dl data-testid="gst-breakup" className="mt-3 space-y-1 text-[13px]">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{inr(T2.sub)}</dd></div>
              {T2.discount > 0 && <div className="flex justify-between"><dt>Discount ({cur.discountPct}%)</dt><dd>−{inr(T2.discount)}</dd></div>}
              <div className="flex justify-between"><dt>Taxable value</dt><dd>{inr(T2.taxable)}</dd></div>
              {cur.igst ? <div className="flex justify-between"><dt>IGST {cur.gstPct}%</dt><dd>{inr(T2.igst)}</dd></div> : <>
                <div className="flex justify-between"><dt>CGST {cur.gstPct / 2}%</dt><dd>{inr(T2.cgst)}</dd></div>
                <div className="flex justify-between"><dt>SGST {cur.gstPct / 2}%</dt><dd>{inr(T2.sgst)}</dd></div></>}
              <div className="flex justify-between border-t border-line pt-1 text-base font-extrabold"><dt>Total</dt><dd>{cur.kind === "credit_note" ? "−" : ""}{inr(total)}</dd></div>
              {cur.kind === "invoice" && <><div className="flex justify-between text-emerald-700"><dt>Paid</dt><dd>{inr(paid)}</dd></div><div className="flex justify-between font-bold"><dt>Balance</dt><dd>{inr(total - paid)}</dd></div></>}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {cur.kind === "invoice" && cur.status === "Draft" && (finance ? <button data-testid="send-invoice" onClick={() => run(sendInvoice(cur.no))} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-bold text-white hover:bg-brand-dark"><Send className="size-4" />Send invoice</button> : <button onClick={() => show(`Your role (${role}) cannot send invoices`)} className="h-10 flex-1 rounded-lg border border-line text-sm font-bold text-sub">Send (Accounts only)</button>)}
              {cur.approval === "pending" && (isAdmin ? <button data-testid="approve-discount" onClick={() => run(approveDiscount(cur.no))} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700"><Check className="size-4" />Approve discount</button> : <button onClick={() => show("Only an admin can approve this discount")} className="h-10 flex-1 rounded-lg border border-line text-sm font-bold text-sub">Approve (admin only)</button>)}
              <button onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-bold hover:bg-brand-soft"><Printer className="size-4" />Print</button>
            </div>
            {cur.kind === "invoice" && (<>
              <h4 className="mb-1 mt-4 text-sm font-extrabold">Receipts & credit notes for {cur.orderId}</h4>
              <ul className="space-y-1 text-[12px]">{receipts.map((p) => <li key={p.id} className="flex justify-between rounded-lg border border-line px-3 py-1.5"><span><b>{p.receipt}</b> · {p.kind === "refund" ? `Refund (${p.creditNote})` : p.mode}</span><span>{p.kind === "refund" ? "−" : ""}{inr(p.amount)}</span></li>)}{receipts.length === 0 && <li className="text-sub">No receipts yet.</li>}</ul>
            </>)}
          </div>); })()}
      </SlideOver>

      <SlideOver open={!!draft} onClose={() => setDraft(null)} title="New Invoice" width={520}
        footer={<><button onClick={() => setDraft(null)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Cancel</button><button onClick={save} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Create draft</button></>}>
        {draft && T && (<>
          <Field label="Order" required><Combobox error={!!errs.orderId} value={draft.orderId} placeholder="Search order or customer…" onChange={(v) => setDraft({ ...draftFor(ordOf(v)), discPct: draft.discPct, terms: draft.terms })} options={ORDERS.filter((o) => !o.closed).map(orderOpt)} /><Err>{errs.orderId}</Err></Field>
          <div className="mb-1 text-[13px] font-semibold">Line items</div>
          {draft.lines.map((l, k) => (
            <div key={k} className="mb-2 grid grid-cols-[1fr_56px_96px_28px] gap-2">
              <input aria-label={`Line ${k + 1} description`} className={inputCls} placeholder="Description" value={l.desc} onChange={(e) => setDraft({ ...draft, lines: draft.lines.map((x, j) => j === k ? { ...x, desc: e.target.value } : x) })} />
              <input aria-label={`Line ${k + 1} qty`} type="number" min={1} className={inputCls} value={l.qty} onChange={(e) => setDraft({ ...draft, lines: draft.lines.map((x, j) => j === k ? { ...x, qty: Number(e.target.value) } : x) })} />
              <input aria-label={`Line ${k + 1} price`} type="number" min={0} className={inputCls} value={l.price} onChange={(e) => setDraft({ ...draft, lines: draft.lines.map((x, j) => j === k ? { ...x, price: Number(e.target.value) } : x) })} />
              <button aria-label="Remove line" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, j) => j !== k) })} className="text-sub hover:text-rose-600"><Trash2 className="size-4" /></button>
            </div>))}
          <button onClick={() => setDraft({ ...draft, lines: [...draft.lines, { desc: "", qty: 1, price: 0 }] })} className="mb-4 text-xs font-bold text-brand">+ Add line</button>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount %"><input aria-label="Discount %" type="number" min={0} max={100} className={inputCls} value={draft.discPct} onChange={(e) => setDraft({ ...draft, discPct: Number(e.target.value) })} /></Field>
            <Field label="Payment terms"><select aria-label="Terms" className={inputCls} value={draft.terms} onChange={(e) => setDraft({ ...draft, terms: Number(e.target.value) })}>{[7, 15, 30].map((n) => <option key={n} value={n}>Net {n}</option>)}</select></Field>
            <Field label="GST rate %"><input aria-label="GST rate" type="number" className={inputCls} value={draft.gstPct} onChange={(e) => setDraft({ ...draft, gstPct: Number(e.target.value) })} /></Field>
            <Field label="Supply"><select aria-label="Supply" className={inputCls} value={draft.igst ? "inter" : "intra"} onChange={(e) => setDraft({ ...draft, igst: e.target.value === "inter" })}><option value="intra">Intra-state (CGST+SGST)</option><option value="inter">Inter-state (IGST)</option></select></Field>
          </div>
          {draft.discPct > limit && <Banner tone="red">Discount above {limit}% — this invoice will need admin approval before it can be sent.</Banner>}
          <dl className="mt-3 space-y-1 text-[13px]"><div className="flex justify-between"><dt>Taxable</dt><dd>{inr(T.taxable)}</dd></div>{draft.igst ? <div className="flex justify-between"><dt>IGST</dt><dd>{inr(T.igst)}</dd></div> : <><div className="flex justify-between"><dt>CGST</dt><dd>{inr(T.cgst)}</dd></div><div className="flex justify-between"><dt>SGST</dt><dd>{inr(T.sgst)}</dd></div></>}<div className="flex justify-between text-base font-extrabold"><dt>Total</dt><dd>{inr(T.total)}</dd></div></dl>
        </>)}
      </SlideOver>
      {toast}
    </div>
  );
}

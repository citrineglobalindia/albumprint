import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, BookImage, CalendarDays, ClipboardList, Download, IndianRupee, Mail, MapPin, MessageCircle, Phone, Plus, Receipt, TrendingUp, Wallet } from "lucide-react";
import { KpiRow, LineTabs, PageHeader, Panel, PayPill, Pill, PrimaryButton, Td, Th, cx, tableCls, trCls, type Kpi } from "../components/ui";
import { useToast } from "../components/Toast";
import { useNewOrder } from "../components/NewOrderWizard";
import { BalanceReminderButton } from "../components/Reminders";
import { albumProgress } from "../components/OrderAlbumRows";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { CUSTOMERS, stageLabel, stageTone, type Order } from "../lib/data";
import { INVOICES, PAYMENTS, invTotal } from "../lib/finance";
import { duesByCustomer } from "../lib/reminders";
import { customerOrders, customerStats, groupOf, mergeCustomers, mobileKey } from "../lib/customerGroups";
import { isInvoicePending } from "../lib/orders2";
import { albumStatus } from "../lib/albumFlow";
import { statusLabel } from "../lib/jobProgress";
import { downloadCsv } from "../lib/csv";
import { fmtDate, inr } from "../lib/format";

// Customer 360: who they are, every order (with album progress), and their account — billed, received, outstanding, a running ledger,
// payments and invoices — across every record of the customer (duplicates with the same mobile count as one).
type Tab = "orders" | "albums" | "accounts";
const month = (d: string) => d.slice(0, 7);

export default function CustomerProfile() {
  useStore();
  const { id } = useParams();
  const { role } = useAuth();
  const [toast, show] = useToast();
  const newOrder = useNewOrder();
  const [tab, setTab] = useState<Tab>("orders");
  const found = CUSTOMERS.find((c) => c.id === id);
  const group = found ? groupOf(found) : undefined;
  const c = group?.primary ?? found;
  const orders = useMemo(() => (c ? customerOrders(c).sort((a, b) => (b.pendingAt || "").localeCompare(a.pendingAt || "")) : []), [c, c && customerOrders(c).length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <div className="p-8 text-sm text-sub">Customer not found. <Link to="/customers" className="font-bold text-brand underline">Back to customers</Link></div>;
  const st = customerStats(c);
  const ids = new Set(orders.map((o) => o.id));
  const pays = PAYMENTS.filter((p) => ids.has(p.orderId)).sort((a, b) => b.date.localeCompare(a.date));
  const invs = INVOICES.filter((i) => ids.has(i.orderId)).sort((a, b) => b.date.localeCompare(a.date));
  const live = orders.filter((o) => o.hold !== "Cancelled");
  const albums = live.reduce((s, o) => s + Math.max(1, o.albums?.length ?? 0), 0);
  const pendingInv = live.filter((o) => isInvoicePending(o.id)).length;
  const money = role === "admin" || role === "reception" || role === "accounts";

  // ledger: orders billed (debit) and money received (credit), oldest first, with the running balance
  const ledger = [
    ...live.filter((o) => o.total > 0).map((o) => ({ date: o.pendingAt, ref: o.id, what: `Order · ${o.event}`, debit: o.total, credit: 0 })),
    ...PAYMENTS.filter((p) => ids.has(p.orderId)).map((p) => ({ date: p.date, ref: p.receipt || p.orderId, what: `${p.kind === "refund" ? "Refund" : "Payment"} · ${p.mode} · ${p.orderId}`, debit: p.kind === "refund" ? p.amount : 0, credit: p.kind === "refund" ? 0 : p.amount })),
  ].sort((a, b) => a.date.localeCompare(b.date) || b.debit - a.debit);
  let bal = 0; const rows = ledger.map((l) => { bal += l.debit - l.credit; return { ...l, bal }; });
  const statement = () => downloadCsv(`statement-${c.id}.csv`, [["Date", "Reference", "Details", "Billed", "Received", "Balance"], ...rows.map((r) => [r.date, r.ref, r.what, r.debit || "", r.credit || "", r.bal])]);

  // last 12 months: billed vs received
  const months = new Map<string, { m: string; billed: number; received: number }>();
  for (const o of live) { const k = month(o.pendingAt || ""); if (!k) continue; const x = months.get(k) ?? { m: k, billed: 0, received: 0 }; x.billed += o.total; months.set(k, x); }
  for (const p of pays) { const k = month(p.date); const x = months.get(k) ?? { m: k, billed: 0, received: 0 }; x.received += p.kind === "refund" ? -p.amount : p.amount; months.set(k, x); }
  const chart = [...months.values()].sort((a, b) => a.m.localeCompare(b.m)).slice(-12).map((x) => ({ ...x, label: new Date(`${x.m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) }));

  const events = new Map<string, number>();
  for (const o of live) for (const e of o.event.split(",").map((x) => x.trim()).filter((x) => x && x !== "—")) events.set(e, (events.get(e) ?? 0) + 1);

  const kpis: Kpi[] = [
    { label: "Orders", value: `${st.orders} · ${st.active} active`, icon: ClipboardList, tone: "blue" },
    { label: "Albums", value: albums, icon: BookImage, tone: "violet" },
    ...(money ? [
      { label: "Billed", value: inr(st.billed), icon: Receipt, tone: "indigo" as const },
      { label: "Received", value: inr(st.paid), icon: Wallet, tone: "green" as const },
      { label: "Outstanding", value: inr(st.dues), icon: IndianRupee, tone: "red" as const, invert: true },
      { label: "Avg order value", value: inr(live.filter((o) => o.total > 0).length ? Math.round(st.billed / live.filter((o) => o.total > 0).length) : 0), icon: TrendingUp, tone: "teal" as const },
    ] : []),
  ];
  const wa = `https://wa.me/91${mobileKey(c.mobile)}`;
  return (
    <>
      <Link to="/customers" className="mb-2 inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline"><ArrowLeft className="size-3.5" />Customers</Link>
      <PageHeader title={c.studio || c.name} subtitle={`${c.id}${c.name && c.name !== c.studio ? ` · ${c.name}` : ""} · customer since ${fmtDate(st.first ?? c.since)}${st.last ? ` · last order ${fmtDate(st.last)}` : ""}`}>
        <PrimaryButton icon={Plus} onClick={() => newOrder.open({ customerId: c.id })}>New Order</PrimaryButton>
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-line bg-white px-5 py-3 text-sm" data-testid="customer-contact">
        <a href={`tel:${mobileKey(c.mobile)}`} className="inline-flex items-center gap-1.5 font-semibold hover:text-brand"><Phone className="size-4 text-sub" />{c.mobile}</a>
        <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:underline"><MessageCircle className="size-4" />WhatsApp</a>
        {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-brand"><Mail className="size-4 text-sub" />{c.email}</a>}
        {(c.city || c.state) && <span className="inline-flex items-center gap-1.5"><MapPin className="size-4 text-sub" />{[c.city, c.state].filter(Boolean).join(", ")}</span>}
        <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4 text-sub" />{st.orders} order{st.orders === 1 ? "" : "s"}</span>
        <Pill tone={c.type === "VIP" ? "amber" : c.type === "New" ? "blue" : "slate"}>{st.orders > 1 && c.type === "New" ? "Repeat" : c.type}</Pill>
        {money && <span className="ml-auto"><BalanceReminderButton d={duesByCustomer().find((x) => x.customer.id === c.id)} onDone={(m) => show(m)} /></span>}
      </div>
      {(group?.dupes.length ?? 0) > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900" data-testid="duplicate-records">
          <span>This customer is saved {group!.dupes.length + 1} times with the same mobile ({[c, ...group!.dupes].map((x) => x.id).join(", ")}). Everything is shown here together.</span>
          {role === "admin" && <button onClick={() => { if (window.confirm(`Merge ${group!.dupes.map((x) => x.id).join(", ")} into ${c.id}? Their orders and invoices move to ${c.id}.`)) void mergeCustomers(c, group!.dupes).then((r) => show(r.msg)); }} className="ml-auto h-8 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700">Merge into {c.id}</button>}
        </div>
      )}
      <KpiRow items={kpis} cols={Math.min(6, kpis.length)} />

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title={money ? "Billed vs received" : "Orders by month"} subtitle="Last 12 months">
          <div style={{ height: 230 }}><ResponsiveContainer>
            <BarChart data={chart}><CartesianGrid vertical={false} stroke="#e6e9f5" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} width={60} /><Tooltip formatter={(v) => inr(Number(v))} /><Legend />
              <Bar dataKey="billed" name="Billed" fill="#3b5bf0" radius={[6, 6, 0, 0]} />{money && <Bar dataKey="received" name="Received" fill="#10b981" radius={[6, 6, 0, 0]} />}</BarChart>
          </ResponsiveContainer></div>
        </Panel>
        <Panel title="At a glance">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-sub">Invoice pending</dt><dd className="font-bold">{pendingInv} order{pendingInv === 1 ? "" : "s"}</dd></div>
            <div><dt className="text-xs text-sub">Payments</dt><dd className="font-bold">{pays.length}</dd></div>
            <div><dt className="text-xs text-sub">Invoices</dt><dd className="font-bold">{invs.filter((i) => i.status !== "Void").length}</dd></div>
            <div><dt className="text-xs text-sub">Cancelled orders</dt><dd className="font-bold">{orders.length - live.length}</dd></div>
          </dl>
          {events.size > 0 && <div className="mt-4"><div className="mb-1.5 text-xs font-semibold text-sub">Events</div><div className="flex flex-wrap gap-1.5">{[...events.entries()].sort((a, b) => b[1] - a[1]).map(([e, n]) => <span key={e} className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold">{e} <span className="text-sub">×{n}</span></span>)}</div></div>}
        </Panel>
      </div>

      <Panel className="mt-5" bodyClassName="p-0" title="Details" action={money && tab === "accounts" ? <button onClick={statement} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft"><Download className="size-3.5" />Statement (CSV)</button> : undefined}>
        <div className="px-5 pt-2"><LineTabs<Tab> className="!border-0" value={tab} onChange={setTab} tabs={[{ key: "orders", label: "Orders", count: orders.length }, { key: "albums", label: "Albums", count: albums }, ...(money ? [{ key: "accounts" as Tab, label: "Accounts" }] : [])]} /></div>
        <div className="overflow-x-auto">
          {tab === "orders" && (
            <table className={tableCls} data-testid="customer-orders">
              <thead><tr><Th>Order</Th><Th>Date</Th><Th>Events</Th><Th>Type</Th><Th>Stage</Th><Th>Albums · progress</Th>{money && <><Th className="text-right">Total</Th><Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Payment</Th></>}</tr></thead>
              <tbody>{orders.map((o) => { const p = albumProgress(o); return (
                <tr key={o.id} className={cx(trCls, o.hold === "Cancelled" && "opacity-60")}>
                  <Td className="font-bold"><Link to={`/orders/${o.id}`} className="text-brand hover:underline">{o.id}</Link></Td><Td>{fmtDate(o.pendingAt)}</Td><Td>{o.event}</Td><Td>{o.workflow}</Td>
                  <Td>{o.hold ? <Pill tone={o.hold === "On Hold" ? "pink" : "red"} dot>{o.hold}</Pill> : <Pill tone={stageTone(o.stage)} dot>{stageLabel(o.stage)}</Pill>}</Td>
                  <Td><span className="flex items-center gap-2"><span className="h-1.5 w-20 overflow-hidden rounded bg-line"><span className="block h-full bg-emerald-500" style={{ width: `${p.pct}%` }} /></span><span className="text-xs">{p.n} album{p.n === 1 ? "" : "s"} · {p.pct}%</span></span></Td>
                  {money && <><Td className="text-right">{isInvoicePending(o.id) ? <span className="text-xs font-semibold text-amber-700">Invoice pending</span> : inr(o.total)}</Td><Td className="text-right">{inr(o.paid)}</Td><Td className={cx("text-right font-semibold", o.total - o.paid > 0 && "text-rose-600")}>{inr(Math.max(0, o.total - o.paid))}</Td><Td><PayPill s={o.pay} /></Td></>}
                </tr>); })}
                {orders.length === 0 && <tr><td colSpan={10} className="px-5 py-8 text-center text-sm text-sub">No orders yet.</td></tr>}</tbody>
            </table>
          )}
          {tab === "albums" && (
            <table className={tableCls} data-testid="customer-albums">
              <thead><tr><Th>Order</Th><Th>Album</Th><Th>Sheets</Th><Th>Event date</Th><Th>Grading</Th><Th>Design</Th><Th>Order stage</Th></tr></thead>
              <tbody>{live.flatMap((o: Order) => (o.albums?.length ? o.albums : [{ title: o.event, sheets: o.pages, eventDate: undefined }]).map((a, i) => (
                <tr key={`${o.id}-${i}`} className={trCls}>
                  <Td className="font-bold"><Link to={`/orders/${o.id}`} className="text-brand hover:underline">{o.id}</Link></Td><Td className="font-semibold">{a.title || `Album ${i + 1}`}</Td><Td>{a.sheets || "—"}</Td><Td>{a.eventDate ? fmtDate(a.eventDate) : "—"}</Td>
                  {(["grading", "design"] as const).map((d) => { const s = o.workflow === "Printing" ? undefined : albumStatus(o, d, i + 1).status; return <Td key={d}>{s ? statusLabel(s) : <span className="text-sub">—</span>}</Td>; })}
                  <Td><Pill tone={stageTone(o.stage)} dot>{stageLabel(o.stage)}</Pill></Td>
                </tr>)))}</tbody>
            </table>
          )}
          {tab === "accounts" && money && (
            <div className="grid gap-4 p-4 xl:grid-cols-2">
              <div className="xl:col-span-2">
                <h3 className="mb-2 text-sm font-extrabold">Ledger</h3>
                <table className={tableCls} data-testid="customer-ledger">
                  <thead><tr><Th>Date</Th><Th>Reference</Th><Th>Details</Th><Th className="text-right">Billed</Th><Th className="text-right">Received</Th><Th className="text-right">Balance</Th></tr></thead>
                  <tbody>{rows.map((r, i) => <tr key={i} className={trCls}><Td>{fmtDate(r.date)}</Td><Td className="font-semibold">{r.ref}</Td><Td>{r.what}</Td><Td className="text-right">{r.debit ? inr(r.debit) : ""}</Td><Td className="text-right text-emerald-700">{r.credit ? inr(r.credit) : ""}</Td><Td className={cx("text-right font-bold", r.bal > 0 ? "text-rose-600" : "text-emerald-700")}>{inr(r.bal)}</Td></tr>)}
                    {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center text-sm text-sub">Nothing billed or received yet.</td></tr>}</tbody>
                </table>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-extrabold">Payments</h3>
                <table className={tableCls} data-testid="customer-payments"><thead><tr><Th>Date</Th><Th>Receipt</Th><Th>Order</Th><Th>Mode</Th><Th className="text-right">Amount</Th></tr></thead>
                  <tbody>{pays.map((p) => <tr key={p.id} className={trCls}><Td>{fmtDate(p.date)}</Td><Td>{p.receipt}</Td><Td>{p.orderId}</Td><Td>{p.mode}</Td><Td className={cx("text-right font-semibold", p.kind === "refund" ? "text-rose-600" : "text-emerald-700")}>{p.kind === "refund" ? "−" : ""}{inr(p.amount)}</Td></tr>)}
                    {pays.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-sm text-sub">No payments yet.</td></tr>}</tbody></table>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-extrabold">Invoices</h3>
                <table className={tableCls} data-testid="customer-invoices"><thead><tr><Th>Invoice</Th><Th>Date</Th><Th>Order</Th><Th>Status</Th><Th className="text-right">Amount</Th></tr></thead>
                  <tbody>{invs.map((i) => <tr key={i.no} className={cx(trCls, i.status === "Void" && "opacity-60")}><Td className="font-semibold">{i.no}</Td><Td>{fmtDate(i.date)}</Td><Td>{i.orderId}</Td><Td>{i.status}</Td><Td className="text-right">{inr(invTotal(i))}</Td></tr>)}
                    {invs.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-sm text-sub">No invoices yet.</td></tr>}</tbody></table>
              </div>
            </div>
          )}
        </div>
      </Panel>
      {toast}
    </>
  );
}

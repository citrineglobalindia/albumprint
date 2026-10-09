import { useState } from "react";
import { Truck, Send, CheckCircle2, CalendarClock, PackageX, IndianRupee, Filter, Download, ExternalLink, MoreVertical, Package, MapPin, Copy, ChevronDown } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, Thumb, SearchInput, FilterSelect, CountTabs, LineTabs, Pagination, Th, Td, trCls, tableCls, PrimaryButton, TodayChip, Avatar, cx, type Kpi } from "../components/ui";
import { ORDERS } from "../lib/data";
import type { Tone } from "../lib/data";
import { inr } from "../lib/format";

type DS = "Ready for Delivery" | "Dispatched" | "In Transit" | "Delivered" | "Pickup Scheduled" | "Courier Pending" | "Payment Hold";
const DS_TONE: Record<DS, Tone> = { "Ready for Delivery": "amber", Dispatched: "blue", "In Transit": "blue", Delivered: "green", "Pickup Scheduled": "pink", "Courier Pending": "orange", "Payment Hold": "red" };
const COURIERS = [
  { name: "DTDC", site: "www.dtdc.in", phone: "1800 103 7100", prefix: "DTDC" },
  { name: "BlueDart", site: "www.bluedart.com", phone: "1860 233 1234", prefix: "BD" },
  { name: "Delhivery", site: "www.delhivery.com", phone: "124 6719500", prefix: "DELH" },
  { name: "India Post", site: "www.indiapost.gov.in", phone: "1800 266 6868", prefix: "IP" },
];
const CITIES = ["Bengaluru, KA", "Chennai, TN", "Hyderabad, TG", "Pune, MH", "Kochi, KL", "Delhi, DL", "Mumbai, MH", "Coimbatore, TN"];
const SEQ: DS[] = ["Delivered", "In Transit", "Pickup Scheduled", "Dispatched", "Delivered", "Ready for Delivery", "Courier Pending", "In Transit", "Pickup Scheduled", "Payment Hold"];

interface Del { id: string; customer: string; event: string; method: string; courier: typeof COURIERS[number] | null; dispatch: string; tracking: string; status: DS; addr: string; outstanding: number; mobile: string; pod: boolean }

const build = (): Del[] =>
  ORDERS.slice(0, 40).map((o, i) => {
    const status = SEQ[i % SEQ.length]!;
    const self = status === "Pickup Scheduled";
    const c = COURIERS[i % COURIERS.length]!;
    const hold = status === "Payment Hold";
    return {
      id: o.id, customer: o.customer, event: o.event, mobile: o.mobile,
      method: self ? "Self Pickup" : i % 6 === 5 ? "Local Delivery" : `Courier (${c.name})`, courier: self ? null : c,
      dispatch: self || status === "Ready for Delivery" || status === "Courier Pending" ? "" : `${1 + (i % 4)} Oct 2026`,
      tracking: self || status === "Ready for Delivery" || status === "Courier Pending" || hold ? "" : `${c.prefix}${458712396 + i * 7919}`,
      status, addr: self ? "" : CITIES[i % CITIES.length]!, outstanding: hold ? 2000 + (i % 3) * 1500 : status === "Ready for Delivery" && o.pay !== "Paid" ? 2000 : 0, pod: status === "Delivered",
    };
  });

type Tab = "all" | DS;
const TIMELINE = [["Order Ready for Delivery", "1 Oct 2026, 09:20 AM"], ["Dispatched to Courier", "1 Oct 2026, 10:30 AM"], ["In Transit", "2 Oct 2026, 08:45 AM"], ["Out for Delivery", "3 Oct 2026, 11:10 AM"], ["Delivered", "3 Oct 2026, 04:15 PM"]] as const;

export default function Delivery() {
  const [items, setItems] = useState(build);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [range, setRange] = useState("Last 30 Days");
  const [selId, setSelId] = useState("IDP00072");
  const [dTab, setDTab] = useState<"details" | "pod" | "cust">("details");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState("");

  const cnt = (s: DS) => items.filter((i) => i.status === s).length;
  const filtered = items.filter((i) => (tab === "all" || i.status === tab) && (!q || `${i.id} ${i.customer} ${i.tracking}`.toLowerCase().includes(q.toLowerCase())));
  const rows = filtered.slice((page - 1) * 10, page * 10);
  const sel = items.find((i) => i.id === selId) ?? items[0]!;
  const order = ORDERS.find((o) => o.id === sel.id)!;
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2200); };
  const setStatus = (s: DS) => setItems((is) => is.map((i) => (i.id === sel.id ? { ...i, status: s, pod: s === "Delivered" || i.pod } : i)));

  const kpis: Kpi[] = [
    { label: "Ready for Delivery", value: cnt("Ready for Delivery") + 32, delta: 28, icon: Truck, tone: "green" },
    { label: "Dispatched", value: cnt("Dispatched") + 48, delta: 12, icon: Send, tone: "blue" },
    { label: "Delivered", value: cnt("Delivered") + 140, delta: 18, icon: CheckCircle2, tone: "green" },
    { label: "Pickup Scheduled", value: cnt("Pickup Scheduled") + 8, delta: 33, icon: CalendarClock, tone: "pink" },
    { label: "Courier Pending", value: cnt("Courier Pending") + 4, delta: -20, icon: PackageX, tone: "orange", invert: true },
    { label: "Payment Hold", value: cnt("Payment Hold") + 2, delta: 50, icon: IndianRupee, tone: "red", invert: true },
  ];
  const tabs: { key: Tab; label: string; count: number; tone?: Tone }[] = [
    { key: "all", label: "All Deliveries", count: items.length, tone: "indigo" },
    ...(["Ready for Delivery", "Dispatched", "Delivered", "Pickup Scheduled", "Courier Pending", "Payment Hold"] as DS[]).map((s) => ({ key: s as Tab, label: s, count: s === "Dispatched" ? cnt(s) + cnt("In Transit") : cnt(s), tone: DS_TONE[s] })),
  ];
  const tlDone = sel.status === "Delivered" ? 5 : sel.status === "In Transit" ? 3 : sel.status === "Dispatched" ? 2 : 1;
  const hold = sel.status === "Payment Hold" || sel.outstanding > 0;

  return (
    <div className="min-w-0">
      <PageHeader title="Delivery" subtitle="Manage ready albums, dispatch, tracking and delivery to customers." icon={<Truck className="mt-1 size-8 text-brand" />}>
        <TodayChip />
        <PrimaryButton>New Delivery</PrimaryButton>
        <button className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold">More <ChevronDown className="size-4" /></button>
      </PageHeader>
      {toast && <div className="fixed right-6 top-6 z-50 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-xl">{toast}</div>}
      <KpiRow items={kpis} />

      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4">
        <div className="min-w-0 space-y-4">
          <Panel bodyClassName="p-3"><CountTabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setPage(1); }} /></Panel>
          <Panel title="Delivery List" subtitle="All ready albums and delivery status" action={
            <div className="flex items-center gap-2">
              <FilterSelect className="w-36" value={range} onChange={setRange} options={["Last 7 Days", "Last 30 Days", "Last 90 Days"]} />
              <SearchInput className="w-56" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search order, customer, tracking..." />
              <button className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-semibold"><Filter className="size-4" />Filters</button>
              <button aria-label="Export" onClick={() => flash("Export started")} className="grid size-10 place-items-center rounded-lg border border-line"><Download className="size-4" /></button>
            </div>}>
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead><tr>
                  <Th><input type="checkbox" checked={rows.length > 0 && rows.every((r) => checked.has(r.id))} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></Th>
                  <Th>Order ID</Th><Th>Customer</Th><Th>Event</Th><Th>Delivery Method</Th><Th>Dispatch Date</Th><Th>Tracking Number</Th><Th>Delivery Status</Th><Th>Address</Th><Th>Outstanding</Th><Th>Actions</Th>
                </tr></thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} onClick={() => setSelId(d.id)} className={cx(trCls, "cursor-pointer", d.status === "Payment Hold" && "bg-rose-50/40", sel.id === d.id && "bg-brand-soft")}>
                      <Td><input type="checkbox" checked={checked.has(d.id)} onClick={(e) => e.stopPropagation()} onChange={() => setChecked((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })} /></Td>
                      <Td><div className="flex items-center gap-2"><Thumb seed={d.id} size={28} /><b>{d.id}</b></div></Td>
                      <Td>{d.customer}</Td><Td>{d.event}</Td><Td>{d.method}</Td>
                      <Td>{d.dispatch || "—"}</Td>
                      <Td>{d.tracking ? <span className="inline-flex items-center gap-1 text-brand underline">{d.tracking}<ExternalLink className="size-3" /></span> : "—"}</Td>
                      <Td><Pill tone={DS_TONE[d.status]} dot>{d.status}</Pill></Td>
                      <Td>{d.addr || "—"}</Td>
                      <Td className={cx("font-semibold", d.outstanding > 0 ? "text-rose-600" : "text-emerald-600")}>{inr(d.outstanding)}</Td>
                      <Td><div className="flex items-center gap-2"><button onClick={() => setSelId(d.id)} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold hover:bg-brand-soft">View</button><MoreVertical className="size-4 text-sub" /></div></Td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-sub">No deliveries.</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={10} total={filtered.length} onPage={setPage} noun="deliveries" />
          </Panel>
        </div>

        <Panel bodyClassName="p-4" className="self-start">
          <div className="flex gap-3">
            <Thumb seed={sel.id} size={64} />
            <div className="min-w-0 flex-1"><div className="text-xs text-sub">Order ID</div><div className="flex items-center justify-between gap-2"><b className="text-lg">{sel.id}</b><Pill tone={DS_TONE[sel.status]}>{sel.status}</Pill></div>
              <div className="text-[13px] font-semibold">{sel.customer}</div><div className="truncate text-xs text-sub">{sel.event} • {order.size} Premium Album</div></div>
          </div>
          {hold && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">Payment hold: {inr(sel.outstanding || 2000)} outstanding. Dispatch blocked until cleared.</div>}
          <LineTabs className="mt-3 gap-4" value={dTab} onChange={setDTab} tabs={[{ key: "details", label: "Delivery Details" }, { key: "pod", label: "Proof of Delivery" }, { key: "cust", label: "Customer Info" }]} />

          {dTab === "details" && (
            <div className="mt-3 space-y-2 text-[13px]">
              {[["Delivery Method", sel.method], ["Tracking Number", sel.tracking || "—"], ["Dispatch Date", sel.dispatch || "—"], ["Estimated Delivery", "4 Oct 2026"], ["Delivered On", sel.status === "Delivered" ? "3 Oct 2026, 04:15 PM" : "—"]].map(([l, v]) => (
                <div key={l} className="flex justify-between gap-3"><span className="text-sub">{l}</span><span className="text-right font-semibold">{v}</span></div>
              ))}
              <div className="flex justify-between gap-3"><span className="flex items-center gap-1 text-sub"><MapPin className="size-3.5" />Address</span><span className="text-right font-semibold">{sel.addr ? `#24, 3rd Cross, ${sel.addr}, India` : "Collect from studio"}</span></div>
            </div>
          )}
          {dTab === "pod" && (
            <div className="mt-3 text-[13px]">
              {sel.pod ? (
                <div><div className="grid h-28 place-items-center rounded-xl bg-slate-100 text-sub"><span className="text-center"><Package className="mx-auto mb-1 size-6" />Signed receipt / delivery photo</span></div>
                  <div className="mt-2 text-sub">Received by {sel.customer} • 3 Oct 2026, 04:15 PM</div></div>
              ) : (
                <div className="rounded-xl border-2 border-dashed border-line p-6 text-center text-sub">No proof of delivery yet.
                  <button disabled={hold} onClick={() => { setStatus("Delivered"); flash("Marked delivered, POD attached"); }} className="mx-auto mt-3 block rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white disabled:bg-slate-300">Upload POD & Mark Delivered</button></div>
              )}
            </div>
          )}
          {dTab === "cust" && (
            <div className="mt-3 space-y-2 text-[13px]">
              <div className="flex items-center gap-2"><Avatar name={sel.customer} size={32} /><b>{sel.customer}</b></div>
              <div className="flex justify-between"><span className="text-sub">Mobile</span><b>{sel.mobile}</b></div>
              <div className="flex justify-between"><span className="text-sub">Payment</span><b>{order.pay}</b></div>
              <div className="flex justify-between"><span className="text-sub">Order Total</span><b>{inr(order.total)}</b></div>
            </div>
          )}

          <h3 className="mb-2 mt-5 text-[15px] font-extrabold">Pickup & Delivery Timeline</h3>
          <ol className="space-y-3">
            {TIMELINE.map(([t, d], i) => (
              <li key={t} className="flex gap-3 text-[13px]">
                <span className={cx("mt-1 grid size-4 place-items-center rounded-full", i < tlDone ? (i === 0 || i === 4 ? "bg-emerald-500 text-white" : "border-2 border-brand bg-white") : "border-2 border-slate-300 bg-white")}>{i < tlDone && (i === 0 || i === 4) && <CheckCircle2 className="size-3" />}</span>
                <div><div className={cx("font-semibold", i >= tlDone && "text-sub")}>{t}</div><div className="text-[11px] text-sub">{i < tlDone ? d : "Pending"}</div></div>
              </li>
            ))}
          </ol>
          {!hold && sel.status !== "Delivered" && (
            <button onClick={() => { const next = sel.status === "Dispatched" ? "In Transit" : sel.status === "In Transit" ? "Delivered" : "Dispatched"; setStatus(next); flash(`Status: ${next}`); }} className="mt-3 h-10 w-full rounded-xl bg-brand text-sm font-bold text-white hover:bg-brand-dark">
              {sel.status === "Dispatched" ? "Mark In Transit" : sel.status === "In Transit" ? "Mark Delivered" : "Dispatch Now"}
            </button>
          )}

          <h3 className="mb-2 mt-5 text-[15px] font-extrabold">Courier Details</h3>
          {sel.courier ? (
            <div className="flex items-center gap-3 text-[13px]"><span className="grid size-12 place-items-center rounded-lg bg-rose-50 text-xs font-extrabold text-rose-600">{sel.courier.name.slice(0, 4).toUpperCase()}</span>
              <div><b>{sel.courier.name}</b><div className="text-xs text-sub">{sel.courier.site} | {sel.courier.phone}</div></div><Copy className="ml-auto size-4 text-sub" /></div>
          ) : <div className="text-[13px] text-sub">Self pickup - no courier assigned.</div>}
        </Panel>
      </div>
    </div>
  );
}

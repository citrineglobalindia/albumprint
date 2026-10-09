import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Truck, Send, CheckCircle2, CalendarClock, PackageX, IndianRupee, Filter, Download, ExternalLink, MoreVertical, Package, MapPin, Copy } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, Thumb, SearchInput, FilterSelect, CountTabs, LineTabs, Pagination, Th, Td, trCls, tableCls, PrimaryButton, TodayChip, Avatar, MoreButton, SlideOver, Field, inputCls, cx, type Kpi } from "../components/ui";
import { useToast } from "../components/Toast";
import { downloadCsv } from "../lib/csv";
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
const METHODS = ["Pickup", "Company delivery", "Courier", "Third-party"];
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
  const [toast, flash] = useToast();
  const nav = useNavigate();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fMethod, setFMethod] = useState("All");
  const [fOut, setFOut] = useState(false);
  const [fCity, setFCity] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [nf, setNf] = useState({ order: "", method: METHODS[0]!, courier: COURIERS[0]!.name, tracking: "", dispatch: "", address: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [trackFor, setTrackFor] = useState<string | null>(null);
  const [trackVal, setTrackVal] = useState("");
  const [trackErr, setTrackErr] = useState("");

  const cnt = (s: DS) => items.filter((i) => i.status === s).length;
  const filtered = items.filter((i) => (tab === "all" || i.status === tab) && (!q || `${i.id} ${i.customer} ${i.tracking}`.toLowerCase().includes(q.toLowerCase()))
    && (fMethod === "All" || i.method.startsWith(fMethod === "Courier" ? "Courier" : fMethod)) && (!fOut || i.outstanding > 0) && (!fCity || i.addr.toLowerCase().includes(fCity.toLowerCase())));
  const activeFilters = (fMethod !== "All" ? 1 : 0) + (fOut ? 1 : 0) + (fCity ? 1 : 0);
  const eligible = ORDERS.filter((o) => o.stage === "ready_for_delivery" && !items.some((i) => i.id === o.id));
  const patchItem = (id: string, p: Partial<Del>) => setItems((is) => is.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const markDispatched = (id: string) => {
    const d = items.find((i) => i.id === id)!;
    if (d.status === "Payment Hold" || d.outstanding > 0) { flash(`${id}: payment hold, clear dues first`); return; }
    patchItem(id, { status: "Dispatched", dispatch: d.dispatch || "3 Oct 2026" }); flash(`${id} marked dispatched`);
  };
  const createDelivery = () => {
    const e: Record<string, string> = {};
    const o = ORDERS.find((x) => x.id === nf.order);
    if (!o) e.order = "Select a QC-passed order";
    if (nf.method !== "Pickup" && !nf.address.trim()) e.address = "Address is required";
    if (nf.method === "Courier" && nf.dispatch && !nf.tracking.trim()) e.tracking = "Tracking number required once dispatched";
    setErrs(e);
    if (Object.keys(e).length || !o) return;
    const c = nf.method === "Courier" ? COURIERS.find((x) => x.name === nf.courier)! : null;
    const dispatched = !!nf.dispatch;
    const status: DS = nf.method === "Pickup" ? "Pickup Scheduled" : dispatched ? "Dispatched" : nf.method === "Courier" ? "Courier Pending" : "Ready for Delivery";
    const dd = nf.dispatch ? new Date(nf.dispatch).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
    const d: Del = { id: o.id, customer: o.customer, event: o.event, mobile: o.mobile, method: nf.method === "Courier" ? `Courier (${nf.courier})` : nf.method === "Pickup" ? "Self Pickup" : nf.method, courier: c, dispatch: dd, tracking: nf.tracking.trim(), status, addr: nf.method === "Pickup" ? "" : nf.address.trim(), outstanding: o.pay === "Paid" ? 0 : o.total - o.paid > 0 ? 2000 : 0, pod: false };
    setItems((is) => [d, ...is]); setSelId(d.id); setTab("all"); setPage(1); setNewOpen(false); flash(`Delivery created for ${o.id}`);
  };
  const exportCsv = () => { downloadCsv("deliveries.csv", [["Order", "Customer", "Event", "Method", "Dispatch", "Tracking", "Status", "Address", "Outstanding"], ...filtered.map((d) => [d.id, d.customer, d.event, d.method, d.dispatch, d.tracking, d.status, d.addr, d.outstanding])]); flash(`Exported ${filtered.length} deliveries`); };
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); } catch { /* ignore */ } flash(`${what} copied`); };
  const printLabel = (d: Del) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`SHIPPING LABEL\nOrder: ${d.id}\nTo: ${d.customer} (${d.mobile})\nAddress: ${d.addr || "Studio pickup"}\nMethod: ${d.method}\nTracking: ${d.tracking || "-"}\n`], { type: "text/plain" }));
    a.download = `label-${d.id}.txt`; a.click(); flash(`Label for ${d.id} downloaded`);
  };

  const rows = filtered.slice((page - 1) * 10, page * 10);
  const sel = items.find((i) => i.id === selId) ?? items[0]!;
  const order = ORDERS.find((o) => o.id === sel.id)!;
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
        <PrimaryButton onClick={() => { setNf({ order: "", method: METHODS[0]!, courier: COURIERS[0]!.name, tracking: "", dispatch: "", address: "" }); setErrs({}); setNewOpen(true); }}>New Delivery</PrimaryButton>
        <MoreButton />
      </PageHeader>
      {toast}
      <KpiRow items={kpis} />

      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4">
        <div className="min-w-0 space-y-4">
          <Panel bodyClassName="p-3"><CountTabs tabs={tabs} value={tab} onChange={(t) => { setTab(t); setPage(1); }} /></Panel>
          <Panel title="Delivery List" subtitle="All ready albums and delivery status" action={
            <div className="flex items-center gap-2">
              <FilterSelect className="w-36" value={range} onChange={setRange} options={["Last 7 Days", "Last 30 Days", "Last 90 Days"]} />
              <SearchInput className="w-56" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search order, customer, tracking..." />
              <button onClick={() => setFiltersOpen((v) => !v)} className={cx("inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold", filtersOpen || activeFilters ? "border-brand bg-brand-soft text-brand" : "border-line")}><Filter className="size-4" />Filters{activeFilters > 0 && ` (${activeFilters})`}</button>
              <button aria-label="Export" onClick={exportCsv} className="grid size-10 place-items-center rounded-lg border border-line"><Download className="size-4" /></button>
            </div>}>
            {filtersOpen && (
              <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-slate-50 p-3 text-[13px]">
                <label>Method<FilterSelect className="mt-1 w-40" value={fMethod} onChange={(v) => { setFMethod(v); setPage(1); }} options={["All", "Self Pickup", "Local Delivery", "Courier"]} /></label>
                <label>City<input aria-label="City filter" value={fCity} onChange={(e) => { setFCity(e.target.value); setPage(1); }} placeholder="e.g. Pune" className="mt-1 h-10 w-36 rounded-lg border border-line bg-white px-3 outline-none focus:border-brand" /></label>
                <label className="flex h-10 items-center gap-2"><input type="checkbox" checked={fOut} onChange={(e) => { setFOut(e.target.checked); setPage(1); }} />Outstanding only</label>
                <button onClick={() => { setFMethod("All"); setFOut(false); setFCity(""); }} className="h-10 text-xs font-bold text-brand">Clear filters</button>
              </div>
            )}
            {checked.size > 0 && (
              <div className="mb-3 flex items-center gap-3 rounded-xl bg-brand-soft px-4 py-2 text-[13px] font-semibold">
                {checked.size} selected
                <button onClick={() => { [...checked].forEach(markDispatched); setChecked(new Set()); }} className="rounded-lg bg-brand px-3 py-1 text-xs font-bold text-white">Mark dispatched</button>
                <button onClick={() => { downloadCsv("selected-deliveries.csv", [["Order", "Customer", "Status"], ...items.filter((i) => checked.has(i.id)).map((d) => [d.id, d.customer, d.status])]); flash("Exported selected"); }} className="rounded-lg border border-line bg-white px-3 py-1 text-xs font-bold">Export</button>
                <button onClick={() => setChecked(new Set())} className="ml-auto text-xs font-bold text-brand">Clear</button>
              </div>
            )}
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
                      <Td>{d.tracking ? <button onClick={(e) => { e.stopPropagation(); if (d.courier) window.open(`https://${d.courier.site}`, "_blank", "noopener"); flash(`Tracking ${d.tracking}${d.courier ? ` on ${d.courier.name}` : ""}`); }} className="inline-flex items-center gap-1 text-brand underline">{d.tracking}<ExternalLink className="size-3" /></button> : "—"}</Td>
                      <Td><Pill tone={DS_TONE[d.status]} dot>{d.status}</Pill></Td>
                      <Td>{d.addr || "—"}</Td>
                      <Td className={cx("font-semibold", d.outstanding > 0 ? "text-rose-600" : "text-emerald-600")}>{inr(d.outstanding)}</Td>
                      <Td><div className="flex items-center gap-2"><button onClick={() => setSelId(d.id)} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold hover:bg-brand-soft">View</button><div className="relative"><button aria-label="Row actions" onClick={(e) => { e.stopPropagation(); setMenu(menu === d.id ? null : d.id); }} onBlur={() => setTimeout(() => setMenu(null), 150)}><MoreVertical className="size-4 text-sub" /></button>
                        {menu === d.id && (
                          <div className="absolute right-0 top-6 z-30 w-40 rounded-xl border border-line bg-white p-1 text-left shadow-xl">
                            {([["Mark dispatched", () => markDispatched(d.id)], ["Add tracking", () => { setTrackFor(d.id); setTrackVal(d.tracking); setTrackErr(""); }], ["Print label", () => printLabel(d)], ["Open order", () => nav(`/orders/${d.id}`)]] as [string, () => void][]).map(([l, f]) => <button key={l} onMouseDown={() => { setMenu(null); f(); }} className="block w-full rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-brand-soft">{l}</button>)}
                          </div>
                        )}</div></div></Td>
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
              <div className="flex justify-between gap-3"><span className="flex items-center gap-1 text-sub"><MapPin className="size-3.5" />Address</span><span className="text-right font-semibold">{sel.addr ? `#24, 3rd Cross, ${sel.addr}, India` : "Collect from studio"}{sel.addr && <button onClick={() => copy(`#24, 3rd Cross, ${sel.addr}, India`, "Address")} className="ml-2 inline-flex items-center gap-1 text-xs text-brand"><Copy className="size-3" />Copy</button>}</span></div>
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
              <div><b>{sel.courier.name}</b><div className="text-xs text-sub">{sel.courier.site} | {sel.courier.phone}</div></div><button aria-label="Copy courier phone" onClick={() => copy(sel.courier!.phone, "Courier phone")} className="ml-auto"><Copy className="size-4 text-sub" /></button></div>
          ) : <div className="text-[13px] text-sub">Self pickup - no courier assigned.</div>}
        </Panel>
      </div>
      <SlideOver open={newOpen} onClose={() => setNewOpen(false)} title="New Delivery" footer={<><button onClick={() => setNewOpen(false)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Cancel</button><button onClick={createDelivery} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Create Delivery</button></>}>
        <Field label="QC-passed order" required>
          <select aria-label="Order" className={inputCls} value={nf.order} onChange={(e) => setNf({ ...nf, order: e.target.value })}>
            <option value="">Select order…</option>
            {eligible.map((o) => <option key={o.id} value={o.id}>{o.id} - {o.customer}</option>)}
          </select>
          {errs.order && <span className="text-xs text-rose-600">{errs.order}</span>}
        </Field>
        <Field label="Delivery method"><select aria-label="Method" className={inputCls} value={nf.method} onChange={(e) => setNf({ ...nf, method: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
        {nf.method === "Courier" && <Field label="Courier"><select className={inputCls} value={nf.courier} onChange={(e) => setNf({ ...nf, courier: e.target.value })}>{COURIERS.map((c) => <option key={c.name}>{c.name}</option>)}</select></Field>}
        {nf.method !== "Pickup" && <Field label="Dispatch date"><input type="date" className={inputCls} value={nf.dispatch} onChange={(e) => setNf({ ...nf, dispatch: e.target.value })} /></Field>}
        {nf.method === "Courier" && <Field label="Tracking number"><input aria-label="Tracking number" className={inputCls} value={nf.tracking} onChange={(e) => setNf({ ...nf, tracking: e.target.value })} />{errs.tracking && <span className="text-xs text-rose-600">{errs.tracking}</span>}</Field>}
        {nf.method !== "Pickup" && <Field label="Delivery address" required><textarea aria-label="Address" className="h-20 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={nf.address} onChange={(e) => setNf({ ...nf, address: e.target.value })} />{errs.address && <span className="text-xs text-rose-600">{errs.address}</span>}</Field>}
      </SlideOver>
      <SlideOver open={!!trackFor} onClose={() => setTrackFor(null)} title={`Add tracking - ${trackFor ?? ""}`} footer={<button onClick={() => { if (!trackVal.trim()) { setTrackErr("Tracking number is required"); return; } patchItem(trackFor!, { tracking: trackVal.trim() }); flash("Tracking number saved"); setTrackFor(null); }} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Save</button>}>
        <Field label="Tracking number" required><input aria-label="Tracking" className={inputCls} value={trackVal} onChange={(e) => setTrackVal(e.target.value)} />{trackErr && <span className="text-xs text-rose-600">{trackErr}</span>}</Field>
      </SlideOver>
    </div>
  );
}

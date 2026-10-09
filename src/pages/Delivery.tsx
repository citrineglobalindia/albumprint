import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Truck, Send, CheckCircle2, CalendarClock, PackageX, IndianRupee, Download, ExternalLink, Package, MapPin, Copy, Wallet, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, Thumb, SearchInput, CountTabs, LineTabs, Pagination, Td, trCls, tableCls, PrimaryButton, TodayChip, Avatar, MoreButton, SlideOver, Field, inputCls, cx, type Kpi } from "../components/ui";
import { ColumnsMenu, Combobox, DateRangePicker, FilterChips, MultiSelect, SavedViews, SortTh, sortRows, type DateRange, type SortState } from "../components/controls";
import { ALL_TIME, Banner, DateField, Err, FieldBox, PhotoUploader, Segmented, StatusMenu, Steps, TODAY_ISO, desRange, inRangeOpt, orderOpt, rangeLabel, serRange, strOpts, usePersisted, useSlashSearch, type Photo, type SavedRange } from "../components/pageKit";
import { RowMenu } from "../components/RowMenu";
import { useToast } from "../components/Toast";
import { downloadCsv } from "../lib/csv";
import { ORDERS, ASSIGNEES } from "../lib/data";
import type { Tone } from "../lib/data";
import { fmtDate, inr, TODAY } from "../lib/format";

type DS = "Ready for Delivery" | "Dispatched" | "In Transit" | "Delivered" | "Pickup Scheduled" | "Courier Pending" | "Payment Hold";
const DS_TONE: Record<DS, Tone> = { "Ready for Delivery": "amber", Dispatched: "blue", "In Transit": "blue", Delivered: "green", "Pickup Scheduled": "pink", "Courier Pending": "orange", "Payment Hold": "red" };
const COURIERS = [
  { name: "DTDC", site: "www.dtdc.in", phone: "1800 103 7100", prefix: "DTDC" },
  { name: "BlueDart", site: "www.bluedart.com", phone: "1860 233 1234", prefix: "BD" },
  { name: "Delhivery", site: "www.delhivery.com", phone: "124 6719500", prefix: "DELH" },
  { name: "India Post", site: "www.indiapost.gov.in", phone: "1800 266 6868", prefix: "IP" },
];
type Courier = (typeof COURIERS)[number];
const PINCODES: Record<string, string> = {
  "560001": "Bengaluru, KA", "600001": "Chennai, TN", "500001": "Hyderabad, TG", "411001": "Pune, MH", "682001": "Kochi, KL", "110001": "Delhi, DL",
  "400001": "Mumbai, MH", "641001": "Coimbatore, TN", "700001": "Kolkata, WB", "380001": "Ahmedabad, GJ", "226001": "Lucknow, UP", "570001": "Mysuru, KA",
};
const PIN_OF: Record<string, string> = Object.fromEntries(Object.entries(PINCODES).map(([k, v]) => [v, k]));
const PRE: DS[] = ["Ready for Delivery", "Courier Pending", "Pickup Scheduled", "Payment Hold"];

interface Ev { t: string; at: string }
interface Pod { photos: Photo[]; signature: Photo[]; by: string; at: string }
interface Del { id: string; customer: string; event: string; mobile: string; method: string; courier: Courier | null; dispatch: string; tracking: string; status: DS; addr: string; city: string; pod: Pod | null; podSeed: boolean; events: Ev[] }

const nowStr = () => `${fmtDate(TODAY)}, ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
const ordOf = (id: string) => ORDERS.find((o) => o.id === id)!;
const balOf = (d: Del) => Math.max(0, ordOf(d.id).total - ordOf(d.id).paid);
/** Derived status: unpaid orders are held before dispatch; a settled hold is released automatically. */
const effStatus = (d: Del): DS => (PRE.includes(d.status) ? (balOf(d) > 0 ? "Payment Hold" : d.status === "Payment Hold" ? "Ready for Delivery" : d.status) : d.status);
const outstanding = (d: Del) => (PRE.includes(d.status) ? balOf(d) : 0);

const build = (): Del[] => {
  const picks = ORDERS.map((o, i) => ({ o, i })).filter(({ o, i }) => o.stage === "delivered" || (o.stage === "ready_for_delivery" && i < 40));
  const readySeq: Del["status"][] = ["In Transit", "Pickup Scheduled", "Ready for Delivery", "Courier Pending", "Ready for Delivery", "Dispatched"];
  let r = 0;
  return picks.map(({ o, i }) => {
    const status: DS = o.stage === "delivered" ? "Delivered" : readySeq[r++ % readySeq.length]!;
    const self = status === "Pickup Scheduled";
    const c = COURIERS[i % COURIERS.length]!;
    const pin = Object.keys(PINCODES)[i % 12]!;
    const sent = status === "Delivered" || status === "Dispatched" || status === "In Transit";
    const events: Ev[] = [{ t: "Order Ready for Delivery", at: "1 Oct 2026, 09:20 AM" }];
    if (self) events.push({ t: "Pickup Scheduled", at: "2 Oct 2026, 11:00 AM" });
    if (sent) events.push({ t: "Dispatched", at: "1 Oct 2026, 10:30 AM" });
    if (status === "In Transit" || status === "Delivered") events.push({ t: "In Transit", at: "2 Oct 2026, 08:45 AM" });
    if (status === "Delivered") events.push({ t: "Delivered", at: "3 Oct 2026, 04:15 PM" });
    return {
      id: o.id, customer: o.customer, event: o.event, mobile: o.mobile, method: self ? "Self Pickup" : i % 6 === 5 ? "Local Delivery" : `Courier (${c.name})`, courier: self ? null : c,
      dispatch: sent ? `2026-10-0${1 + (i % 3)}` : "", tracking: sent ? `${c.prefix}${458712396 + i * 7919}` : "", status,
      addr: self ? "" : `#${10 + (i % 40)}, ${1 + (i % 5)}rd Cross, ${PINCODES[pin]!.split(",")[0]} - ${pin}`, city: self ? "" : PINCODES[pin]!, pod: null, podSeed: status === "Delivered", events,
    };
  });
};

type Tab = "all" | DS;
const METHODS = ["Pickup", "Company delivery", "Courier", "Third-party"] as const;
type Method = (typeof METHODS)[number];
const methodGroup = (m: string) => (m.startsWith("Courier") ? "Courier" : m);
const COLS = [{ key: "id", label: "Order ID" }, { key: "customer", label: "Customer" }, { key: "event", label: "Event" }, { key: "method", label: "Delivery Method" }, { key: "dispatch", label: "Dispatch Date" }, { key: "tracking", label: "Tracking Number" }, { key: "status", label: "Delivery Status" }, { key: "city", label: "City" }, { key: "out", label: "Outstanding" }];
interface ViewState { tab: Tab; methods: string[]; cities: string[]; out: boolean; range: SavedRange; q: string; hidden: string[]; sort: SortState }

interface NF { order: string; method: Method; dispatch: string; courier: string; tracking: string; slot: string; driver: string; provider: string; pin: string; city: string; line: string; contact: string; phone: string }
const blankNF = (): NF => ({ order: "", method: "Courier", dispatch: "", courier: COURIERS[0]!.name, tracking: "", slot: "Morning (10-1)", driver: ASSIGNEES[0]!, provider: "", pin: "", city: "", line: "", contact: "", phone: "" });

export default function Delivery() {
  const [items, setItems] = usePersisted<Del[]>("delivery.items", build);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [range, setRange] = useState<DateRange>(ALL_TIME());
  const [fMethod, setFMethod] = useState<string[]>([]);
  const [fCity, setFCity] = useState<string[]>([]);
  const [fOut, setFOut] = useState(false);
  const [sort, setSort] = useState<SortState>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [dTab, setDTab] = useState<"details" | "pod" | "cust">("details");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [toast, flash] = useToast();
  const nav = useNavigate();
  useSlashSearch();

  const [newOpen, setNewOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [nf, setNf] = useState<NF>(blankNF);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [trackFor, setTrackFor] = useState<string | null>(null);
  const [trackVal, setTrackVal] = useState("");
  const [trackErr, setTrackErr] = useState("");
  // proof of delivery draft
  const [podBy, setPodBy] = useState("");
  const [podPhotos, setPodPhotos] = useState<Photo[]>([]);
  const [podSig, setPodSig] = useState<Photo[]>([]);
  const [podErr, setPodErr] = useState("");

  useEffect(() => { setPage(1); }, [tab, q, range, fMethod, fCity, fOut]);
  useEffect(() => { setPodBy(""); setPodPhotos([]); setPodSig([]); setPodErr(""); }, [selId]);

  const patchItem = (id: string, p: Partial<Del> | ((d: Del) => Partial<Del>)) => setItems((is) => is.map((i) => (i.id === id ? { ...i, ...(typeof p === "function" ? p(i) : p) } : i)));
  const withEv = (d: Del, t: string): Ev[] => [...d.events.filter((e) => e.t !== t), { t, at: nowStr() }];
  const cities = useMemo(() => [...new Set(items.map((i) => i.city).filter(Boolean))].sort(), [items]);
  const cnt = (s: DS) => items.filter((i) => effStatus(i) === s).length;

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const rows = items.filter((i) => {
      const s = effStatus(i);
      if (tab !== "all" && !(tab === "Dispatched" ? s === "Dispatched" || s === "In Transit" : s === tab)) return false;
      if (t && !`${i.id} ${i.customer} ${i.tracking}`.toLowerCase().includes(t)) return false;
      if (fMethod.length && !fMethod.includes(methodGroup(i.method))) return false;
      if (fCity.length && !fCity.includes(i.city)) return false;
      if (fOut && outstanding(i) <= 0) return false;
      return inRangeOpt(i.dispatch, range);
    });
    return sortRows(rows, sort, (i, k) => {
      switch (k) { case "id": return i.id; case "customer": return i.customer.toLowerCase(); case "event": return i.event; case "method": return i.method; case "dispatch": return i.dispatch; case "tracking": return i.tracking; case "status": return effStatus(i); case "city": return i.city; default: return outstanding(i); }
    });
  }, [items, tab, q, fMethod, fCity, fOut, range, sort]);
  const rows = filtered.slice((page - 1) * 8, page * 8);
  const sel = items.find((i) => i.id === selId) ?? null;

  /** Central status transition with the business rules. Returns true when applied. */
  const changeStatus = (id: string, s: DS): boolean => {
    const d = items.find((i) => i.id === id)!;
    if (s === "Payment Hold") { flash("Payment hold is applied automatically while dues are pending"); return false; }
    if (s === effStatus(d)) return false;
    const bal = balOf(d);
    const dispatching = s === "Dispatched" || s === "In Transit" || s === "Delivered";
    if (dispatching && bal > 0) { flash(`${id}: payment hold, ${inr(bal)} outstanding. Record payment first`); return false; }
    if ((s === "Dispatched" || s === "In Transit") && d.courier && !d.tracking) { flash(`${id}: add a tracking number before dispatch`); setTrackFor(id); setTrackVal(""); setTrackErr(""); return false; }
    if (s === "Delivered" && !d.pod && !d.podSeed) { flash(`${id}: attach proof of delivery first`); setSelId(id); setDTab("pod"); return false; }
    const o = ordOf(id);
    if (s === "Delivered") o.stage = "delivered"; else if (o.stage === "delivered") o.stage = "ready_for_delivery";
    patchItem(id, { status: s, dispatch: (s === "Dispatched" || s === "In Transit") && !d.dispatch ? TODAY_ISO : d.dispatch, events: withEv(d, s) });
    flash(`${id}: ${s}`);
    return true;
  };

  const pick = (d: Del, v: DS) => {
    if (!PRE.includes(v)) { changeStatus(d.id, v); return; }
    if (v === d.status) return;
    if (d.status === "Delivered") ordOf(d.id).stage = "ready_for_delivery";
    patchItem(d.id, { status: v, events: withEv(d, v) }); flash(`${d.id}: ${v}`);
  };
  const nextAction = (d: Del): { label: string; to: DS } | null => {
    const s = effStatus(d);
    if (s === "Delivered" || s === "Payment Hold") return null;
    if (s === "Dispatched") return { label: "Mark In Transit", to: "In Transit" };
    if (s === "In Transit") return { label: "Mark Delivered", to: "Delivered" };
    if (s === "Pickup Scheduled") return { label: "Mark Picked Up (Delivered)", to: "Delivered" };
    return { label: "Dispatch Now", to: "Dispatched" };
  };

  const submitPod = (d: Del) => {
    if (balOf(d) > 0) return setPodErr(`Clear ${inr(balOf(d))} dues before delivery`);
    if (!podBy.trim()) return setPodErr("Enter the receiver's name");
    if (podPhotos.length === 0 && podSig.length === 0) return setPodErr("Upload a delivery photo or a signature");
    ordOf(d.id).stage = "delivered";
    patchItem(d.id, { status: "Delivered", pod: { photos: podPhotos, signature: podSig, by: podBy.trim(), at: nowStr() }, events: withEv(d, "Delivered") });
    setPodErr(""); flash(`${d.id} delivered - proof attached`);
  };

  /* ───────── new delivery wizard ───────── */
  const eligible = ORDERS.filter((o) => o.stage === "ready_for_delivery" && !items.some((i) => i.id === o.id));
  const nOrder = ORDERS.find((o) => o.id === nf.order);
  const setN = (p: Partial<NF>) => setNf((x) => ({ ...x, ...p }));
  const pickOrder = (id: string) => { const o = ordOf(id); setN({ order: id, contact: o.customer, phone: o.mobile }); setErrs({}); };
  const onPin = (v: string) => { const pin = v.replace(/\D/g, "").slice(0, 6); setN({ pin, city: PINCODES[pin] ?? (pin.length === 6 ? nf.city : "") }); };
  const genTracking = () => { const c = COURIERS.find((x) => x.name === nf.courier); setN({ tracking: `${c?.prefix ?? "TRK"}${Math.floor(100000000 + Math.random() * 899999999)}` }); };
  const validate = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!nOrder) e.order = "Select a QC-passed order";
      if (nf.dispatch && nf.dispatch < TODAY_ISO) e.dispatch = "Dispatch date cannot be in the past";
    }
    if (s === 1) {
      if (nf.method === "Courier" && nf.dispatch && !nf.tracking.trim()) e.tracking = "Tracking number is required once a dispatch date is set";
      if (nf.method === "Courier" && nf.tracking && !/^[A-Za-z0-9-]{6,}$/.test(nf.tracking.trim())) e.tracking = "Tracking number looks invalid";
      if (nf.method === "Third-party" && !nf.provider.trim()) e.provider = "Enter the courier / transport provider";
    }
    if (s === 2 && nf.method !== "Pickup") {
      if (!/^\d{6}$/.test(nf.pin)) e.pin = "Enter a 6-digit pincode";
      else if (!nf.city) e.city = "City not found for this pincode - enter it manually";
      if (nf.line.trim().length < 5) e.line = "Enter the full street address";
      if (!/^\+?[0-9 ]{10,14}$/.test(nf.phone.trim())) e.phone = "Enter a valid contact number";
    }
    setErrs(e); return Object.keys(e).length === 0;
  };
  const next = () => { if (validate(step)) setStep(step + 1); };
  const createDelivery = () => {
    if (!validate(0)) return setStep(0);
    if (!validate(1)) return setStep(1);
    if (!validate(2)) return;
    const o = nOrder!;
    const c = nf.method === "Courier" ? COURIERS.find((x) => x.name === nf.courier)! : null;
    const dispatched = !!nf.dispatch && nf.method !== "Pickup";
    const status: DS = nf.method === "Pickup" ? "Pickup Scheduled" : dispatched && balOf({ id: o.id } as Del) <= 0 ? "Dispatched" : nf.method === "Courier" ? "Courier Pending" : "Ready for Delivery";
    const method = nf.method === "Courier" ? `Courier (${nf.courier})` : nf.method === "Pickup" ? "Self Pickup" : nf.method === "Third-party" ? `Third-party (${nf.provider.trim()})` : "Local Delivery";
    const events: Ev[] = [{ t: "Order Ready for Delivery", at: nowStr() }];
    if (status === "Pickup Scheduled") events.push({ t: "Pickup Scheduled", at: nowStr() });
    if (status === "Dispatched") events.push({ t: "Dispatched", at: nowStr() });
    const d: Del = {
      id: o.id, customer: o.customer, event: o.event, mobile: nf.phone || o.mobile, method, courier: c, dispatch: status === "Dispatched" ? nf.dispatch : "", tracking: nf.tracking.trim(), status,
      addr: nf.method === "Pickup" ? "" : `${nf.line.trim()}, ${nf.city.split(",")[0]} - ${nf.pin}`, city: nf.method === "Pickup" ? "" : nf.city, pod: null, podSeed: false, events,
    };
    setItems((is) => [d, ...is]); setSelId(d.id); setDTab("details"); setTab("all"); setSort(null); setPage(1); setNewOpen(false);
    flash(`Delivery created for ${o.id}${balOf(d) > 0 ? ` - on payment hold (${inr(balOf(d))} due)` : ""}`);
  };

  const exportCsv = () => { downloadCsv("deliveries.csv", [["Order", "Customer", "Event", "Method", "Dispatch", "Tracking", "Status", "Address", "Outstanding"], ...filtered.map((d) => [d.id, d.customer, d.event, d.method, d.dispatch, d.tracking, effStatus(d), d.addr, outstanding(d)])]); flash(`Exported ${filtered.length} deliveries`); };
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); } catch { /* ignore */ } flash(`${what} copied`); };
  const printLabel = (d: Del) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`SHIPPING LABEL\nOrder: ${d.id}\nTo: ${d.customer} (${d.mobile})\nAddress: ${d.addr || "Studio pickup"}\nMethod: ${d.method}\nTracking: ${d.tracking || "-"}\n`], { type: "text/plain" }));
    a.download = `label-${d.id}.txt`; a.click(); flash(`Label for ${d.id} downloaded`);
  };

  const kpis: Kpi[] = [
    { label: "Ready for Delivery", value: cnt("Ready for Delivery") + 32, delta: 28, icon: Truck, tone: "green" },
    { label: "Dispatched", value: cnt("Dispatched") + cnt("In Transit") + 48, delta: 12, icon: Send, tone: "blue" },
    { label: "Delivered", value: cnt("Delivered") + 140, delta: 18, icon: CheckCircle2, tone: "green" },
    { label: "Pickup Scheduled", value: cnt("Pickup Scheduled") + 8, delta: 33, icon: CalendarClock, tone: "pink" },
    { label: "Courier Pending", value: cnt("Courier Pending") + 4, delta: -20, icon: PackageX, tone: "orange", invert: true },
    { label: "Payment Hold", value: cnt("Payment Hold") + 2, delta: 50, icon: IndianRupee, tone: "red", invert: true },
  ];
  const tabs: { key: Tab; label: string; count: number; tone?: Tone }[] = [
    { key: "all", label: "All Deliveries", count: items.length, tone: "indigo" },
    ...(["Ready for Delivery", "Dispatched", "Delivered", "Pickup Scheduled", "Courier Pending", "Payment Hold"] as DS[]).map((s) => ({ key: s as Tab, label: s, count: s === "Dispatched" ? cnt(s) + cnt("In Transit") : cnt(s), tone: DS_TONE[s] })),
  ];

  const chips = [
    ...(tab !== "all" ? [{ label: `Status: ${tab}`, onRemove: () => setTab("all") }] : []),
    ...fMethod.map((s) => ({ label: `Method: ${s}`, onRemove: () => setFMethod(fMethod.filter((x) => x !== s)) })),
    ...fCity.map((s) => ({ label: `City: ${s}`, onRemove: () => setFCity(fCity.filter((x) => x !== s)) })),
    ...(fOut ? [{ label: "Outstanding only", onRemove: () => setFOut(false) }] : []),
    ...(range.preset !== "All Time" ? [{ label: `Dispatched: ${range.preset === "Custom" ? rangeLabel(range) : range.preset}`, onRemove: () => setRange(ALL_TIME()) }] : []),
    ...(q ? [{ label: `Search: ${q}`, onRemove: () => setQ("") }] : []),
  ];
  const clearAll = () => { setTab("all"); setFMethod([]); setFCity([]); setFOut(false); setRange(ALL_TIME()); setQ(""); };
  const view: ViewState = { tab, methods: fMethod, cities: fCity, out: fOut, range: serRange(range), q, hidden, sort };
  const applyView = (v: ViewState) => { setTab(v.tab); setFMethod(v.methods); setFCity(v.cities); setFOut(v.out); setRange(desRange(v.range)); setQ(v.q); setHidden(v.hidden); setSort(v.sort); };
  const vis = (k: string) => !hidden.includes(k);

  const selStatus = sel ? effStatus(sel) : "Ready for Delivery";
  const selOrder = sel ? ordOf(sel.id) : null;
  const selBal = sel ? balOf(sel) : 0;
  const act = sel ? nextAction(sel) : null;
  const flow: string[] = sel?.method === "Self Pickup" ? ["Order Ready for Delivery", "Pickup Scheduled", "Delivered"] : ["Order Ready for Delivery", "Dispatched", "In Transit", "Delivered"];
  const STEPS = ["Order & method", "Courier & tracking", "Address"];

  return (
    <div className="min-w-0">
      <PageHeader title="Delivery" subtitle="Manage ready albums, dispatch, tracking and delivery to customers." icon={<Truck className="mt-1 size-8 text-brand" />}>
        <TodayChip />
        <PrimaryButton onClick={() => { setNf(blankNF()); setStep(0); setErrs({}); setNewOpen(true); }}>New Delivery</PrimaryButton>
        <MoreButton />
      </PageHeader>
      {toast}
      <KpiRow items={kpis} />

      <div className="min-w-0 space-y-4">
        <Panel bodyClassName="p-3"><CountTabs tabs={tabs} value={tab} onChange={setTab} /></Panel>
        <Panel title="Delivery List" subtitle="Click a row to open the delivery timeline and proof of delivery" action={<button aria-label="Export" onClick={exportCsv} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-brand-soft"><Download className="size-4 text-sub" />Export</button>}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} align="left" />
            <MultiSelect className="w-40" label="Method" options={[...METHODS.filter((m) => m !== "Pickup"), "Self Pickup"]} value={fMethod} onChange={setFMethod} />
            <MultiSelect className="w-40" label="City" options={cities} value={fCity} onChange={setFCity} />
            <button onClick={() => setFOut(!fOut)} aria-pressed={fOut} className={cx("h-10 rounded-lg border px-3 text-[13px] font-semibold", fOut ? "border-brand bg-brand-soft text-brand" : "border-line bg-white")}>Outstanding only</button>
            <SearchInput className="w-64" value={q} onChange={setQ} placeholder="Search order, customer, tracking... ( / )" />
            <div className="ml-auto flex gap-2">
              <SavedViews<ViewState> storageKey="delivery" current={view} onApply={applyView} />
              <ColumnsMenu columns={COLS} hidden={hidden} onChange={setHidden} />
            </div>
          </div>
          <FilterChips chips={chips} onClearAll={clearAll} />
          {checked.size > 0 && (
            <div className="mb-3 flex items-center gap-3 rounded-xl bg-brand-soft px-4 py-2 text-[13px] font-semibold">
              {checked.size} selected
              <button onClick={() => { [...checked].forEach((id) => changeStatus(id, "Dispatched")); setChecked(new Set()); }} className="rounded-lg bg-brand px-3 py-1 text-xs font-bold text-white">Mark dispatched</button>
              <button onClick={() => { downloadCsv("selected-deliveries.csv", [["Order", "Customer", "Status"], ...items.filter((i) => checked.has(i.id)).map((d) => [d.id, d.customer, effStatus(d)])]); flash("Exported selected"); }} className="rounded-lg border border-line bg-white px-3 py-1 text-xs font-bold">Export</button>
              <button onClick={() => setChecked(new Set())} className="ml-auto text-xs font-bold text-brand">Clear</button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr>
                <th className="px-3 py-3"><input aria-label="Select all" type="checkbox" checked={rows.length > 0 && rows.every((r) => checked.has(r.id))} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
                {vis("id") && <SortTh k="id" sort={sort} onSort={setSort}>Order ID</SortTh>}
                {vis("customer") && <SortTh k="customer" sort={sort} onSort={setSort}>Customer</SortTh>}
                {vis("event") && <SortTh k="event" sort={sort} onSort={setSort}>Event</SortTh>}
                {vis("method") && <SortTh k="method" sort={sort} onSort={setSort}>Delivery Method</SortTh>}
                {vis("dispatch") && <SortTh k="dispatch" sort={sort} onSort={setSort}>Dispatch Date</SortTh>}
                {vis("tracking") && <SortTh k="tracking" sort={sort} onSort={setSort}>Tracking Number</SortTh>}
                {vis("status") && <SortTh k="status" sort={sort} onSort={setSort}>Delivery Status</SortTh>}
                {vis("city") && <SortTh k="city" sort={sort} onSort={setSort}>City</SortTh>}
                {vis("out") && <SortTh k="out" sort={sort} onSort={setSort}>Outstanding</SortTh>}
                <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub">Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((d) => {
                  const s = effStatus(d); const out = outstanding(d);
                  return (
                    <tr key={d.id} onClick={() => { setSelId(d.id); setDTab("details"); }} className={cx(trCls, "cursor-pointer", s === "Payment Hold" && "bg-rose-50/40", selId === d.id && "bg-brand-soft")}>
                      <Td><input aria-label={`Select ${d.id}`} type="checkbox" checked={checked.has(d.id)} onClick={(e) => e.stopPropagation()} onChange={() => setChecked((c) => { const n = new Set(c); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })} /></Td>
                      {vis("id") && <Td><div className="flex items-center gap-2"><Thumb seed={d.id} size={28} /><b>{d.id}</b></div></Td>}
                      {vis("customer") && <Td>{d.customer}</Td>}
                      {vis("event") && <Td>{d.event}</Td>}
                      {vis("method") && <Td>{d.method}</Td>}
                      {vis("dispatch") && <Td>{d.dispatch ? fmtDate(d.dispatch) : "—"}</Td>}
                      {vis("tracking") && <Td>{d.tracking ? <button onClick={(e) => { e.stopPropagation(); if (d.courier) window.open(`https://${d.courier.site}`, "_blank", "noopener"); flash(`Tracking ${d.tracking}${d.courier ? ` on ${d.courier.name}` : ""}`); }} className="inline-flex items-center gap-1 text-brand underline">{d.tracking}<ExternalLink className="size-3" /></button> : "—"}</Td>}
                      {vis("status") && (
                        <Td>
                          <StatusMenu<DS> label={`Change status of ${d.id}`} trigger={<Pill tone={DS_TONE[s]} dot>{s}</Pill>}
                            options={(["Ready for Delivery", "Pickup Scheduled", "Courier Pending", "Dispatched", "In Transit", "Delivered"] as DS[]).map((v) => ({ value: v, hint: (v === "Dispatched" || v === "In Transit" || v === "Delivered") && out > 0 ? "dues" : undefined }))}
                            onPick={(v) => pick(d, v)} />
                        </Td>
                      )}
                      {vis("city") && <Td>{d.city || "—"}</Td>}
                      {vis("out") && <Td className={cx("font-semibold", out > 0 ? "text-rose-600" : "text-emerald-600")}>{inr(out)}</Td>}
                      <Td>
                        <div className="flex items-center gap-2">
                          {s === "Payment Hold" && <button onClick={(e) => { e.stopPropagation(); nav(`/payments?pay=${d.id}`); }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-xs font-bold text-rose-600 hover:bg-rose-100"><Wallet className="size-3.5" />Record payment</button>}
                          <button onClick={(e) => { e.stopPropagation(); setSelId(d.id); setDTab("details"); }} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold hover:bg-brand-soft">View</button>
                          <RowMenu items={[
                            { label: "Mark dispatched", onClick: () => changeStatus(d.id, "Dispatched") },
                            { label: "Add tracking", onClick: () => { setTrackFor(d.id); setTrackVal(d.tracking); setTrackErr(""); } },
                            { label: "Print label", onClick: () => printLabel(d) },
                            { label: "Open order", onClick: () => nav(`/orders/${d.id}`) },
                          ]} />
                        </div>
                      </Td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-sub">No deliveries.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={8} total={filtered.length} onPage={setPage} noun="deliveries" />
        </Panel>
      </div>

      {/* ───── delivery drawer ───── */}
      <SlideOver open={!!sel} onClose={() => setSelId(null)} title={sel ? `Delivery ${sel.id}` : "Delivery"} width={520} footer={sel && <>
        <button onClick={() => nav(`/orders/${sel.id}`)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Open order</button>
        <button onClick={() => printLabel(sel)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Print label</button>
        {selStatus === "Payment Hold" && <button onClick={() => nav(`/payments?pay=${sel.id}`)} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-rose-600 px-4 text-sm font-bold text-white"><Wallet className="size-4" />Record payment</button>}
        {act && selStatus !== "Payment Hold" && <button onClick={() => (act.to === "Delivered" && !sel.pod && !sel.podSeed ? (setDTab("pod"), flash("Attach proof of delivery first")) : changeStatus(sel.id, act.to))} className="h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark">{act.label}</button>}
      </>}>
        {sel && selOrder && (
          <div>
            <div className="flex gap-3">
              <Thumb seed={sel.id} size={64} />
              <div className="min-w-0 flex-1"><div className="text-xs text-sub">Order ID</div><div className="flex items-center justify-between gap-2"><b className="text-lg">{sel.id}</b>
                <StatusMenu<DS> label="Change delivery status" trigger={<Pill tone={DS_TONE[selStatus]} dot>{selStatus} ▾</Pill>} options={(["Ready for Delivery", "Pickup Scheduled", "Courier Pending", "Dispatched", "In Transit", "Delivered"] as DS[]).map((v) => ({ value: v }))}
                  onPick={(v) => pick(sel, v)} /></div>
                <div className="text-[13px] font-semibold">{sel.customer}</div><div className="truncate text-xs text-sub">{sel.event} • {selOrder.size} Premium Album</div></div>
            </div>
            {selBal > 0 && PRE.includes(sel.status) && <div className="mt-3"><Banner>Payment hold: {inr(selBal)} outstanding. Dispatch is blocked until the dues are cleared - use Record payment.</Banner></div>}
            <LineTabs className="mt-3 gap-4" value={dTab} onChange={setDTab} tabs={[{ key: "details", label: "Delivery Details" }, { key: "pod", label: "Proof of Delivery" }, { key: "cust", label: "Customer Info" }]} />

            {dTab === "details" && (
              <div className="mt-3 space-y-2 text-[13px]">
                {[["Delivery Method", sel.method], ["Tracking Number", sel.tracking || "—"], ["Dispatch Date", sel.dispatch ? fmtDate(sel.dispatch) : "—"], ["Delivered On", sel.events.find((e) => e.t === "Delivered")?.at ?? "—"]].map(([l, v]) => (
                  <div key={l} className="flex justify-between gap-3"><span className="text-sub">{l}</span><span className="text-right font-semibold">{v}</span></div>
                ))}
                <div className="flex justify-between gap-3"><span className="flex items-center gap-1 text-sub"><MapPin className="size-3.5" />Address</span><span className="text-right font-semibold">{sel.addr || "Collect from studio"}{sel.addr && <button onClick={() => copy(sel.addr, "Address")} className="ml-2 inline-flex items-center gap-1 text-xs text-brand"><Copy className="size-3" />Copy</button>}</span></div>
                {sel.courier && !sel.tracking && <button onClick={() => { setTrackFor(sel.id); setTrackVal(""); setTrackErr(""); }} className="text-xs font-bold text-brand">+ Add tracking number</button>}
              </div>
            )}
            {dTab === "pod" && (
              <div className="mt-3 text-[13px]">
                {sel.pod || sel.podSeed ? (
                  <div>
                    <div className="grid grid-cols-2 gap-2">
                      {sel.pod?.photos.map((p) => <img key={p.id} src={p.url} alt="Delivery photo" className="h-32 w-full rounded-xl border border-line object-cover" />)}
                      {sel.pod?.signature.map((p) => <img key={p.id} src={p.url} alt="Signature" className="h-32 w-full rounded-xl border border-line bg-white object-contain" />)}
                    </div>
                    {!sel.pod && <div className="grid h-28 place-items-center rounded-xl bg-slate-100 text-sub"><span className="text-center"><Package className="mx-auto mb-1 size-6" />Signed receipt / delivery photo on file</span></div>}
                    <div className="mt-2 text-sub">Received by {sel.pod?.by ?? sel.customer} • {sel.pod?.at ?? sel.events.find((e) => e.t === "Delivered")?.at}</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <FieldBox label="Received by" required><input aria-label="Received by" className={inputCls} value={podBy} onChange={(e) => setPodBy(e.target.value)} placeholder="Name of the person who received the album" /></FieldBox>
                    <FieldBox label="Delivery photo"><PhotoUploader ariaLabel="Delivery photo" photos={podPhotos} onChange={setPodPhotos} label="Photo" size={80} /></FieldBox>
                    <FieldBox label="Customer signature"><PhotoUploader ariaLabel="Signature image" photos={podSig} onChange={setPodSig} multiple={false} label="Signature" size={80} /></FieldBox>
                    {podErr && <Err>{podErr}</Err>}
                    <button disabled={selBal > 0} onClick={() => submitPod(sel)} className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">Upload POD & Mark Delivered</button>
                    {selBal > 0 && <p className="text-xs text-rose-600">Blocked: {inr(selBal)} still outstanding.</p>}
                  </div>
                )}
              </div>
            )}
            {dTab === "cust" && (
              <div className="mt-3 space-y-2 text-[13px]">
                <div className="flex items-center gap-2"><Avatar name={sel.customer} size={32} /><b>{sel.customer}</b></div>
                <div className="flex justify-between"><span className="text-sub">Mobile</span><b>{sel.mobile}</b></div>
                <div className="flex justify-between"><span className="text-sub">Payment</span><b>{selOrder.pay}</b></div>
                <div className="flex justify-between"><span className="text-sub">Order Total</span><b>{inr(selOrder.total)}</b></div>
                <div className="flex justify-between"><span className="text-sub">Paid</span><b>{inr(selOrder.paid)}</b></div>
                <div className="flex justify-between"><span className="text-sub">Balance</span><b className={selBal > 0 ? "text-rose-600" : "text-emerald-600"}>{inr(selBal)}</b></div>
              </div>
            )}

            <h3 className="mb-2 mt-5 text-[15px] font-extrabold">Pickup & Delivery Timeline</h3>
            <ol className="space-y-3">
              {flow.map((t) => {
                const ev = sel.events.find((e) => e.t === t);
                return (
                  <li key={t} className="flex gap-3 text-[13px]">
                    <span className={cx("mt-1 grid size-4 place-items-center rounded-full", ev ? (t === "Delivered" || t === flow[0] ? "bg-emerald-500 text-white" : "border-2 border-brand bg-white") : "border-2 border-slate-300 bg-white")}>{ev && (t === "Delivered" || t === flow[0]) && <CheckCircle2 className="size-3" />}</span>
                    <div><div className={cx("font-semibold", !ev && "text-sub")}>{t}</div><div className="text-[11px] text-sub">{ev ? ev.at : "Pending"}</div></div>
                  </li>
                );
              })}
            </ol>

            <h3 className="mb-2 mt-5 text-[15px] font-extrabold">Courier Details</h3>
            {sel.courier ? (
              <div className="flex items-center gap-3 text-[13px]"><span className="grid size-12 place-items-center rounded-lg bg-rose-50 text-xs font-extrabold text-rose-600">{sel.courier.name.slice(0, 4).toUpperCase()}</span>
                <div><b>{sel.courier.name}</b><div className="text-xs text-sub">{sel.courier.site} | {sel.courier.phone}</div></div><button aria-label="Copy courier phone" onClick={() => copy(sel.courier!.phone, "Courier phone")} className="ml-auto"><Copy className="size-4 text-sub" /></button></div>
            ) : <div className="text-[13px] text-sub">{sel.method === "Self Pickup" ? "Self pickup - no courier assigned." : "No courier assigned."}</div>}
          </div>
        )}
      </SlideOver>

      {/* ───── new delivery wizard ───── */}
      <SlideOver open={newOpen} onClose={() => setNewOpen(false)} title="New Delivery" width={520} footer={<>
        {step > 0 ? <button onClick={() => setStep(step - 1)} className="mr-auto inline-flex h-10 items-center gap-1 px-3 text-sm font-bold text-sub"><ChevronLeft className="size-4" />Back</button> : <button onClick={() => setNewOpen(false)} className="mr-auto h-10 px-3 text-sm font-bold text-sub">Cancel</button>}
        {step < 2 ? <PrimaryButton icon={ChevronRight} onClick={next}>Next</PrimaryButton> : <PrimaryButton icon={Truck} onClick={createDelivery}>Create Delivery</PrimaryButton>}
      </>}>
        <Steps steps={STEPS} step={step} />
        {step === 0 && (
          <>
            <FieldBox label="QC-passed order" required>
              <Combobox error={!!errs.order} placeholder="Search order or customer…" value={nf.order} onChange={pickOrder} options={eligible.map(orderOpt)} />
              <Err>{errs.order}</Err>
              {eligible.length === 0 && <p className="mt-1 text-xs text-sub">No orders are ready. Orders appear here after QC passes them.</p>}
            </FieldBox>
            {nOrder && (
              <div className="mb-4 rounded-xl border border-line bg-slate-50/60 p-3 text-xs text-sub">
                <b className="text-sm text-ink">{nOrder.customer}</b> · {nOrder.event} · {nOrder.size} · {nOrder.pages} pages
                <div className="mt-1">Balance <b className={nOrder.total - nOrder.paid > 0 ? "text-rose-600" : "text-emerald-600"}>{inr(nOrder.total - nOrder.paid)}</b></div>
              </div>
            )}
            {nOrder && nOrder.total - nOrder.paid > 0 && <div className="mb-4"><Banner tone="amber">{inr(nOrder.total - nOrder.paid)} is unpaid - the delivery will be created on Payment Hold until the dues are recorded.</Banner></div>}
            <FieldBox label="Delivery method" required><Segmented value={nf.method} options={METHODS} onChange={(m) => setN({ method: m })} /></FieldBox>
            {nf.method !== "Pickup" && <FieldBox label="Planned dispatch date" hint="Optional. Leave empty to dispatch later."><DateField label="Dispatch date" value={nf.dispatch} min={TODAY_ISO} error={!!errs.dispatch} onChange={(v) => setN({ dispatch: v })} /><Err>{errs.dispatch}</Err></FieldBox>}
          </>
        )}
        {step === 1 && (
          <>
            {nf.method === "Courier" && (
              <>
                <FieldBox label="Courier"><Segmented value={nf.courier} options={COURIERS.map((c) => c.name)} onChange={(c) => setN({ courier: c })} /></FieldBox>
                <Field label="Tracking number" hint="Generate a reference or paste the AWB from the courier.">
                  <div className="flex gap-2"><input aria-label="Tracking number" className={cx(inputCls, errs.tracking && "border-rose-400")} value={nf.tracking} onChange={(e) => setN({ tracking: e.target.value })} /><button type="button" onClick={genTracking} className="h-10 shrink-0 rounded-lg border border-line px-3 text-xs font-bold text-brand">Generate</button></div>
                  <Err>{errs.tracking}</Err>
                </Field>
              </>
            )}
            {nf.method === "Third-party" && (
              <>
                <Field label="Provider" required><input aria-label="Provider" className={cx(inputCls, errs.provider && "border-rose-400")} value={nf.provider} onChange={(e) => setN({ provider: e.target.value })} placeholder="e.g. VRL Logistics" /><Err>{errs.provider}</Err></Field>
                <Field label="Reference / LR no. (optional)"><input className={inputCls} value={nf.tracking} onChange={(e) => setN({ tracking: e.target.value })} /></Field>
              </>
            )}
            {nf.method === "Company delivery" && <FieldBox label="Driver / delivery executive"><Combobox value={nf.driver} onChange={(v) => setN({ driver: v })} options={strOpts(ASSIGNEES)} /></FieldBox>}
            {nf.method === "Pickup" && <FieldBox label="Pickup slot"><Segmented value={nf.slot} options={["Morning (10-1)", "Afternoon (2-5)", "Evening (5-8)"]} onChange={(v) => setN({ slot: v })} /></FieldBox>}
          </>
        )}
        {step === 2 && (nf.method === "Pickup" ? (
          <div className="space-y-3 text-[13px]">
            <Banner tone="blue">Customer collects from the studio - no shipping address needed.</Banner>
            <div className="rounded-xl border border-line p-4"><b>AlbumPro Studio</b><br />123 Creative Street, KPHB, Hyderabad - 500072<br /><span className="text-sub">Slot: {nf.slot}</span></div>
          </div>
        ) : (
          <>
            <Field label="Contact person"><input className={inputCls} value={nf.contact} onChange={(e) => setN({ contact: e.target.value })} /></Field>
            <Field label="Contact number" required><input aria-label="Contact number" className={cx(inputCls, errs.phone && "border-rose-400")} value={nf.phone} onChange={(e) => setN({ phone: e.target.value })} /><Err>{errs.phone}</Err></Field>
            <div className="grid grid-cols-[130px_1fr] gap-3">
              <Field label="Pincode" required><input aria-label="Pincode" inputMode="numeric" className={cx(inputCls, errs.pin && "border-rose-400")} value={nf.pin} onChange={(e) => onPin(e.target.value)} placeholder="560001" /><Err>{errs.pin}</Err></Field>
              <Field label="City / State" required><input aria-label="City" className={cx(inputCls, errs.city && "border-rose-400", nf.city && PINCODES[nf.pin] && "bg-emerald-50")} value={nf.city} onChange={(e) => setN({ city: e.target.value })} placeholder="Auto-filled from pincode" /><Err>{errs.city}</Err></Field>
            </div>
            <p className="-mt-2 mb-3 text-[11px] text-sub">Try {Object.keys(PINCODES).slice(0, 4).join(", ")}…</p>
            <Field label="Street address" required><textarea aria-label="Address" className={cx("h-20 w-full rounded-lg border p-3 text-sm outline-none focus:border-brand", errs.line ? "border-rose-400" : "border-line")} value={nf.line} onChange={(e) => setN({ line: e.target.value })} placeholder="House no., street, landmark" /><Err>{errs.line}</Err></Field>
          </>
        ))}
      </SlideOver>

      <SlideOver open={!!trackFor} onClose={() => setTrackFor(null)} title={`Add tracking - ${trackFor ?? ""}`} footer={<button onClick={() => { if (!trackVal.trim()) { setTrackErr("Tracking number is required"); return; } patchItem(trackFor!, { tracking: trackVal.trim() }); flash("Tracking number saved"); setTrackFor(null); }} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Save</button>}>
        <Field label="Tracking number" required><input aria-label="Tracking" className={inputCls} value={trackVal} onChange={(e) => setTrackVal(e.target.value)} />{trackErr && <span className="text-xs text-rose-600">{trackErr}</span>}</Field>
      </SlideOver>
    </div>
  );
}

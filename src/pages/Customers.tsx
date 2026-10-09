import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useToast } from "../components/Toast";
import { ActionMenu } from "../components/ActionMenu";
import { Users, ShieldCheck, Crown, Phone, Repeat, IndianRupee, Mail, MapPin, CalendarDays, Tag, X, MoreHorizontal, ChevronDown, StickyNote, Pencil, RotateCcw, Check, AlertCircle, Plus, Undo2 } from "lucide-react";
import {
  PageHeader, PrimaryButton, KpiRow, Panel, Pill, Avatar, Thumb, SearchInput, LineTabs, Pagination,
  tableCls, Th, Td, trCls, cx, OutlineButton, MoreButton, SlideOver, Field, inputCls, type Kpi,
} from "../components/ui";
import { MultiSelect, DateRangePicker, FilterChips, SavedViews, ColumnsMenu, SortTh, sortRows, presetRange, inRange, fmtShort, type DateRange, type SortState } from "../components/controls";
import { useNewOrder } from "../components/NewOrderWizard";
import { CUSTOMERS, ORDERS, stageLabel, stageTone, type Customer } from "../lib/data";
import { inr, fmtDate, TODAY } from "../lib/format";
import { useStore, notify, useSlashFocus, packRange, unpackRange } from "../lib/store";

type Tab = "all" | "active" | "vip" | "new" | "inactive";

// Fallback history when a customer has no matching orders in ORDERS.
const HISTORY: { id: string; title: string; date: string; amt: number }[] = [
  { id: "ORD100728", title: "Wedding Album - Raj & Priya", date: "2026-10-12", amt: 18500 },
  { id: "ORD100701", title: "Pre Wedding Album", date: "2026-09-25", amt: 22000 },
  { id: "ORD100665", title: "Reception Album", date: "2026-08-10", amt: 26300 },
];

/* ───────────── notes / follow-ups (module-level so they survive navigation) ───────────── */
interface Follow { id: number; text: string; due: string; done: boolean }
const NOTES: Record<string, string[]> = {};
const FOLLOWS: Record<string, Follow[]> = {};
let fid = 1;
const notesOf = (id: string) => (NOTES[id] ??= ["Discussed new album design samples. Client liked the premium matte finish. Follow up next week for final approval."]);
const followsOf = (id: string) => (FOLLOWS[id] ??= [
  { id: fid++, text: "Call about final approval", due: "2026-10-07", done: false },
  { id: fid++, text: "Share new album samples", due: "2026-10-10", done: false },
]);

/* ───────────── lookups ───────────── */
const PIN_PREFIX: Record<string, [string, string]> = {
  "400": ["Mumbai", "Maharashtra"], "411": ["Pune", "Maharashtra"], "560": ["Bengaluru", "Karnataka"], "570": ["Mysuru", "Karnataka"], "110": ["Delhi", "Delhi"],
  "500": ["Hyderabad", "Telangana"], "600": ["Chennai", "Tamil Nadu"], "641": ["Coimbatore", "Tamil Nadu"], "682": ["Kochi", "Kerala"], "226": ["Lucknow", "Uttar Pradesh"],
};
const GST_STATE: Record<string, string> = { "07": "Delhi", "27": "Maharashtra", "29": "Karnataka", "36": "Telangana", "33": "Tamil Nadu", "09": "Uttar Pradesh", "32": "Kerala", "24": "Gujarat", "06": "Haryana", "19": "West Bengal", "08": "Rajasthan", "23": "Madhya Pradesh" };
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const TAG_OPTIONS = ["Wedding", "Pre Wedding", "Events", "Corporate", "Wholesale", "Bulk", "Prompt payer"];
const digits = (s: string) => s.replace(/\D/g, "");
const fmtMobile = (s: string) => { const d = digits(s).slice(-10); return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : s.trim(); };

const COLS = [
  { key: "id", label: "Customer ID" }, { key: "name", label: "Customer Name" }, { key: "studio", label: "Studio / Company" }, { key: "mobile", label: "Mobile" },
  { key: "email", label: "Email" }, { key: "city", label: "City" }, { key: "type", label: "Type" }, { key: "orders", label: "Active Orders" },
  { key: "lifetime", label: "Lifetime Value" }, { key: "lastOrder", label: "Last Order" },
];
const TypePill = ({ t }: { t: Customer["type"] }) => <Pill tone={t === "VIP" ? "amber" : t === "New" ? "blue" : "slate"} icon={t === "VIP" ? Crown : undefined}>{t}</Pill>;
const EMPTY = { name: "", studio: "", mobile: "", whatsapp: "", email: "", address: "", city: "", state: "", pin: "", gstin: "", notes: "", tags: [] as string[] };
const Err = ({ children }: { children?: string }) => (children ? <p role="alert" className="mt-1 flex items-center gap-1 text-xs font-semibold text-rose-600"><AlertCircle className="size-3.5" />{children}</p> : null);
const ordersOf = (c: Customer) => ORDERS.filter((o) => o.customer === c.name || o.customer === c.studio);

interface ViewState { q: string; type: string[]; city: string[]; status: string[]; tags: string[]; dues: boolean; segment: string | null; range: ReturnType<typeof packRange>; hidden: string[]; sort: SortState }

export default function Customers() {
  useStore();
  const all = CUSTOMERS;
  const newOrder = useNewOrder();
  const [toast, show] = useToast();
  const [adding, setAdding] = useState(false);
  const [sp, setSp] = useSearchParams();
  useEffect(() => { if (sp.get("new")) { setAdding(true); setSp({}, { replace: true }); } }, [sp, setSp]);
  const [editId, setEditId] = useState<string | null>(null);
  const [segment, setSegment] = useState<string | null>(null);
  const [segOpen, setSegOpen] = useState(false);
  const [duesOnly, setDuesOnly] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [type, setType] = useState<string[]>([]);
  const [city, setCity] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [tagF, setTagF] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>(() => presetRange("All Time"));
  const [hidden, setHidden] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(CUSTOMERS[0]!.id);
  const [dtab, setDtab] = useState<"history" | "notes" | "follow">("history");
  const [draft, setDraft] = useState("");
  const [fdraft, setFdraft] = useState("");
  const [fdate, setFdate] = useState("2026-10-08");
  const [f, setF] = useState(EMPTY);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [autoState, setAutoState] = useState(true);
  const searchWrap = useRef<HTMLDivElement>(null);
  useSlashFocus(searchWrap);

  const closeForm = () => { setAdding(false); setEditId(null); setErrs({}); setF(EMPTY); };
  const openEdit = (c: Customer) => { setF({ ...EMPTY, name: c.name, studio: c.studio, mobile: c.mobile, email: c.email, city: c.city, state: c.state, gstin: c.gstin ?? "", address: c.address ?? "", pin: c.pin ?? "", whatsapp: c.whatsapp ?? "", notes: c.notes ?? "", tags: [...c.tags] }); setErrs({}); setEditId(c.id); };

  // live form intelligence
  const dup = useMemo(() => { const d = digits(f.mobile).slice(-10); return d.length >= 10 ? CUSTOMERS.find((c) => c.id !== editId && digits(c.mobile).slice(-10) === d) ?? null : null; }, [f.mobile, editId]);
  const gst = f.gstin.trim().toUpperCase();
  const gstErr = gst && !GSTIN_RE.test(gst) ? (gst.length < 15 ? `GSTIN needs 15 characters (${gst.length}/15)` : "Invalid GSTIN format (e.g. 27ABCDE1234F1Z5)") : "";
  const setPin = (pin: string) => {
    const hit = PIN_PREFIX[pin.slice(0, 3)];
    setF((x) => ({ ...x, pin, ...(pin.length === 6 && hit ? { city: hit[0], state: hit[1] } : {}) }));
  };
  const setGstin = (v: string) => {
    const g = v.toUpperCase();
    const st = GST_STATE[g.slice(0, 2)];
    setF((x) => ({ ...x, gstin: g, ...(st && autoState ? { state: st } : {}) }));
  };

  const save = (thenOrder = false) => {
    const e: Record<string, string> = {};
    if (f.studio.trim().length < 2) e.studio = "Enter 2–150 characters";
    if (!/^\+?[0-9 ]{10,14}$/.test(f.mobile.trim())) e.mobile = "Enter a valid 10-digit mobile number";
    else if (dup) e.mobile = `Duplicate — ${dup.studio} already uses this mobile`;
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = "Invalid email address";
    if (gstErr) e.gstin = gstErr;
    if (f.pin && !/^[1-9][0-9]{5}$/.test(f.pin)) e.pin = "PIN must be 6 digits";
    setErrs(e);
    if (Object.keys(e).length) return;
    const patch = { name: f.name.trim() || f.studio.trim(), studio: f.studio.trim(), mobile: fmtMobile(f.mobile), email: f.email.trim(), city: f.city.trim(), state: f.state.trim(), gstin: f.gstin.toUpperCase() || undefined, address: f.address.trim() || undefined, pin: f.pin || undefined, whatsapp: f.whatsapp || undefined, notes: f.notes || undefined, tags: f.tags };
    if (editId) {
      Object.assign(CUSTOMERS.find((x) => x.id === editId)!, patch); notify();
      show(`${patch.studio} updated`); closeForm(); return;
    }
    const nextNum = Math.max(...CUSTOMERS.map((c) => Number(c.id.replace("IDC", "")))) + 1;
    const c: Customer = { id: `IDC${String(nextNum).padStart(6, "0")}`, type: "New", status: "Active", activeOrders: 0, lifetime: 0, lastOrder: "2026-10-03", since: "2026-10-03", dues: 0, ...patch };
    CUSTOMERS.unshift(c); notify();
    setActiveId(c.id); setPage(1); setTab("all"); closeForm(); show(`Customer ${c.studio} added`);
    if (thenOrder) newOrder.open({ customerId: c.id });
  };

  const inTab = (c: Customer, t: Tab) => t === "all" || (t === "active" ? c.status === "Active" : t === "inactive" ? c.status === "Inactive" : t === "vip" ? c.type === "VIP" : c.type === "New");
  const repeat = (c: Customer) => Math.max(c.activeOrders, ordersOf(c).length) >= 2;
  const base = all.filter((c) => {
    const s = q.trim().toLowerCase();
    if (s && ![c.name, c.mobile, c.email, c.studio, c.id].some((v) => v.toLowerCase().includes(s))) return false;
    if (type.length && !type.includes(c.type)) return false;
    if (city.length && !city.includes(c.city)) return false;
    if (status.length && !status.includes(c.status)) return false;
    if (tagF.length && !tagF.some((t) => c.tags.includes(t))) return false;
    if (duesOnly && !(c.dues > 0)) return false;
    if (!inRange(c.lastOrder, range)) return false;
    if (segment === "VIP" && c.type !== "VIP") return false;
    if (segment === "New" && c.type !== "New") return false;
    if (segment === "Repeat" && !repeat(c)) return false;
    if (segment === "High dues" && !(c.dues > 0)) return false;
    return true;
  });
  const list = sortRows(base.filter((c) => inTab(c, tab)), sort, (c, k) => k === "orders" ? c.activeOrders : k === "lifetime" ? c.lifetime : ((c as unknown as Record<string, string>)[k] ?? "").toLowerCase());
  const rows = list.slice((page - 1) * pageSize, page * pageSize);
  const cur = all.find((c) => c.id === activeId) ?? null;
  const allChecked = rows.length > 0 && rows.every((c) => checked.has(c.id));
  const tabs: { key: Tab; label: string }[] = [{ key: "all", label: "All Customers" }, { key: "active", label: "Active" }, { key: "vip", label: "VIP" }, { key: "new", label: "New" }, { key: "inactive", label: "Inactive" }];
  const setStatusFor = (ids: string[], st: Customer["status"]) => { CUSTOMERS.forEach((c) => { if (ids.includes(c.id)) c.status = st; }); notify(); show(`${ids.length} customer${ids.length > 1 ? "s" : ""} ${st === "Active" ? "activated" : "deactivated"}`); };
  const show_ = (k: string) => !hidden.includes(k);
  const th = (k: string, label: string) => show_(k) && <SortTh key={k} k={k} sort={sort} onSort={(s) => { setSort(s); setPage(1); }}>{label}</SortTh>;
  const cities = Array.from(new Set(CUSTOMERS.map((c) => c.city).filter(Boolean))).sort();

  const kpis: Kpi[] = [
    { label: "Total Customers", value: all.length, delta: 12, icon: Users, tone: "blue" },
    { label: "Active Customers", value: all.filter((c) => c.status === "Active").length, delta: 8, icon: ShieldCheck, tone: "green" },
    { label: "VIP Customers", value: all.filter((c) => c.type === "VIP").length, delta: 22, icon: Crown, tone: "amber" },
    { label: "Pending Follow-ups", value: all.reduce((a, c) => a + followsOf(c.id).filter((x) => !x.done).length, 0), delta: -15, icon: Phone, tone: "pink" },
    { label: "Repeat Customers", value: all.filter(repeat).length, delta: 18, icon: Repeat, tone: "violet" },
    { label: "Outstanding Dues", value: inr(all.reduce((a, c) => a + c.dues, 0)), delta: 12, icon: IndianRupee, tone: "red", invert: true },
  ];

  const reset = () => { setQ(""); setType([]); setCity([]); setStatus([]); setTagF([]); setDuesOnly(false); setSegment(null); setRange(presetRange("All Time")); setPage(1); };
  const chips = [
    ...(range.preset !== "All Time" ? [{ label: `Last order: ${range.preset === "Custom" ? `${fmtShort(range.from)} – ${fmtShort(range.to)}` : range.preset}`, onRemove: () => setRange(presetRange("All Time")) }] : []),
    ...([["Type", type, setType], ["City", city, setCity], ["Status", status, setStatus], ["Tag", tagF, setTagF]] as [string, string[], (v: string[]) => void][]).filter(([, v]) => v.length).map(([l, v, set]) => ({ label: `${l}: ${v.join(", ")}`, onRemove: () => set([]) })),
    ...(segment ? [{ label: `Segment: ${segment}`, onRemove: () => setSegment(null) }] : []),
    ...(duesOnly ? [{ label: "Has dues", onRemove: () => setDuesOnly(false) }] : []),
    ...(q.trim() ? [{ label: `Search: “${q.trim()}”`, onRemove: () => setQ("") }] : []),
  ];
  const view: ViewState = { q, type, city, status, tags: tagF, dues: duesOnly, segment, range: packRange(range), hidden, sort };
  const applyView = (v: ViewState) => { setQ(v.q); setType(v.type); setCity(v.city); setStatus(v.status); setTagF(v.tags); setDuesOnly(v.dues); setSegment(v.segment); setRange(unpackRange(v.range)); setHidden(v.hidden); setSort(v.sort); setPage(1); show("View applied"); };
  const fl = (set: (v: string[]) => void) => (v: string[]) => { set(v); setPage(1); };

  const myOrders = cur ? ordersOf(cur) : [];
  const myNotes = cur ? notesOf(cur.id) : [];
  const myFollow = cur ? followsOf(cur.id) : [];
  const openFollow = myFollow.filter((x) => !x.done).length;

  return (
    <div>
      <PageHeader title="Customers" subtitle="Manage your studio clients, track orders, and build long-term relationships.">
        <DateRangePicker value={range} onChange={(r) => { setRange(r); setPage(1); }} />
        <PrimaryButton onClick={() => { setF(EMPTY); setErrs({}); setAdding(true); }}>Add Customer</PrimaryButton>
        <MoreButton />
      </PageHeader>
      <KpiRow items={kpis} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel bodyClassName="!p-4">
          <div className="flex items-center justify-between gap-3">
            <LineTabs<Tab> className="!border-0" value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={tabs.map((t) => ({ ...t, count: base.filter((c) => inTab(c, t.key)).length }))} />
            <div className="relative">
              <button onClick={() => setSegOpen(!segOpen)} className="inline-flex items-center gap-1 text-xs font-bold text-brand">{segment ? `Segment: ${segment}` : "View Segments"} <ChevronDown className="size-3.5" /></button>
              {segOpen && (
                <div className="absolute right-0 top-7 z-30 w-44 rounded-xl border border-line bg-white p-1.5 shadow-xl">
                  {[null, "VIP", "New", "Repeat", "High dues"].map((sg) => (
                    <button key={sg ?? "all"} onClick={() => { setSegment(sg); setSegOpen(false); setPage(1); show(sg ? `Segment applied: ${sg}` : "Segment cleared"); }} className={cx("block w-full rounded-lg px-3 py-2 text-left text-[13px] font-semibold hover:bg-brand-soft", segment === sg && "bg-brand-soft text-brand")}>{sg ?? "All customers"}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-line pt-4">
            <div ref={searchWrap} className="min-w-[220px] flex-1"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search customer name, mobile, email or company...  ( / )" /></div>
            <MultiSelect className="w-36" label="Customer Type" options={["VIP", "Regular", "New"]} value={type} onChange={fl(setType)} />
            <MultiSelect className="w-28" label="City" options={cities} value={city} onChange={fl(setCity)} />
            <MultiSelect className="w-28" label="Status" options={["Active", "Inactive"]} value={status} onChange={fl(setStatus)} />
            <MultiSelect className="w-28" label="Tags" options={TAG_OPTIONS} value={tagF} onChange={fl(setTagF)} />
            <button aria-pressed={duesOnly} onClick={() => { setDuesOnly(!duesOnly); setPage(1); }} className={cx("inline-flex h-10 items-center rounded-lg border px-3 text-[13px] font-semibold", duesOnly ? "border-rose-400 bg-rose-50 text-rose-600" : "border-line bg-white")}>Has dues</button>
            <SavedViews<ViewState> storageKey="customers" current={view} onApply={applyView} />
            <ColumnsMenu columns={COLS} hidden={hidden} onChange={setHidden} />
            <button onClick={reset} className="inline-flex items-center gap-1.5 text-[13px] font-bold text-brand"><RotateCcw className="size-4" />Reset</button>
          </div>
          <div className="mt-3"><FilterChips chips={chips} onClearAll={reset} /></div>
          {checked.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft px-3 py-2 text-[13px]">
              <b>{checked.size} selected</b>
              <OutlineButton onClick={() => { CUSTOMERS.forEach((c) => { if (checked.has(c.id)) c.type = "VIP"; }); notify(); show(`${checked.size} marked VIP`); setChecked(new Set()); }}>Mark VIP</OutlineButton>
              <OutlineButton onClick={() => { setStatusFor([...checked], "Inactive"); setChecked(new Set()); }}>Deactivate</OutlineButton>
              <OutlineButton onClick={() => { setStatusFor([...checked], "Active"); setChecked(new Set()); }}>Activate</OutlineButton>
              <button onClick={() => setChecked(new Set())} className="ml-auto text-xs font-bold text-brand">Clear</button>
            </div>
          )}
          <div className="mt-1 overflow-x-auto">
            <table className={tableCls}>
              <thead><tr>
                <Th><input type="checkbox" checked={allChecked} onChange={() => setChecked((p) => { const n = new Set(p); rows.forEach((c) => allChecked ? n.delete(c.id) : n.add(c.id)); return n; })} /></Th>
                {th("id", "Customer ID")}{th("name", "Customer Name")}{th("studio", "Studio / Company")}{th("mobile", "Mobile")}{th("email", "Email")}{th("city", "City")}{th("type", "Type")}
                {th("orders", "Active Orders")}{th("lifetime", "Lifetime Value")}{th("lastOrder", "Last Order")}<Th className="text-right">Actions</Th>
              </tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} data-row={c.id} onClick={() => setActiveId(c.id)} className={cx(trCls, "cursor-pointer", activeId === c.id && "bg-brand-soft")}>
                    <Td><input type="checkbox" checked={checked.has(c.id)} onClick={(e) => e.stopPropagation()} onChange={() => setChecked((p) => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} /></Td>
                    {show_("id") && <Td className="text-brand">{c.id}</Td>}
                    {show_("name") && <Td><span className="inline-flex items-center gap-2"><Avatar name={c.name} size={28} /><span className="font-semibold text-brand">{c.name}</span></span></Td>}
                    {show_("studio") && <Td>{c.studio}</Td>}{show_("mobile") && <Td>{c.mobile}</Td>}{show_("email") && <Td className="text-brand">{c.email}</Td>}{show_("city") && <Td>{c.city}</Td>}{show_("type") && <Td><TypePill t={c.type} /></Td>}
                    {show_("orders") && <Td className="text-center"><span className="inline-grid size-6 place-items-center rounded-md bg-brand-soft font-bold text-brand">{c.activeOrders}</span></Td>}
                    {show_("lifetime") && <Td className="font-bold">{inr(c.lifetime)}</Td>}{show_("lastOrder") && <Td>{fmtDate(c.lastOrder)}</Td>}
                    <Td className="text-right"><ActionMenu trigger={<MoreHorizontal className="size-4" />} items={[
                      { label: "View", onClick: () => { setActiveId(c.id); setDtab("history"); } },
                      { label: "Edit", onClick: () => openEdit(c) },
                      { label: "Create Order", onClick: () => newOrder.open({ customerId: c.id }) },
                      { label: "Add Note", onClick: () => { setActiveId(c.id); setDtab("notes"); } },
                      { label: c.status === "Active" ? "Deactivate" : "Activate", danger: c.status === "Active", onClick: () => setStatusFor([c.id], c.status === "Active" ? "Inactive" : "Active") },
                    ]} /></Td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={12} className="py-10 text-center text-sub">No customers found.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={list.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="customers" />
        </Panel>

        {cur ? (
          <Panel bodyClassName="!p-5" className="xl:sticky xl:top-4">
            <div className="flex items-start gap-3">
              <Thumb seed={cur.name} size={64} rounded="rounded-full" />
              <div className="min-w-0 flex-1">
                <Pill tone={cur.status === "Active" ? "green" : "slate"} dot>{cur.status}</Pill>
                <h3 className="mt-1 text-xl font-extrabold">{cur.name}</h3>
                <div className="text-[13px] text-sub">{cur.studio}</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="flex items-center gap-2">
                  <button onClick={() => openEdit(cur)} aria-label="Edit customer" className="inline-flex h-7 items-center gap-1 rounded-lg border border-line px-2 text-xs font-bold text-brand hover:bg-brand-soft"><Pencil className="size-3" />Edit</button>
                  <button onClick={() => setActiveId(null)} aria-label="Close" className="text-sub"><X className="size-4" /></button>
                </span>
                {cur.type === "VIP" && <Pill tone="amber" icon={Crown}>VIP Customer</Pill>}
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-[13px]">
              <li className="flex items-center gap-2.5"><Phone className="size-4 text-sub" />{cur.mobile}</li>
              <li className="flex items-center gap-2.5"><Mail className="size-4 text-sub" />{cur.email || "—"}</li>
              <li className="flex items-center gap-2.5"><MapPin className="size-4 text-sub" />{[cur.city, cur.state].filter(Boolean).join(", ") || "—"}{cur.pin ? ` · ${cur.pin}` : ""}</li>
              {cur.gstin && <li className="flex items-center gap-2.5 font-mono text-xs"><span className="w-4 text-center text-[10px] font-bold text-sub">GST</span>{cur.gstin}</li>}
              <li className="flex items-center gap-2.5"><CalendarDays className="size-4 text-sub" />Customer since {fmtDate(cur.since)}</li>
              <li className="flex flex-wrap items-center gap-2"><Tag className="size-4 text-sub" />{cur.tags.length ? cur.tags.map((t) => <Pill key={t} tone="blue">{t}</Pill>) : <span className="text-sub">No tags</span>}</li>
            </ul>
            <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-xl border border-line py-3 text-center">
              <div><div className="text-[11px] text-sub">Total Orders</div><div className="text-lg font-extrabold text-brand">{myOrders.length || cur.activeOrders * 6 || 4}</div></div>
              <div><div className="text-[11px] text-sub">Lifetime Value</div><div className="text-lg font-extrabold">{inr(cur.lifetime)}</div></div>
              <div><div className="text-[11px] text-sub">Pending Dues</div><div className={cx("text-lg font-extrabold", cur.dues ? "text-rose-600" : "text-emerald-600")}>{inr(cur.dues)}</div></div>
            </div>
            <div className="mt-3 flex gap-2"><PrimaryButton icon={Plus} onClick={() => newOrder.open({ customerId: cur.id })}>New Order</PrimaryButton></div>
            <LineTabs<"history" | "notes" | "follow"> className="mt-4" value={dtab} onChange={setDtab} tabs={[{ key: "history", label: "Order History" }, { key: "notes", label: `Notes (${myNotes.length})` }, { key: "follow", label: `Follow-ups (${openFollow})` }]} />
            {dtab === "history" && (
              <ul className="mt-3 space-y-2.5">
                {myOrders.length > 0 ? myOrders.slice(0, 8).map((o, i) => (
                  <li key={o.id}>
                    <Link to={`/orders/${o.id}`} className="flex items-center gap-3 rounded-lg text-xs hover:bg-brand-soft/60">
                      <Thumb seed={i + cur.name.length} size={38} />
                      <div className="min-w-0 flex-1"><div className="font-bold">{o.id}</div><div className="truncate text-sub">{o.event} · {o.workflow}</div></div>
                      <div className="text-sub">{fmtDate(o.pendingAt)}</div><div className="font-bold">{inr(o.total)}</div><Pill tone={stageTone(o.stage)}>{stageLabel(o.stage)}</Pill>
                    </Link>
                  </li>
                )) : HISTORY.map((h, i) => (
                  <li key={h.id} className="flex items-center gap-3 text-xs">
                    <Thumb seed={i + cur.name.length} size={38} />
                    <div className="min-w-0 flex-1"><div className="font-bold">{h.id}</div><div className="truncate text-sub">{h.title}</div></div>
                    <div className="text-sub">{fmtDate(h.date)}</div><div className="font-bold">{inr(h.amt)}</div><Pill tone="green">Delivered</Pill>
                  </li>
                ))}
              </ul>
            )}
            {dtab === "notes" && (
              <div className="mt-3 space-y-2">
                {myNotes.map((n, i) => <div key={i} className="rounded-xl bg-violet-50 p-3 text-xs"><div className="mb-1 flex items-center gap-1.5 font-bold text-violet-700"><StickyNote className="size-3.5" />Note</div>{n}<div className="mt-1 text-sub">- by Admin</div></div>)}
                <div className="flex gap-2">
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note…" className="h-9 min-w-0 flex-1 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand" />
                  <button onClick={() => { if (draft.trim()) { NOTES[cur.id] = [draft.trim(), ...myNotes]; notify(); setDraft(""); show("Note added"); } }} className="h-9 rounded-lg bg-brand px-3 text-xs font-bold text-white">Add</button>
                </div>
              </div>
            )}
            {dtab === "follow" && (
              <div className="mt-3 space-y-2 text-xs">
                <ul className="space-y-2">
                  {myFollow.map((x) => (
                    <li key={x.id} className={cx("flex items-center gap-2 rounded-lg border border-line p-2.5", x.done && "bg-slate-50 text-sub")}>
                      <button aria-label={x.done ? "Reopen follow-up" : "Complete follow-up"} onClick={() => { x.done = !x.done; notify(); show(x.done ? "Follow-up completed" : "Follow-up reopened"); }} className={cx("grid size-5 shrink-0 place-items-center rounded-full border", x.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 hover:border-brand")}>{x.done && <Check className="size-3" />}</button>
                      <span className={cx("min-w-0 flex-1", x.done && "line-through")}>{x.text}</span>
                      <span className={cx("whitespace-nowrap font-semibold", !x.done && new Date(x.due) < TODAY ? "text-rose-600" : "text-sub")}>{fmtDate(x.due)}</span>
                      {x.done && <button aria-label="Reopen" onClick={() => { x.done = false; notify(); show("Follow-up reopened"); }} className="text-sub hover:text-brand"><Undo2 className="size-3.5" /></button>}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <input value={fdraft} onChange={(e) => setFdraft(e.target.value)} placeholder="Add a follow-up…" className="h-9 min-w-0 flex-1 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand" />
                  <input type="date" aria-label="Follow-up date" value={fdate} onChange={(e) => setFdate(e.target.value)} className="h-9 w-[130px] rounded-lg border border-line px-2 text-xs outline-none focus:border-brand" />
                  <button onClick={() => { if (fdraft.trim() && fdate) { myFollow.unshift({ id: fid++, text: fdraft.trim(), due: fdate, done: false }); notify(); setFdraft(""); show("Follow-up added"); } }} className="h-9 rounded-lg bg-brand px-3 text-xs font-bold text-white">Add</button>
                </div>
              </div>
            )}
          </Panel>
        ) : (
          <Panel><p className="py-10 text-center text-sm text-sub">Select a customer to view details.</p></Panel>
        )}
      </div>

      <SlideOver open={adding || editId !== null} onClose={closeForm} title={editId ? "Edit Customer" : "Add Customer"} width={480}
        footer={<><OutlineButton className="!h-10" onClick={closeForm}>Cancel</OutlineButton>{!editId && <OutlineButton className="!h-11" onClick={() => save(true)}>Save &amp; create order</OutlineButton>}<PrimaryButton icon={Check} onClick={() => save(false)}>Save Customer</PrimaryButton></>}>
        <Field label="Customer / Studio Name" required><input aria-label="Studio name" className={cx(inputCls, errs.studio && "border-rose-400")} value={f.studio} onChange={(e) => setF({ ...f, studio: e.target.value })} /><Err>{errs.studio}</Err></Field>
        <Field label="Contact Person"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mobile Number" required>
          <input aria-label="Mobile number" inputMode="tel" className={cx(inputCls, (errs.mobile || dup) && "border-rose-400")} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} placeholder="98765 43210" />
          {dup && (
            <p data-testid="dup-warning" className="mt-1.5 flex flex-wrap items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800">
              <AlertCircle className="size-3.5" />A customer with this mobile exists — <button type="button" className="font-extrabold text-brand underline" onClick={() => { setActiveId(dup.id); setDtab("history"); setTab("all"); reset(); closeForm(); }}>open {dup.studio}</button>
            </p>
          )}
          {!dup && <Err>{errs.mobile}</Err>}
        </Field>
        <Field label="WhatsApp Number">
          <input className={inputCls} value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} />
          <label className="mt-1.5 flex items-center gap-1.5 text-xs text-sub"><input type="checkbox" checked={!!f.whatsapp && f.whatsapp === f.mobile} onChange={(e) => setF({ ...f, whatsapp: e.target.checked ? f.mobile : "" })} />Same as mobile</label>
        </Field>
        <Field label="Email"><input className={cx(inputCls, errs.email && "border-rose-400")} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /><Err>{errs.email}</Err></Field>
        <Field label="Address"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="PIN"><input aria-label="PIN" inputMode="numeric" maxLength={6} className={cx(inputCls, errs.pin && "border-rose-400")} value={f.pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="400001" /><Err>{errs.pin}</Err></Field>
          <Field label="City"><input aria-label="City" className={inputCls} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="State"><input aria-label="State" className={inputCls} value={f.state} onChange={(e) => { setAutoState(false); setF({ ...f, state: e.target.value }); }} /></Field>
        </div>
        <Field label="GSTIN / Tax ID">
          <input aria-label="GSTIN" maxLength={15} className={cx(inputCls, "font-mono uppercase", gstErr && "border-rose-400", gst && !gstErr && "border-emerald-400")} value={f.gstin} onChange={(e) => setGstin(e.target.value)} placeholder="27ABCDE1234F1Z5" />
          <Err>{gstErr}</Err>
          {gst && !gstErr && <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-600"><Check className="size-3.5" />Valid GSTIN{GST_STATE[gst.slice(0, 2)] ? ` · state code ${gst.slice(0, 2)} = ${GST_STATE[gst.slice(0, 2)]}` : ""}</p>}
        </Field>
        <div className="mb-4">
          <span className="mb-1.5 block text-[13px] font-semibold">Tags</span>
          <div className="flex flex-wrap gap-1.5">
            {TAG_OPTIONS.map((t) => { const on = f.tags.includes(t); return <button type="button" key={t} aria-pressed={on} onClick={() => setF({ ...f, tags: on ? f.tags.filter((x) => x !== t) : [...f.tags, t] })} className={cx("rounded-full border px-3 py-1 text-xs font-bold", on ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{t}</button>; })}
          </div>
        </div>
        <Field label="Customer Notes"><textarea rows={3} className={cx(inputCls, "h-auto py-2")} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </SlideOver>
      {toast}
    </div>
  );
}

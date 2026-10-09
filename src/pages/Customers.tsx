import { useMemo, useState } from "react";
import { Users, ShieldCheck, Crown, Phone, Repeat, IndianRupee, Mail, MapPin, CalendarDays, Tag, X, Filter, MoreHorizontal, ChevronDown, User, StickyNote } from "lucide-react";
import {
  PageHeader, PrimaryButton, KpiRow, Panel, Pill, Avatar, Thumb, SearchInput, FilterSelect, LineTabs, Pagination,
  tableCls, Th, Td, trCls, cx, OutlineButton, SlideOver, Field, inputCls, type Kpi,
} from "../components/ui";
import { CUSTOMERS, type Customer } from "../lib/data";
import { inr, fmtDate } from "../lib/format";

type Tab = "all" | "active" | "vip" | "new" | "inactive";

// Mock per-customer history (replace with API). ALB-FR-CU: customer order history, notes, follow-ups.
const HISTORY: { id: string; title: string; date: string; amt: number }[] = [
  { id: "ORD100728", title: "Wedding Album - Raj & Priya", date: "2026-10-12", amt: 18500 },
  { id: "ORD100701", title: "Pre Wedding Album", date: "2026-09-25", amt: 22000 },
  { id: "ORD100665", title: "Reception Album", date: "2026-08-10", amt: 26300 },
  { id: "ORD100612", title: "Wedding Highlight Book", date: "2026-06-18", amt: 15800 },
  { id: "ORD100588", title: "Engagement Album", date: "2026-05-12", amt: 12400 },
];

const kpis: Kpi[] = [
  { label: "Total Customers", value: "1,248", delta: 12, icon: Users, tone: "blue" },
  { label: "Active Customers", value: 892, delta: 8, icon: ShieldCheck, tone: "green" },
  { label: "VIP Customers", value: 86, delta: 22, icon: Crown, tone: "amber" },
  { label: "Pending Follow-ups", value: 34, delta: -15, icon: Phone, tone: "pink" },
  { label: "Repeat Customers", value: 416, delta: 18, icon: Repeat, tone: "violet" },
  { label: "Outstanding Dues", value: "₹3,24,500", delta: 12, icon: IndianRupee, tone: "red", invert: true },
];

const TypePill = ({ t }: { t: Customer["type"] }) => <Pill tone={t === "VIP" ? "amber" : t === "New" ? "blue" : "slate"} icon={t === "VIP" ? Crown : undefined}>{t}</Pill>;

const EMPTY = { name: "", studio: "", mobile: "", whatsapp: "", email: "", address: "", city: "", state: "", pin: "", gstin: "", notes: "" };

export default function Customers() {
  const [all, setAll] = useState<Customer[]>(CUSTOMERS);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const save = () => {
    // SRS §4.2: name 2-150 chars, valid mobile; optional email / GSTIN format-validated.
    const e: Record<string, string> = {};
    if (f.studio.trim().length < 2) e.studio = "Enter 2–150 characters";
    if (!/^\+?[0-9 ]{10,14}$/.test(f.mobile.trim())) e.mobile = "Enter a valid mobile number";
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = "Invalid email";
    if (f.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin.toUpperCase())) e.gstin = "Invalid GSTIN";
    setErrs(e);
    if (Object.keys(e).length) return;
    const c: Customer = { id: `IDC${String(1249 + all.length - CUSTOMERS.length).padStart(6, "0")}`, name: f.name || f.studio, studio: f.studio, mobile: f.mobile, email: f.email, city: f.city, state: f.state, type: "New", status: "Active", activeOrders: 0, lifetime: 0, lastOrder: "2026-10-03", since: "2026-10-03", dues: 0, tags: [] };
    setAll([c, ...all]); setActiveId(c.id); setAdding(false); setF(EMPTY);
  };
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [type, setType] = useState("All Customer Types");
  const [city, setCity] = useState("All Cities");
  const [status, setStatus] = useState("All Statuses");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [checked, setChecked] = useState<Set<string>>(new Set([CUSTOMERS[0]!.id]));
  const [activeId, setActiveId] = useState<string | null>(CUSTOMERS[0]!.id);
  const [dtab, setDtab] = useState<"history" | "notes" | "follow">("history");
  const [notes, setNotes] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState("");

  const inTab = (c: Customer, t: Tab) => t === "all" || (t === "active" ? c.status === "Active" : t === "inactive" ? c.status === "Inactive" : t === "vip" ? c.type === "VIP" : c.type === "New");
  const base = useMemo(() => all.filter((c) => {
    const s = q.trim().toLowerCase();
    if (s && ![c.name, c.mobile, c.email, c.studio, c.id].some((v) => v.toLowerCase().includes(s))) return false;
    if (type !== "All Customer Types" && c.type !== type) return false;
    if (city !== "All Cities" && c.city !== city) return false;
    if (status !== "All Statuses" && c.status !== status) return false;
    return true;
  }), [q, type, city, status]);
  const list = base.filter((c) => inTab(c, tab));
  const rows = list.slice((page - 1) * pageSize, page * pageSize);
  const cur = all.find((c) => c.id === activeId) ?? null;
  const allChecked = rows.length > 0 && rows.every((c) => checked.has(c.id));
  const tabs: { key: Tab; label: string }[] = [{ key: "all", label: "All Customers" }, { key: "active", label: "Active" }, { key: "vip", label: "VIP" }, { key: "new", label: "New" }, { key: "inactive", label: "Inactive" }];
  const myNotes = cur ? [...(notes[cur.id] ?? []), "Discussed new album design samples. Client liked the premium matte finish. Follow up next week for final approval."] : [];

  return (
    <div>
      <PageHeader title="Customers" subtitle="Manage your studio clients, track orders, and build long-term relationships.">
        <PrimaryButton onClick={() => setAdding(true)}>Add Customer</PrimaryButton>
        <button className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold">More <ChevronDown className="size-4" /></button>
      </PageHeader>
      <KpiRow items={kpis} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel bodyClassName="!p-4">
          <div className="flex items-center justify-between gap-3">
            <LineTabs<Tab> className="!border-0" value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={tabs.map((t) => ({ ...t, count: base.filter((c) => inTab(c, t.key)).length }))} />
            <button className="inline-flex items-center gap-1 text-xs font-bold text-brand">View Segments <ChevronDown className="size-3.5" /></button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <SearchInput className="min-w-[220px] flex-1" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search customer name, mobile, email or company..." />
            <FilterSelect value={type} onChange={(v) => { setType(v); setPage(1); }} options={["All Customer Types", "VIP", "Regular", "New"]} />
            <FilterSelect value={city} onChange={(v) => { setCity(v); setPage(1); }} options={["All Cities", ...Array.from(new Set(CUSTOMERS.map((c) => c.city)))]} />
            <FilterSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={["All Statuses", "Active", "Inactive"]} />
            <OutlineButton icon={Filter} className="!h-10">Filters</OutlineButton>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className={tableCls}>
              <thead><tr>
                <Th><input type="checkbox" checked={allChecked} onChange={() => setChecked((p) => { const n = new Set(p); rows.forEach((c) => allChecked ? n.delete(c.id) : n.add(c.id)); return n; })} /></Th>
                <Th>Customer ID</Th><Th>Customer Name</Th><Th>Studio / Company</Th><Th>Mobile</Th><Th>Email</Th><Th>City</Th><Th>Type</Th>
                <Th className="whitespace-normal">Active Orders</Th><Th className="whitespace-normal">Lifetime Value</Th><Th>Last Order</Th><Th className="text-right">Actions</Th>
              </tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => setActiveId(c.id)} className={cx(trCls, "cursor-pointer", activeId === c.id && "bg-brand-soft")}>
                    <Td><input type="checkbox" checked={checked.has(c.id)} onClick={(e) => e.stopPropagation()} onChange={() => setChecked((p) => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} /></Td>
                    <Td className="text-brand">{c.id}</Td>
                    <Td><span className="inline-flex items-center gap-2"><Avatar name={c.name} size={28} /><span className="font-semibold text-brand">{c.name}</span></span></Td>
                    <Td>{c.studio}</Td><Td>{c.mobile}</Td><Td className="text-brand">{c.email}</Td><Td>{c.city}</Td><Td><TypePill t={c.type} /></Td>
                    <Td className="text-center"><span className="inline-grid size-6 place-items-center rounded-md bg-brand-soft font-bold text-brand">{c.activeOrders}</span></Td>
                    <Td className="font-bold">{inr(c.lifetime)}</Td><Td>{fmtDate(c.lastOrder)}</Td>
                    <Td className="text-right"><button onClick={(e) => e.stopPropagation()} className="h-8 rounded-lg border border-line px-2.5"><MoreHorizontal className="size-4" /></button></Td>
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
                <Pill tone="green" dot>{cur.status}</Pill>
                <h3 className="mt-1 text-xl font-extrabold">{cur.name}</h3>
                <div className="text-[13px] text-sub">{cur.studio}</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <button onClick={() => setActiveId(null)} aria-label="Close" className="text-sub"><X className="size-4" /></button>
                {cur.type === "VIP" && <Pill tone="amber" icon={Crown}>VIP Customer</Pill>}
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-[13px]">
              <li className="flex items-center gap-2.5"><Phone className="size-4 text-sub" />{cur.mobile}</li>
              <li className="flex items-center gap-2.5"><Mail className="size-4 text-sub" />{cur.email}</li>
              <li className="flex items-center gap-2.5"><MapPin className="size-4 text-sub" />{cur.city}, {cur.state}</li>
              <li className="flex items-center gap-2.5"><CalendarDays className="size-4 text-sub" />Customer since {fmtDate(cur.since)}</li>
              <li className="flex flex-wrap items-center gap-2"><Tag className="size-4 text-sub" />{cur.tags.slice(0, 2).map((t) => <Pill key={t} tone="blue">{t}</Pill>)}<Pill tone="blue">+2</Pill></li>
            </ul>
            <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-xl border border-line py-3 text-center">
              <div><div className="text-[11px] text-sub">Total Orders</div><div className="text-lg font-extrabold text-brand">{cur.activeOrders * 6 || 4}</div></div>
              <div><div className="text-[11px] text-sub">Lifetime Value</div><div className="text-lg font-extrabold">{inr(cur.lifetime)}</div></div>
              <div><div className="text-[11px] text-sub">Pending Dues</div><div className={cx("text-lg font-extrabold", cur.dues ? "text-rose-600" : "text-emerald-600")}>{inr(cur.dues)}</div></div>
            </div>
            <LineTabs<"history" | "notes" | "follow"> className="mt-4" value={dtab} onChange={setDtab} tabs={[{ key: "history", label: "Order History" }, { key: "notes", label: `Notes (${myNotes.length})` }, { key: "follow", label: "Follow-ups (2)" }]} />
            {dtab === "history" && (
              <ul className="mt-3 space-y-2.5">
                {HISTORY.map((h, i) => (
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
                  <button onClick={() => { if (draft.trim()) { setNotes((p) => ({ ...p, [cur.id]: [draft.trim(), ...(p[cur.id] ?? [])] })); setDraft(""); } }} className="h-9 rounded-lg bg-brand px-3 text-xs font-bold text-white">Add</button>
                </div>
              </div>
            )}
            {dtab === "follow" && (
              <ul className="mt-3 space-y-2 text-xs">
                {["Call about final approval — 7 Oct 2026", "Share new album samples — 10 Oct 2026"].map((f) => <li key={f} className="flex items-center gap-2 rounded-lg border border-line p-2.5"><User className="size-3.5 text-sub" />{f}</li>)}
              </ul>
            )}
            {dtab === "history" && (
              <div className="mt-4 rounded-xl bg-violet-50 p-3 text-xs">
                <div className="mb-1 flex justify-between"><span className="font-bold text-violet-700">Recent Note</span><span className="text-sub">2 days ago</span></div>
                {myNotes[0]}<div className="mt-1 text-sub">- by Admin</div>
              </div>
            )}
          </Panel>
        ) : (
          <Panel><p className="py-10 text-center text-sm text-sub">Select a customer to view details.</p></Panel>
        )}
      </div>
      <SlideOver open={adding} onClose={() => setAdding(false)} title="Add Customer" footer={<><OutlineButton className="!h-10" onClick={() => setAdding(false)}>Cancel</OutlineButton><PrimaryButton onClick={save}>Save Customer</PrimaryButton></>}>
        {([["studio", "Customer / Studio Name", true], ["name", "Contact Person"], ["mobile", "Mobile Number", true], ["whatsapp", "WhatsApp Number"], ["email", "Email"], ["address", "Address"], ["city", "City"], ["state", "State"], ["pin", "PIN"], ["gstin", "GSTIN / Tax ID"], ["notes", "Customer Notes"]] as [keyof typeof EMPTY, string, boolean?][]).map(([k, label, req]) => (
          <Field key={k} label={label} required={req} hint={errs[k]}>
            <input className={cx(inputCls, errs[k] && "border-rose-400")} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </Field>
        ))}
      </SlideOver>
    </div>
  );
}

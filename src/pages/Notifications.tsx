import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Mail, Smartphone, Phone, StickyNote, ArrowDownLeft, ArrowUpRight, CheckCheck, Send, RotateCw, Pencil } from "lucide-react";
import { PageHeader, Panel, LineTabs, Pill, SearchInput, Toggle, Th, Td, trCls, tableCls, Pagination, KpiRow, SlideOver, Field, PrimaryButton, inputCls, Avatar, cx, type Kpi } from "../components/ui";
import { Combobox, DateRangePicker, FilterChips, MultiSelect, SortTh, sortRows, fmtShort, presetRange, type DateRange, type SortState } from "../components/controls";
import { useToast } from "../components/Toast";
import { notifStore, useNotifs } from "../lib/notifStore";
import { ORDERS, type Order, type Tone } from "../lib/data";
import { fmtDate, inr } from "../lib/format";

// SRS §17.1 triggered notifications and §17.2 communication log.
const TRIGGERS = [
  ["Order Created", "Customer / Admin", "Order acknowledgement with Order ID"],
  ["Colour Grading Assigned", "Colour Grader", "New job notification"],
  ["Grading Submitted", "Admin", "Approval required"],
  ["Design Assigned", "Designer", "New design task"],
  ["Design Submitted", "Admin", "Review required"],
  ["Proof Ready", "Customer", "Secure review link"],
  ["Correction Received", "Admin / Designer", "Correction task"],
  ["Final Approval", "Admin / Printing", "Release notification"],
  ["Printing Completed", "QC", "QC job notification"],
  ["QC Passed", "Reception / Admin", "Order ready for delivery"],
  ["Payment Due", "Customer / Accounts", "Reminder on configured schedule"],
  ["Dispatched", "Customer", "Courier / tracking details"],
  ["Delivered", "Customer / Admin", "Delivery confirmation"],
];
const CHANNELS = ["WhatsApp", "Email", "SMS", "Call", "Internal Note"] as const;
type Ch = (typeof CHANNELS)[number];
const CH_ICON = { WhatsApp: MessageCircle, Email: Mail, SMS: Smartphone, Call: Phone, "Internal Note": StickyNote };
const STATUSES = ["Read", "Delivered", "Sent", "Queued", "Failed"];
const STATUS_TONE: Record<string, Tone> = { Read: "green", Delivered: "blue", Sent: "slate", Queued: "amber", Failed: "red" };
interface Msg { id: number; ch: Ch; dir: "Inbound" | "Outbound"; tpl: string; to: string; at: string; ts: string; status: string; order: string; msg: string }
const SEED_LOG: Omit<Msg, "id">[] = [
  { ch: "WhatsApp", dir: "Outbound", tpl: "proof_ready", to: "+91 98•••• 43210", at: "3 Oct 2026, 11:02 AM", ts: "2026-10-03T11:02:00", status: "Read", order: "IDP00072", msg: "Proof link shared with client" },
  { ch: "WhatsApp", dir: "Inbound", tpl: "—", to: "+91 99•••• 54321", at: "3 Oct 2026, 10:48 AM", ts: "2026-10-03T10:48:00", status: "Read", order: "IDP00071", msg: "Client requested page 12 colour change" },
  { ch: "Email", dir: "Outbound", tpl: "order_created", to: "ra••@sharmastudio.in", at: "3 Oct 2026, 10:15 AM", ts: "2026-10-03T10:15:00", status: "Delivered", order: "IDP00070", msg: "Order acknowledgement sent" },
  { ch: "SMS", dir: "Outbound", tpl: "payment_due", to: "+91 91•••• 56789", at: "2 Oct 2026, 05:30 PM", ts: "2026-10-02T17:30:00", status: "Delivered", order: "IDP00069", msg: "Payment reminder ₹28,000" },
  { ch: "Call", dir: "Outbound", tpl: "—", to: "+91 88•••• 65544", at: "2 Oct 2026, 03:10 PM", ts: "2026-10-02T15:10:00", status: "Sent", order: "IDP00068", msg: "Follow-up on final approval" },
  { ch: "WhatsApp", dir: "Outbound", tpl: "dispatched", to: "+91 77•••• 44332", at: "2 Oct 2026, 12:00 PM", ts: "2026-10-02T12:00:00", status: "Failed", order: "IDP00067", msg: "Tracking DTDC458712396 — number not on WhatsApp" },
  { ch: "Internal Note", dir: "Outbound", tpl: "—", to: "Admin", at: "2 Oct 2026, 10:20 AM", ts: "2026-10-02T10:20:00", status: "Sent", order: "IDP00066", msg: "Client prefers pickup on Saturday" },
  { ch: "Email", dir: "Outbound", tpl: "delivered", to: "ch••@mail.com", at: "1 Oct 2026, 04:15 PM", ts: "2026-10-01T16:15:00", status: "Queued", order: "IDP00064", msg: "Delivery confirmation" },
  { ch: "WhatsApp", dir: "Outbound", tpl: "proof_ready", to: "+91 99•••• 54321", at: "3 Oct 2026, 09:30 AM", ts: "2026-10-03T09:30:00", status: "Delivered", order: "IDP00071", msg: "Hi, the proof for your album is ready" },
  { ch: "WhatsApp", dir: "Inbound", tpl: "—", to: "+91 98•••• 43210", at: "3 Oct 2026, 11:20 AM", ts: "2026-10-03T11:20:00", status: "Read", order: "IDP00072", msg: "Looks great, approved!" },
  { ch: "WhatsApp", dir: "Outbound", tpl: "dispatched", to: "+91 77•••• 44332", at: "2 Oct 2026, 09:00 AM", ts: "2026-10-02T09:00:00", status: "Delivered", order: "IDP00067", msg: "Your album is being packed for dispatch" },
];

const TPL: Record<string, string> = {
  proof_ready: "Hi {{customer}}, the proof for order {{order_id}} is ready. Please review it here: {{link}}",
  order_created: "Thank you {{customer}}! Your {{event}} order {{order_id}} has been created. Expected delivery: {{due_date}}.",
  payment_due: "Gentle reminder: {{amount_due}} is pending on order {{order_id}}. Please clear it at your earliest convenience.",
  dispatched: "Your album for order {{order_id}} has been dispatched. Tracking: {{tracking}}.",
  delivered: "Your album ({{order_id}}) has been delivered. Thank you for choosing us, {{customer}}!",
};
const ERR = "mt-1 block text-xs font-semibold text-rose-600";
const maskPhone = (m: string) => { const d = m.replace(/\D/g, "").slice(-10); return d.length < 10 ? m : `+91 ${d.slice(0, 2)}•••• ${d.slice(-5)}`; };
const maskEmail = (e: string) => e.replace(/^(.{2}).*@/, "$1••@");
const emailOf = (o: Order) => `${o.customer.toLowerCase().replace(/[^a-z0-9]+/g, "")}@studiomail.in`;
const NOW = "2026-10-03T11:30:00";
const nowStr = () => new Date(NOW).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).replace(" at", ",").replace(/am|pm/, (x) => x.toUpperCase());
const vars = (o?: Order): Record<string, string> => o ? { customer: o.customer, order_id: o.id, event: o.event, due_date: fmtDate(o.due), amount_due: inr(Math.max(0, o.total - o.paid)), link: `https://albumpro.app/proof/${o.id}`, tracking: `DTDC${(o.id.slice(3) + "458712").slice(0, 9)}`, stage: o.stage } : {};
const resolve = (t: string, v: Record<string, string>) => t.replace(/\{\{(\w+)\}\}/g, (m, k: string) => v[k] ?? m);
const parts = (t: string, v: Record<string, string>) => t.split(/(\{\{\w+\}\})/).map((p, i) => { const k = /^\{\{(\w+)\}\}$/.exec(p)?.[1]; return k ? (v[k] ? <mark key={i} className="rounded bg-brand-soft px-0.5 font-semibold text-brand">{v[k]}</mark> : <mark key={i} className="rounded bg-amber-100 px-0.5 text-amber-700">{p}</mark>) : <span key={i}>{p}</span>; });
const inRng = (ts: string, r: DateRange) => { if (!r.from || !r.to) return true; const d = ts.slice(0, 10); const f = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; return d >= f(r.from) && d <= f(r.to); };

export default function Notifications() {
  const [tab, setTab] = useState<"log" | "threads" | "triggers">("log");
  const idRef = useRef(100);
  const [log, setLog] = useState<Msg[]>(() => SEED_LOG.map((m, i) => ({ ...m, id: i + 1 })));
  const [q, setQ] = useState("");
  const [range, setRange] = useState<DateRange>(() => presetRange("All Time"));
  const [fCh, setFCh] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fDir, setFDir] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>(null);
  const [on, setOn] = useState<Record<string, [boolean, boolean]>>(Object.fromEntries(TRIGGERS.map(([t]) => [t, [true, t !== "Correction Received"]])));
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<number | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [compose, setCompose] = useState(false);
  const [f, setF] = useState({ ch: "WhatsApp" as Ch, tpl: "", order: "", to: "", body: "", custom: false });
  const [errs, setErrs] = useState<{ order?: string; to?: string; body?: string }>({});
  const [toast, show] = useToast();
  const notifs = useNotifs();
  const unread = notifs.filter((n) => !n.read).length;
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const view = useMemo(() => {
    const t = q.trim().toLowerCase();
    const l = log.filter((m) => (!fCh.length || fCh.includes(m.ch)) && (!fStatus.length || fStatus.includes(m.status)) && (!fDir.length || fDir.includes(m.dir)) && inRng(m.ts, range) && (!t || [m.order, m.msg, m.to, m.tpl].some((v) => v.toLowerCase().includes(t))));
    return sortRows(l, sort, (m, k) => (k === "ts" ? m.ts : String(m[k as keyof Msg]).toLowerCase()));
  }, [log, q, fCh, fStatus, fDir, range, sort]);
  const maxPage = Math.max(1, Math.ceil(view.length / 8));
  const cur = Math.min(page, maxPage);
  const rows = view.slice((cur - 1) * 8, cur * 8);
  const failed = log.filter((l) => l.status === "Failed").length;
  const failedInView = view.filter((m) => m.status === "Failed");
  const kpis: Kpi[] = [
    { label: "Sent Today", value: 40 + log.filter((l) => l.dir === "Outbound").length, delta: 12, icon: ArrowUpRight, tone: "blue" },
    { label: "Delivered / Read", value: 33 + log.filter((l) => l.status === "Read" || l.status === "Delivered").length, delta: 8, icon: MessageCircle, tone: "green" },
    { label: "Failed", value: failed, delta: 0, icon: Smartphone, tone: "red", invert: true },
    { label: "Inbound Replies", value: 8 + log.filter((l) => l.dir === "Inbound").length, delta: 20, icon: ArrowDownLeft, tone: "violet" },
  ];
  const chips = [
    ...(q.trim() ? [{ label: `Search: ${q.trim()}`, onRemove: () => setQ("") }] : []),
    ...(range.preset !== "All Time" ? [{ label: `Date: ${range.preset === "Custom" ? `${fmtShort(range.from)} – ${fmtShort(range.to)}` : range.preset}`, onRemove: () => setRange(presetRange("All Time")) }] : []),
    ...fCh.map((c) => ({ label: `Channel: ${c}`, onRemove: () => setFCh(fCh.filter((x) => x !== c)) })),
    ...fStatus.map((c) => ({ label: `Status: ${c}`, onRemove: () => setFStatus(fStatus.filter((x) => x !== c)) })),
    ...fDir.map((c) => ({ label: `Direction: ${c}`, onRemove: () => setFDir(fDir.filter((x) => x !== c)) })),
  ];
  const clearAll = () => { setQ(""); setRange(presetRange("All Time")); setFCh([]); setFStatus([]); setFDir([]); setPage(1); };

  const retryIds = (ids: number[]) => {
    if (!ids.length) { show("No failed messages to retry"); return; }
    setLog((l) => l.map((m) => (ids.includes(m.id) ? { ...m, status: "Queued" } : m)));
    show(ids.length === 1 ? "Retrying message..." : `Retrying ${ids.length} failed messages...`);
    timers.current.push(window.setTimeout(() => { setLog((l) => l.map((m) => (ids.includes(m.id) ? { ...m, status: "Delivered", at: nowStr(), ts: NOW } : m))); show(ids.length === 1 ? "Message delivered on retry" : `${ids.length} messages delivered on retry`); }, 1200));
  };
  const markAll = () => { if (!unread) { show("No unread notifications"); return; } notifStore.markAllRead(); show(`Marked ${unread} notification${unread > 1 ? "s" : ""} as read`); };

  // ---- compose ----
  const ord = ORDERS.find((o) => o.id === f.order);
  const v = vars(ord);
  const recipientAuto = ord ? (f.ch === "Email" ? maskEmail(emailOf(ord)) : f.ch === "Internal Note" ? "Admin" : maskPhone(ord.mobile)) : "";
  const openCompose = (order = "") => { setErrs({}); const o = ORDERS.find((x) => x.id === order); setF({ ch: "WhatsApp", tpl: "", order, to: o ? maskPhone(o.mobile) : "", body: "", custom: false }); setCompose(true); };
  const pickOrder = (id: string) => { const o = ORDERS.find((x) => x.id === id); setF((p) => ({ ...p, order: id, to: o ? (p.ch === "Email" ? maskEmail(emailOf(o)) : p.ch === "Internal Note" ? "Admin" : maskPhone(o.mobile)) : p.to, custom: false })); };
  const pickCh = (c: Ch) => setF((p) => { const o = ORDERS.find((x) => x.id === p.order); return { ...p, ch: c, custom: false, to: o ? (c === "Email" ? maskEmail(emailOf(o)) : c === "Internal Note" ? "Admin" : maskPhone(o.mobile)) : p.to }; });
  const pickTpl = (t: string) => setF((p) => ({ ...p, tpl: t, body: t ? TPL[t]! : p.body }));
  const send = () => {
    const e: { order?: string; to?: string; body?: string } = {};
    if (!f.order) e.order = "Select the order this message relates to";
    const to = f.custom ? f.to.trim() : recipientAuto;
    if (!to) e.to = "Recipient is required";
    else if (f.custom && f.ch === "Email" && !/^\S+@\S+\.\S+$/.test(to)) e.to = "Enter a valid email address";
    else if (f.custom && (f.ch === "WhatsApp" || f.ch === "SMS" || f.ch === "Call") && to.replace(/\D/g, "").length < 10) e.to = "Enter a valid phone number (min 10 digits)";
    if (!f.body.trim()) e.body = "Message body is required";
    setErrs(e);
    if (Object.keys(e).length) return;
    const msg: Msg = { id: idRef.current++, ch: f.ch, dir: "Outbound", tpl: f.tpl || "—", to: f.custom ? (f.ch === "Email" ? maskEmail(to) : f.ch === "Internal Note" ? to : maskPhone(to)) : to, at: nowStr(), ts: NOW, status: f.ch === "Internal Note" ? "Sent" : "Queued", order: f.order, msg: resolve(f.body.trim(), v) };
    setLog((l) => [msg, ...l]);
    clearAll(); setSort(null); setTab("log");
    setCompose(false);
    show(`${f.ch} message queued for ${f.order}`);
    if (f.ch !== "Internal Note") timers.current.push(window.setTimeout(() => setLog((l) => l.map((m) => (m.id === msg.id ? { ...m, status: "Delivered" } : m))), 1500));
  };
  const sendReply = () => {
    if (!thread || !reply.trim()) return;
    const o = ORDERS.find((x) => x.id === thread);
    const msg: Msg = { id: idRef.current++, ch: "WhatsApp", dir: "Outbound", tpl: "—", to: o ? maskPhone(o.mobile) : "—", at: nowStr(), ts: NOW, status: "Queued", order: thread, msg: reply.trim() };
    setLog((l) => [msg, ...l]); setReply("");
    timers.current.push(window.setTimeout(() => setLog((l) => l.map((m) => (m.id === msg.id ? { ...m, status: "Delivered" } : m))), 1200));
  };

  const d = detail !== null ? log.find((m) => m.id === detail) : undefined;
  const threads = useMemo(() => {
    const g = new Map<string, Msg[]>();
    log.forEach((m) => g.set(m.order, [...(g.get(m.order) ?? []), m]));
    return [...g].map(([order, ms]) => ({ order, ms: [...ms].sort((a, b) => a.ts.localeCompare(b.ts)), cust: ORDERS.find((o) => o.id === order)?.customer ?? order })).sort((a, b) => b.ms[b.ms.length - 1]!.ts.localeCompare(a.ms[a.ms.length - 1]!.ts));
  }, [log]);
  const th = thread ? threads.find((t) => t.order === thread) : undefined;
  const thOrder = ORDERS.find((o) => o.id === thread);

  return (
    <>
      {toast}
      <PageHeader title="Notifications" subtitle="Triggered messages and the full communication log, linked to orders.">
        <button onClick={markAll} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold hover:bg-brand-soft"><CheckCheck className="size-4" />Mark all read{unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[11px] text-white">{unread}</span>}</button>
        <PrimaryButton icon={Send} onClick={() => openCompose()}>Send message</PrimaryButton>
      </PageHeader>
      <KpiRow items={kpis} />
      <Panel>
        <LineTabs className="mb-4" value={tab} onChange={setTab} tabs={[{ key: "log", label: "Communication Log" }, { key: "threads", label: "Conversations", count: threads.length }, { key: "triggers", label: "Triggered Notifications" }]} />
        {tab === "log" && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <SearchInput className="w-64" value={q} onChange={(x) => { setQ(x); setPage(1); }} placeholder="Search order, recipient, message…" />
              <DateRangePicker align="left" value={range} onChange={(r) => { setRange(r); setPage(1); }} />
              <MultiSelect className="w-36" label="All Channels" options={[...CHANNELS]} value={fCh} onChange={(x) => { setFCh(x); setPage(1); }} />
              <MultiSelect className="w-36" label="All Statuses" options={STATUSES} value={fStatus} onChange={(x) => { setFStatus(x); setPage(1); }} />
              <MultiSelect className="w-36" label="Direction" options={["Inbound", "Outbound"]} value={fDir} onChange={(x) => { setFDir(x); setPage(1); }} />
              <button onClick={() => retryIds(failedInView.map((m) => m.id))} disabled={failedInView.length === 0} className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 px-3.5 text-[13px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40"><RotateCw className="size-4" />Retry failed ({failedInView.length})</button>
            </div>
            <FilterChips chips={chips} onClearAll={clearAll} />
            <div className="scroll-thin overflow-x-auto">
              <table className={tableCls}>
                <thead><tr><SortTh k="ch" sort={sort} onSort={setSort}>Channel</SortTh><SortTh k="dir" sort={sort} onSort={setSort}>Direction</SortTh><SortTh k="tpl" sort={sort} onSort={setSort}>Template</SortTh><SortTh k="to" sort={sort} onSort={setSort}>Recipient</SortTh><SortTh k="ts" sort={sort} onSort={setSort}>Sent At</SortTh><SortTh k="status" sort={sort} onSort={setSort}>Status</SortTh><SortTh k="order" sort={sort} onSort={setSort}>Order</SortTh><Th>Summary</Th><Th>Actions</Th></tr></thead>
                <tbody>{rows.map((l) => {
                  const I = CH_ICON[l.ch];
                  return <tr key={l.id} onClick={() => setDetail(l.id)} className={trCls + " cursor-pointer"}>
                    <Td><span className="inline-flex items-center gap-2 font-semibold"><I className="size-4 text-sub" />{l.ch}</span></Td>
                    <Td>{l.dir}</Td><Td className="font-mono text-xs">{l.tpl}</Td><Td>{l.to}</Td><Td>{l.at}</Td>
                    <Td><Pill tone={STATUS_TONE[l.status]} dot>{l.status}</Pill></Td>
                    <Td><button onClick={(e) => { e.stopPropagation(); setThread(l.order); }} title="Open conversation" className="font-bold text-brand hover:underline">{l.order}</button></Td>
                    <Td className="max-w-[300px] truncate">{l.msg}</Td>
                    <Td><span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setDetail(l.id)} className="h-8 rounded-lg border border-line bg-white px-3 text-xs font-bold hover:bg-brand-soft">View</button>
                      {l.status === "Failed" && <button onClick={() => retryIds([l.id])} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50"><RotateCw className="size-3.5" />Retry</button>}
                    </span></Td>
                  </tr>;
                })}
                {rows.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-sub">No messages match.</td></tr>}</tbody>
              </table>
            </div>
            <Pagination page={cur} pageSize={8} total={view.length} onPage={setPage} noun="messages" />
          </>
        )}
        {tab === "threads" && (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="thread-list">
            {threads.map((t) => { const last = t.ms[t.ms.length - 1]!; return (
              <li key={t.order}><button onClick={() => setThread(t.order)} className="flex w-full items-start gap-3 rounded-xl border border-line p-3 text-left hover:bg-brand-soft">
                <Avatar name={t.cust} size={36} />
                <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><b className="truncate text-[13px]">{t.order} · {t.cust}</b><span className="shrink-0 rounded-full bg-slate-100 px-2 text-[11px] font-bold">{t.ms.length}</span></span>
                  <span className="block truncate text-xs text-sub">{last.dir === "Inbound" ? "Client: " : "You: "}{last.msg}</span><span className="text-[11px] text-sub">{last.at}</span></span>
              </button></li>); })}
          </ul>
        )}
        {tab === "triggers" && (
          <div className="scroll-thin overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><Th>Trigger</Th><Th>Recipient</Th><Th>Behaviour</Th><Th>WhatsApp</Th><Th>Email</Th></tr></thead>
              <tbody>{TRIGGERS.map(([t, r, dd]) => (
                <tr key={t} className={trCls}><Td className="font-bold">{t}</Td><Td>{r}</Td><Td className="text-sub">{dd}</Td>
                  <Td><Toggle on={on[t]![0]} onChange={(x) => { setOn({ ...on, [t!]: [x, on[t!]![1]] }); show(`${t}: WhatsApp ${x ? "enabled" : "disabled"}`); }} /></Td>
                  <Td><Toggle on={on[t]![1]} onChange={(x) => { setOn({ ...on, [t!]: [on[t!]![0], x] }); show(`${t}: Email ${x ? "enabled" : "disabled"}`); }} /></Td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <SlideOver open={!!d} onClose={() => setDetail(null)} title="Message details" footer={d && <>
        {d.status === "Failed" && <button onClick={() => retryIds([d.id])} className="inline-flex h-11 items-center gap-2 rounded-xl border border-rose-200 px-5 text-sm font-bold text-rose-600 hover:bg-rose-50"><RotateCw className="size-4" />Retry</button>}
        <button onClick={() => { setThread(d.order); setDetail(null); }} className="h-11 rounded-xl border border-line px-5 text-sm font-bold hover:bg-brand-soft">Open conversation</button>
        <button onClick={() => setDetail(null)} className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white">Close</button>
      </>}>
        {d && (
          <dl className="space-y-3 text-sm">
            {([["Channel", d.ch], ["Direction", d.dir], ["Template", d.tpl], ["Recipient", d.to], ["Sent at", d.at], ["Order", d.order]] as const).map(([k, x]) => <div key={k} className="flex justify-between gap-4 border-b border-line pb-2"><dt className="text-sub">{k}</dt><dd className="font-semibold">{x}</dd></div>)}
            <div className="flex justify-between gap-4 border-b border-line pb-2"><dt className="text-sub">Status</dt><dd><Pill tone={STATUS_TONE[d.status]} dot>{d.status}</Pill></dd></div>
            <div><dt className="mb-1 text-sub">Message</dt><dd className="rounded-lg bg-slate-50 p-3">{d.msg}</dd></div>
          </dl>
        )}
      </SlideOver>

      {/* conversation thread for one order */}
      <SlideOver width={520} open={!!thread} onClose={() => setThread(null)} title={thOrder ? `${thread} · ${thOrder.customer}` : thread ?? ""} footer={<>
        <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendReply()} aria-label="Reply" placeholder="Reply on WhatsApp…" className={cx(inputCls, "flex-1")} />
        <button onClick={sendReply} disabled={!reply.trim()} className="h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white disabled:opacity-40"><Send className="size-4" /></button>
      </>}>
        <div data-testid="thread" className="space-y-3">
          {th?.ms.map((m) => { const I = CH_ICON[m.ch]; const out = m.dir === "Outbound"; return (
            <div key={m.id} className={cx("flex", out ? "justify-end" : "justify-start")}>
              <div className={cx("max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px]", out ? "rounded-br-sm bg-brand text-white" : "rounded-bl-sm bg-slate-100")}>
                <div className={cx("mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide", out ? "text-white/70" : "text-sub")}><I className="size-3" />{m.ch}{m.tpl !== "—" && <> · {m.tpl}</>}</div>
                {m.msg}
                <div className={cx("mt-1 flex items-center justify-between gap-3 text-[10px]", out ? "text-white/70" : "text-sub")}><span>{m.at}</span><span className="flex items-center gap-1">{m.status}{m.status === "Failed" && <button onClick={() => retryIds([m.id])} className="rounded bg-white/90 px-1.5 text-rose-600">Retry</button>}</span></div>
              </div>
            </div>); })}
          {!th && <p className="text-sm text-sub">No messages for this order yet.</p>}
        </div>
        <button onClick={() => { const o = thread!; setThread(null); openCompose(o); }} className="mt-5 inline-flex items-center gap-1.5 text-xs font-bold text-brand"><Pencil className="size-3.5" />Compose a template message</button>
      </SlideOver>

      <SlideOver width={500} open={compose} onClose={() => setCompose(false)} title="Send message" footer={<>
        <button onClick={() => setCompose(false)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={Send} onClick={send}>Send</PrimaryButton>
      </>}>
        <div className="mb-4"><span className="mb-1.5 block text-[13px] font-semibold">Channel <span className="text-rose-500">*</span></span><Combobox options={CHANNELS.map((c) => ({ value: c, label: c }))} value={f.ch} onChange={(x) => pickCh(x as Ch)} /></div>
        <div className="mb-4"><span className="mb-1.5 block text-[13px] font-semibold">Order <span className="text-rose-500">*</span></span>
          <Combobox error={!!errs.order} options={ORDERS.slice(0, 40).map((o) => ({ value: o.id, label: o.id, sub: o.customer }))} value={f.order} onChange={pickOrder} placeholder="Search order or customer…" />
          {errs.order && <span className={ERR}>{errs.order}</span>}</div>
        <Field label={f.ch === "Email" ? "Recipient email" : f.ch === "Internal Note" ? "Recipient / Team" : "Recipient phone"} required hint={!f.custom && f.order ? "Auto-filled from the order and masked for privacy." : undefined}>
          {f.custom ? <input className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Recipient" /> : (
            <div className="flex gap-2"><input readOnly className={cx(inputCls, "bg-slate-50")} value={recipientAuto} placeholder="Pick an order to auto-fill" aria-label="Recipient" />
              <button type="button" onClick={() => setF({ ...f, custom: true, to: "" })} className="h-10 shrink-0 rounded-lg border border-line px-3 text-xs font-bold text-brand hover:bg-brand-soft">Change</button></div>)}
          {errs.to && <span className={ERR}>{errs.to}</span>}
        </Field>
        <div className="mb-4"><span className="mb-1.5 block text-[13px] font-semibold">Template</span><Combobox options={[{ value: "", label: "None (free text)" }, ...Object.keys(TPL).map((t) => ({ value: t, label: t }))]} value={f.tpl} onChange={pickTpl} placeholder="None (free text)" /></div>
        <Field label="Message" required hint="Use {{customer}}, {{order_id}}, {{event}}, {{due_date}}, {{amount_due}}, {{link}}, {{tracking}}">
          <textarea className="h-28 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />{errs.body && <span className={ERR}>{errs.body}</span>}
        </Field>
        <div className="mb-2 text-[13px] font-semibold">Preview</div>
        <div data-testid="tpl-preview" className="rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3 text-[13px]">{f.body.trim() ? parts(f.body, v) : <span className="text-sub">Choose a template or type a message to see the resolved preview.</span>}</div>
        {!ord && /\{\{/.test(f.body) && <p className="mt-1 text-xs text-amber-600">Select an order to fill in the highlighted placeholders.</p>}
      </SlideOver>
    </>
  );
}

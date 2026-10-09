import { useMemo, useState } from "react";
import { MessageCircle, Mail, Smartphone, Phone, StickyNote, ArrowDownLeft, ArrowUpRight, CheckCheck, Send, RotateCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { PageHeader, Panel, LineTabs, Pill, SearchInput, FilterSelect, Toggle, Th, Td, trCls, tableCls, Pagination, KpiRow, SlideOver, Field, PrimaryButton, inputCls, type Kpi } from "../components/ui";
import { useToast } from "../components/Toast";
import { notifStore, useNotifs } from "../lib/notifStore";
import { ORDERS } from "../lib/data";
import type { Tone } from "../lib/data";

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
type Ch = "WhatsApp" | "Email" | "SMS" | "Call" | "Internal Note";
const CH_ICON = { WhatsApp: MessageCircle, Email: Mail, SMS: Smartphone, Call: Phone, "Internal Note": StickyNote };
const STATUS_TONE: Record<string, Tone> = { Read: "green", Delivered: "blue", Sent: "slate", Queued: "amber", Failed: "red" };
interface Msg { ch: Ch; dir: "Inbound" | "Outbound"; tpl: string; to: string; at: string; status: string; order: string; msg: string }
const SEED_LOG: Msg[] = [
  { ch: "WhatsApp", dir: "Outbound", tpl: "proof_ready", to: "+91 98•••• 43210", at: "3 Oct 2026, 11:02 AM", status: "Read", order: "IDP00072", msg: "Proof link shared with client" },
  { ch: "WhatsApp", dir: "Inbound", tpl: "—", to: "+91 99•••• 54321", at: "3 Oct 2026, 10:48 AM", status: "Read", order: "IDP00071", msg: "Client requested page 12 colour change" },
  { ch: "Email", dir: "Outbound", tpl: "order_created", to: "ra••@sharmastudio.in", at: "3 Oct 2026, 10:15 AM", status: "Delivered", order: "IDP00070", msg: "Order acknowledgement sent" },
  { ch: "SMS", dir: "Outbound", tpl: "payment_due", to: "+91 91•••• 56789", at: "2 Oct 2026, 05:30 PM", status: "Delivered", order: "IDP00069", msg: "Payment reminder ₹28,000" },
  { ch: "Call", dir: "Outbound", tpl: "—", to: "+91 88•••• 65544", at: "2 Oct 2026, 03:10 PM", status: "Sent", order: "IDP00068", msg: "Follow-up on final approval" },
  { ch: "WhatsApp", dir: "Outbound", tpl: "dispatched", to: "+91 77•••• 44332", at: "2 Oct 2026, 12:00 PM", status: "Failed", order: "IDP00067", msg: "Tracking DTDC458712396 — number not on WhatsApp" },
  { ch: "Internal Note", dir: "Outbound", tpl: "—", to: "Admin", at: "2 Oct 2026, 10:20 AM", status: "Sent", order: "IDP00066", msg: "Client prefers pickup on Saturday" },
  { ch: "Email", dir: "Outbound", tpl: "delivered", to: "ch••@mail.com", at: "1 Oct 2026, 04:15 PM", status: "Queued", order: "IDP00064", msg: "Delivery confirmation" },
];

const TPL: Record<string, string> = {
  proof_ready: "Hi! The proof for your album order is ready. Please review it here: {link}",
  order_created: "Thank you! Your order has been created. We will keep you updated.",
  payment_due: "Gentle reminder: a payment is pending on your order. Please clear it at your earliest convenience.",
  dispatched: "Your album has been dispatched. Tracking details will follow shortly.",
  delivered: "Your album has been delivered. Thank you for choosing us!",
};
const ERR = "mt-1 block text-xs font-semibold text-rose-600";
const mask = (m: string) => m.replace(/(\d{2})\s?(\d{2})\d*\s?(\d{5})$/, "$1 $2•••• $3");
const nowStr = () => new Date("2026-10-03T11:30:00").toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).replace(" at", ",").replace(/am|pm/, (x) => x.toUpperCase());

export default function Notifications() {
  const [tab, setTab] = useState<"log" | "triggers">("log");
  const [log, setLog] = useState<Msg[]>(SEED_LOG);
  const [q, setQ] = useState("");
  const [ch, setCh] = useState("All Channels");
  const [fStatus, setFStatus] = useState("All Statuses");
  const [on, setOn] = useState<Record<string, [boolean, boolean]>>(Object.fromEntries(TRIGGERS.map(([t]) => [t, [true, t !== "Correction Received"]])));
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<number | null>(null);
  const [compose, setCompose] = useState(false);
  const [f, setF] = useState({ ch: "WhatsApp" as Ch, tpl: "", order: "", to: "", body: "" });
  const [errs, setErrs] = useState<{ order?: string; to?: string; body?: string }>({});
  const [toast, show] = useToast();
  const notifs = useNotifs();
  const unread = notifs.filter((n) => !n.read).length;
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const idx = useMemo(() => log.map((l, i) => ({ l, i })).filter(({ l }) => (ch === "All Channels" || l.ch === ch) && (fStatus === "All Statuses" || l.status === fStatus) && (!q || [l.order, l.msg, l.to, l.tpl].some((v) => v.toLowerCase().includes(q.toLowerCase())))), [log, q, ch, fStatus]);
  const rows = idx.slice((page - 1) * 8, page * 8);
  const failed = log.filter((l) => l.status === "Failed").length;
  const kpis: Kpi[] = [
    { label: "Sent Today", value: 40 + log.filter((l) => l.dir === "Outbound").length, delta: 12, icon: ArrowUpRight, tone: "blue" },
    { label: "Delivered / Read", value: 33 + log.filter((l) => l.status === "Read" || l.status === "Delivered").length, delta: 8, icon: MessageCircle, tone: "green" },
    { label: "Failed", value: failed, delta: 0, icon: Smartphone, tone: "red", invert: true },
    { label: "Inbound Replies", value: 8 + log.filter((l) => l.dir === "Inbound").length, delta: 20, icon: ArrowDownLeft, tone: "violet" },
  ];

  const retry = (i: number) => {
    setLog((l) => l.map((m, k) => (k === i ? { ...m, status: "Queued" } : m)));
    show("Retrying message...");
    timers.current.push(window.setTimeout(() => { setLog((l) => l.map((m, k) => (k === i ? { ...m, status: "Delivered", at: nowStr() } : m))); show("Message delivered on retry"); }, 1200));
  };
  const markAll = () => { if (!unread) { show("No unread notifications"); return; } notifStore.markAllRead(); show(`Marked ${unread} notification${unread > 1 ? "s" : ""} as read`); };

  const openCompose = () => { setErrs({}); setF({ ch: "WhatsApp", tpl: "", order: "", to: "", body: "" }); setCompose(true); };
  const pickOrder = (id: string) => { const o = ORDERS.find((x) => x.id === id); setF((p) => ({ ...p, order: id, to: o ? o.mobile : p.to })); };
  const pickTpl = (t: string) => setF((p) => ({ ...p, tpl: t, body: t ? TPL[t]! : p.body }));
  const send = () => {
    const e: { order?: string; to?: string; body?: string } = {};
    if (!f.order) e.order = "Select the order this message relates to";
    if (!f.to.trim()) e.to = "Recipient is required";
    else if (f.ch === "Email" && !/^\S+@\S+\.\S+$/.test(f.to.trim())) e.to = "Enter a valid email address";
    else if ((f.ch === "WhatsApp" || f.ch === "SMS" || f.ch === "Call") && f.to.replace(/\D/g, "").length < 10) e.to = "Enter a valid phone number (min 10 digits)";
    if (!f.body.trim()) e.body = "Message body is required";
    setErrs(e);
    if (Object.keys(e).length) return;
    const msg: Msg = { ch: f.ch, dir: "Outbound", tpl: f.tpl || "—", to: f.ch === "Email" || f.ch === "Internal Note" ? f.to.trim() : mask(f.to.trim()), at: nowStr(), status: f.ch === "Internal Note" ? "Sent" : "Queued", order: f.order, msg: f.body.trim() };
    setLog((l) => [msg, ...l]);
    setQ(""); setCh("All Channels"); setFStatus("All Statuses"); setPage(1); setTab("log");
    setCompose(false);
    show(`${f.ch} message queued for ${f.order}`);
    if (f.ch !== "Internal Note") timers.current.push(window.setTimeout(() => setLog((l) => l.map((m) => (m === msg ? { ...m, status: "Delivered" } : m))), 1500));
  };

  const d = detail !== null ? log[detail] : undefined;
  return (
    <>
      {toast}
      <PageHeader title="Notifications" subtitle="Triggered messages and the full communication log, linked to orders.">
        <button onClick={markAll} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold hover:bg-brand-soft"><CheckCheck className="size-4" />Mark all read{unread > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[11px] text-white">{unread}</span>}</button>
        <PrimaryButton icon={Send} onClick={openCompose}>Send message</PrimaryButton>
      </PageHeader>
      <KpiRow items={kpis} />
      <Panel>
        <LineTabs className="mb-4" value={tab} onChange={setTab} tabs={[{ key: "log", label: "Communication Log" }, { key: "triggers", label: "Triggered Notifications" }]} />
        {tab === "log" ? (
          <>
            <div className="mb-3 flex flex-wrap gap-3"><SearchInput className="w-72" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search order, recipient, message…" /><FilterSelect value={ch} onChange={(v) => { setCh(v); setPage(1); }} options={["All Channels", "WhatsApp", "Email", "SMS", "Call", "Internal Note"]} /><FilterSelect value={fStatus} onChange={(v) => { setFStatus(v); setPage(1); }} options={["All Statuses", "Read", "Delivered", "Sent", "Queued", "Failed"]} /></div>
            <div className="scroll-thin overflow-x-auto">
              <table className={tableCls}>
                <thead><tr><Th>Channel</Th><Th>Direction</Th><Th>Template</Th><Th>Recipient</Th><Th>Sent At</Th><Th>Status</Th><Th>Order</Th><Th>Summary</Th><Th>Actions</Th></tr></thead>
                <tbody>{rows.map(({ l, i }) => {
                  const I = CH_ICON[l.ch];
                  return <tr key={i} onClick={() => setDetail(i)} className={trCls + " cursor-pointer"}>
                    <Td><span className="inline-flex items-center gap-2 font-semibold"><I className="size-4 text-sub" />{l.ch}</span></Td>
                    <Td>{l.dir}</Td><Td className="font-mono text-xs">{l.tpl}</Td><Td>{l.to}</Td><Td>{l.at}</Td>
                    <Td><Pill tone={STATUS_TONE[l.status]} dot>{l.status}</Pill></Td><Td className="font-bold">{l.order}</Td><Td className="max-w-[320px] truncate">{l.msg}</Td>
                    <Td><span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setDetail(i)} className="h-8 rounded-lg border border-line bg-white px-3 text-xs font-bold hover:bg-brand-soft">View</button>
                      {l.status === "Failed" && <button onClick={() => retry(i)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50"><RotateCw className="size-3.5" />Retry</button>}
                    </span></Td>
                  </tr>;
                })}
                {rows.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-sub">No messages match.</td></tr>}</tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={8} total={idx.length} onPage={setPage} noun="messages" />
          </>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><Th>Trigger</Th><Th>Recipient</Th><Th>Behaviour</Th><Th>WhatsApp</Th><Th>Email</Th></tr></thead>
              <tbody>{TRIGGERS.map(([t, r, dd]) => (
                <tr key={t} className={trCls}><Td className="font-bold">{t}</Td><Td>{r}</Td><Td className="text-sub">{dd}</Td>
                  <Td><Toggle on={on[t]![0]} onChange={(v) => { setOn({ ...on, [t!]: [v, on[t!]![1]] }); show(`${t}: WhatsApp ${v ? "enabled" : "disabled"}`); }} /></Td>
                  <Td><Toggle on={on[t]![1]} onChange={(v) => { setOn({ ...on, [t!]: [on[t!]![0], v] }); show(`${t}: Email ${v ? "enabled" : "disabled"}`); }} /></Td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>

      <SlideOver open={!!d} onClose={() => setDetail(null)} title="Message details" footer={d && <>
        {d.status === "Failed" && <button onClick={() => retry(detail!)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-rose-200 px-5 text-sm font-bold text-rose-600 hover:bg-rose-50"><RotateCw className="size-4" />Retry</button>}
        <button onClick={() => setDetail(null)} className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white">Close</button>
      </>}>
        {d && (
          <dl className="space-y-3 text-sm">
            {([["Channel", d.ch], ["Direction", d.dir], ["Template", d.tpl], ["Recipient", d.to], ["Sent at", d.at], ["Order", d.order]] as const).map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-line pb-2"><dt className="text-sub">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
            <div className="flex justify-between gap-4 border-b border-line pb-2"><dt className="text-sub">Status</dt><dd><Pill tone={STATUS_TONE[d.status]} dot>{d.status}</Pill></dd></div>
            <div><dt className="mb-1 text-sub">Message</dt><dd className="rounded-lg bg-slate-50 p-3">{d.msg}</dd></div>
          </dl>
        )}
      </SlideOver>

      <SlideOver open={compose} onClose={() => setCompose(false)} title="Send message" footer={<>
        <button onClick={() => setCompose(false)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={Send} onClick={send}>Send</PrimaryButton>
      </>}>
        <Field label="Channel" required><FilterSelect value={f.ch} onChange={(v) => setF({ ...f, ch: v as Ch })} options={["WhatsApp", "Email", "SMS", "Call", "Internal Note"]} /></Field>
        <Field label="Template"><FilterSelect value={f.tpl || "None (free text)"} onChange={(v) => pickTpl(v.startsWith("None") ? "" : v)} options={["None (free text)", ...Object.keys(TPL)]} /></Field>
        <Field label="Order" required><FilterSelect value={f.order || "Select order"} onChange={(v) => pickOrder(v === "Select order" ? "" : v)} options={["Select order", ...ORDERS.slice(0, 30).map((o) => o.id)]} />{errs.order && <span className={ERR}>{errs.order}</span>}</Field>
        <Field label={f.ch === "Email" ? "Recipient email" : f.ch === "Internal Note" ? "Recipient / Team" : "Recipient phone"} required><input className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />{errs.to && <span className={ERR}>{errs.to}</span>}</Field>
        <Field label="Message" required><textarea className="h-32 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />{errs.body && <span className={ERR}>{errs.body}</span>}</Field>
      </SlideOver>
    </>
  );
}

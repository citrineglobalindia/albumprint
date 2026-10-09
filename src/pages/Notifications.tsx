import { useMemo, useState } from "react";
import { MessageCircle, Mail, Smartphone, Phone, StickyNote, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { PageHeader, Panel, LineTabs, Pill, SearchInput, FilterSelect, Toggle, Th, Td, trCls, tableCls, Pagination, KpiRow, type Kpi } from "../components/ui";
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
const LOG: { ch: Ch; dir: "Inbound" | "Outbound"; tpl: string; to: string; at: string; status: string; order: string; msg: string }[] = [
  { ch: "WhatsApp", dir: "Outbound", tpl: "proof_ready", to: "+91 98•••• 43210", at: "3 Oct 2026, 11:02 AM", status: "Read", order: "IDP00072", msg: "Proof link shared with client" },
  { ch: "WhatsApp", dir: "Inbound", tpl: "—", to: "+91 99•••• 54321", at: "3 Oct 2026, 10:48 AM", status: "Read", order: "IDP00071", msg: "Client requested page 12 colour change" },
  { ch: "Email", dir: "Outbound", tpl: "order_created", to: "ra••@sharmastudio.in", at: "3 Oct 2026, 10:15 AM", status: "Delivered", order: "IDP00070", msg: "Order acknowledgement sent" },
  { ch: "SMS", dir: "Outbound", tpl: "payment_due", to: "+91 91•••• 56789", at: "2 Oct 2026, 05:30 PM", status: "Delivered", order: "IDP00069", msg: "Payment reminder ₹28,000" },
  { ch: "Call", dir: "Outbound", tpl: "—", to: "+91 88•••• 65544", at: "2 Oct 2026, 03:10 PM", status: "Sent", order: "IDP00068", msg: "Follow-up on final approval" },
  { ch: "WhatsApp", dir: "Outbound", tpl: "dispatched", to: "+91 77•••• 44332", at: "2 Oct 2026, 12:00 PM", status: "Failed", order: "IDP00067", msg: "Tracking DTDC458712396 — number not on WhatsApp" },
  { ch: "Internal Note", dir: "Outbound", tpl: "—", to: "Admin", at: "2 Oct 2026, 10:20 AM", status: "Sent", order: "IDP00066", msg: "Client prefers pickup on Saturday" },
  { ch: "Email", dir: "Outbound", tpl: "delivered", to: "ch••@mail.com", at: "1 Oct 2026, 04:15 PM", status: "Queued", order: "IDP00064", msg: "Delivery confirmation" },
];

export default function Notifications() {
  const [tab, setTab] = useState<"log" | "triggers">("log");
  const [q, setQ] = useState("");
  const [ch, setCh] = useState("All Channels");
  const [on, setOn] = useState<Record<string, [boolean, boolean]>>(Object.fromEntries(TRIGGERS.map(([t]) => [t, [true, t !== "Correction Received"]])));
  const [page, setPage] = useState(1);
  const rows = useMemo(() => LOG.filter((l) => (ch === "All Channels" || l.ch === ch) && (!q || [l.order, l.msg, l.to, l.tpl].some((v) => v.toLowerCase().includes(q.toLowerCase())))), [q, ch]);
  const kpis: Kpi[] = [
    { label: "Sent Today", value: 48, delta: 12, icon: ArrowUpRight, tone: "blue" },
    { label: "Delivered / Read", value: 41, delta: 8, icon: MessageCircle, tone: "green" },
    { label: "Failed", value: LOG.filter((l) => l.status === "Failed").length, delta: 0, icon: Smartphone, tone: "red", invert: true },
    { label: "Inbound Replies", value: 9, delta: 20, icon: ArrowDownLeft, tone: "violet" },
  ];
  return (
    <>
      <PageHeader title="Notifications" subtitle="Triggered messages and the full communication log, linked to orders." />
      <KpiRow items={kpis} />
      <Panel>
        <LineTabs className="mb-4" value={tab} onChange={setTab} tabs={[{ key: "log", label: "Communication Log" }, { key: "triggers", label: "Triggered Notifications" }]} />
        {tab === "log" ? (
          <>
            <div className="mb-3 flex flex-wrap gap-3"><SearchInput className="w-72" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search order, recipient, message…" /><FilterSelect value={ch} onChange={setCh} options={["All Channels", "WhatsApp", "Email", "SMS", "Call", "Internal Note"]} /></div>
            <div className="scroll-thin overflow-x-auto">
              <table className={tableCls}>
                <thead><tr><Th>Channel</Th><Th>Direction</Th><Th>Template</Th><Th>Recipient</Th><Th>Sent At</Th><Th>Status</Th><Th>Order</Th><Th>Summary</Th></tr></thead>
                <tbody>{rows.slice((page - 1) * 8, page * 8).map((l, i) => {
                  const I = CH_ICON[l.ch];
                  return <tr key={i} className={trCls}>
                    <Td><span className="inline-flex items-center gap-2 font-semibold"><I className="size-4 text-sub" />{l.ch}</span></Td>
                    <Td>{l.dir}</Td><Td className="font-mono text-xs">{l.tpl}</Td><Td>{l.to}</Td><Td>{l.at}</Td>
                    <Td><Pill tone={STATUS_TONE[l.status]} dot>{l.status}</Pill></Td><Td className="font-bold">{l.order}</Td><Td className="max-w-[320px] truncate">{l.msg}</Td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={8} total={rows.length} onPage={setPage} noun="messages" />
          </>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><Th>Trigger</Th><Th>Recipient</Th><Th>Behaviour</Th><Th>WhatsApp</Th><Th>Email</Th></tr></thead>
              <tbody>{TRIGGERS.map(([t, r, d]) => (
                <tr key={t} className={trCls}><Td className="font-bold">{t}</Td><Td>{r}</Td><Td className="text-sub">{d}</Td>
                  <Td><Toggle on={on[t]![0]} onChange={(v) => setOn({ ...on, [t!]: [v, on[t!]![1]] })} /></Td>
                  <Td><Toggle on={on[t]![1]} onChange={(v) => setOn({ ...on, [t!]: [on[t!]![0], v] })} /></Td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { Factory, PackageCheck, Plus, Send, Truck } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, LineTabs, SearchInput, Field, inputCls, tableCls, Th, Td, trCls, cx, type Kpi } from "../components/ui";
import { ExportBtn } from "../components/listKit";
import { downloadCsv } from "../lib/csv";
import { useToast } from "../components/Toast";
import { useStore } from "../lib/store";
import { ORDERS } from "../lib/data";
import { fmtDate, inr } from "../lib/format";
import { ALBUM_LABS, LABS, LAB_STATUS_LABEL, albumPurchase, albumsOf, canManageLabs, canMoveLabWork, canSeeCost, labName, profitOf, purchaseOf, saveLab, setLabStatus, type Lab, type LabStatus } from "../lib/labs";

// Labs: the printing labs we use, and every album's work at a lab — waiting to be sent, at the lab, received back.
type Tab = LabStatus | "all";
const TONE: Record<LabStatus, "slate" | "amber" | "green"> = { not_sent: "slate", sent: "amber", received: "green" };

export default function Labs() {
  useStore();
  const [toast, show] = useToast();
  const [tab, setTab] = useState<Tab>("sent");
  const [lab, setLab] = useState(""); const [q, setQ] = useState("");
  const [edit, setEdit] = useState<(Omit<Lab, "id"> & { id?: string }) | null>(null);
  const move = canMoveLabWork(), cost = canSeeCost();
  const rows = ALBUM_LABS.filter((a) => a.labId).map((a) => ({ a, o: ORDERS.find((o) => o.id === a.orderId) })).filter((r) => r.o && r.o.hold !== "Cancelled") as { a: (typeof ALBUM_LABS)[number]; o: (typeof ORDERS)[number] }[];
  const cnt = (s: LabStatus) => rows.filter((r) => r.a.status === s).length;
  const term = q.trim().toLowerCase();
  const list = rows.filter((r) => (tab === "all" || r.a.status === tab) && (!lab || r.a.labId === lab) && (!term || [r.o.id, r.o.customer, r.o.event, labName(r.a.labId)].some((x) => x.toLowerCase().includes(term))))
    .sort((x, y) => (x.a.sentAt ?? "").localeCompare(y.a.sentAt ?? ""));
  const kpis: Kpi[] = [
    { label: "Waiting to send", value: cnt("not_sent"), icon: Factory, tone: "slate" },
    { label: "At the lab", value: cnt("sent"), icon: Truck, tone: "amber" },
    { label: "Received back", value: cnt("received"), icon: PackageCheck, tone: "green" },
    { label: "Labs", value: LABS.filter((l) => l.active).length, icon: Factory, tone: "blue" },
  ];
  const title = (orderId: string, pos: number) => albumsOf(ORDERS.find((o) => o.id === orderId)!).find((a) => a.position === pos)?.title ?? `Album ${pos}`;
  const go = (orderId: string, pos: number, s: LabStatus) => void setLabStatus(orderId, pos, s).then((r) => show(r.msg));
  const save = async () => { if (!edit) return; const r = await saveLab(edit); show(r.msg); if (r.ok) setEdit(null); };
  return (
    <>
      <PageHeader title="Labs" subtitle="Printing labs we use, and each album's work there: send it, then mark it received back." />
      <KpiRow items={kpis} cols={4} />
      <Panel className="mt-5" title="Lab work" subtitle="Assign the lab on the order page (Printing lab); albums then show up here" bodyClassName="p-0"
        action={<ExportBtn aria="Export lab work" onClick={() => downloadCsv("lab-work.csv", [["Order", "Album", "Customer", "Lab", "Status", "Sent", "Sent by", "Received", "Received by", ...(cost ? ["Purchase"] : [])], ...list.map(({ a, o }) => [o.id, title(o.id, a.position), o.customer, labName(a.labId), LAB_STATUS_LABEL[a.status], a.sentAt?.slice(0, 10) ?? "", a.sentBy ?? "", a.receivedAt?.slice(0, 10) ?? "", a.receivedBy ?? "", ...(cost ? [purchaseOf(o.id, a.position) ?? ""] : [])])])} />}>
        <div className="flex flex-wrap items-center gap-3 px-5 pt-3">
          <LineTabs<Tab> className="!border-0" value={tab} onChange={setTab} tabs={[{ key: "not_sent", label: "Waiting to send", count: cnt("not_sent") }, { key: "sent", label: "At the lab", count: cnt("sent") }, { key: "received", label: "Received", count: cnt("received") }, { key: "all", label: "All", count: rows.length }]} />
          <select aria-label="Filter by lab" className={cx(inputCls, "ml-auto h-9 w-48 text-sm")} value={lab} onChange={(e) => setLab(e.target.value)}><option value="">All labs</option>{LABS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <div className="w-60"><SearchInput value={q} onChange={setQ} placeholder="Search order, customer, lab…" /></div>
        </div>
        <div className="overflow-x-auto">
          <table className={tableCls} data-testid="lab-work">
            <thead><tr><Th>Order</Th><Th>Album</Th><Th>Customer</Th><Th>Lab</Th><Th>Status</Th><Th>Sent</Th><Th>Received</Th>{cost && <Th className="text-right">Purchase</Th>}<Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {list.map(({ a, o }) => (
                <tr key={`${a.orderId}-${a.position}`} className={trCls} data-testid={`labrow-${a.orderId}-${a.position}`}>
                  <Td><Link to={`/orders/${o.id}`} className="font-bold text-brand hover:underline">{o.id}</Link></Td>
                  <Td>{title(o.id, a.position)}</Td><Td>{o.customer}</Td><Td className="font-semibold">{labName(a.labId)}</Td>
                  <Td><Pill tone={TONE[a.status]}>{LAB_STATUS_LABEL[a.status]}</Pill></Td>
                  <Td>{a.sentAt ? `${fmtDate(a.sentAt)}${a.sentBy ? ` · ${a.sentBy}` : ""}` : "—"}</Td>
                  <Td>{a.receivedAt ? `${fmtDate(a.receivedAt)}${a.receivedBy ? ` · ${a.receivedBy}` : ""}` : "—"}</Td>
                  {cost && <Td className="text-right">{(() => { const x = albumPurchase(o, a.position); return x ? <>{inr(x.amount)}{x.source === "lab rates" && <span className="ml-1 text-[10px] font-semibold text-violet-800">lab rates</span>}</> : "—"; })()}</Td>}
                  <td className="px-3 py-2 text-right">
                    {move && a.status === "not_sent" && <button type="button" onClick={() => go(o.id, a.position, "sent")} className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand px-3 text-xs font-bold text-white hover:bg-brand-dark"><Send className="size-3.5" />Send</button>}
                    {move && a.status === "sent" && <button type="button" onClick={() => go(o.id, a.position, "received")} className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"><PackageCheck className="size-3.5" />Receive</button>}
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-sub">Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      {cost && (() => {
        const withP = ORDERS.filter((o) => o.hold !== "Cancelled" && profitOf(o).entered);
        const sell = withP.reduce((s, o) => s + o.total, 0), pur = withP.reduce((s, o) => s + profitOf(o).purchase, 0);
        return (
          <Panel className="mt-5" title="Profit" action={<ExportBtn aria="Export profit" onClick={() => downloadCsv("profit.csv", [["Order", "Customer", "Event", "Order date", "Selling", "Purchase", "Profit", "Margin %", "Complete"], ...withP.map((o) => { const p = profitOf(o); return [o.id, o.customer, o.event, o.pendingAt, p.selling, p.purchase, p.profit, Number(p.margin.toFixed(1)), p.complete ? "yes" : "partial"]; })])} />} subtitle={`${withP.length} order(s) with purchase amounts · selling ${inr(sell)} · purchase ${inr(pur)} · profit ${inr(sell - pur)}${sell ? ` (${(((sell - pur) / sell) * 100).toFixed(1)}%)` : ""}`} bodyClassName="p-0">
            <div className="overflow-x-auto"><table className={tableCls} data-testid="profit-table">
              <thead><tr><Th>Order</Th><Th>Customer</Th><Th className="text-right">Selling</Th><Th className="text-right">Purchase</Th><Th className="text-right">Profit</Th><Th className="text-right">Margin</Th></tr></thead>
              <tbody>{withP.map((o) => { const p = profitOf(o); return (
                <tr key={o.id} className={trCls}><Td><Link to={`/orders/${o.id}`} className="font-bold text-brand hover:underline">{o.id}</Link>{!p.complete && <span className="ml-1 text-[11px] text-amber-700">(partial)</span>}{p.estimated && <span className="ml-1 text-[11px] text-violet-800">(lab rates)</span>}</Td><Td>{o.customer}</Td>
                  <Td className="text-right">{inr(p.selling)}</Td><Td className="text-right">{inr(p.purchase)}</Td><Td className={cx("text-right font-bold", p.profit < 0 ? "text-rose-600" : "text-emerald-700")}>{inr(p.profit)}</Td><Td className="text-right">{p.margin.toFixed(1)}%</Td></tr>); })}
                {withP.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-sub">Choose the lab on each album and enter the labs' purchase rates (Catalog › Prices), or type purchase amounts on the order page, to see profit here.</td></tr>}
              </tbody>
            </table></div>
          </Panel>
        );
      })()}

      <Panel className="mt-5" title="Our labs" subtitle="The labs that print for us" action={canManageLabs() ? <button type="button" onClick={() => setEdit({ name: "", contact: "", phone: "", notes: "", active: true })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-bold text-white hover:bg-brand-dark"><Plus className="size-4" />Add lab</button> : undefined}>
        {edit && (
          <div className="mb-4 grid gap-x-3 rounded-xl border border-brand/40 bg-brand-soft/30 p-3 md:grid-cols-2" data-testid="lab-form">
            <Field label="Lab name" required><input aria-label="Lab name" className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Contact person"><input aria-label="Lab contact" className={inputCls} value={edit.contact ?? ""} onChange={(e) => setEdit({ ...edit, contact: e.target.value })} /></Field>
            <Field label="Phone"><input aria-label="Lab phone" className={inputCls} value={edit.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Notes"><input aria-label="Lab notes" className={inputCls} value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Active (can be chosen on orders)</label>
            <div className="flex justify-end gap-2 md:col-span-2"><button type="button" onClick={() => setEdit(null)} className="h-9 rounded-lg px-3 text-sm font-bold hover:bg-slate-100">Cancel</button><button type="button" onClick={() => void save()} className="h-9 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark">Save lab</button></div>
          </div>
        )}
        <ul className="divide-y divide-line" data-testid="lab-list">
          {LABS.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 py-2 text-[13px]">
              <b className="min-w-0 flex-1">{l.name}</b><span className="text-sub">{[l.contact, l.phone].filter(Boolean).join(" · ") || "—"}</span>
              <Pill tone={l.active ? "green" : "slate"}>{l.active ? "Active" : "Inactive"}</Pill>
              <span className="text-xs text-sub">{ALBUM_LABS.filter((a) => a.labId === l.id && a.status === "sent").length} at lab</span>
              {canManageLabs() && <button type="button" onClick={() => setEdit({ ...l })} className="text-xs font-bold text-brand hover:underline">Edit</button>}
            </li>
          ))}
          {LABS.length === 0 && <li className="py-4 text-center text-sm text-sub">No labs yet.</li>}
        </ul>
      </Panel>
      {toast}
    </>
  );
}

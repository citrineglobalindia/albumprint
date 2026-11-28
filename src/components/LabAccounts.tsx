import { useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Paperclip, Trash2, Wallet } from "lucide-react";
import { Panel, Pill, Td, Th, cx, inputCls, tableCls, trCls } from "./ui";
import { ExportBtn } from "./listKit";
import { downloadCsv } from "../lib/csv";
import { useStore } from "../lib/store";
import { currentActor } from "../lib/audit";
import { inr, fmtDate } from "../lib/format";
import { MODES, TODAY_STR } from "../lib/finance";
import { LABS, LAB_PAYMENTS, NO_LAB, addLabPayment, deleteLabPayment, labName, labPayable, openPurchaseBill, purchaseHistory, uploadPurchaseBill } from "../lib/labs";

type Res = { ok: boolean; msg: string };

/** Labs page (admin / accounts): each lab's purchase bills, payments made to it and what we still owe it (payable). */
export function LabAccounts({ onDone }: { onDone: (msg: string, ok: boolean) => void }) {
  useStore();
  const labs = LABS.filter((l) => l.active || purchaseHistory(l.id).length || LAB_PAYMENTS.some((p) => p.labId === l.id));
  const [sel, setSel] = useState<string>(labs[0]?.id ?? "");
  const noLab = purchaseHistory(NO_LAB);
  const totals = labs.map((l) => ({ l, ...labPayable(l.id) }));
  const all = totals.reduce((a, t) => ({ purchases: a.purchases + t.purchases, paid: a.paid + t.paid, payable: a.payable + t.payable }), { purchases: 0, paid: 0, payable: 0 });
  return (
    <Panel className="mt-5" title="Lab purchases & payable" subtitle={`Purchase bills ${inr(all.purchases)} · paid ${inr(all.paid)} · still payable ${inr(all.payable)}`} bodyClassName="p-0">
      <div className="overflow-x-auto"><table className={tableCls} data-testid="lab-payables">
        <thead><tr><Th>Lab</Th><Th className="text-right">Purchase bills</Th><Th className="text-right">Paid</Th><Th className="text-right">Payable (pending)</Th><Th /></tr></thead>
        <tbody>
          {totals.map(({ l, purchases, paid, payable }) => (
            <tr key={l.id} className={cx(trCls, "cursor-pointer", sel === l.id && "bg-brand-soft")} onClick={() => setSel(l.id)} data-testid={`payable-${l.id}`}>
              <Td className="font-bold">{l.name}</Td><Td className="text-right">{inr(purchases)}</Td><Td className="text-right text-emerald-700">{inr(paid)}</Td>
              <Td className={cx("text-right font-extrabold", payable > 0 ? "text-rose-600" : payable < 0 ? "text-amber-700" : "text-emerald-700")}>{payable < 0 ? `${inr(-payable)} advance` : inr(payable)}</Td>
              <Td className="text-right"><span className="text-xs font-bold text-brand">{sel === l.id ? "Showing ↓" : "View →"}</span></Td>
            </tr>
          ))}
          {noLab.length > 0 && <tr className={trCls}><Td className="text-sub">No lab chosen on the album</Td><Td className="text-right text-sub">{inr(noLab.reduce((s, p) => s + p.amount, 0))}</Td><Td /><Td className="text-right text-[11px] text-sub">choose the lab on those albums</Td><Td /></tr>}
          {totals.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-sub">Add your labs below first.</td></tr>}
        </tbody>
      </table></div>
      {sel && LABS.some((l) => l.id === sel) && <LabDetail labId={sel} onDone={onDone} />}
    </Panel>
  );
}

function LabDetail({ labId, onDone }: { labId: string; onDone: (msg: string, ok: boolean) => void }) {
  const hist = purchaseHistory(labId), pays = LAB_PAYMENTS.filter((p) => p.labId === labId).sort((a, b) => b.date.localeCompare(a.date)), t = labPayable(labId);
  const [f, setF] = useState({ amount: "", date: TODAY_STR, mode: "Bank Transfer", ref: "", note: "" });
  const [busy, setBusy] = useState(false);
  const run = async (p: Promise<Res>, after?: () => void) => { setBusy(true); const r = await p; setBusy(false); onDone(r.msg, r.ok); if (r.ok) after?.(); };
  const name = labName(labId);
  const csv = () => downloadCsv(`lab-${name}.csv`, [["Date", "Type", "Order", "Album", "Customer", "Bill no.", "Purchase", "Paid", "Mode / ref"],
    ...hist.map((p) => [p.date, "Purchase bill", p.orderId, p.title, p.customer, p.billNo ?? "", p.amount, "", ""]),
    ...pays.map((p) => [p.date, "Payment", "", "", "", "", "", p.amount, [p.mode, p.ref].filter(Boolean).join(" · ")])]);
  return (
    <div className="border-t border-line p-4" data-testid="lab-detail">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="flex-1 text-base font-extrabold">{name}</h3>
        <Pill tone="slate">Bills {inr(t.purchases)}</Pill><Pill tone="green">Paid {inr(t.paid)}</Pill>
        <span data-testid="lab-payable"><Pill tone={t.payable > 0 ? "red" : "green"}>{t.payable < 0 ? `Advance ${inr(-t.payable)}` : `Payable ${inr(t.payable)}`}</Pill></span>
        <ExportBtn aria={`Export ${name} account`} onClick={csv} />
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); void run(addLabPayment({ labId, amount: Number(f.amount || 0), date: f.date, mode: f.mode, ref: f.ref, note: f.note }), () => setF({ ...f, amount: "", ref: "", note: "" })); }}>
        <div className="w-full text-[11px] font-bold uppercase tracking-wide text-sub"><Wallet className="mr-1 inline size-3.5" />Record a payment to {name}</div>
        <label className="text-xs font-semibold text-sub">Amount (₹)<input aria-label="Lab payment amount" type="number" min={1} step="0.01" className={cx(inputCls, "mt-1 h-9 !w-32 text-sm")} placeholder={t.payable > 0 ? String(t.payable) : ""} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="text-xs font-semibold text-sub">Date<input aria-label="Lab payment date" type="date" max={TODAY_STR} className={cx(inputCls, "mt-1 h-9 !w-40 text-sm")} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="text-xs font-semibold text-sub">Mode<select aria-label="Lab payment mode" className={cx(inputCls, "mt-1 h-9 !w-36 text-sm")} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="text-xs font-semibold text-sub">Reference<input aria-label="Lab payment reference" className={cx(inputCls, "mt-1 h-9 !w-36 text-sm")} placeholder="UTR / cheque no." value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></label>
        <label className="min-w-[160px] flex-1 text-xs font-semibold text-sub">Note<input aria-label="Lab payment note" className={cx(inputCls, "mt-1 h-9 text-sm")} placeholder="optional" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <button type="submit" disabled={busy || !f.amount} className="h-9 rounded-lg bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40">Save payment</button>
      </form>

      <h4 className="mb-1 text-[13px] font-extrabold">Purchase history · {hist.length} bill{hist.length === 1 ? "" : "s"}</h4>
      <div className="mb-4 overflow-x-auto rounded-xl border border-line"><table className={tableCls} data-testid="lab-purchases">
        <thead><tr><Th>Bill date</Th><Th>Order</Th><Th>Album</Th><Th>Customer</Th><Th>Bill no.</Th><Th className="text-right">Amount</Th><Th>Bill file</Th></tr></thead>
        <tbody>
          {hist.map((p) => (
            <tr key={`${p.orderId}-${p.position}`} className={trCls}>
              <Td>{p.date ? fmtDate(p.date) : "—"}</Td>
              <Td><Link to={`/orders/${p.orderId}`} className="font-bold text-brand hover:underline">{p.orderId}</Link></Td>
              <Td>{p.title}</Td><Td>{p.customer}</Td><Td>{p.billNo ?? <span className="text-sub">—</span>}</Td>
              <Td className="text-right font-bold">{inr(p.amount)}</Td>
              <Td><span className="inline-flex items-center gap-2">
                {p.billFile && <button type="button" aria-label={`View bill for ${p.orderId} album ${p.position}`} onClick={() => void openPurchaseBill(p.orderId, p.position).then((r) => onDone(r.msg, r.ok))} className="inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline"><FileText className="size-3.5" />View</button>}
                <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-sub hover:text-brand"><Paperclip className="size-3.5" />{p.billFile ? "Replace" : "Upload"}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" aria-label={`Upload bill for ${p.orderId} album ${p.position}`} className="sr-only" onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ""; if (fl) void uploadPurchaseBill(p.orderId, p.position, fl).then((r) => onDone(r.msg, r.ok)); }} />
                </label>
              </span></Td>
            </tr>
          ))}
          {hist.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-sub">No purchase bills for {name} yet — enter them on each order (Lab, purchase &amp; profit) after choosing this lab for the album.</td></tr>}
        </tbody>
      </table></div>

      <h4 className="mb-1 text-[13px] font-extrabold">Payments made · {pays.length}</h4>
      <div className="overflow-x-auto rounded-xl border border-line"><table className={tableCls} data-testid="lab-payments">
        <thead><tr><Th>Date</Th><Th className="text-right">Amount</Th><Th>Mode</Th><Th>Reference</Th><Th>Note</Th><Th>By</Th><Th /></tr></thead>
        <tbody>
          {pays.map((p) => (
            <tr key={p.id} className={trCls}>
              <Td>{fmtDate(p.date)}</Td><Td className="text-right font-bold text-emerald-700">{inr(p.amount)}</Td><Td>{p.mode}</Td><Td>{p.ref ?? "—"}</Td><Td>{p.note ?? "—"}</Td><Td>{p.by ?? "—"}</Td>
              <Td className="text-right">{currentActor().role === "admin" && <button type="button" aria-label={`Remove payment of ${p.amount}`} onClick={() => { if (window.confirm(`Remove the payment of ${inr(p.amount)} to ${name}?`)) void run(deleteLabPayment(p.id)); }} className="text-rose-600 hover:text-rose-700"><Trash2 className="size-4" /></button>}</Td>
            </tr>
          ))}
          {pays.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-sub">No payments to {name} yet.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}

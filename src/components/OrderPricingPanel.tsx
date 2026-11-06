import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Download, Lock, Pencil, Printer, RotateCcw } from "lucide-react";
import { Panel, Pill } from "./ui";
import { InvoiceView } from "./InvoiceView";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import type { Order } from "../lib/data";
import { DRAFTS, cancelReopen, pricingOf, reopenOrder } from "../lib/orders2";
import { downloadBlob, invoicePdf, openBlob } from "../lib/invoicePdf";
import { ShareInvoice } from "./ShareInvoice";

/** A finalized order's pricing: the invoice exactly as issued, its PDF, and the admin-only authorized edit (reopen). */
export default function OrderPricingPanel({ o, show }: { o: Order; show: (m: string) => void }) {
  useStore();
  const { role } = useAuth();
  const nav = useNavigate();
  const pr = pricingOf(o.id);
  const [asking, setAsking] = useState(false); const [reason, setReason] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  if (!pr) return null;
  const isAdmin = role === "admin";
  const editing = DRAFTS.find((d) => !d.result && (d.payload.reopenOrder === o.id || d.payload.reopenOrder === o.uid));
  const pdf = async (open: boolean) => { const b = await invoicePdf(pr.snapshot, { paid: o.paid }); if (open) openBlob(b); else downloadBlob(b, `${pr.invoiceNo ?? o.id}.pdf`); };
  const reopen = async () => {
    setBusy(true); setMsg("");
    const r = await reopenOrder(o, reason);
    setBusy(false);
    if ("error" in r) { setMsg(r.error); return; }
    show(`Order ${o.id} reopened for editing`); nav(`/orders/new?draft=${r.draftId}`);
  };
  return (
    <Panel title="Pricing & invoice" subtitle={`${pr.status === "finalized" ? "Finalized" : "Reopened for editing"} · revision ${pr.revision} · ${new Date(pr.finalizedAt).toLocaleString("en-IN")}`} className="mb-5"
      action={<div className="flex flex-wrap gap-2">
        <Pill tone={pr.status === "finalized" ? "green" : "amber"} icon={pr.status === "finalized" ? Lock : AlertTriangle}>{pr.status === "finalized" ? "Prices locked" : "Being edited"}</Pill>
        <button onClick={() => void pdf(false)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft"><Download className="size-3.5" />PDF</button>
        <ShareInvoice compact snapshot={async () => pr.snapshot} paid={o.paid} />
        <button onClick={() => void pdf(true)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft"><Printer className="size-3.5" />Print</button>
        {isAdmin && pr.status === "finalized" && <button onClick={() => setAsking(true)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-amber-300 px-3 text-xs font-bold text-amber-800 hover:bg-amber-50"><Pencil className="size-3.5" />Edit (reopen)</button>}
      </div>} >
      <div data-testid="order-pricing">
        {pr.status === "reopened" && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="size-4" />Reopened{pr.reopenReason ? `: ${pr.reopenReason}` : ""}. Invoice {pr.invoiceNo} is void until the order is finalized again.
            <span className="ml-auto flex gap-2">
              {editing && <button onClick={() => nav(`/orders/new?draft=${editing.id}`)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white">Continue editing</button>}
              {isAdmin && <button onClick={async () => { const e = await cancelReopen(o); show(e ?? "Edit cancelled — the order is back as it was finalized"); }} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold"><RotateCcw className="size-3.5" />Cancel edit</button>}
            </span>
          </div>
        )}
        {asking && (
          <div className="mb-4 rounded-xl border border-line bg-slate-50 p-4" role="dialog" aria-label="Reopen order">
            <p className="mb-2 text-sm"><b>Authorized edit.</b> The current invoice is voided (it stays on record) and the order's selections open in the order builder. Finalizing again issues a new invoice revision. A reason is required.</p>
            <textarea aria-label="Reason for reopening" className="h-20 w-full rounded-lg border border-line p-3 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer added a second copy" />
            {msg && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{msg}</p>}
            <div className="mt-2 flex gap-2"><button disabled={busy} onClick={() => void reopen()} className="h-9 rounded-lg bg-amber-600 px-4 text-sm font-bold text-white disabled:opacity-60">Reopen for editing</button><button onClick={() => { setAsking(false); setMsg(""); }} className="h-9 rounded-lg px-4 text-sm font-bold">Cancel</button></div>
          </div>
        )}
        <InvoiceView s={pr.snapshot} paid={o.paid} />
      </div>
    </Panel>
  );
}

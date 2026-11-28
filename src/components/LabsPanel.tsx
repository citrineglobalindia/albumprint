import { useState } from "react";
import { Link } from "react-router-dom";
import { PackageCheck, Send, TrendingUp, Undo2 } from "lucide-react";
import { Panel, Pill, cx, inputCls } from "./ui";
import { useStore } from "../lib/store";
import { advanceAfter } from "../lib/albumFlow";
import { inr, fmtDate } from "../lib/format";
import type { Order } from "../lib/data";
import { LABS, LAB_STATUS_LABEL, albumLab, albumsOf, canManageLabs, canMoveLabWork, canSeeCost, estimatedPurchase, labName, profitOf, purchaseRec, setAlbumLab, setLabStatus, setPurchase, type LabStatus } from "../lib/labs";
import { TODAY_STR } from "../lib/finance";

const TONE: Record<LabStatus, "slate" | "amber" | "green"> = { not_sent: "slate", sent: "amber", received: "green" };

/** Order page: which lab prints each album, its progress there, the purchase amount and the order's profit. */
export function LabsPanel({ o, onDone }: { o: Order; onDone: (msg: string, ok: boolean) => void }) {
  useStore();
  const cost = canSeeCost(), move = canMoveLabWork();
  const [edit, setEdit] = useState<Record<number, { amount: string; billNo: string; billDate: string }>>({});
  const run = (p: Promise<{ ok: boolean; msg: string }>) => void p.then((r) => { onDone(r.msg, r.ok); const a = r.ok ? advanceAfter(o.id, "printing") : null; if (a) onDone(a.msg, a.ok); });
  const labs = LABS.filter((l) => l.active);
  const pr = profitOf(o);
  return (
    <Panel title={cost ? "Lab, purchase & profit" : "Printing lab"} subtitle={cost ? "Which lab prints each album, the purchase bill (amount, bill no., date) and the order's profit" : "Which lab prints each album and its progress there"}>
      {LABS.length === 0 && <p className="mb-2 text-xs text-sub">No labs yet.{canManageLabs() ? <> Add them in <Link to="/labs" className="font-bold text-brand underline">Labs</Link>.</> : " An admin adds them in Labs."}</p>}
      <ul className="space-y-2.5" data-testid="labs-panel">
        {albumsOf(o).map((a) => {
          const al = albumLab(o.id, a.position), st: LabStatus = al?.status ?? "not_sent", rec = purchaseRec(o.id, a.position), p = rec?.amount;
          const f = edit[a.position] ?? { amount: p !== undefined ? String(p) : "", billNo: rec?.billNo ?? "", billDate: rec?.billDate ?? "" };
          const dirty = !!edit[a.position] && (f.amount !== (p !== undefined ? String(p) : "") || f.billNo !== (rec?.billNo ?? "") || f.billDate !== (rec?.billDate ?? ""));
          const set = (k: "amount" | "billNo" | "billDate", v: string) => setEdit({ ...edit, [a.position]: { ...f, [k]: v } });
          return (
            <li key={a.position} className="rounded-xl border border-line p-3 text-[13px]" data-testid={`lab-album-${a.position}`}>
              <div className="flex flex-wrap items-center gap-2">
                <b className="min-w-0 flex-1 truncate">{a.title}</b>
                <span data-testid="lab-status"><Pill tone={TONE[st]}>{LAB_STATUS_LABEL[st]}</Pill></span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select aria-label={`Lab for ${a.title}`} disabled={!move} className={cx(inputCls, "h-9 w-52 text-sm")} value={al?.labId ?? ""} onChange={(e) => run(setAlbumLab(o.id, a.position, e.target.value || undefined))}>
                  <option value="">{move ? "Choose a lab…" : "No lab"}</option>
                  {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  {al?.labId && !labs.some((l) => l.id === al.labId) && <option value={al.labId}>{labName(al.labId)} (inactive)</option>}
                </select>
                {move && st === "not_sent" && <button type="button" disabled={!al?.labId} onClick={() => run(setLabStatus(o.id, a.position, "sent"))} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-40"><Send className="size-3.5" />Send to lab</button>}
                {move && st === "sent" && <button type="button" onClick={() => run(setLabStatus(o.id, a.position, "received"))} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"><PackageCheck className="size-3.5" />Received from lab</button>}
                {move && st !== "not_sent" && <button type="button" title="Undo" aria-label="Undo lab step" onClick={() => run(setLabStatus(o.id, a.position, st === "received" ? "sent" : "not_sent"))} className="grid size-9 place-items-center rounded-lg border border-line text-sub hover:bg-slate-50"><Undo2 className="size-3.5" /></button>}
              </div>
              {(al?.sentAt || al?.receivedAt) && <div className="mt-1.5 text-xs text-sub">{al?.sentAt && <>Sent {fmtDate(al.sentAt)}{al.sentBy ? ` by ${al.sentBy}` : ""}</>}{al?.receivedAt && <> · received {fmtDate(al.receivedAt)}{al.receivedBy ? ` by ${al.receivedBy}` : ""}</>}</div>}
              {cost && (
                <div className="mt-2 rounded-lg bg-slate-50 p-2.5" data-testid={`purchase-${a.position}`}>
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-sub">Purchase bill</div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs font-semibold text-sub">Purchase amount (₹)<input id={`pa-${o.id}-${a.position}`} aria-label={`Purchase amount for ${a.title}`} type="number" min={0} step="0.01" className={cx(inputCls, "mt-1 h-9 w-36 text-sm")} placeholder="What we paid" value={f.amount} onChange={(e) => set("amount", e.target.value)} /></label>
                    <label className="text-xs font-semibold text-sub">Bill no.<input aria-label={`Bill number for ${a.title}`} className={cx(inputCls, "mt-1 h-9 w-36 text-sm")} placeholder="Supplier bill no." value={f.billNo} onChange={(e) => set("billNo", e.target.value)} /></label>
                    <label className="text-xs font-semibold text-sub">Bill date<input aria-label={`Bill date for ${a.title}`} type="date" max={TODAY_STR} className={cx(inputCls, "mt-1 h-9 w-40 text-sm")} value={f.billDate} onChange={(e) => set("billDate", e.target.value)} /></label>
                    <button type="button" disabled={!dirty} onClick={() => { const n = f.amount.trim() === "" ? null : Number(f.amount); void setPurchase(o.id, a.position, n, { billNo: f.billNo, billDate: f.billDate }).then((r) => { onDone(r.msg, r.ok); if (r.ok) { const e2 = { ...edit }; delete e2[a.position]; setEdit(e2); } }); }} className="inline-flex h-9 items-center rounded-lg bg-brand px-3 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-40">Save purchase</button>
                  </div>
                  {(() => { const e = estimatedPurchase(o, a.position); if (!e) return p !== undefined ? null : <span className="mt-1 block text-[11px] text-sub">No purchase cost on these items yet{al?.labId ? ` for ${labName(al.labId)}` : ""} — add it in Catalog › Prices (Purchase cost · Standard)</span>; return (
                    <span className={cx("mt-1 block text-[11px]", p === undefined ? "font-semibold text-violet-800" : "text-sub")} data-testid={`lab-estimate-${a.position}`}>
                      {p === undefined ? "Estimated from" : "From"} {al?.labId ? `${labName(al.labId)} / standard` : "standard"} purchase costs: {inr(e.amount)}{e.missing.length ? ` · no rate for ${e.missing.join(", ")}` : ""}{p !== undefined ? " (the amount typed is used)" : ""}
                    </span>); })()}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {cost && (
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center" data-testid="profit">
          <div><div className="text-[11px] text-sub">Customer billing</div><div className="font-extrabold">{inr(pr.selling)}</div></div>
          <div><div className="text-[11px] text-sub">Purchase (expense)</div><div className="font-extrabold">{pr.entered ? inr(pr.purchase) : "—"}</div>{pr.estimated && <div className="text-[10px] font-semibold text-violet-800">incl. estimated costs</div>}</div>
          <div><div className="flex items-center justify-center gap-1 text-[11px] text-sub"><TrendingUp className="size-3" />Profit</div>
            <div className={cx("font-extrabold", pr.profit < 0 ? "text-rose-600" : "text-emerald-700")} data-testid="profit-value">{pr.entered ? `${inr(pr.profit)} (${pr.margin.toFixed(1)}%)` : "—"}</div></div>
          {pr.entered && !pr.complete && <p className="col-span-3 text-[11px] text-amber-700">Some albums have no purchase amount yet — the profit counts only those entered.</p>}
          {pr.missingRates && <p className="col-span-3 text-[11px] text-amber-700">Some items have no purchase cost yet — add them in Catalog › Prices (Purchase cost · Standard, or a lab) for an exact profit.</p>}
        </div>
      )}
    </Panel>
  );
}

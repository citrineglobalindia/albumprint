import { cx } from "./ui";
import { SCOPE_LABEL } from "../lib/catalog2";
import { money, type PricedOrder } from "../lib/orderPricing";
import type { InvoiceSnapshot } from "../lib/orders2";

const ORDER_TYPE: Record<string, string> = { design_printing: "Design + Printing", printing_only: "Album Printing Only" };
const date = (iso?: string) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const SCOPE_TONE = { copy: "bg-sky-50 text-sky-700", album: "bg-violet-50 text-violet-700", order: "bg-amber-50 text-amber-700" } as const;

/** The invoice on screen: per-album sections, scope of every charge, discount, tax, final amount, payments and balance. Same content as the PDF. */
export function InvoiceView({ s, paid = 0, preview = false }: { s: InvoiceSnapshot | (PricedOrder & Partial<InvoiceSnapshot>); paid?: number; preview?: boolean }) {
  const b = s.business ?? {}; const c = s.customer; const ev = s.event;
  const balance = Math.round((s.total - paid) * 100) / 100;
  return (
    <div className="rounded-2xl border border-line bg-white p-5 text-[13px] sm:p-7" data-testid="invoice-view">
      <div className="flex flex-wrap justify-between gap-4 border-b border-line pb-4">
        <div className="min-w-0">{s.showBusinessName === false ? null : <div className="text-lg font-extrabold text-ink" data-testid="invoice-business-name">{b.name || "Your business name (set it in Settings)"}</div>}
          <div className="whitespace-pre-line text-xs text-sub">{[b.legal, b.address, [b.phone, b.email].filter(Boolean).join(" · "), b.gstin ? `GSTIN ${b.gstin}` : ""].filter(Boolean).join("\n")}</div></div>
        <div className="text-right"><div className="text-xl font-extrabold text-brand">{preview ? "Invoice preview" : s.taxEnabled ? "Tax invoice" : "Invoice"}</div>
          {preview ? <div className="text-xs text-sub">The invoice number is assigned when the order is finalized</div>
            : <><div className="font-bold" data-testid="invoice-number">{s.invoiceNumber}</div><div className="text-xs text-sub">{date(s.invoiceDate)}{s.revision && s.revision > 1 ? ` · revision ${s.revision}` : ""}</div></>}</div>
      </div>
      <div className="grid gap-4 border-b border-line py-4 sm:grid-cols-2">
        <div><div className="text-[11px] font-bold uppercase text-sub">Bill to</div><div className="font-bold">{c?.name || "—"}</div><div className="text-xs text-sub">{[c?.phone, c?.email, c?.address].filter(Boolean).join(" · ")}</div></div>
        <div><div className="text-[11px] font-bold uppercase text-sub">Order & event</div><div className="font-bold">{s.orderCode ?? "New order"} · {ORDER_TYPE[s.orderType] ?? "—"}</div>
          <div className="text-xs text-sub">{[ev?.type, ev?.name].filter(Boolean).join(" — ") || "—"}{s.orderDate ? ` · ordered ${date(s.orderDate)}` : ""}{ev?.date ? ` · event ${date(ev.date)}` : ""} · delivery {date(s.dueDate || ev?.delivery)}</div></div>
      </div>
      {s.albums.map((a) => (
        <section key={a.index} className="border-b border-line py-4" aria-label={`Invoice section ${a.name}`}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3"><h3 className="text-sm font-extrabold">{a.name}</h3><span className="text-xs text-sub">{a.sheets} sheets · {a.copies} {a.copies === 1 ? "copy" : "copies"}{[a.size, a.paper, a.finish].some(Boolean) ? ` · ${[a.size, a.paper, a.finish].filter(Boolean).join(" / ")}` : ""}</span></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-[12.5px]">
            <thead className="text-[11px] uppercase text-sub"><tr><th className="py-1 text-left">Item</th><th className="text-left">Scope</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{a.lines.map((l) => (
              <tr key={l.position} className="border-t border-line/60">
                <td className="py-1.5"><span className="font-semibold">{l.name}</span>{(l.rule || l.note || !!l.discount) && <span className="block text-[11px] text-sub">{[l.priceEdited ? "price set on the order" : l.rule, l.note, l.discount ? `less ${l.discountType === "percent" ? `${l.discountValue}% ` : ""}discount ${money(l.discount)}${l.scope === "copy" ? " per copy" : ""}` : null].filter(Boolean).join(" · ")}</span>}</td>
                <td><span className={cx("rounded px-1.5 py-0.5 text-[10px] font-bold", SCOPE_TONE[l.scope])}>{SCOPE_LABEL[l.scope]}</span></td>
                <td className="text-right tabular-nums">{l.scope === "copy" ? `${l.qty} ${l.method === "per_sheet" ? "sheets" : l.unit}` : "1"}</td>
                <td className={cx("text-right tabular-nums", l.missing && "font-bold text-rose-600")}>{l.missing ? "Price not configured" : money(l.rate!)}</td>
                <td className="text-right font-semibold tabular-nums">{money(l.scope === "copy" ? l.unitAmount : l.amount)}</td>
              </tr>))}</tbody>
            <tfoot className="text-[12.5px]">
              <tr className="border-t border-line"><td colSpan={4} className="py-1 text-right text-sub">Per-copy subtotal</td><td className="text-right font-bold tabular-nums">{money(a.perCopy)}</td></tr>
              {a.copies > 1 && <tr><td colSpan={4} className="py-1 text-right text-sub">× {a.copies} copies</td><td className="text-right font-bold tabular-nums">{money(Math.round(a.perCopy * a.copies * 100) / 100)}</td></tr>}
              {a.perAlbum > 0 && <tr><td colSpan={4} className="py-1 text-right text-sub">Per-album charges</td><td className="text-right font-bold tabular-nums">{money(a.perAlbum)}</td></tr>}
              <tr><td colSpan={4} className="py-1 text-right font-extrabold">Album total</td><td className="text-right font-extrabold tabular-nums" data-testid={`album-total-${a.index}`}>{money(a.total)}</td></tr>
            </tfoot>
          </table></div>
        </section>
      ))}
      {s.orderLines.length > 0 && (
        <section className="border-b border-line py-4"><h3 className="mb-2 text-sm font-extrabold">Order charges (one-time)</h3>
          {s.orderLines.map((l) => <div key={l.position} className="flex justify-between py-0.5"><span>{l.name}</span><span className={cx("tabular-nums", l.missing ? "font-bold text-rose-600" : "font-semibold")}>{l.missing ? "Price not configured" : money(l.amount)}</span></div>)}
        </section>
      )}
      <dl className="ml-auto mt-4 max-w-sm space-y-1 text-[13px] [&_dt]:whitespace-nowrap [&>div]:gap-4" data-testid="invoice-totals">
        <div className="flex justify-between"><dt className="text-sub">Subtotal</dt><dd className="font-semibold tabular-nums">{money(s.subtotal)}</dd></div>
        {s.discountAmount > 0 && <div className="flex justify-between"><dt className="text-sub">Discount {s.discountType === "percent" ? `(${s.discountValue}%)` : "(fixed)"}</dt><dd className="font-semibold tabular-nums">− {money(s.discountAmount)}</dd></div>}
        {s.taxEnabled && <><div className="flex justify-between"><dt className="text-sub">Taxable amount</dt><dd className="tabular-nums">{money(s.taxable)}</dd></div><div className="flex justify-between"><dt className="text-sub">{s.taxLabel} @ {s.taxRate}%</dt><dd className="font-semibold tabular-nums">{money(s.tax)}</dd></div></>}
        <div className="flex justify-between border-t border-line pt-1 text-base"><dt className="font-extrabold">Final amount</dt><dd className="font-extrabold text-brand tabular-nums" data-testid="final-amount">{money(s.total)}</dd></div>
        <div className="flex justify-between"><dt className="text-sub">Payments received</dt><dd className="tabular-nums">{money(paid)}</dd></div>
        <div className="flex justify-between"><dt className="font-bold">Balance payable</dt><dd className="font-bold tabular-nums" data-testid="balance">{money(balance)}</dd></div>
      </dl>
    </div>
  );
}

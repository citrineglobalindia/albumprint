import { Link } from "react-router-dom";
import { IndianRupee, Percent, ShoppingCart, TrendingUp } from "lucide-react";
import { KpiRow, Panel, Td, Th, cx, tableCls, trCls } from "./ui";
import { ExportBtn } from "./listKit";
import { downloadCsv } from "../lib/csv";
import { useStore } from "../lib/store";
import { inr, inrShort, fmtDate } from "../lib/format";
import type { Order } from "../lib/data";
import { albumsOf, profitOf, purchaseRec } from "../lib/labs";

const billsOf = (o: Order) => albumsOf(o).map((a) => purchaseRec(o.id, a.position)).filter((p) => p?.billNo).map((p) => `${p!.billNo}${p!.billDate ? ` (${fmtDate(p!.billDate)})` : ""}`);

/** Profit & expense: customer billing − purchase (the bills entered on orders, else the catalog's purchase costs) per order. */
export function ProfitPanel({ orders, title = "Profit & expense", className }: { orders: Order[]; title?: string; className?: string }) {
  useStore();
  const rows = orders.filter((o) => o.hold !== "Cancelled").map((o) => ({ o, p: profitOf(o), bills: billsOf(o) })).filter((r) => r.p.entered);
  const sell = rows.reduce((s, r) => s + r.p.selling, 0), pur = rows.reduce((s, r) => s + r.p.purchase, 0), profit = sell - pur;
  const csv = () => downloadCsv("profit-expense.csv", [["Order", "Customer", "Event", "Order date", "Customer billing", "Purchase (expense)", "Profit", "Margin %", "Purchase bills", "Complete", "Estimated"],
    ...rows.map(({ o, p, bills }) => [o.id, o.customer, o.event, o.pendingAt, p.selling, p.purchase, p.profit, Number(p.margin.toFixed(1)), bills.join("; "), p.complete ? "yes" : "partial", p.estimated ? "yes" : ""])]);
  return (
    <div className={className} data-testid="profit-expense">
      <KpiRow cols={4} items={[
        { label: "Customer billing", value: inrShort(sell), icon: IndianRupee, tone: "indigo", hint: `${rows.length} order(s) with costs` },
        { label: "Purchase (expense)", value: inrShort(pur), icon: ShoppingCart, tone: "orange", invert: true },
        { label: "Profit", value: inrShort(profit), icon: TrendingUp, tone: profit < 0 ? "red" : "green" },
        { label: "Margin", value: sell ? `${((profit / sell) * 100).toFixed(1)}%` : "—", icon: Percent, tone: "teal" },
      ]} />
      <Panel className="mt-4" title={title} subtitle={`${rows.length} order(s) · billing ${inr(sell)} · expense ${inr(pur)} · profit ${inr(profit)}`} action={<ExportBtn aria="Export profit" onClick={csv} />} bodyClassName="p-0">
        <div className="overflow-x-auto"><table className={tableCls} data-testid="profit-table">
          <thead><tr><Th>Order</Th><Th>Customer</Th><Th>Purchase bill</Th><Th className="text-right">Customer billing</Th><Th className="text-right">Purchase (expense)</Th><Th className="text-right">Profit</Th><Th className="text-right">Margin</Th></tr></thead>
          <tbody>
            {rows.map(({ o, p, bills }) => (
              <tr key={o.id} className={trCls}>
                <Td><Link to={`/orders/${o.id}`} className="font-bold text-brand hover:underline">{o.id}</Link>{!p.complete && <span className="ml-1 text-[11px] text-amber-700">(partial)</span>}{p.estimated && <span className="ml-1 text-[11px] text-violet-800">(estimated)</span>}</Td>
                <Td>{o.customer}</Td>
                <Td className="text-xs text-sub">{bills.length ? bills.join(", ") : "—"}</Td>
                <Td className="text-right">{inr(p.selling)}</Td><Td className="text-right">{inr(p.purchase)}</Td>
                <Td className={cx("text-right font-bold", p.profit < 0 ? "text-rose-600" : "text-emerald-700")}>{inr(p.profit)}</Td><Td className="text-right">{p.margin.toFixed(1)}%</Td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-sub">Enter purchase bills on the order page (Lab, purchase &amp; profit), or purchase costs in Catalog › Prices, to see profit here.</td></tr>}
          </tbody>
        </table></div>
      </Panel>
    </div>
  );
}

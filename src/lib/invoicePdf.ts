import type { InvoiceSnapshot } from "./orders2";
import { SCOPE_LABEL } from "./catalog2";

// The invoice PDF, drawn only from the stored snapshot (so a re-download years later shows exactly what was issued).
// The PDF fonts have no ₹ glyph, so amounts are written "Rs. 1,234.50".
const rs = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ORDER_TYPE: Record<string, string> = { design_printing: "Design + Printing", printing_only: "Album Printing Only" };
const fmtDate = (iso?: string) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export async function invoicePdf(s: InvoiceSnapshot, opts: { preview?: boolean; paid?: number } = {}): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), L = 40, Rx = W - 40;
  const after = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;
  const b = s.business ?? {};

  // header: business (left), invoice identity (right)
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(15, 27, 76);
  if (s.showBusinessName !== false) doc.text(b.name || "AlbumPro Studio", L, 48);              // the company name can be hidden per invoice
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
  const bl = [b.legal, b.address, [b.phone, b.email].filter(Boolean).join("  ·  "), b.website, b.gstin ? `GSTIN ${b.gstin}` : "", b.pan ? `PAN ${b.pan}` : ""].filter(Boolean) as string[];
  doc.text(bl, L, 64, { maxWidth: 300 });
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(63, 79, 224); doc.text(opts.preview ? "INVOICE PREVIEW" : s.taxEnabled ? "TAX INVOICE" : "INVOICE", Rx, 48, { align: "right" });
  doc.setFontSize(10); doc.setTextColor(20); doc.setFont("helvetica", "normal");
  const idLines = opts.preview ? ["Not yet issued — the number is assigned when the order is finalized"] : [`Invoice no. ${s.invoiceNumber ?? "—"}`, `Date ${fmtDate(s.invoiceDate)}`, s.revision && s.revision > 1 ? `Revision ${s.revision}` : ""].filter(Boolean);
  doc.text(idLines, Rx, 66, { align: "right", maxWidth: 230 });

  // bill to + order
  let y = Math.max(64 + bl.length * 12, 100) + 14;
  doc.setDrawColor(225); doc.line(L, y - 8, Rx, y - 8);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(110); doc.text("BILL TO", L, y + 4); doc.text("ORDER & EVENT", W / 2 + 10, y + 4);
  doc.setFont("helvetica", "normal"); doc.setTextColor(20); doc.setFontSize(10);
  const c = s.customer ?? { name: "" };
  doc.text([c.name || "—", c.phone ? `Phone ${c.phone}` : "", c.email ?? "", c.address ?? ""].filter(Boolean), L, y + 18, { maxWidth: W / 2 - 60 });
  const ev = s.event ?? { type: "", name: "", date: "", delivery: "", notes: "" };
  doc.text([s.orderCode ? `Order ${s.orderCode}` : "Order (not yet created)", `Type: ${ORDER_TYPE[s.orderType] ?? s.orderType}`, `Event: ${[ev.type, ev.name].filter(Boolean).join(" — ") || "—"}`,
    `Event date: ${fmtDate(ev.date)}`, `Delivery: ${fmtDate(s.dueDate || ev.delivery)}`].filter(Boolean), W / 2 + 10, y + 18, { maxWidth: W / 2 - 50 });
  y += 92;

  // one section per album
  const head = [["Item", "Basis", "Scope", "Qty", "Rate", "Amount"]];
  for (const a of s.albums) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(15, 27, 76);
    doc.text(`${a.name}`, L, y); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90);
    doc.text(`${a.sheets} sheets · ${a.copies} ${a.copies === 1 ? "copy" : "copies"}${[a.size, a.paper, a.finish].some(Boolean) ? " · " + [a.size, a.paper, a.finish].filter(Boolean).join(" / ") : ""}`, L, y + 12);
    const body = a.lines.map((l) => [l.name + (l.note ? ` (${l.note})` : ""), [l.priceEdited ? "price set on the order" : l.rule, l.discount ? `less ${l.discountType === "percent" ? `${l.discountValue}% ` : ""}discount ${rs(l.discount)}${l.scope === "copy" ? "/copy" : ""}` : null].filter(Boolean).join(" · "), SCOPE_LABEL[l.scope], l.scope === "copy" ? `${l.qty} ${l.method === "per_sheet" ? "sheets" : l.unit}${a.copies > 1 ? ` × ${a.copies}` : ""}` : "1",
      l.rate == null ? "Price not configured" : rs(l.rate), rs(l.amount)]);
    body.push(["", "", "", "", "Per-copy subtotal", rs(a.perCopy)]);
    if (a.copies > 1) body.push(["", "", "", "", `× ${a.copies} copies`, rs(a.perCopy * a.copies)]);
    if (a.perAlbum) body.push(["", "", "", "", "Per-album charges", rs(a.perAlbum)]);
    body.push(["", "", "", "", "Album total", rs(a.total)]);
    autoTable(doc, { head, body, startY: y + 20, styles: { fontSize: 8.5, cellPadding: 4 }, headStyles: { fillColor: [63, 79, 224] }, columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } }, margin: { left: L, right: 40 },
      didParseCell: (h) => { if (h.section === "body" && h.row.index >= a.lines.length) { h.cell.styles.fontStyle = "bold"; h.cell.styles.fillColor = [246, 247, 252]; } } });
    y = after() + 24;
  }
  if (s.orderLines.length) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(15, 27, 76); doc.text("Order charges (one-time)", L, y);
    autoTable(doc, { head, body: s.orderLines.map((l) => [l.name, l.rule ?? "", SCOPE_LABEL.order, "1", l.rate == null ? "Price not configured" : rs(l.rate), rs(l.amount)]), startY: y + 8, styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: [63, 79, 224] }, columnStyles: { 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } }, margin: { left: L, right: 40 } });
    y = after() + 24;
  }

  // totals
  const paid = opts.paid ?? 0;
  const tot: [string, string][] = [["Subtotal", rs(s.subtotal)]];
  if (s.discountAmount) tot.push([`Discount${s.discountType === "percent" ? ` (${s.discountValue}%)` : " (fixed)"}`, `− ${rs(s.discountAmount)}`]);
  if (s.taxEnabled) { tot.push(["Taxable amount", rs(s.taxable)]); tot.push([`${s.taxLabel} @ ${s.taxRate}%`, rs(s.tax)]); }
  tot.push(["Final amount", rs(s.total)]);
  if (!opts.preview) { tot.push(["Payments received", rs(paid)]); tot.push(["Balance payable", rs(Math.round((s.total - paid) * 100) / 100)]); }
  autoTable(doc, { body: tot, startY: y, theme: "plain", styles: { fontSize: 10, cellPadding: 3 }, columnStyles: { 0: { halign: "right", cellWidth: 380 }, 1: { halign: "right", fontStyle: "bold" } }, margin: { left: L, right: 40 },
    didParseCell: (h) => { if (h.row.index === tot.findIndex((t) => t[0] === "Final amount")) { h.cell.styles.fontSize = 12; h.cell.styles.textColor = [63, 79, 224]; } } });
  y = after() + 18;
  doc.setFontSize(8); doc.setTextColor(120);
  doc.text(["Per copy: multiplied by the number of copies.  Per album: charged once for the album.  Per order: charged once for the whole order.",
    s.taxEnabled ? `${s.taxLabel} is charged on the amount after discount.` : "No tax applied.", ev.notes ? `Notes: ${ev.notes}` : ""].filter(Boolean), L, y, { maxWidth: W - 80 });
  if (opts.preview) { doc.setFontSize(60); doc.setTextColor(235); doc.text("PREVIEW", W / 2, 470, { align: "center", angle: 30 }); }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(150); doc.text(`${s.invoiceNumber ?? "Preview"} · page ${i} of ${pages}`, L, doc.internal.pageSize.getHeight() - 20); }
  return doc.output("blob");
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
/** Open the PDF in a new tab to view or print it. */
export function openBlob(blob: Blob) {
  const url = URL.createObjectURL(blob); const w = window.open(url, "_blank");
  if (!w) downloadBlob(blob, "invoice.pdf");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

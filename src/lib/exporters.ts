import { downloadCsv } from "./csv";

export type ExportFormat = "CSV" | "Excel" | "PDF";
type Cell = string | number;

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** A real .xlsx workbook (one sheet): numbers stay numbers, the header row is bold and frozen. */
export async function toXlsx(rows: Cell[][], sheetName = "Report"): Promise<Blob> {
  const { zipSync, strToU8 } = await import("fflate");
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${colName(ci)}${ri + 1}`, style = ri === 0 || rows[ri - 1]?.length === 0 ? ' s="1"' : "";
    return typeof v === "number" && Number.isFinite(v) ? `<c r="${ref}"${style}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
  }).join("")}</row>`).join("");
  const widths = (rows[0] ?? []).map((_, ci) => Math.min(60, Math.max(10, ...rows.map((r) => String(r[ci] ?? "").length + 2))));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData></worksheet>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  };
  return new Blob([zipSync(files) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Rows may hold several tables separated by an empty row; a leading two-column block is treated as report details. */
const blocksOf = (rows: Cell[][]) => rows.reduce<Cell[][][]>((acc, r) => { if (!r.length) { if (acc.at(-1)?.length) acc.push([]); } else (acc.at(-1) ?? (acc.push([]), acc.at(-1)!)).push(r); return acc; }, [[]]).filter((b) => b.length);

/** A real PDF: title, report details, then each table with a repeating header row, paginated. */
export async function toPdf(rows: Cell[][], title: string, subtitle = ""): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const blocks = blocksOf(rows);
  const meta = blocks.length > 1 && blocks[0]!.every((r) => r.length === 2) ? blocks.shift()! : [];
  const wide = blocks.some((b) => (b[0]?.length ?? 0) > 6);
  const doc = new jsPDF({ orientation: wide ? "landscape" : "portrait", unit: "pt", format: "a4" });
  doc.setFontSize(16); doc.setTextColor(20); doc.text(title, 40, 44);
  doc.setFontSize(9); doc.setTextColor(110);
  const lines = [...meta.map((r) => `${r[0]}: ${r[1]}`), subtitle, `Generated ${new Date().toLocaleString("en-IN")}`].filter(Boolean);
  doc.text(lines.join("   ·   "), 40, 60, { maxWidth: doc.internal.pageSize.getWidth() - 80 });
  let y = 78;
  for (const b of blocks) {
    autoTable(doc, { head: [b[0]!.map(String)], body: b.slice(1).map((r) => r.map(String)), startY: y, styles: { fontSize: 8, cellPadding: 4 }, headStyles: { fillColor: [63, 79, 224] }, margin: { left: 40, right: 40 } });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 22;
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140); doc.text(`AlbumPro · page ${i} of ${n}`, 40, doc.internal.pageSize.getHeight() - 20); }
  return doc.output("blob");
}

/** Download rows in the chosen format (the first row is the header). */
export async function downloadRows(format: ExportFormat, baseName: string, rows: Cell[][], title = baseName, subtitle = "") {
  const name = baseName.replace(/[^\w.-]+/g, "-").toLowerCase();
  if (format === "CSV") { downloadCsv(`${name}.csv`, rows); return; }
  if (format === "Excel") { save(await toXlsx(rows, title), `${name}.xlsx`); return; }
  save(await toPdf(rows, title, subtitle), `${name}.pdf`);
}

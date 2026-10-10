import { useEffect, useMemo, useState } from "react";
import { Bell, Building2, Camera, CreditCard, FileText, FolderOpen, History, Mail, MessageCircle, Save, Settings as Cog, ShieldCheck, Workflow, Receipt, Download, Send, Eye, Search, Undo2, GripVertical, ArrowUp, ArrowDown, MonitorSmartphone, Check, X, Database, Upload, Trash2, ShieldAlert } from "lucide-react";
import type { ComponentType } from "react";
import { Field, FilterSelect, Panel, Pill, PageHeader, SearchInput, SlideOver, Td, Th, Toggle, inputCls, tableCls, trCls, cx } from "../components/ui";
import { useToast } from "../components/Toast";
import { downloadCsv } from "../lib/csv";
import { STAGES } from "../lib/data";
import { TODAY } from "../lib/format";
import { AUDIT } from "../lib/audit";
import { flushAll, resetDemoData } from "../lib/persist";
import { useConfirm } from "../components/ConfirmDialog";
import { useRef } from "react";

type Val = string | boolean;
type Fld =
  | { k: string; l: string; t: "text" | "number" | "password" | "textarea"; hint?: string }
  | { k: string; l: string; t: "select"; o: string[]; hint?: string }
  | { k: string; l: string; t: "slider"; min: number; max: number; step?: number; unit: string; zero?: string; hint?: string }
  | { k: string; l: string; t: "toggle"; hint: string };
interface Group { title: string; desc?: string; cols?: 1 | 2; fields: Fld[] }
interface SectionDef { key: string; label: string; icon: ComponentType<{ className?: string }>; title: string; desc: string; groups?: Group[]; keywords?: string }

const SECTIONS: SectionDef[] = [
  { key: "general", label: "General", icon: Cog, title: "General Settings", desc: "Base information and system-wide configuration" },
  { key: "company", label: "Company Profile", icon: Building2, title: "Company Profile", desc: "Legal and tax details printed on invoices and receipts", groups: [
    { title: "Legal Details", cols: 2, fields: [
      { k: "legal", l: "Legal Name", t: "text" }, { k: "gstin", l: "GSTIN", t: "text", hint: "15-character GSTIN, format validated" },
      { k: "pan", l: "PAN", t: "text" }, { k: "state", l: "State of Supply", t: "select", o: ["Karnataka", "Telangana", "Maharashtra", "Tamil Nadu", "Delhi"] },
      { k: "caddr", l: "Registered Address", t: "textarea" }] }] },
  { key: "workflow", label: "Workflow Settings", icon: Workflow, title: "Workflow Settings", desc: "Controls how orders move through the production route", keywords: "stages sla hours order of stages enable disable", groups: [
    { title: "Approvals", desc: "Admin approval gates in the Design + Printing route", fields: [
      { k: "wf_cg", l: "", t: "toggle", hint: "Require Admin approval after Colour Grading" },
      { k: "wf_design", l: "", t: "toggle", hint: "Require Admin design review before client proof" },
      { k: "wf_release", l: "", t: "toggle", hint: "Admin release required before Printing" },
      { k: "wf_disc", l: "", t: "toggle", hint: "Discounts above the limit need Admin approval" }] },
    { title: "Turnaround", cols: 2, fields: [
      { k: "tat_cg", l: "Colour Grading TAT (days)", t: "number" }, { k: "tat_design", l: "Designing TAT (days)", t: "number" },
      { k: "tat_print", l: "Printing TAT (days)", t: "number" }, { k: "disc_limit", l: "Discount approval threshold (%)", t: "number" }] }] },
  { key: "notifications", label: "Notifications", icon: Bell, title: "Notifications", desc: "Choose which events notify staff and clients", keywords: "matrix channel whatsapp email sms in-app events", groups: [
    { title: "Staff Alerts", fields: [
      { k: "n_assign", l: "", t: "toggle", hint: "Notify assignee when an order is assigned" },
      { k: "n_overdue", l: "", t: "toggle", hint: "Alert Admin when an order passes its due date" },
      { k: "n_qc", l: "", t: "toggle", hint: "Notify Designer / Printer on QC failure" }] },
    { title: "Client Alerts", fields: [
      { k: "n_proof", l: "", t: "toggle", hint: "Send proof link when the design is ready" },
      { k: "n_ready", l: "", t: "toggle", hint: "Notify client when the order is ready for delivery" },
      { k: "n_due", l: "", t: "toggle", hint: "Send payment reminder for pending dues" }] }] },
  { key: "email", label: "Email Configuration", icon: Mail, title: "Email Configuration", desc: "SMTP server used to send invoices, receipts and proofs", groups: [
    { title: "SMTP", cols: 2, fields: [
      { k: "smtp_host", l: "SMTP Host", t: "text" }, { k: "smtp_port", l: "Port", t: "number" }, { k: "smtp_user", l: "Username", t: "text" }, { k: "smtp_pass", l: "Password", t: "password" },
      { k: "from_name", l: "From Name", t: "text" }, { k: "from_email", l: "From Email", t: "text" },
      { k: "smtp_tls", l: "", t: "toggle", hint: "Use TLS / STARTTLS" }] }] },
  { key: "whatsapp", label: "WhatsApp Configuration", icon: MessageCircle, title: "WhatsApp Configuration", desc: "WhatsApp Business API for client notifications", groups: [
    { title: "Business API", cols: 2, fields: [
      { k: "wa_num", l: "Business Number", t: "text" }, { k: "wa_id", l: "Phone Number ID", t: "text" }, { k: "wa_token", l: "Access Token", t: "password" }, { k: "wa_tpl", l: "Default Template", t: "select", o: ["order_update", "proof_ready", "payment_reminder"] },
      { k: "wa_on", l: "", t: "toggle", hint: "Enable WhatsApp messages" }] }] },
  { key: "storage", label: "File & Storage", icon: FolderOpen, title: "File & Storage", desc: "Where photos and design files are stored", groups: [
    { title: "Storage", cols: 2, fields: [
      { k: "st_prov", l: "Storage Provider", t: "select", o: ["Cloud (S3)", "Local NAS", "Google Drive"] }, { k: "st_max", l: "Max upload size (MB)", t: "number" },
      { k: "st_ret", l: "Retention after delivery (months)", t: "number" }, { k: "st_types", l: "Allowed file types", t: "text" },
      { k: "st_backup", l: "", t: "toggle", hint: "Nightly backup of design files" }] }] },
  { key: "templates", label: "Document Templates", icon: FileText, title: "Document Templates", desc: "Layout and footer text for generated documents", groups: [
    { title: "Templates", cols: 2, fields: [
      { k: "tpl_inv", l: "Invoice Template", t: "select", o: ["Classic", "Modern", "Compact"] }, { k: "tpl_rcp", l: "Receipt Template", t: "select", o: ["Thermal 80mm", "A5", "A4"] },
      { k: "tpl_foot", l: "Document Footer", t: "textarea" }, { k: "tpl_terms", l: "Terms & Conditions", t: "textarea" }] }] },
  { key: "invoice", label: "Invoice Settings", icon: Receipt, title: "Invoice Settings", desc: "Numbering, GST and payment terms for invoices", groups: [
    { title: "Numbering & Tax", cols: 2, fields: [
      { k: "inv_prefix", l: "Invoice Prefix", t: "text" }, { k: "inv_next", l: "Next Invoice Number", t: "number" },
      { k: "inv_gst", l: "Default GST %", t: "select", o: ["0%", "5%", "12%", "18%", "28%"] }, { k: "inv_terms", l: "Payment Terms (days)", t: "number" },
      { k: "inv_igst", l: "", t: "toggle", hint: "Use IGST for inter-state customers" }, { k: "inv_round", l: "", t: "toggle", hint: "Round off invoice total" }] },
    { title: "Footer & Terms", fields: [{ k: "inv_footer", l: "Invoice footer", t: "textarea" }, { k: "inv_tc", l: "Terms & conditions", t: "textarea" }] }], keywords: "preview prefix footer terms gst" },
  { key: "payment", label: "Payment Settings", icon: CreditCard, title: "Payment Settings", desc: "Accepted modes, advances, dues and refunds", groups: [
    { title: "Modes", fields: [
      { k: "pm_upi", l: "", t: "toggle", hint: "UPI" }, { k: "pm_cash", l: "", t: "toggle", hint: "Cash" }, { k: "pm_bank", l: "", t: "toggle", hint: "Bank Transfer" }, { k: "pm_online", l: "", t: "toggle", hint: "Online payment gateway" }] },
    { title: "Rules", cols: 2, fields: [
      { k: "adv_pct", l: "Minimum advance (%)", t: "number" }, { k: "upi_id", l: "UPI ID", t: "text" },
      { k: "rcp_prefix", l: "Receipt Prefix", t: "text" }, { k: "refund_appr", l: "Refunds approved by", t: "select", o: ["Admin", "Admin + Accounts"] }] }] },
  { key: "security", label: "Security", icon: ShieldCheck, title: "Security", desc: "Authentication, MFA, sessions and password policy (SRS section 2)", keywords: "password policy sessions timeout lockout active sessions revoke", groups: [
    { title: "Authentication", fields: [
      { k: "mfa", l: "", t: "toggle", hint: "Require MFA for all users" }, { k: "mfa_admin", l: "", t: "toggle", hint: "Step-up OTP for exports, overrides and permission changes" },
      { k: "remember", l: "", t: "toggle", hint: "Allow Remember Device (trusted device policy)" }, { k: "captcha", l: "", t: "toggle", hint: "Risk-based CAPTCHA on login" }] },
    { title: "Sessions & Password Policy", cols: 2, fields: [
      { k: "timeout", l: "Session timeout", t: "select", o: ["15 minutes", "30 minutes", "1 hour", "2 hours", "4 hours"] }, { k: "max_fail", l: "Lock account after failed attempts", t: "slider", min: 3, max: 10, unit: "attempts" },
      { k: "pw_min", l: "Minimum password length", t: "slider", min: 6, max: 20, unit: "characters" }, { k: "pw_exp", l: "Password expiry", t: "slider", min: 0, max: 365, step: 15, unit: "days", zero: "Never" },
      { k: "pw_cx", l: "", t: "toggle", hint: "Require upper, lower, number and symbol" }, { k: "pw_hist", l: "", t: "toggle", hint: "Block reuse of last 5 passwords" }] }] },
  { key: "data", label: "Data & Storage", icon: Database, title: "Data & Storage", desc: "Saved demo data, backup, restore and audit summary", keywords: "backup restore export import reset local storage audit summary" },
  { key: "audit", label: "Activity Log", icon: History, title: "Activity Log", desc: "Audit trail of sensitive actions" },
];

interface StageCfg { key: string; enabled: boolean; sla: number }
const SLA_DEFAULT: Record<string, number> = { new_order: 2, files_received: 4, colour_grading: 24, admin_approval: 8, designing: 72, client_review: 72, final_approval: 8, printing: 72, qc: 8, ready_for_delivery: 24, delivered: 4 };
const LOCKED_STAGES = ["new_order", "delivered"];
const DEFAULT_STAGES: StageCfg[] = STAGES.map((s) => ({ key: s.key, enabled: true, sla: SLA_DEFAULT[s.key] ?? 24 }));
const EVENTS = ["Order Created", "Design Submitted", "Proof Ready", "Correction Received", "QC Failed", "Payment Due", "Dispatched", "Delivered"];
const CHANNELS = ["WhatsApp", "Email", "SMS", "In-app"];
const DEFAULT_MATRIX: Record<string, string[]> = Object.fromEntries(EVENTS.map((e, i) => [e, ["In-app", ...(i % 2 === 0 ? ["WhatsApp"] : []), ...(i < 5 ? ["Email"] : []), ...(e === "Payment Due" ? ["SMS"] : [])]]));
const parse = <T,>(s: string | boolean | undefined, d: T): T => { try { return JSON.parse(String(s)) as T; } catch { return d; } };

const INIT: Record<string, Val> = {
  name: "Priya's Memories Photography", website: "www.priyasmemories.com", phone: "+91 98765 43210", email: "info@priyasmemories.com",
  address: "123, Main Road, Indiranagar\nBengaluru, Karnataka - 560038", currency: "INR (₹)", tax: "18%", prefix: "ALB", nextNo: "00073",
  autoAssign: true, clientLink: true, deliveryNoPay: false, notify: true,
  legal: "Priya's Memories Photography Pvt. Ltd.", gstin: "29ABCDE1234F1Z5", pan: "ABCDE1234F", state: "Karnataka", caddr: "123, Main Road, Indiranagar, Bengaluru - 560038",
  wf_cg: true, wf_design: true, wf_release: true, wf_disc: true, tat_cg: "2", tat_design: "5", tat_print: "3", disc_limit: "10",
  n_assign: true, n_overdue: true, n_qc: true, n_proof: true, n_ready: true, n_due: false,
  smtp_host: "smtp.example.com", smtp_port: "587", smtp_user: "info@priyasmemories.com", smtp_pass: "", from_name: "Priya's Memories", from_email: "info@priyasmemories.com", smtp_tls: true,
  wa_num: "+91 98765 43210", wa_id: "", wa_token: "", wa_tpl: "order_update", wa_on: false,
  st_prov: "Cloud (S3)", st_max: "50", st_ret: "12", st_types: "JPG, PNG, PSD, PDF, TIFF", st_backup: true,
  tpl_inv: "Modern", tpl_rcp: "A5", tpl_foot: "Thank you for choosing us.", tpl_terms: "Advance is non-refundable once design work starts.",
  inv_prefix: "INV-2026-", inv_next: "19", inv_gst: "18%", inv_terms: "9", inv_igst: true, inv_round: false, inv_footer: "Thank you for choosing us. Payment due within the terms above.", inv_tc: "Advance is non-refundable once design work starts. Goods once delivered are not returnable.",
  bh_start: "10", bh_end: "19", bh_days: "1,2,3,4,5,6", bh_holidays: "", sla_warn_pct: "75", wf_stages: JSON.stringify(DEFAULT_STAGES), notif_matrix: JSON.stringify(DEFAULT_MATRIX),
  pm_upi: true, pm_cash: true, pm_bank: true, pm_online: false, adv_pct: "50", upi_id: "priya@upi", rcp_prefix: "RCP", refund_appr: "Admin",
  mfa: true, mfa_admin: true, remember: true, captcha: true, timeout: "30 minutes", max_fail: "5", pw_min: "8", pw_exp: "90", pw_cx: true, pw_hist: true,
};

const LOG: [string, string, string, string][] = [
  ["03 Oct 2026, 11:20 AM", "Admin", "Login", "MFA verified from Chrome / Windows"],
  ["03 Oct 2026, 11:05 AM", "Priya N", "Order created", "IDP00073 - Customer Chidanan da"],
  ["03 Oct 2026, 10:42 AM", "Suresh B", "Payment recorded", "INR 25,000 against IDP00072 (UPI)"],
  ["03 Oct 2026, 10:10 AM", "Admin", "Discount approved", "12% on IDP00071"],
  ["02 Oct 2026, 05:40 PM", "Suresh B", "Invoice sent", "INV-2026-0018 to Chidanan da"],
  ["02 Oct 2026, 04:45 PM", "Manjunath P", "Stage changed", "IDP00066 Printing -> QC"],
  ["02 Oct 2026, 02:49 PM", "Divya S", "QC failed", "IDP00064 - Colour shift"],
  ["01 Oct 2026, 06:00 PM", "Admin", "Permission changed", "Reception: Payments -> Receive limited"],
  ["01 Oct 2026, 03:12 PM", "Admin", "User created", "Neha Reddy (Colour Grading)"],
];

const STORE = "albumpro.settings";
const ERR = "mt-1 block text-xs font-semibold text-rose-600";
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const load = (): Record<string, Val> => {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) { const m = { ...INIT, ...JSON.parse(raw) } as Record<string, Val>; if (/^\d+$/.test(String(m.timeout))) m.timeout = `${m.timeout} minutes`; return m; }
  } catch { /* ignore */ }
  return INIT;
};
type Errs = Record<string, string>;
const validate = (v: Record<string, Val>): Errs => {
  const e: Errs = {};
  const s = (k: string) => String(v[k] ?? "").trim();
  if (!s("name")) e.name = "Company name is required";
  if (s("email") && !EMAIL_RE.test(s("email"))) e.email = "Enter a valid email address";
  if (s("gstin") && !/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z0-9][A-Z0-9]$/i.test(s("gstin"))) e.gstin = "GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5";
  if (s("pan") && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(s("pan"))) e.pan = "PAN must look like ABCDE1234F";
  if (s("smtp_port") && !(Number(s("smtp_port")) >= 1 && Number(s("smtp_port")) <= 65535)) e.smtp_port = "Port must be between 1 and 65535";
  if (s("from_email") && !EMAIL_RE.test(s("from_email"))) e.from_email = "Enter a valid email address";
  if (s("smtp_user") && !EMAIL_RE.test(s("smtp_user"))) e.smtp_user = "Enter a valid email address";
  if (Number(s("pw_min")) < 6 && s("pw_min")) e.pw_min = "Minimum length cannot be below 6";
  if (parse<StageCfg[]>(v.wf_stages, []).some((x) => x.enabled && !(Number.isInteger(x.sla) && x.sla >= 1))) e.wf_stages = "Every enabled stage needs an SLA of at least 1 hour";
  if (!(Number(s("bh_end")) > Number(s("bh_start")))) e.bh_end = "Closing hour must be after opening hour";
  if (!s("bh_days")) e.bh_days = "Pick at least one working day";
  if (s("bh_holidays").split(/[\s,;]+/).filter(Boolean).some((x) => !/^\d{4}-\d{2}-\d{2}$/.test(x))) e.bh_holidays = "Use YYYY-MM-DD dates separated by commas or new lines";
  if (!(Number(s("sla_warn_pct")) >= 1 && Number(s("sla_warn_pct")) <= 99)) e.sla_warn_pct = "Enter a percentage between 1 and 99";
  if (!s("inv_prefix")) e.inv_prefix = "Invoice prefix is required";
  if (s("adv_pct") && !(Number(s("adv_pct")) >= 0 && Number(s("adv_pct")) <= 100)) e.adv_pct = "Enter a percentage between 0 and 100";
  if (s("disc_limit") && !(Number(s("disc_limit")) >= 0 && Number(s("disc_limit")) <= 100)) e.disc_limit = "Enter a percentage between 0 and 100";
  return e;
};
const GENERAL_KEYS = ["name", "website", "phone", "email", "address", "currency", "tax", "prefix", "nextNo", "autoAssign", "clientLink", "deliveryNoPay", "notify", "logo"];
const KEY_SEC: Record<string, string> = Object.fromEntries([
  ...GENERAL_KEYS.map((k) => [k, "general"]),
  ...SECTIONS.flatMap((x) => (x.groups ?? []).flatMap((g) => g.fields.map((f) => [f.k, x.key]))),
  ["wf_stages", "workflow"], ["bh_start", "workflow"], ["bh_end", "workflow"], ["bh_days", "workflow"], ["bh_holidays", "workflow"], ["sla_warn_pct", "workflow"], ["notif_matrix", "notifications"],
]);
const matchSection = (x: SectionDef, term: string) => {
  const hay = [x.label, x.title, x.desc, x.keywords ?? "", ...(x.groups ?? []).flatMap((g) => [g.title, g.desc ?? "", ...g.fields.flatMap((f) => [f.l, "hint" in f ? f.hint ?? "" : ""])]), x.key === "general" ? "company name website phone logo currency tax prefix order number behaviour" : ""].join(" ").toLowerCase();
  return term.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

const LINES: [string, number][] = [["Album Premium 12x36", 8500], ["Extra pages (10)", 1200], ["Box - Premium", 1500]];
const money = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Live invoice sample: re-renders as prefix / numbering / GST / terms / footer change. */
function InvoicePreview({ v, receipt }: { v: Record<string, Val>; receipt?: boolean }) {
  const s = (k: string) => String(v[k] ?? "");
  const rate = parseFloat(s("inv_gst")) / 100 || 0;
  const sub = LINES.reduce((a, [, p]) => a + p, 0);
  const gst = Math.round(sub * rate * 100) / 100;
  const raw = sub + gst, total = v.inv_round ? Math.round(raw) : raw, roundOff = total - raw;
  const due = new Date(TODAY); due.setDate(due.getDate() + (Number(s("inv_terms")) || 0));
  const no = receipt ? `${s("rcp_prefix")}-0042` : `${s("inv_prefix")}${s("inv_next").padStart(4, "0")}`;
  return (
    <div data-testid="invoice-preview" className="rounded-xl border border-line bg-white p-5 text-[13px] shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><div className="text-base font-extrabold">{s("name")}</div><div className="whitespace-pre-line text-xs text-sub">{s("address")}</div><div className="text-xs text-sub">GSTIN {s("gstin")}</div></div><b className="text-brand">{receipt ? "PAYMENT RECEIPT" : "TAX INVOICE"}</b></div>
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-sub"><span data-testid="invoice-number" className="font-bold text-ink">{no}</span><span>{receipt ? "Mode: UPI" : `Due ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} (${s("inv_terms")} days)`}</span></div>
      <table className="mt-3 w-full"><tbody>
        {LINES.map(([a, p]) => <tr key={a} className="border-t border-line"><td className="py-1.5">{a}</td><td>1</td><td className="text-right">{money(p)}</td></tr>)}
        <tr className="border-t border-line"><td className="py-1.5" colSpan={2}>Subtotal</td><td className="text-right">{money(sub)}</td></tr>
        {v.inv_igst ? <tr><td className="py-1" colSpan={2}>IGST ({s("inv_gst")})</td><td className="text-right">{money(gst)}</td></tr> : <><tr><td className="py-1" colSpan={2}>CGST ({(rate * 50).toFixed(1).replace(".0", "")}%)</td><td className="text-right">{money(gst / 2)}</td></tr><tr><td className="py-1" colSpan={2}>SGST ({(rate * 50).toFixed(1).replace(".0", "")}%)</td><td className="text-right">{money(gst / 2)}</td></tr></>}
        {v.inv_round && roundOff !== 0 && <tr><td className="py-1" colSpan={2}>Round off</td><td className="text-right">{roundOff > 0 ? "+" : ""}{roundOff.toFixed(2)}</td></tr>}
        <tr className="border-t border-line font-extrabold"><td className="py-1.5" colSpan={2}>Total</td><td className="text-right" data-testid="invoice-total">{money(total)}</td></tr>
      </tbody></table>
      <p className="mt-4 text-xs" data-testid="invoice-footer">{s(receipt ? "tpl_foot" : "inv_footer")}</p>
      <p className="mt-2 text-[11px] text-sub" data-testid="invoice-terms">{s(receipt ? "tpl_terms" : "inv_tc")}</p>
    </div>
  );
}

/** SRS §18.2: drag-reorderable workflow stages with enable toggles and SLA hours. */
function StageEditor({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const stages = parse<StageCfg[]>(value, DEFAULT_STAGES);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const put = (l: StageCfg[]) => onChange(JSON.stringify(l));
  const label = (k: string) => STAGES.find((x) => x.key === k)?.label ?? k;
  const move = (from: string, to: string) => { if (from === to) return; const a = stages.findIndex((x) => x.key === from), b = stages.findIndex((x) => x.key === to); const c = [...stages]; const [m] = c.splice(a, 1); c.splice(b, 0, m!); put(c); };
  const total = stages.filter((x) => x.enabled).reduce((a, x) => a + (x.sla || 0), 0);
  return (
    <div className="rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><div><h3 className="text-base font-extrabold">Production stages & SLA</h3><p className="text-xs text-sub">Drag to reorder, switch stages off to skip them, and set the SLA target in hours (SRS 18.2).</p></div>
        <span data-testid="sla-total" className="text-xs font-bold text-sub">Total SLA {total} h (~{(total / 24).toFixed(1)} days)</span></div>
      <ol className="mt-3 space-y-1.5" data-testid="stage-list">
        {stages.map((st, i) => {
          const locked = LOCKED_STAGES.includes(st.key);
          return (
            <li key={st.key} data-testid="stage-row" draggable onDragStart={(e) => { setDrag(st.key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", st.key); }}
              onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(st.key); } }} onDrop={(e) => { e.preventDefault(); if (drag) move(drag, st.key); setDrag(null); setOver(null); }} onDragEnd={() => { setDrag(null); setOver(null); }}
              className={cx("flex items-center gap-3 rounded-xl border px-3 py-2", st.enabled ? "border-line bg-white" : "border-dashed border-line bg-slate-50 text-sub", drag === st.key && "opacity-40", over === st.key && drag && drag !== st.key && "border-brand")}>
              <GripVertical className="size-4 cursor-grab text-sub" aria-label={`Drag ${label(st.key)}`} />
              <span className="w-6 text-xs font-bold text-sub">{i + 1}</span>
              <span className={cx("flex-1 text-sm font-bold", !st.enabled && "line-through")}>{label(st.key)}{locked && <span className="ml-2 text-[11px] font-semibold text-sub">required</span>}</span>
              <label className="flex items-center gap-1.5 text-xs text-sub">SLA<input type="number" min={1} aria-label={`SLA hours for ${label(st.key)}`} disabled={!st.enabled} value={st.sla} onChange={(e) => put(stages.map((x) => (x.key === st.key ? { ...x, sla: Number(e.target.value) } : x)))} className="h-8 w-16 rounded-lg border border-line px-2 text-right text-sm text-ink outline-none focus:border-brand disabled:opacity-50" />h</label>
              <button disabled={i === 0} onClick={() => move(st.key, stages[i - 1]!.key)} aria-label={`Move ${label(st.key)} up`} className="text-sub hover:text-brand disabled:opacity-30"><ArrowUp className="size-4" /></button>
              <button disabled={i === stages.length - 1} onClick={() => move(st.key, stages[i + 1]!.key)} aria-label={`Move ${label(st.key)} down`} className="text-sub hover:text-brand disabled:opacity-30"><ArrowDown className="size-4" /></button>
              <span title={locked ? "This stage cannot be disabled" : undefined} className={locked ? "opacity-50" : ""}><Toggle on={st.enabled} onChange={(x) => { if (!locked) put(stages.map((y) => (y.key === st.key ? { ...y, enabled: x } : y))); }} /></span>
            </li>
          );
        })}
      </ol>
      {error && <span className={ERR}>{error}</span>}
    </div>
  );
}

function NotifMatrix({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const m = parse<Record<string, string[]>>(value, DEFAULT_MATRIX);
  const flip = (e: string, c: string) => onChange(JSON.stringify({ ...m, [e]: (m[e] ?? []).includes(c) ? (m[e] ?? []).filter((x) => x !== c) : [...(m[e] ?? []), c] }));
  const colAll = (c: string) => EVENTS.every((e) => (m[e] ?? []).includes(c));
  const flipCol = (c: string) => { const all = colAll(c); onChange(JSON.stringify(Object.fromEntries(EVENTS.map((e) => [e, all ? (m[e] ?? []).filter((x) => x !== c) : [...new Set([...(m[e] ?? []), c])]])))); };
  return (
    <div className="rounded-2xl border border-line p-5">
      <h3 className="text-base font-extrabold">Event x channel matrix</h3>
      <p className="mb-3 text-xs text-sub">Choose which channels fire for each event.</p>
      <div className="overflow-x-auto"><table className={tableCls} data-testid="notif-matrix">
        <thead><tr><Th>Event</Th>{CHANNELS.map((c) => <Th key={c} className="text-center"><label className="inline-flex flex-col items-center gap-1 normal-case">{c}<span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sub"><input type="checkbox" aria-label={`All ${c}`} checked={colAll(c)} onChange={() => flipCol(c)} className="size-3.5 accent-[#3f4fe0]" />All</span></label></Th>)}</tr></thead>
        <tbody>{EVENTS.map((e) => <tr key={e} className={trCls}><Td className="font-semibold">{e}</Td>{CHANNELS.map((c) => <Td key={c} className="text-center"><span aria-label={`${e}: ${c}`} className="inline-block"><Toggle on={(m[e] ?? []).includes(c)} onChange={() => flip(e, c)} /></span></Td>)}</tr>)}</tbody>
      </table></div>
    </div>
  );
}

interface Sess { id: string; device: string; where: string; when: string; current?: boolean }
const SEED_SESSIONS: Sess[] = [
  { id: "s1", device: "Chrome · Windows 11", where: "Bengaluru, IN · 103.21.44.8", when: "Active now", current: true },
  { id: "s2", device: "Safari · iPhone 15", where: "Bengaluru, IN · 49.37.12.90", when: "Last active 25 min ago" },
  { id: "s3", device: "Edge · Windows 10", where: "Mumbai, IN · 117.200.5.34", when: "Last active 3 hours ago" },
  { id: "s4", device: "Chrome · Android", where: "Hyderabad, IN · 157.48.99.2", when: "Last active yesterday" },
];

function SecurityExtras({ v, show }: { v: Record<string, Val>; show: (m: string) => void }) {
  const [sessions, setSessions] = useState(SEED_SESSIONS);
  const [pw, setPw] = useState("");
  const min = Number(v.pw_min) || 8;
  const rules = [
    { l: `At least ${min} characters`, ok: pw.length >= min },
    ...(v.pw_cx ? [{ l: "Uppercase letter", ok: /[A-Z]/.test(pw) }, { l: "Lowercase letter", ok: /[a-z]/.test(pw) }, { l: "Number", ok: /\d/.test(pw) }, { l: "Symbol", ok: /[^A-Za-z0-9]/.test(pw) }] : []),
  ];
  return (<>
    <div className="rounded-2xl border border-line p-5">
      <h3 className="text-base font-extrabold">Test the password policy</h3>
      <p className="mb-3 text-xs text-sub">Type a sample password to see which rules of the current policy it passes (nothing is stored).</p>
      <input data-testid="pw-test" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Try a password…" />
      <ul className="mt-2 grid gap-x-4 sm:grid-cols-2 text-xs" data-testid="pw-rules">{rules.map((r) => <li key={r.l} className={cx("flex items-center gap-1.5", r.ok ? "text-emerald-600" : "text-sub")}>{r.ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}{r.l}</li>)}</ul>
      <p className="mt-2 text-xs text-sub">Passwords expire {Number(v.pw_exp) ? `every ${v.pw_exp} days` : "never"}; accounts lock after {String(v.max_fail)} failed attempts; sessions end after {String(v.timeout)} of inactivity.</p>
    </div>
    <div className="rounded-2xl border border-line p-5">
      <div className="mb-3 flex items-center justify-between"><div><h3 className="text-base font-extrabold">Active sessions</h3><p className="text-xs text-sub">Devices currently signed in to your account.</p></div>
        {sessions.length > 1 && <button onClick={() => { setSessions((l) => l.filter((x) => x.current)); show("Signed out of all other sessions"); }} className="h-9 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50">Revoke all others</button>}</div>
      <ul className="space-y-2" data-testid="settings-sessions">{sessions.map((x) => (
        <li key={x.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-[13px]"><MonitorSmartphone className="size-5 text-sub" /><span className="flex-1"><b>{x.device}</b>{x.current && <Pill tone="green" className="ml-2">This device</Pill>}<span className="block text-xs text-sub">{x.where} · {x.when}</span></span>
          {!x.current && <button onClick={() => { setSessions((l) => l.filter((y) => y.id !== x.id)); show(`Session on ${x.device} revoked`); }} className="h-8 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50">Revoke</button>}</li>
      ))}</ul>
    </div>
  </>);
}

export default function Settings() {
  const [sec, setSec] = useState("general");
  const [saved, setSaved] = useState<Record<string, Val>>(load);
  const [v, setV] = useState<Record<string, Val>>(saved);
  const [errs, setErrs] = useState<Errs>({});
  const [toast, show] = useToast();
  const [logQ, setLogQ] = useState("");
  const [logUser, setLogUser] = useState("All Users");
  const [logAction, setLogAction] = useState("All Actions");
  const [preview, setPreview] = useState<null | "invoice" | "receipt">(null);
  const [q, setQ] = useState("");

  const dirtyKeys = useMemo(() => Object.keys({ ...saved, ...v }).filter((k) => v[k] !== saved[k]), [v, saved]);
  const dirtySecs = useMemo(() => new Set(dirtyKeys.map((k) => KEY_SEC[k]).filter(Boolean) as string[]), [dirtyKeys]);
  const dirty = dirtyKeys.length > 0;
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const set = (k: string, val: Val) => { setV((p) => ({ ...p, [k]: val })); if (errs[k]) setErrs((e) => { const c = { ...e }; delete c[k]; return c; }); };
  const matches = useMemo(() => SECTIONS.filter((x) => !q.trim() || matchSection(x, q.trim().toLowerCase())), [q]);
  useEffect(() => { if (matches.length && !matches.some((x) => x.key === sec)) setSec(matches[0]!.key); }, [matches, sec]);
  const s = SECTIONS.find((x) => x.key === sec)!;
  const str = (k: string) => String(v[k] ?? "");

  const saveAll = () => {
    const e = validate(v);
    setErrs(e);
    const bad = Object.keys(e);
    if (bad.length) { setSec(KEY_SEC[bad[0]!] ?? sec); show(`Fix ${bad.length} invalid field${bad.length > 1 ? "s" : ""} before saving`); return; }
    const n = dirtySecs.size;
    try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { show("Saved for this session only (browser storage unavailable)"); setSaved(v); return; }
    setSaved(v);
    show(n ? `Saved changes in ${n} section${n > 1 ? "s" : ""}` : "Settings saved");
  };
  const discard = () => { setV(saved); setErrs({}); show("Unsaved changes discarded"); };
  const sendTestEmail = () => {
    if (!str("smtp_host").trim() || !EMAIL_RE.test(str("from_email"))) { show("Enter an SMTP host and a valid From Email first"); return; }
    show(`Test email sent to ${str("from_email")} via ${str("smtp_host")}:${str("smtp_port")}`);
  };
  const sendTestWa = () => {
    if (!v.wa_on) { show("Enable WhatsApp messages first"); return; }
    if (str("wa_num").replace(/\D/g, "").length < 10) { show("Enter a valid business number first"); return; }
    show(`Test WhatsApp message (${str("wa_tpl")}) sent to ${str("wa_num")}`);
  };

  const users = useMemo(() => ["All Users", ...new Set(LOG.map((r) => r[1]))], []);
  const actions = useMemo(() => ["All Actions", ...new Set(LOG.map((r) => r[2]))], []);
  const logRows = LOG.filter((r) => (logUser === "All Users" || r[1] === logUser) && (logAction === "All Actions" || r[2] === logAction) && r.join(" ").toLowerCase().includes(logQ.toLowerCase()));

  const renderGroup = (g: Group) => (
    <div key={g.title} className="rounded-2xl border border-line p-5">
      <h3 className="text-base font-extrabold">{g.title}</h3>
      {g.desc && <p className="text-xs text-sub">{g.desc}</p>}
      <div className={cx("mt-4", g.cols === 2 ? "grid gap-x-4 md:grid-cols-2" : "space-y-4")}>
        {g.fields.map((f) =>
          f.t === "toggle" ? (
            <div key={f.k} className="flex items-center justify-between gap-4 py-1.5"><span className="text-sm font-semibold">{f.hint}</span><Toggle on={Boolean(v[f.k])} onChange={(x) => set(f.k, x)} /></div>
          ) : f.t === "slider" ? (
            <Field key={f.k} label={f.l} hint={f.hint}>
              <div className="flex items-center gap-3"><input type="range" aria-label={f.l} min={f.min} max={f.max} step={f.step ?? 1} value={Number(v[f.k]) || f.min} onChange={(e) => set(f.k, e.target.value)} className="h-2 flex-1 accent-[#3f4fe0]" />
                <output data-testid={`val-${f.k}`} className="w-28 text-right text-sm font-bold">{Number(v[f.k]) === 0 && f.zero ? f.zero : `${v[f.k]} ${f.unit}`}</output></div>
              {errs[f.k] && <span className={ERR}>{errs[f.k]}</span>}
            </Field>
          ) : (
            <Field key={f.k} label={f.l} hint={f.hint}>
              {f.t === "textarea" ? <textarea className="h-20 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={str(f.k)} onChange={(e) => set(f.k, e.target.value)} />
                : f.t === "select" ? <FilterSelect value={str(f.k)} onChange={(x) => set(f.k, x)} options={f.o} />
                : <input type={f.t} className={inputCls} value={str(f.k)} onChange={(e) => set(f.k, e.target.value)} />}
              {errs[f.k] && <span className={ERR}>{errs[f.k]}</span>}
            </Field>
          ),
        )}
      </div>
      {sec === "email" && g.title === "SMTP" && <button onClick={sendTestEmail} className="mt-2 inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[13px] font-bold hover:bg-brand-soft"><Send className="size-4" />Send test email</button>}
      {sec === "whatsapp" && <button onClick={sendTestWa} className="mt-2 inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[13px] font-bold hover:bg-brand-soft"><Send className="size-4" />Send test WhatsApp message</button>}
      {sec === "templates" && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => setPreview("invoice")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[13px] font-bold hover:bg-brand-soft"><Eye className="size-4" />Preview invoice</button>
          <button onClick={() => setPreview("receipt")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-[13px] font-bold hover:bg-brand-soft"><Eye className="size-4" />Preview receipt</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-w-0">
      {toast}
      <PageHeader title="Settings" subtitle="Configure system preferences and behaviour">
        {dirty && <span data-testid="dirty-note" className="text-xs font-bold text-amber-600">Unsaved changes in {dirtySecs.size} section{dirtySecs.size === 1 ? "" : "s"}</span>}
        {dirty && <button onClick={discard} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold hover:bg-brand-soft"><Undo2 className="size-4" />Discard</button>}
        <button onClick={saveAll} className={cx("inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-md shadow-brand/25 hover:bg-brand-dark", dirty && "ring-4 ring-brand/20")}><Save className="size-4" />Save All</button>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
        <Panel title="Settings" bodyClassName="pt-2">
          <label className="mb-2 flex h-9 items-center gap-2 rounded-lg border border-line px-2.5 focus-within:border-brand"><Search className="size-4 text-sub" /><input aria-label="Search settings" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings…" className="w-full bg-transparent text-sm outline-none" />{q && <button onClick={() => setQ("")} aria-label="Clear settings search"><X className="size-3.5 text-sub" /></button>}</label>
          <nav className="space-y-0.5">
            {matches.map((x) => (
              <button key={x.key} onClick={() => setSec(x.key)} className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] font-semibold", x.key === sec ? "bg-brand-soft text-brand" : "text-ink hover:bg-slate-50")}>
                <x.icon className="size-[18px] text-sub" /><span className="flex-1">{x.label}</span>{dirtySecs.has(x.key) && <span data-testid={`dirty-${x.key}`} title="Unsaved changes" className="size-2 rounded-full bg-amber-500" />}
              </button>
            ))}
            {matches.length === 0 && <p className="px-3 py-4 text-xs text-sub">No settings match “{q}”.</p>}
          </nav>
        </Panel>

        <Panel title={s.title} subtitle={s.desc} bodyClassName="space-y-4">
          {sec === "general" && <General v={v} set={set} errs={errs} show={show} />}
          {sec === "workflow" && <StageEditor value={str("wf_stages")} onChange={(x) => set("wf_stages", x)} error={errs.wf_stages} />}
          {sec === "workflow" && <BusinessHours v={v} set={set} errs={errs} />}
          {sec === "data" && <DataStorage show={show} />}
          {sec === "audit" && (
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <SearchInput className="w-72" value={logQ} onChange={setLogQ} placeholder="Search user or action..." />
                <FilterSelect className="w-44" value={logUser} onChange={setLogUser} options={users} />
                <FilterSelect className="w-48" value={logAction} onChange={setLogAction} options={actions} />
                <button onClick={() => { setLogQ(""); setLogUser("All Users"); setLogAction("All Actions"); show("Log filters cleared"); }} className="text-sm font-bold text-brand">Clear</button>
                <button onClick={() => { downloadCsv("activity-log.csv", [["Timestamp", "User", "Action", "Details"], ...logRows]); show(`Exported ${logRows.length} log entries`); }} className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[13px] font-bold hover:bg-brand-soft"><Download className="size-4" />Export</button>
              </div>
              <div className="overflow-x-auto">
                <table className={tableCls}>
                  <thead><tr><Th>Timestamp</Th><Th>User</Th><Th>Action</Th><Th>Details</Th></tr></thead>
                  <tbody>
                    {logRows.map((r, i) => (
                      <tr key={i} className={trCls}><Td>{r[0]}</Td><Td className="font-semibold">{r[1]}</Td><Td><Pill tone={/fail|changed|approved/i.test(r[2]) ? "amber" : "blue"}>{r[2]}</Pill></Td><Td className="text-sub">{r[3]}</Td></tr>
                    ))}
                    {logRows.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-sub">No log entries match.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {sec === "invoice" ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
              <div className="space-y-4">{s.groups?.map(renderGroup)}</div>
              <div className="xl:sticky xl:top-2 xl:self-start"><div className="mb-2 text-xs font-bold uppercase tracking-wide text-sub">Live preview</div><InvoicePreview v={v} /></div>
            </div>
          ) : s.groups?.map(renderGroup)}
          {sec === "notifications" && <NotifMatrix value={str("notif_matrix")} onChange={(x) => set("notif_matrix", x)} />}
          {sec === "security" && <SecurityExtras v={v} show={show} />}
        </Panel>
      </div>

      <SlideOver open={!!preview} onClose={() => setPreview(null)} width={520} title={preview === "invoice" ? `Invoice preview - ${str("tpl_inv")}` : `Receipt preview - ${str("tpl_rcp")}`}
        footer={<><button onClick={() => setPreview(null)} className="h-11 px-5 text-sm font-bold">Close</button><button onClick={() => { window.print(); }} className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white">Print sample</button></>}>
        <InvoicePreview v={v} receipt={preview === "receipt"} />
        <p className="mt-3 text-xs text-sub">Edit prefix, footer and terms under Invoice Settings and Document Templates, then save.</p>
      </SlideOver>
    </div>
  );
}

function General({ v, set, errs, show }: { v: Record<string, Val>; set: (k: string, x: Val) => void; errs: Errs; show: (m: string) => void }) {
  const s = (k: string) => String(v[k] ?? "");
  const [logo, setLogo] = useState<string | null>(() => { try { return localStorage.getItem("albumpro.logo"); } catch { return null; } });
  const toggles: [string, string, string][] = [
    ["autoAssign", "Auto Assign to Next Department", "Automatically move order to next stage after approval"],
    ["deliveryNoPay", "Allow Delivery Without Full Payment", "Permits delivery even if final payment is pending"],
    ["clientLink", "Enable Client Approval Link", "Allow clients to review and approve albums online"],
    ["notify", "Enable Notifications", "Send email/WhatsApp notifications to users and clients"],
  ];
  return (<>
    <div className="rounded-2xl border border-line p-5">
      <h3 className="text-base font-extrabold">Company Information</h3>
      <p className="mb-4 text-xs text-sub">This information will be used across the system (invoices, reports, client communication, etc.)</p>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="Company Name" required><input className={inputCls} value={s("name")} onChange={(e) => set("name", e.target.value)} />{errs.name && <span className={ERR}>{errs.name}</span>}</Field>
          <Field label="Website"><input className={inputCls} value={s("website")} onChange={(e) => set("website", e.target.value)} /></Field>
          <Field label="Phone Number"><input className={inputCls} value={s("phone")} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email"><input type="email" className={inputCls} value={s("email")} onChange={(e) => set("email", e.target.value)} />{errs.email && <span className={ERR}>{errs.email}</span>}</Field>
          <div className="md:col-span-2"><Field label="Address"><textarea className="h-24 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={s("address")} onChange={(e) => set("address", e.target.value)} /></Field></div>
        </div>
        <div className="rounded-xl border border-line p-4 text-center">
          <div className="mb-2 text-left text-[13px] font-bold">Company Logo</div>
          <div className="grid h-36 place-items-center rounded-lg bg-slate-50 text-sub">
            {logo ? <img src={logo} alt="Logo" className="max-h-32 max-w-full object-contain" /> : <div><Camera className="mx-auto size-10 text-slate-400" /><div className="mt-2 text-xs font-semibold text-ink">Upload Company Logo</div><div className="text-[11px]">PNG, JPG or WebP (Max 2MB)</div></div>}
          </div>
          <label className="mt-3 block cursor-pointer rounded-lg border border-line py-2 text-sm font-bold text-brand hover:bg-brand-soft">
            Change Logo
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = "";
              if (!f) return;
              if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { show("Logo must be a PNG, JPG or WebP image"); return; }
              if (f.size > 2 * 1024 * 1024) { show("Logo is larger than 2MB"); return; }
              const r = new FileReader();
              r.onload = () => { const url = String(r.result); setLogo(url); try { localStorage.setItem("albumpro.logo", url); } catch { /* ignore */ } set("logo", f.name); show(`Logo updated: ${f.name}`); };
              r.readAsDataURL(f);
            }} />
          </label>
        </div>
      </div>
    </div>

    <div className="rounded-2xl border border-line p-5">
      <h3 className="text-base font-extrabold">Operational Settings</h3>
      <p className="mb-4 text-xs text-sub">Configure currency, tax and order numbering</p>
      <div className="grid gap-x-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Default Currency"><FilterSelect value={s("currency")} onChange={(x) => set("currency", x)} options={["INR (₹)", "USD ($)"]} /></Field>
        <Field label="Default Tax (GST %)"><FilterSelect value={s("tax")} onChange={(x) => set("tax", x)} options={["0%", "5%", "12%", "18%", "28%"]} /></Field>
        <Field label="Default Order Prefix"><input className={inputCls} value={s("prefix")} onChange={(e) => set("prefix", e.target.value.toUpperCase())} /></Field>
        <Field label="Next Order Number"><input className={inputCls} inputMode="numeric" value={s("nextNo")} onChange={(e) => set("nextNo", e.target.value.replace(/\D/g, ""))} /></Field>
      </div>
    </div>

    <div className="rounded-2xl border border-line p-5">
      <h3 className="text-base font-extrabold">System Behaviour</h3>
      <p className="mb-4 text-xs text-sub">Control how the system behaves with these preferences</p>
      <div className="grid gap-x-10 gap-y-4 md:grid-cols-2">
        {toggles.map(([k, t, d]) => (
          <div key={k} className="flex items-start gap-3"><Toggle on={Boolean(v[k])} onChange={(x) => set(k, x)} /><div><div className="text-sm font-bold">{t}</div><div className="text-xs text-sub">{d}</div></div></div>
        ))}
      </div>
    </div>
  </>);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Business-hours calendar consumed by lib/sla.ts (SRS 18.2: SLA clocks count business hours only). */
function BusinessHours({ v, set, errs }: { v: Record<string, Val>; set: (k: string, x: Val) => void; errs: Errs }) {
  const days = String(v.bh_days ?? "").split(",").filter(Boolean).map(Number);
  const flip = (d: number) => set("bh_days", (days.includes(d) ? days.filter((x) => x !== d) : [...days, d]).sort().join(","));
  const hours = Array.from({ length: 25 }, (_, h) => h);
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return (
    <div className="rounded-2xl border border-line p-5" data-testid="business-hours">
      <h3 className="text-base font-extrabold">Business hours & SLA calendar</h3>
      <p className="mb-4 text-xs text-sub">SLA hours are counted only inside these working hours. Sundays and holidays are excluded unless enabled. Save All to apply.</p>
      <div className="grid gap-x-4 md:grid-cols-3">
        <Field label="Opening time"><select aria-label="Opening time" className={inputCls} value={String(v.bh_start)} onChange={(e) => set("bh_start", e.target.value)}>{hours.slice(0, 24).map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select></Field>
        <Field label="Closing time"><select aria-label="Closing time" className={inputCls} value={String(v.bh_end)} onChange={(e) => set("bh_end", e.target.value)}>{hours.slice(1).map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select>{errs.bh_end && <span className={ERR}>{errs.bh_end}</span>}</Field>
        <Field label="Warn at % of SLA used" hint="Escalation threshold (ALB-FR-0394)"><input type="number" aria-label="Warn percentage" className={inputCls} value={String(v.sla_warn_pct)} onChange={(e) => set("sla_warn_pct", e.target.value)} />{errs.sla_warn_pct && <span className={ERR}>{errs.sla_warn_pct}</span>}</Field>
      </div>
      <div className="mb-4"><span className="mb-1.5 block text-[13px] font-semibold">Working days</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Working days">{DAYS.map((d, i) => <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => flip(i)} className={cx("h-9 w-14 rounded-lg border text-xs font-bold", days.includes(i) ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{d}</button>)}</div>
        {errs.bh_days && <span className={ERR}>{errs.bh_days}</span>}</div>
      <Field label="Holidays" hint="One date per line or comma separated, YYYY-MM-DD"><textarea aria-label="Holidays" className="h-20 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={String(v.bh_holidays ?? "")} onChange={(e) => set("bh_holidays", e.target.value)} placeholder="2026-10-20" />{errs.bh_holidays && <span className={ERR}>{errs.bh_holidays}</span>}</Field>
    </div>
  );
}

const SKIP_KEYS = ["albumpro.role", "albumpro.lockUntil"];
const backupKeys = () => { try { return Object.keys(localStorage).filter((k) => k.startsWith("albumpro.") && !SKIP_KEYS.includes(k)).sort(); } catch { return []; } };
const kb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

function DataStorage({ show }: { show: (m: string) => void }) {
  const [dialog, confirm] = useConfirm();
  const [tick, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => backupKeys().map((k) => {
    const raw = localStorage.getItem(k) ?? "";
    let count = "";
    try { const j = JSON.parse(raw); if (Array.isArray(j)) count = `${j.length} records`; else if (j && typeof j === "object") count = `${Object.keys(j).length} fields`; } catch { /* not json */ }
    return { k, size: raw.length * 2, count };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tick]);
  const total = rows.reduce((a, r) => a + r.size, 0);

  const exportBackup = () => {
    flushAll();
    const keys: Record<string, string> = {};
    backupKeys().forEach((k) => { keys[k] = localStorage.getItem(k) ?? ""; });
    const blob = new Blob([JSON.stringify({ app: "albumpro", version: 1, exportedAt: new Date().toISOString(), keys }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `albumpro-backup-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    show(`Backup exported (${Object.keys(keys).length} keys)`);
  };
  const importBackup = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    let data: { app?: string; keys?: Record<string, unknown> };
    try { data = JSON.parse(await file.text()); } catch { show("That file is not valid JSON"); return; }
    const entries = Object.entries(data.keys ?? {}).filter(([k, v]) => k.startsWith("albumpro.") && !SKIP_KEYS.includes(k) && typeof v === "string");
    if (data.app !== "albumpro" || !entries.length) { show("Not an AlbumPro backup file"); return; }
    confirm({ title: "Restore backup", message: `Replace the current saved data with ${entries.length} key${entries.length === 1 ? "" : "s"} from ${file.name}? The page will reload.`, confirmLabel: "Restore", danger: true }, () => {
      flushAll();   // make memory == storage so the unload flush cannot overwrite what we restore
      try { backupKeys().forEach((k) => localStorage.removeItem(k)); entries.forEach(([k, v]) => localStorage.setItem(k, v as string)); } catch { show("Browser storage is unavailable"); return; }
      window.location.reload();
    });
  };
  const reset = () => confirm({ title: "Reset demo data", message: "Erase all saved orders, files, audit log, masters, pricing and users, and reload with the original sample data? This cannot be undone. Export a backup first if unsure.", confirmLabel: "Reset everything", danger: true }, () => {
    try { localStorage.removeItem("albumpro.users"); localStorage.removeItem("albumpro.settings"); } catch { /* ignore */ }
    resetDemoData();
  });

  const byEntity = new Map<string, number>();
  AUDIT.forEach((a) => byEntity.set(a.entity, (byEntity.get(a.entity) ?? 0) + 1));
  const ent = [...byEntity.entries()].sort((a, b) => b[1] - a[1]);
  const overrides = AUDIT.filter((a) => a.override).length;
  const actors = new Set(AUDIT.map((a) => a.actor)).size;

  return (<>
    {dialog}
    <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" data-testid="backup-input" onChange={(e) => importBackup(e.target.files?.[0])} />
    <div className="rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-base font-extrabold">Saved demo data</h3><p className="text-xs text-sub">Everything below lives in this browser only ({kb(total)} total). A backend will replace it.</p></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportBackup} data-testid="export-backup" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[13px] font-bold hover:bg-brand-soft"><Download className="size-4" />Export backup (JSON)</button>
          <button onClick={() => fileRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[13px] font-bold hover:bg-brand-soft"><Upload className="size-4" />Import backup</button>
          <button onClick={reset} data-testid="reset-demo" className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 px-3.5 text-[13px] font-bold text-rose-600 hover:bg-rose-50"><Trash2 className="size-4" />Reset demo data</button>
          <button onClick={() => { flushAll(); setTick((t) => t + 1); }} className="h-10 px-2 text-[13px] font-bold text-brand">Refresh</button>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto"><table className={tableCls} data-testid="storage-keys">
        <thead><tr><Th>Key</Th><Th>Contents</Th><Th className="text-right">Size</Th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.k} className={trCls}><Td className="font-mono text-xs">{r.k}</Td><Td className="text-sub">{r.count || "—"}</Td><Td className="text-right">{kb(r.size)}</Td></tr>)}
          {rows.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-sub">Nothing saved yet.</td></tr>}</tbody>
      </table></div>
    </div>
    <div className="rounded-2xl border border-line p-5" data-testid="audit-summary">
      <div className="flex items-center justify-between"><div><h3 className="text-base font-extrabold">Audit summary</h3><p className="text-xs text-sub">Read-only. The full trail is under Audit Log.</p></div><ShieldAlert className="size-5 text-sub" /></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-4 text-sm">
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-sub">Events</div><b className="text-lg">{AUDIT.length}</b></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-sub">Override events</div><b className="text-lg text-rose-600">{overrides}</b></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-sub">Distinct actors</div><b className="text-lg">{actors}</b></div>
        <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-sub">Latest</div><b className="text-[13px]">{AUDIT[0] ? new Date(AUDIT[0].at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</b></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{ent.map(([k, n]) => <Pill key={k} tone="blue">{k}: {n}</Pill>)}{ent.length === 0 && <span className="text-xs text-sub">No events recorded yet.</span>}</div>
    </div>
  </>);
}

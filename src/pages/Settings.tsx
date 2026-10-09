import { useState } from "react";
import { Bell, Building2, Camera, CreditCard, FileText, FolderOpen, History, Mail, MessageCircle, Save, Settings as Cog, ShieldCheck, Workflow, Receipt } from "lucide-react";
import type { ComponentType } from "react";
import { Field, FilterSelect, Panel, Pill, PageHeader, SearchInput, Td, Th, Toggle, inputCls, tableCls, trCls, cx } from "../components/ui";
import { useToast } from "../components/Toast";

type Val = string | boolean;
type Fld =
  | { k: string; l: string; t: "text" | "number" | "password" | "textarea"; hint?: string }
  | { k: string; l: string; t: "select"; o: string[]; hint?: string }
  | { k: string; l: string; t: "toggle"; hint: string };
interface Group { title: string; desc?: string; cols?: 1 | 2; fields: Fld[] }
interface SectionDef { key: string; label: string; icon: ComponentType<{ className?: string }>; title: string; desc: string; groups?: Group[] }

const SECTIONS: SectionDef[] = [
  { key: "general", label: "General", icon: Cog, title: "General Settings", desc: "Base information and system-wide configuration" },
  { key: "company", label: "Company Profile", icon: Building2, title: "Company Profile", desc: "Legal and tax details printed on invoices and receipts", groups: [
    { title: "Legal Details", cols: 2, fields: [
      { k: "legal", l: "Legal Name", t: "text" }, { k: "gstin", l: "GSTIN", t: "text", hint: "15-character GSTIN, format validated" },
      { k: "pan", l: "PAN", t: "text" }, { k: "state", l: "State of Supply", t: "select", o: ["Karnataka", "Telangana", "Maharashtra", "Tamil Nadu", "Delhi"] },
      { k: "caddr", l: "Registered Address", t: "textarea" }] }] },
  { key: "workflow", label: "Workflow Settings", icon: Workflow, title: "Workflow Settings", desc: "Controls how orders move through the production route", groups: [
    { title: "Approvals", desc: "Admin approval gates in the Design + Printing route", fields: [
      { k: "wf_cg", l: "", t: "toggle", hint: "Require Admin approval after Colour Grading" },
      { k: "wf_design", l: "", t: "toggle", hint: "Require Admin design review before client proof" },
      { k: "wf_release", l: "", t: "toggle", hint: "Admin release required before Printing" },
      { k: "wf_disc", l: "", t: "toggle", hint: "Discounts above the limit need Admin approval" }] },
    { title: "Turnaround", cols: 2, fields: [
      { k: "tat_cg", l: "Colour Grading TAT (days)", t: "number" }, { k: "tat_design", l: "Designing TAT (days)", t: "number" },
      { k: "tat_print", l: "Printing TAT (days)", t: "number" }, { k: "disc_limit", l: "Discount approval threshold (%)", t: "number" }] }] },
  { key: "notifications", label: "Notifications", icon: Bell, title: "Notifications", desc: "Choose which events notify staff and clients", groups: [
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
      { k: "inv_igst", l: "", t: "toggle", hint: "Use IGST for inter-state customers" }, { k: "inv_round", l: "", t: "toggle", hint: "Round off invoice total" }] }] },
  { key: "payment", label: "Payment Settings", icon: CreditCard, title: "Payment Settings", desc: "Accepted modes, advances, dues and refunds", groups: [
    { title: "Modes", fields: [
      { k: "pm_upi", l: "", t: "toggle", hint: "UPI" }, { k: "pm_cash", l: "", t: "toggle", hint: "Cash" }, { k: "pm_bank", l: "", t: "toggle", hint: "Bank Transfer" }, { k: "pm_online", l: "", t: "toggle", hint: "Online payment gateway" }] },
    { title: "Rules", cols: 2, fields: [
      { k: "adv_pct", l: "Minimum advance (%)", t: "number" }, { k: "upi_id", l: "UPI ID", t: "text" },
      { k: "rcp_prefix", l: "Receipt Prefix", t: "text" }, { k: "refund_appr", l: "Refunds approved by", t: "select", o: ["Admin", "Admin + Accounts"] }] }] },
  { key: "security", label: "Security", icon: ShieldCheck, title: "Security", desc: "Authentication, MFA, sessions and password policy (SRS section 2)", groups: [
    { title: "Authentication", fields: [
      { k: "mfa", l: "", t: "toggle", hint: "Require MFA for all users" }, { k: "mfa_admin", l: "", t: "toggle", hint: "Step-up OTP for exports, overrides and permission changes" },
      { k: "remember", l: "", t: "toggle", hint: "Allow Remember Device (trusted device policy)" }, { k: "captcha", l: "", t: "toggle", hint: "Risk-based CAPTCHA on login" }] },
    { title: "Sessions & Password Policy", cols: 2, fields: [
      { k: "timeout", l: "Session timeout (minutes)", t: "number" }, { k: "max_fail", l: "Lock account after failed attempts", t: "number" },
      { k: "pw_min", l: "Minimum password length", t: "number" }, { k: "pw_exp", l: "Password expiry (days)", t: "number" },
      { k: "pw_cx", l: "", t: "toggle", hint: "Require upper, lower, number and symbol" }, { k: "pw_hist", l: "", t: "toggle", hint: "Block reuse of last 5 passwords" }] }] },
  { key: "audit", label: "Activity Log", icon: History, title: "Activity Log", desc: "Audit trail of sensitive actions" },
];

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
  inv_prefix: "INV-2026-", inv_next: "19", inv_gst: "18%", inv_terms: "9", inv_igst: true, inv_round: false,
  pm_upi: true, pm_cash: true, pm_bank: true, pm_online: false, adv_pct: "50", upi_id: "priya@upi", rcp_prefix: "RCP", refund_appr: "Admin",
  mfa: true, mfa_admin: true, remember: true, captcha: true, timeout: "30", max_fail: "5", pw_min: "8", pw_exp: "90", pw_cx: true, pw_hist: true,
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

export default function Settings() {
  const [sec, setSec] = useState("general");
  const [v, setV] = useState<Record<string, Val>>(INIT);
  const [dirty, setDirty] = useState(false);
  const [toast, show] = useToast();
  const [logQ, setLogQ] = useState("");
  const set = (k: string, val: Val) => { setV((p) => ({ ...p, [k]: val })); setDirty(true); };
  const s = SECTIONS.find((x) => x.key === sec)!;
  const str = (k: string) => String(v[k] ?? "");

  const save = () => { setDirty(false); show(`${s.label} settings saved`); };

  return (
    <div className="min-w-0">
      {toast}
      <PageHeader title="Settings" subtitle="Configure system preferences and behaviour">
        <button onClick={save} className={cx("inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-md shadow-brand/25 hover:bg-brand-dark", dirty && "ring-4 ring-brand/20")}><Save className="size-4" />Save Changes</button>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
        <Panel title="Settings" bodyClassName="pt-2">
          <nav className="space-y-0.5">
            {SECTIONS.map((x) => (
              <button key={x.key} onClick={() => setSec(x.key)} className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] font-semibold", x.key === sec ? "bg-brand-soft text-brand" : "text-ink hover:bg-slate-50")}>
                <x.icon className="size-[18px] text-sub" />{x.label}
              </button>
            ))}
          </nav>
        </Panel>

        <Panel title={s.title} subtitle={s.desc} bodyClassName="space-y-4">
          {sec === "general" && <General v={v} set={set} />}
          {sec === "audit" && (
            <div>
              <SearchInput className="mb-3 max-w-sm" value={logQ} onChange={setLogQ} placeholder="Search user or action..." />
              <div className="overflow-x-auto">
                <table className={tableCls}>
                  <thead><tr><Th>Timestamp</Th><Th>User</Th><Th>Action</Th><Th>Details</Th></tr></thead>
                  <tbody>
                    {LOG.filter((r) => r.join(" ").toLowerCase().includes(logQ.toLowerCase())).map((r, i) => (
                      <tr key={i} className={trCls}><Td>{r[0]}</Td><Td className="font-semibold">{r[1]}</Td><Td><Pill tone={/fail|changed|approved/i.test(r[2]) ? "amber" : "blue"}>{r[2]}</Pill></Td><Td className="text-sub">{r[3]}</Td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {s.groups?.map((g) => (
            <div key={g.title} className="rounded-2xl border border-line p-5">
              <h3 className="text-base font-extrabold">{g.title}</h3>
              {g.desc && <p className="text-xs text-sub">{g.desc}</p>}
              <div className={cx("mt-4", g.cols === 2 ? "grid gap-x-4 md:grid-cols-2" : "space-y-4")}>
                {g.fields.map((f) =>
                  f.t === "toggle" ? (
                    <div key={f.k} className="flex items-center justify-between gap-4 py-1.5"><span className="text-sm font-semibold">{f.hint}</span><Toggle on={Boolean(v[f.k])} onChange={(x) => set(f.k, x)} /></div>
                  ) : (
                    <Field key={f.k} label={f.l} hint={f.hint}>
                      {f.t === "textarea" ? <textarea className="h-20 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={str(f.k)} onChange={(e) => set(f.k, e.target.value)} />
                        : f.t === "select" ? <FilterSelect value={str(f.k)} onChange={(x) => set(f.k, x)} options={f.o} />
                        : <input type={f.t} className={inputCls} value={str(f.k)} onChange={(e) => set(f.k, e.target.value)} />}
                    </Field>
                  ),
                )}
              </div>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

function General({ v, set }: { v: Record<string, Val>; set: (k: string, x: Val) => void }) {
  const s = (k: string) => String(v[k] ?? "");
  const [logo, setLogo] = useState<string | null>(null);
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
          <Field label="Company Name" required><input className={inputCls} value={s("name")} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Website"><input className={inputCls} value={s("website")} onChange={(e) => set("website", e.target.value)} /></Field>
          <Field label="Phone Number"><input className={inputCls} value={s("phone")} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email"><input type="email" className={inputCls} value={s("email")} onChange={(e) => set("email", e.target.value)} /></Field>
          <div className="md:col-span-2"><Field label="Address"><textarea className="h-24 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={s("address")} onChange={(e) => set("address", e.target.value)} /></Field></div>
        </div>
        <div className="rounded-xl border border-line p-4 text-center">
          <div className="mb-2 text-left text-[13px] font-bold">Company Logo</div>
          <div className="grid h-36 place-items-center rounded-lg bg-slate-50 text-sub">
            {logo ? <img src={logo} alt="Logo" className="max-h-32 max-w-full object-contain" /> : <div><Camera className="mx-auto size-10 text-slate-400" /><div className="mt-2 text-xs font-semibold text-ink">Upload Company Logo</div><div className="text-[11px]">PNG, JPG or WebP (Max 2MB)</div></div>}
          </div>
          <label className="mt-3 block cursor-pointer rounded-lg border border-line py-2 text-sm font-bold text-brand hover:bg-brand-soft">
            Change Logo
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && f.size <= 2 * 1024 * 1024) { setLogo(URL.createObjectURL(f)); set("logo", f.name); } }} />
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
        <Field label="Next Order Number"><input className={cx(inputCls, "bg-slate-50")} value={s("nextNo")} readOnly /></Field>
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

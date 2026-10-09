import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, Download, KeyRound, Shield, Upload, UserCog, UserPlus, Users, UserCheck, UserX, RotateCcw, ChevronRight, Copy, Pencil, Trash2, LogOut, Plus, Check, CalendarCheck, LineChart, Settings, Eye, EyeOff, Wand2, X, GitCompare, MonitorSmartphone, History, Mail } from "lucide-react";
import { TONE, Avatar, Field, KpiRow, LinkAction, Pagination, Panel, PageHeader, Pill, PrimaryButton, SearchInput, SlideOver, Td, Th, Toggle, inputCls, tableCls, trCls, cx } from "../components/ui";
import { ColumnsMenu, Combobox, FilterChips, MultiSelect, SavedViews, SortTh, sortRows, type SortState } from "../components/controls";
import { useToast } from "../components/Toast";
import { downloadCsv, parseCsv } from "../lib/csv";
import { RowMenu } from "../components/RowMenu";
import { useConfirm } from "../components/ConfirmDialog";
import { STAFF, type Staff, type Tone } from "../lib/data";
import { fmtDate } from "../lib/format";

type Tab = "users" | "roles" | "permissions";
const ROLE_TONE: Record<string, Tone> = { "Super Admin": "indigo", Designer: "pink", Printer: "orange", "Colour Grading": "blue", "QC Executive": "amber", Reception: "green", Accounts: "violet" };
const BASE_ROLES = ["Super Admin", "Designer", "Printer", "Colour Grading", "QC Executive", "Reception", "Accounts"];
const EXTRA_TONES: Tone[] = ["teal", "red", "slate", "blue", "amber", "pink"];
const COL_ROLE: Record<string, string> = { Admin: "Super Admin", Reception: "Reception", "Colour Grading": "Colour Grading", Designing: "Designer", Printing: "Printer", QC: "QC Executive", Accounts: "Accounts" };
const DEPTS = ["Head Office", "Designing", "Printing", "Colour Grading", "Quality Control", "Reception", "Accounts"];
const ROLE_DEPT: Record<string, string> = { "Super Admin": "Head Office", Designer: "Designing", Printer: "Printing", "Colour Grading": "Colour Grading", "QC Executive": "Quality Control", Reception: "Reception", Accounts: "Accounts" };
const ROLE_DESC: Record<string, string> = {
  "Super Admin": "Full access to every module, approvals, user & role administration.",
  Designer: "Album design work; view orders and printing requirements.",
  Printer: "Printing production; view designs and orders.",
  "Colour Grading": "Colour grading work on assigned orders.",
  "QC Executive": "QC inspection, defects and pass/fail.",
  Reception: "Customer & order create/edit, intake, limited payments.",
  Accounts: "Payments, invoices, refunds and finance reports.",
};

// SRS §21 Role Permission Matrix. Columns map to ROLE_COLS below.
const ROLE_COLS = ["Admin", "Reception", "Colour Grading", "Designing", "Printing", "QC", "Accounts"] as const;
const MATRIX: [string, string[]][] = [
  ["Customer Create/Edit", ["Full", "Create/Edit", "View", "View", "View", "View", "View"]],
  ["Order Create/Edit", ["Full", "Create/Edit", "View", "View", "View", "View", "View"]],
  ["Printing Requirement", ["Full", "Create/Edit", "View", "View", "View", "View", "View"]],
  ["Colour Grading Work", ["Full", "View", "Work", "View", "View", "View", "No"]],
  ["Approve Colour Grading", ["Approve", "No", "No", "No", "No", "No", "No"]],
  ["Album Design Work", ["Full", "View", "View", "Work", "View", "View", "No"]],
  ["Approve Design", ["Approve", "No", "No", "No", "No", "No", "No"]],
  ["Send Client Proof", ["Full", "Limited", "No", "No", "No", "No", "No"]],
  ["Client Correction View", ["Full", "View", "No", "Work", "No", "No", "No"]],
  ["Release to Printing", ["Approve", "No", "No", "No", "No", "No", "No"]],
  ["Printing Production", ["Full", "View", "No", "View", "Work", "View", "No"]],
  ["QC Inspection", ["Full", "View", "No", "View", "View", "Work", "No"]],
  ["Delivery", ["Full", "Update", "No", "No", "Update", "Update", "View"]],
  ["Payments", ["Full", "Receive limited", "No", "No", "No", "No", "Full"]],
  ["Invoices / Refunds", ["Full", "View/receipt", "No", "No", "No", "No", "Full"]],
  ["Reports", ["Full", "Limited", "Dept", "Dept", "Dept", "Dept", "Finance"]],
  ["User / Role Admin", ["Full", "No", "No", "No", "No", "No", "No"]],
];
const MODULES = MATRIX.map(([m]) => m);

const ACTS = ["view", "create", "edit", "approve", "delete", "export"] as const;
type Act = (typeof ACTS)[number];
type RolePerms = Record<string, Act[]>;
type Perms = Record<string, RolePerms>;
const LEVEL: Record<string, Act[]> = {
  No: [], View: ["view"], Work: ["view", "edit"], "Create/Edit": ["view", "create", "edit"], Full: [...ACTS], Approve: ["view", "approve"],
  Limited: ["view", "create"], Update: ["view", "edit"], "Receive limited": ["view", "create"], "View/receipt": ["view", "export"], Dept: ["view", "export"], Finance: ["view", "export"],
};
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const actLabel = (a: Act[]) => (a.length === 0 ? "No" : a.length === ACTS.length ? "Full" : a.length === 1 ? cap(a[0]!) : a.map((x) => cap(x)).join(" / "));
const initialPerms = (): Perms => Object.fromEntries(ROLE_COLS.map((c, ci) => [COL_ROLE[c]!, Object.fromEntries(MATRIX.map(([m, v]) => [m, [...(LEVEL[v[ci]!] ?? [])]]))]));
const clonePerm = (p: RolePerms): RolePerms => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [...v]]));
const blankPerm = (): RolePerms => Object.fromEntries(MODULES.map((m) => [m, [] as Act[]]));
const countModules = (p: RolePerms | undefined) => (p ? Object.values(p).filter((a) => a.length > 0).length : 0);

const GROUPS = [
  { icon: CalendarCheck, t: "Orders & Production", d: "Orders, pipeline, designing, printing" },
  { icon: Users, t: "Customer Management", d: "Customers, enquiries, data access" },
  { icon: LineChart, t: "Reports & Analytics", d: "Reports, financial data, insights" },
  { icon: Settings, t: "System Settings", d: "Masters, configuration, preferences" },
];

interface RoleDef { name: string; desc: string; tone: Tone }
interface UForm { name: string; email: string; mobile: string; role: string; dept: string; pw: string; invite: boolean }
const EMPTY_U: UForm = { name: "", email: "", mobile: "", role: "Reception", dept: "Reception", pw: "", invite: true };
const ERR = "mt-1 block text-xs font-semibold text-rose-600";
const OK = "mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-600";

// ---------- password strength (SRS §2 password policy) ----------
const pwChecks = (pw: string) => [
  { k: "len", label: "8+ characters", ok: pw.length >= 8 },
  { k: "upper", label: "Uppercase letter", ok: /[A-Z]/.test(pw) },
  { k: "num", label: "Number", ok: /\d/.test(pw) },
  { k: "sym", label: "Symbol", ok: /[^A-Za-z0-9]/.test(pw) },
];
const STRENGTH = ["Too weak", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_BAR = ["bg-slate-200", "bg-rose-500", "bg-amber-500", "bg-sky-500", "bg-emerald-500"];
function genPassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*?"];
  const all = sets.join("");
  const rnd = (n: number) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]! % n; };
  const chars = sets.map((s) => s[rnd(s.length)]!);
  while (chars.length < 14) chars.push(all[rnd(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!]; }
  return chars.join("");
}

// ---------- mock per-user security data ----------
interface Session { id: string; device: string; ip: string; place: string; since: string; current?: boolean }
interface AuditEntry { id: string; at: string; actor: string; action: string; target: string | null; detail: string }
const DEVICES = ["Chrome · Windows 11", "Safari · iPhone 15", "Edge · Windows 10", "Chrome · Android", "Firefox · macOS"];
const PLACES = ["Bengaluru, IN", "Mumbai, IN", "Hyderabad, IN", "Chennai, IN"];
const hash = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
const genSessions = (u: Staff): Session[] => {
  if (u.status === "Inactive") return [];
  const h = hash(u.id), n = 1 + (h % 3), base = new Date(u.lastLogin || "2026-10-01T09:00:00");
  return Array.from({ length: n }, (_, i) => ({ id: `${u.id}-s${i}`, device: DEVICES[(h + i) % DEVICES.length]!, ip: `103.${21 + i}.${h % 200}.${(h * 7 + i) % 250}`, place: PLACES[(h + i) % PLACES.length]!, since: new Date(+base - i * 3600e3 * 5).toISOString(), current: u.id === "U1" && i === 0 }));
};
const genHistory = (u: Staff) => {
  const h = hash(u.id), base = new Date(u.lastLogin || "2026-10-01T09:00:00");
  return Array.from({ length: u.lastLogin ? 5 : 0 }, (_, i) => ({ at: new Date(+base - i * 86400e3 - (i * 37 % 120) * 60e3).toISOString(), device: DEVICES[(h + i) % DEVICES.length]!, ip: `103.${21 + (i % 2)}.${h % 200}.${(h * 7 + i) % 250}`, ok: (h + i) % 7 !== 3 }));
};
const seedAudit = (u: Staff): AuditEntry[] => [
  { id: `${u.id}-a3`, at: u.lastLogin || "2026-09-20T10:00:00", actor: u.name, action: "Login", target: u.id, detail: "MFA verified" },
  { id: `${u.id}-a2`, at: "2026-08-14T15:30:00", actor: "Admin", action: "Role assigned", target: u.id, detail: `${u.role} (${u.dept})` },
  { id: `${u.id}-a1`, at: "2026-08-14T15:12:00", actor: "Admin", action: "User created", target: u.id, detail: `Invite sent to ${u.email}` },
];
const fmtDT = (iso: string) => `${fmtDate(iso)}, ${new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;

interface ViewState { q: string; fRole: string[]; fDept: string[]; fStatus: string[]; sort: SortState; hidden: string[] }
const COLS = [{ key: "contact", label: "Email / Mobile" }, { key: "role", label: "Role" }, { key: "dept", label: "Department" }, { key: "status", label: "Status" }, { key: "last", label: "Last Login" }];

/** Checkbox grid: modules x actions (view/create/edit/approve/delete/export). */
function PermGrid({ value, onChange, locked }: { value: RolePerms; onChange: (v: RolePerms) => void; locked?: boolean }) {
  const toggle = (m: string, a: Act) => onChange({ ...value, [m]: value[m]!.includes(a) ? value[m]!.filter((x) => x !== a) : [...value[m]!, a] });
  const toggleRow = (m: string) => onChange({ ...value, [m]: value[m]!.length === ACTS.length ? [] : [...ACTS] });
  const toggleCol = (a: Act) => { const all = MODULES.every((m) => value[m]!.includes(a)); onChange(Object.fromEntries(MODULES.map((m) => [m, all ? value[m]!.filter((x) => x !== a) : value[m]!.includes(a) ? value[m]! : [...value[m]!, a]]))); };
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-[13px]" aria-label="Permission matrix editor">
        <thead><tr className="bg-slate-50"><Th>Module</Th>{ACTS.map((a) => <Th key={a} className="text-center"><label className="inline-flex flex-col items-center gap-1 normal-case"><span className="uppercase">{a}</span><input type="checkbox" aria-label={`All ${a}`} disabled={locked} checked={MODULES.every((m) => value[m]!.includes(a))} onChange={() => toggleCol(a)} className="size-3.5 accent-[#3f4fe0]" /></label></Th>)}<Th className="text-center">All</Th></tr></thead>
        <tbody>
          {MODULES.map((m) => (
            <tr key={m} className={trCls}>
              <Td className="font-semibold">{m}</Td>
              {ACTS.map((a) => <Td key={a} className="text-center"><input type="checkbox" aria-label={`${m}: ${a}`} disabled={locked} checked={value[m]!.includes(a)} onChange={() => toggle(m, a)} className="size-4 accent-[#3f4fe0]" /></Td>)}
              <Td className="text-center"><input type="checkbox" aria-label={`${m}: all`} disabled={locked} checked={value[m]!.length === ACTS.length} onChange={() => toggleRow(m)} className="size-4 accent-[#3f4fe0]" /></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function UsersRoles() {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<Staff[]>(STAFF);
  const [roles, setRoles] = useState<RoleDef[]>(BASE_ROLES.map((name) => ({ name, desc: ROLE_DESC[name]!, tone: ROLE_TONE[name]! })));
  const [q, setQ] = useState("");
  const [fRole, setFRole] = useState<string[]>([]);
  const [fDept, setFDept] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [toast, show] = useToast();
  const [dialog, confirm] = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(100);
  const [params, setParams] = useSearchParams();

  // user form (add / edit)
  const [uSlide, setUSlide] = useState<null | { id: string | null }>(null);
  const [f, setF] = useState<UForm>(EMPTY_U);
  const [showPw, setShowPw] = useState(false);
  const [touched, setTouched] = useState(false);
  // user drawer
  const [drawer, setDrawer] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, Session[]>>(() => Object.fromEntries(STAFF.map((u) => [u.id, genSessions(u)])));
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  // role editor
  const [rSlide, setRSlide] = useState<null | { old: string | null }>(null);
  const [rf, setRf] = useState({ name: "", desc: "", copy: "" });
  const [rp, setRp] = useState<RolePerms>(blankPerm);
  const [rErr, setRErr] = useState<{ name?: string; desc?: string }>({});
  // permissions
  const [perms, setPerms] = useState<Perms>(initialPerms);
  const [saved, setSaved] = useState<Perms>(initialPerms);
  const dirty = JSON.stringify(perms) !== JSON.stringify(saved);
  const stash = useRef<Record<string, Act[]>>({});
  const [anchor, setAnchor] = useState<{ ri: number; mi: number } | null>(null);
  const [cmp, setCmp] = useState<{ on: boolean; a: string; b: string }>({ on: false, a: "Reception", b: "Accounts" });

  const roleNames = roles.map((r) => r.name);
  const roleTone = (n: string): Tone => roles.find((r) => r.name === n)?.tone ?? "slate";
  const log = (action: string, target: string | null, detail: string) => setAudit((a) => [{ id: `L${Date.now()}${a.length}`, at: new Date().toISOString(), actor: "Admin", action, target, detail }, ...a]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const rows = users.filter((u) => {
      if (fRole.length && !fRole.includes(u.role)) return false;
      if (fDept.length && !fDept.includes(u.dept)) return false;
      if (fStatus.length && !fStatus.includes(u.status)) return false;
      return !t || u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t) || u.mobile.includes(t);
    });
    return sortRows(rows, sort, (u, k) => (k === "user" ? u.name.toLowerCase() : k === "contact" ? u.email : k === "role" ? u.role : k === "dept" ? u.dept : k === "status" ? u.status : u.lastLogin));
  }, [users, q, fRole, fDept, fStatus, sort]);
  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, maxPage);
  const rows = filtered.slice((cur - 1) * pageSize, cur * pageSize);
  const roleCount = (r: string) => users.filter((u) => u.role === r).length;
  const active = users.filter((u) => u.status === "Active").length;
  const allOnPage = rows.length > 0 && rows.every((u) => sel.has(u.id));
  const colOn = (k: string) => !hidden.includes(k);
  const chips = [
    ...(q.trim() ? [{ label: `Search: ${q.trim()}`, onRemove: () => setQ("") }] : []),
    ...fRole.map((r) => ({ label: `Role: ${r}`, onRemove: () => setFRole(fRole.filter((x) => x !== r)) })),
    ...fDept.map((r) => ({ label: `Dept: ${r}`, onRemove: () => setFDept(fDept.filter((x) => x !== r)) })),
    ...fStatus.map((r) => ({ label: `Status: ${r}`, onRemove: () => setFStatus(fStatus.filter((x) => x !== r)) })),
  ];
  const reset = () => { setQ(""); setFRole([]); setFDept([]); setFStatus([]); setSort(null); setPage(1); show("Filters reset"); };
  const clearFilters = () => { setQ(""); setFRole([]); setFDept([]); setFStatus([]); setPage(1); };
  const newId = () => `U${nextId.current++}`;
  const curView: ViewState = { q, fRole, fDept, fStatus, sort, hidden };

  // ---- users ----
  const openAdd = () => { setTouched(false); setShowPw(false); setF(EMPTY_U); setUSlide({ id: null }); };
  const openEdit = (u: Staff) => { setTouched(false); setF({ name: u.name, email: u.email, mobile: u.mobile, role: u.role, dept: u.dept, pw: "", invite: false }); setUSlide({ id: u.id }); };
  useEffect(() => {
    if (params.get("new") === "1") { setTab("users"); openAdd(); const n = new URLSearchParams(params); n.delete("new"); setParams(n, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const editing = uSlide?.id ?? null;
  const emailTrim = f.email.trim().toLowerCase();
  const emailBad = emailTrim !== "" && !/^\S+@\S+\.\S+$/.test(emailTrim);
  const emailDup = emailTrim && !emailBad ? users.find((u) => u.id !== editing && u.email.toLowerCase() === emailTrim) : undefined;
  const digits = f.mobile.replace(/\D/g, "");
  const mobileBad = digits.length > 0 && digits.length < 10;
  const mobileDup = digits.length >= 10 ? users.find((u) => u.id !== editing && u.mobile.replace(/\D/g, "").slice(-10) === digits.slice(-10)) : undefined;
  const checks = pwChecks(f.pw);
  const score = f.pw ? checks.filter((c) => c.ok).length : 0;
  const errs = {
    name: !f.name.trim() ? "Full name is required" : "",
    email: !emailTrim ? "Work email is required" : emailBad ? "Enter a valid work email" : emailDup ? `Already used by ${emailDup.name}` : "",
    mobile: !digits ? "Mobile is required" : mobileBad ? "Enter a valid mobile number (min 10 digits)" : mobileDup ? `Already used by ${mobileDup.name}` : "",
    pw: editing ? "" : score < 4 ? "Password must meet all four rules below" : "",
  };
  const formOk = !Object.values(errs).some(Boolean);
  const saveUser = () => {
    setTouched(true);
    if (!formOk) return;
    if (editing) {
      setUsers((l) => l.map((u) => (u.id === editing ? { ...u, name: f.name.trim(), email: f.email.trim(), mobile: f.mobile.trim(), role: f.role, dept: f.dept } : u)));
      log("User updated", editing, `${f.name.trim()} - ${f.role} / ${f.dept}`);
      show(`${f.name.trim()} updated`);
    } else {
      const id = newId();
      const nu: Staff = { id, name: f.name.trim(), role: f.role, dept: f.dept, email: f.email.trim(), mobile: f.mobile.trim(), status: "Active", lastLogin: "" };
      setUsers((l) => [nu, ...l]);
      setSessions((s) => ({ ...s, [id]: [] }));
      log("User created", id, f.invite ? `Invite sent to ${nu.email}` : "Created without invite");
      clearFilters(); setSort(null);
      show(f.invite ? `User ${nu.name} created. Invite sent to ${nu.email}` : `User ${nu.name} created (no invite sent)`);
    }
    setUSlide(null);
    setF(EMPTY_U);
  };
  const setStatus = (ids: string[], status: "Active" | "Inactive") => {
    setUsers((l) => l.map((u) => (ids.includes(u.id) ? { ...u, status } : u)));
    if (status === "Inactive") setSessions((s) => ({ ...s, ...Object.fromEntries(ids.map((i) => [i, []])) }));
    ids.forEach((i) => log(status === "Active" ? "User activated" : "User deactivated", i, status === "Active" ? "Account re-enabled" : "All sessions ended"));
  };
  const removeUsers = (ids: string[]) => { setUsers((l) => l.filter((u) => !ids.includes(u.id))); setSel((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; }); if (drawer && ids.includes(drawer)) setDrawer(null); };
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = () => setSel((s) => { const n = new Set(s); if (allOnPage) rows.forEach((u) => n.delete(u.id)); else rows.forEach((u) => n.add(u.id)); return n; });
  const resetPw = (u: Staff) => confirm({ title: "Reset password", message: `Send a password reset link to ${u.email}? The current password stops working.`, confirmLabel: "Send reset link" }, () => { log("Password reset", u.id, "Reset link emailed"); show(`Password reset link sent to ${u.email}`); });
  const forceLogout = (u: Staff) => confirm({ title: "Force logout", message: `End all active sessions for ${u.name}?`, confirmLabel: "Force logout" }, () => { setSessions((s) => ({ ...s, [u.id]: [] })); log("Force logout", u.id, "All sessions revoked"); show(`${u.name} signed out of all sessions`); });
  const rowMenu = (u: Staff) => [
    { label: "View profile", icon: Eye, onClick: () => setDrawer(u.id) },
    { label: "Edit user", icon: Pencil, onClick: () => openEdit(u) },
    { label: u.status === "Active" ? "Deactivate" : "Activate", icon: u.status === "Active" ? UserX : UserCheck, onClick: () => { setStatus([u.id], u.status === "Active" ? "Inactive" : "Active"); show(`${u.name} ${u.status === "Active" ? "deactivated" : "activated"}`); } },
    { label: "Reset password", icon: KeyRound, onClick: () => resetPw(u) },
    { label: "Force logout", icon: LogOut, onClick: () => forceLogout(u) },
    { label: "Delete user", icon: Trash2, danger: true, onClick: () => confirm({ title: "Delete user", message: `Delete ${u.name} permanently? This cannot be undone.`, confirmLabel: "Delete", danger: true }, () => { removeUsers([u.id]); show(`${u.name} deleted`); }) },
  ];

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const data = parseCsv(await file.text());
    if (!data.length) { show("The CSV file is empty"); return; }
    const hdr = data[0]!.map((h) => h.toLowerCase());
    const hasHdr = hdr.includes("name") && hdr.includes("email");
    const idx = (n: string, d: number) => (hasHdr && hdr.indexOf(n) >= 0 ? hdr.indexOf(n) : d);
    const ci = { name: idx("name", 0), email: idx("email", 1), mobile: idx("mobile", 2), role: idx("role", 3), dept: idx("department", 4), status: idx("status", 5) };
    const emails = new Set(users.map((u) => u.email.toLowerCase()));
    const add: Staff[] = []; let skipped = 0;
    for (const r of data.slice(hasHdr ? 1 : 0)) {
      const email = (r[ci.email] ?? "").trim(), name = (r[ci.name] ?? "").trim();
      const role = r[ci.role] && roleNames.includes(r[ci.role]!) ? r[ci.role]! : "Reception";
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || emails.has(email.toLowerCase())) { skipped++; continue; }
      emails.add(email.toLowerCase());
      add.push({ id: newId(), name, email, mobile: r[ci.mobile] ?? "", role, dept: r[ci.dept] || DEPTS[1]!, status: /inactive/i.test(r[ci.status] ?? "") ? "Inactive" : "Active", lastLogin: "" });
    }
    if (add.length) { setUsers((l) => [...add, ...l]); setSessions((s) => ({ ...s, ...Object.fromEntries(add.map((u) => [u.id, []])) })); setPage(1); add.forEach((u) => log("User created", u.id, "Imported from CSV")); }
    show(`Imported ${add.length} user${add.length === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped (invalid or duplicate)` : ""}`);
    if (fileRef.current) fileRef.current.value = "";
  };
  const exportUsers = () => { downloadCsv("users.csv", [["Name", "Email", "Mobile", "Role", "Department", "Status"], ...users.map((u) => [u.name, u.email, u.mobile, u.role, u.dept, u.status])]); show(`Exported ${users.length} users`); };

  // ---- roles ----
  const openRole = (r?: RoleDef) => { setRErr({}); setRf({ name: r?.name ?? "", desc: r?.desc ?? "", copy: "" }); setRp(r ? clonePerm(perms[r.name] ?? blankPerm()) : blankPerm()); setRSlide({ old: r?.name ?? null }); };
  const saveRole = () => {
    const e: { name?: string; desc?: string } = {};
    const name = rf.name.trim();
    if (!name) e.name = "Role name is required";
    else if (roles.some((r) => r.name.toLowerCase() === name.toLowerCase() && r.name !== rSlide?.old)) e.name = "A role with this name already exists";
    if (!rf.desc.trim()) e.desc = "Description is required";
    setRErr(e);
    if (Object.keys(e).length) return;
    const old = rSlide!.old;
    if (old) {
      setRoles((l) => l.map((r) => (r.name === old ? { ...r, name, desc: rf.desc.trim() } : r)));
      const apply = (p: Perms): Perms => Object.fromEntries(Object.entries(p).map(([k, v]) => (k === old ? [name, old === "Super Admin" ? v : clonePerm(rp)] : [k, v])));
      setPerms(apply); setSaved(apply);
      if (old !== name) {
        setUsers((l) => l.map((u) => (u.role === old ? { ...u, role: name } : u)));
        if (fRole.includes(old)) setFRole(fRole.map((r) => (r === old ? name : r)));
      }
      log("Role updated", null, `${name}: ${countModules(rp)} modules`);
      show(`Role ${name} updated`);
    } else {
      setRoles((l) => [...l, { name, desc: rf.desc.trim(), tone: EXTRA_TONES[l.length % EXTRA_TONES.length]! }]);
      setPerms((p) => ({ ...p, [name]: clonePerm(rp) })); setSaved((p) => ({ ...p, [name]: clonePerm(rp) }));
      log("Role created", null, `${name}: ${countModules(rp)} modules`);
      show(`Role ${name} created`);
    }
    setRSlide(null);
  };
  const cloneRole = (r: RoleDef) => {
    let name = `${r.name} Copy`, n = 2;
    while (roleNames.includes(name)) name = `${r.name} Copy ${n++}`;
    setRoles((l) => [...l, { ...r, name }]);
    setPerms((p) => ({ ...p, [name]: clonePerm(p[r.name]!) })); setSaved((p) => ({ ...p, [name]: clonePerm(p[r.name]!) }));
    show(`Cloned ${r.name} as ${name}`);
  };
  const deleteRole = (r: RoleDef) => {
    if (r.name === "Super Admin") { show("Super Admin is a protected system role"); return; }
    const n = roleCount(r.name);
    if (n > 0) { show(`Cannot delete ${r.name}: ${n} user${n > 1 ? "s" : ""} still assigned. Reassign them first`); return; }
    confirm({ title: "Delete role", message: `Delete the ${r.name} role and its permissions?`, confirmLabel: "Delete", danger: true }, () => {
      setRoles((l) => l.filter((x) => x.name !== r.name));
      const drop = (p: Perms) => { const c = { ...p }; delete c[r.name]; return c; };
      setPerms(drop); setSaved(drop);
      setFRole((l) => l.filter((x) => x !== r.name));
      show(`Role ${r.name} deleted`);
    });
  };
  const copyFrom = (name: string) => { setRf((x) => ({ ...x, copy: name })); if (perms[name]) { setRp(clonePerm(perms[name]!)); show(`Copied ${countModules(perms[name])} module permissions from ${name}`); } };

  // ---- permissions matrix ----
  const setCell = (p: Perms, role: string, m: string, on: boolean): Perms => {
    const key = `${role}|${m}`;
    const curv = p[role]![m]!;
    if (on) { if (curv.length) return p; return { ...p, [role]: { ...p[role]!, [m]: [...(stash.current[key] ?? ["view" as Act])] } }; }
    if (!curv.length) return p;
    stash.current[key] = curv;
    return { ...p, [role]: { ...p[role]!, [m]: [] } };
  };
  const clickCell = (ri: number, mi: number, shift: boolean) => {
    const role = roleNames[ri]!, m = MODULES[mi]!;
    if (role === "Super Admin") return;
    const target = perms[role]![m]!.length === 0;
    setPerms((p) => {
      let n = p;
      if (shift && anchor) {
        const [r1, r2] = [Math.min(anchor.ri, ri), Math.max(anchor.ri, ri)], [m1, m2] = [Math.min(anchor.mi, mi), Math.max(anchor.mi, mi)];
        for (let a = r1; a <= r2; a++) for (let b = m1; b <= m2; b++) if (roleNames[a] !== "Super Admin") n = setCell(n, roleNames[a]!, MODULES[b]!, target);
      } else n = setCell(n, role, m, target);
      return n;
    });
    setAnchor({ ri, mi });
  };
  const colAll = (role: string) => MODULES.every((m) => perms[role]![m]!.length > 0);
  const toggleCol = (role: string) => { const all = colAll(role); setPerms((p) => MODULES.reduce((n, m) => setCell(n, role, m, !all), p)); };
  const savePerms = () => {
    if (!dirty) { show("No permission changes to save"); return; }
    confirm({ title: "Save permissions", message: "Permission changes need step-up authentication (SRS 2.2) and are recorded in the audit log. Confirm to continue?", confirmLabel: "Confirm & save" }, () => { setSaved(perms); log("Permissions changed", null, "Role permission matrix saved"); show("Role permissions saved"); });
  };
  const resetPerms = () => {
    if (!dirty) { show("Nothing to reset. Permissions match the saved version"); return; }
    confirm({ title: "Reset permissions", message: "Discard all unsaved permission changes?", confirmLabel: "Reset", danger: true }, () => { setPerms(saved); show("Unsaved permission changes discarded"); });
  };
  const cmpActive = cmp.on && perms[cmp.a] && perms[cmp.b];
  const diffCount = cmpActive ? MODULES.filter((m) => actLabel(perms[cmp.a]![m]!) !== actLabel(perms[cmp.b]![m]!)).length : 0;
  const roleOpts = roleNames.map((r) => ({ value: r, label: r, sub: `${roleCount(r)} users` }));

  const bulkIds = [...sel];
  const dUser = users.find((u) => u.id === drawer);
  const dSessions = dUser ? sessions[dUser.id] ?? [] : [];
  const dAudit = dUser ? [...audit.filter((a) => a.target === dUser.id), ...seedAudit(dUser)] : [];
  const revoke = (u: Staff, s: Session) => { setSessions((m) => ({ ...m, [u.id]: m[u.id]!.filter((x) => x.id !== s.id) })); log("Session revoked", u.id, `${s.device} (${s.ip})`); show(`Session on ${s.device} revoked`); };

  return (
    <div className="min-w-0">
      {toast}{dialog}
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="import-file" onChange={(e) => importFile(e.target.files?.[0])} />
      <PageHeader title="Users & Roles" subtitle="Manage system users, roles and permissions">
        {tab === "roles" ? <PrimaryButton icon={Plus} onClick={() => openRole()}>Create Role</PrimaryButton> : <PrimaryButton icon={UserPlus} onClick={openAdd}>Add User</PrimaryButton>}
      </PageHeader>

      <div className="mb-5 flex gap-8 border-b border-line">
        {([["users", "Users", Users], ["roles", "Roles", Shield], ["permissions", "Permissions", KeyRound]] as const).map(([k, l, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={cx("-mb-px flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-bold", tab === k ? "border-brand text-brand" : "border-transparent text-sub hover:text-ink")}><Icon className="size-4" />{l}</button>
        ))}
      </div>

      {tab === "users" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <KpiRow items={[
              { label: "Total Users", value: users.length, delta: 12, icon: Users, tone: "indigo" },
              { label: "Active Users", value: active, delta: 11, icon: UserCheck, tone: "green" },
              { label: "Inactive Users", value: users.length - active, delta: -25, icon: UserX, tone: "pink" },
              { label: "Total Roles", value: roles.length, deltaLabel: "System Roles", icon: UserCog, tone: "violet" },
            ]} />
            <Panel>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <SearchInput className="w-72" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by name, email, mobile..." />
                <MultiSelect className="w-40" label="All Roles" options={roleNames} value={fRole} onChange={(v) => { setFRole(v); setPage(1); }} />
                <MultiSelect className="w-48" label="All Departments" options={DEPTS} value={fDept} onChange={(v) => { setFDept(v); setPage(1); }} />
                <MultiSelect className="w-40" label="All Statuses" options={["Active", "Inactive"]} value={fStatus} onChange={(v) => { setFStatus(v); setPage(1); }} />
                <div className="ml-auto flex items-center gap-2">
                  <SavedViews<ViewState> storageKey="users" current={curView} onApply={(v) => { setQ(v.q); setFRole(v.fRole); setFDept(v.fDept); setFStatus(v.fStatus); setSort(v.sort); setHidden(v.hidden); setPage(1); show("View applied"); }} />
                  <ColumnsMenu columns={COLS} hidden={hidden} onChange={setHidden} />
                  <button onClick={reset} className="inline-flex items-center gap-1.5 text-sm font-bold text-brand"><RotateCcw className="size-4" />Reset</button>
                </div>
              </div>
              <FilterChips chips={chips} onClearAll={clearFilters} />
              {sel.size > 0 && (
                <div role="toolbar" aria-label="Bulk actions" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft px-4 py-2.5 text-[13px]">
                  <b className="mr-2 text-brand">{sel.size} selected</b>
                  <button onClick={() => { setStatus(bulkIds, "Active"); show(`${sel.size} users activated`); setSel(new Set()); }} className="h-8 rounded-lg border border-line bg-white px-3 font-bold hover:bg-slate-50">Activate</button>
                  <button onClick={() => { setStatus(bulkIds, "Inactive"); show(`${sel.size} users deactivated`); setSel(new Set()); }} className="h-8 rounded-lg border border-line bg-white px-3 font-bold hover:bg-slate-50">Deactivate</button>
                  <button onClick={() => { downloadCsv("selected-users.csv", [["Name", "Email", "Mobile", "Role", "Department", "Status"], ...users.filter((u) => sel.has(u.id)).map((u) => [u.name, u.email, u.mobile, u.role, u.dept, u.status])]); show(`Exported ${sel.size} users`); }} className="h-8 rounded-lg border border-line bg-white px-3 font-bold hover:bg-slate-50">Export</button>
                  <button onClick={() => confirm({ title: "Delete users", message: `Delete ${sel.size} selected user${sel.size > 1 ? "s" : ""}? This cannot be undone.`, confirmLabel: "Delete", danger: true }, () => { removeUsers(bulkIds); show(`${bulkIds.length} users deleted`); })} className="h-8 rounded-lg border border-rose-200 bg-white px-3 font-bold text-rose-600 hover:bg-rose-50">Delete</button>
                  <button onClick={() => setSel(new Set())} className="ml-auto font-bold text-sub hover:text-ink">Clear selection</button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className={tableCls}>
                  <thead><tr>
                    <Th><input type="checkbox" aria-label="Select all on page" className="size-4 accent-[#3f4fe0]" checked={allOnPage} onChange={togglePage} /></Th><Th>#</Th>
                    <SortTh k="user" sort={sort} onSort={setSort}>User</SortTh>
                    {colOn("contact") && <SortTh k="contact" sort={sort} onSort={setSort}>Email / Mobile</SortTh>}
                    {colOn("role") && <SortTh k="role" sort={sort} onSort={setSort}>Role</SortTh>}
                    {colOn("dept") && <SortTh k="dept" sort={sort} onSort={setSort}>Department</SortTh>}
                    {colOn("status") && <SortTh k="status" sort={sort} onSort={setSort}>Status</SortTh>}
                    {colOn("last") && <SortTh k="last" sort={sort} onSort={setSort}>Last Login</SortTh>}
                    <Th>Actions</Th>
                  </tr></thead>
                  <tbody>
                    {rows.map((u, i) => (
                      <tr key={u.id} onClick={() => setDrawer(u.id)} className={cx(trCls, "cursor-pointer", sel.has(u.id) && "bg-brand-soft/60")}>
                        <Td><span onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${u.name}`} className="size-4 accent-[#3f4fe0]" checked={sel.has(u.id)} onChange={() => toggleSel(u.id)} /></span></Td>
                        <Td>{(cur - 1) * pageSize + i + 1}</Td>
                        <Td><span className="flex items-center gap-2.5"><Avatar name={u.name} size={34} /><span><b>{u.name}</b><span className="block text-xs text-sub">{u.role}</span></span></span></Td>
                        {colOn("contact") && <Td><span className="text-xs leading-snug">{u.email}<br /><span className="text-sub">{u.mobile}</span></span></Td>}
                        {colOn("role") && <Td><Pill tone={roleTone(u.role)}>{u.role}</Pill></Td>}
                        {colOn("dept") && <Td>{u.dept}</Td>}
                        {colOn("status") && <Td><Pill tone={u.status === "Active" ? "green" : "red"}>{u.status}</Pill></Td>}
                        {colOn("last") && <Td>{u.lastLogin ? fmtDT(u.lastLogin) : "Never"}</Td>}
                        <Td><span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => { setStatus([u.id], u.status === "Active" ? "Inactive" : "Active"); show(`${u.name} ${u.status === "Active" ? "deactivated" : "activated"}`); }} className="h-8 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft">{u.status === "Active" ? "Deactivate" : "Activate"}</button>
                          <RowMenu items={rowMenu(u)} label={`Actions for ${u.name}`} />
                        </span></Td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-sub">No users match.</td></tr>}
                  </tbody>
                </table>
              </div>
              <Pagination page={cur} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="users" />
            </Panel>
          </div>

          <div className="min-w-0 space-y-4">
            <Panel title="Users by Role" action={<LinkAction onClick={() => setTab("roles")}>View Roles →</LinkAction>} bodyClassName="pt-3">
              <ul className="space-y-3 text-[13px]">{roles.map((r) => <li key={r.name}><button onClick={() => { setFRole([r.name]); setPage(1); }} className="flex w-full items-center gap-2.5 text-left hover:text-brand"><span className={cx("size-2.5 rounded-full", TONE[r.tone].dot)} /><span className="flex-1">{r.name}</span><b>{roleCount(r.name)}</b></button></li>)}</ul>
            </Panel>
            <Panel title="Quick Actions" bodyClassName="space-y-2 pt-3">
              {[
                { i: UserPlus, t: "Add New User", d: "Create a new system user account", fn: openAdd },
                { i: Shield, t: "Manage Roles", d: "View and edit system roles", fn: () => setTab("roles") },
                { i: KeyRound, t: "Set Permissions", d: "Configure role permissions", fn: () => setTab("permissions") },
                { i: Upload, t: "Import Users", d: "Bulk import users from CSV", fn: () => fileRef.current?.click() },
                { i: Download, t: "Export Users", d: "Download user list", fn: exportUsers },
              ].map((a) => (
                <button key={a.t} onClick={a.fn} className="flex w-full items-center gap-3 rounded-xl border border-line p-2.5 text-left hover:bg-brand-soft">
                  <span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand"><a.i className="size-4" /></span>
                  <span className="flex-1 text-[13px]"><b>{a.t}</b><span className="block text-xs text-sub">{a.d}</span></span>
                  <ChevronRight className="size-4 text-sub" />
                </button>
              ))}
            </Panel>
            <Panel title="Permission Groups" subtitle="" action={<LinkAction onClick={() => setTab("permissions")}>View All →</LinkAction>} bodyClassName="space-y-3 pt-3">
              {GROUPS.map((g) => <button key={g.t} onClick={() => setTab("permissions")} className="flex w-full items-center gap-3 text-left"><g.icon className="size-5 text-brand" /><div className="text-[13px]"><b>{g.t}</b><div className="text-xs text-sub">{g.d}</div></div></button>)}
            </Panel>
          </div>
        </div>
      )}

      {tab === "roles" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => {
            const members = users.filter((u) => u.role === r.name);
            const mods = countModules(perms[r.name]);
            return (
              <Panel key={r.name}>
                <div className="flex items-start justify-between"><Pill tone={r.tone}>{r.name}</Pill><span className="text-xs text-sub">{members.length} users</span></div>
                <p className="mt-3 text-sm text-sub">{r.desc}</p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex -space-x-2">{members.slice(0, 5).map((u) => <span key={u.id} title={u.name} className="rounded-full ring-2 ring-white"><Avatar name={u.name} size={28} /></span>)}{members.length > 5 && <span className="grid size-7 place-items-center rounded-full bg-slate-100 text-[11px] font-bold ring-2 ring-white">+{members.length - 5}</span>}</div>
                  {members.length === 0 && <span className="text-xs text-sub">No members yet</span>}
                  <button onClick={() => { setFRole([r.name]); setPage(1); setTab("users"); }} className="ml-auto text-xs font-bold text-brand hover:underline">View members</button>
                </div>
                <div className="mt-3"><div className="mb-1 flex justify-between text-[11px] font-semibold text-sub"><span>Module access</span><span>{mods} / {MODULES.length}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand" style={{ width: `${(mods / MODULES.length) * 100}%` }} /></div></div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button onClick={() => openRole(r)} className="mr-auto inline-flex items-center gap-1 text-xs font-bold text-brand">Edit permissions <ArrowRight className="size-3.5" /></button>
                  <button onClick={() => openRole(r)} aria-label={`Edit ${r.name}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-brand-soft"><Pencil className="size-3.5" />Edit</button>
                  <button onClick={() => cloneRole(r)} aria-label={`Clone ${r.name}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-brand-soft"><Copy className="size-3.5" />Clone</button>
                  <button onClick={() => deleteRole(r)} aria-label={`Delete ${r.name}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-2.5 text-xs font-bold text-rose-600 hover:bg-rose-50"><Trash2 className="size-3.5" />Delete</button>
                </div>
              </Panel>
            );
          })}
          <button onClick={() => openRole()} className="grid min-h-40 place-items-center rounded-2xl border-2 border-dashed border-line text-sm font-bold text-brand hover:bg-brand-soft"><span className="inline-flex items-center gap-2"><Plus className="size-4" />Create Role</span></button>
        </div>
      )}

      {tab === "permissions" && (
        <Panel title="Role Permission Matrix" subtitle="SRS Section 21 - tick to grant access; shift-click to apply to a range"
          action={<div className="flex items-center gap-2">
            <button onClick={() => setCmp({ ...cmp, on: !cmp.on })} aria-pressed={cmp.on} className={cx("inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-bold", cmp.on ? "border-brand bg-brand-soft text-brand" : "border-line bg-white hover:bg-brand-soft")}><GitCompare className="size-4" />Compare roles</button>
            <button onClick={resetPerms} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold hover:bg-brand-soft"><RotateCcw className="size-4" />Reset</button>
            <PrimaryButton icon={Shield} onClick={savePerms}>Save Permissions</PrimaryButton>
          </div>}>
          {cmp.on && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-[13px]">
              <span className="font-bold">Compare</span>
              <Combobox className="w-48" options={roleOpts} value={cmp.a} onChange={(v) => setCmp({ ...cmp, a: v })} placeholder="Role A" />
              <span className="text-sub">with</span>
              <Combobox className="w-48" options={roleOpts} value={cmp.b} onChange={(v) => setCmp({ ...cmp, b: v })} placeholder="Role B" />
              <span className="font-semibold text-amber-700" data-testid="diff-count">{diffCount} module{diffCount === 1 ? "" : "s"} differ</span>
            </div>
          )}
          <div className="overflow-x-auto">
            {cmpActive ? (
              <table className={tableCls} aria-label="Role comparison">
                <thead><tr><Th>Module / Action</Th><Th>{cmp.a}</Th><Th>{cmp.b}</Th><Th>Difference</Th></tr></thead>
                <tbody>
                  {MODULES.map((m) => {
                    const A = perms[cmp.a]![m]!, B = perms[cmp.b]![m]!;
                    const diff = actLabel(A) !== actLabel(B);
                    const plus = ACTS.filter((a) => B.includes(a) && !A.includes(a)), minus = ACTS.filter((a) => A.includes(a) && !B.includes(a));
                    return (
                      <tr key={m} data-diff={diff} className={cx(trCls, diff && "bg-amber-50")}>
                        <Td className="font-semibold">{m}</Td><Td>{actLabel(A)}</Td><Td>{actLabel(B)}</Td>
                        <Td>{diff ? <span className="text-xs font-semibold">{plus.length > 0 && <span className="mr-2 text-emerald-700">{cmp.b} +{plus.join(", +")}</span>}{minus.length > 0 && <span className="text-rose-600">{cmp.b} -{minus.join(", -")}</span>}</span> : <span className="text-xs text-slate-400">Same</span>}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className={tableCls}>
                <thead><tr><Th>Module / Action</Th>{roleNames.map((r) => (
                  <Th key={r} className="text-center"><label className="inline-flex flex-col items-center gap-1 normal-case">
                    {r}
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sub"><input type="checkbox" aria-label={`Select all for ${r}`} className="size-3.5 accent-[#3f4fe0]" checked={colAll(r)} disabled={r === "Super Admin"} onChange={() => toggleCol(r)} />All</span>
                  </label></Th>
                ))}</tr></thead>
                <tbody>
                  {MODULES.map((m, mi) => (
                    <tr key={m} className={trCls}>
                      <Td className="font-semibold">{m}</Td>
                      {roleNames.map((r, ri) => {
                        const val = perms[r]![m]!;
                        return (
                          <Td key={r} className="text-center">
                            <label className={cx("inline-flex items-center gap-1.5", r === "Super Admin" && "opacity-60")}>
                              <input type="checkbox" aria-label={`${r}: ${m}`} className="size-4 accent-[#3f4fe0]" checked={val.length > 0} disabled={r === "Super Admin"} onChange={() => {}} onClick={(e) => clickCell(ri, mi, e.shiftKey)} />
                              <span className={cx("text-xs", val.length === 0 ? "text-slate-400" : "font-semibold")}>{actLabel(val)}</span>
                            </label>
                          </Td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {dirty && <p className="mt-3 text-xs font-semibold text-amber-600">Unsaved changes. Permission changes require step-up authentication and are recorded in the audit log.</p>}
        </Panel>
      )}

      {/* ---- Add / Edit user ---- */}
      <SlideOver width={500} open={!!uSlide} onClose={() => setUSlide(null)} title={editing ? "Edit User" : "Add User"} footer={<>
        <button onClick={() => setUSlide(null)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={editing ? Check : UserPlus} onClick={saveUser}>{editing ? "Save Changes" : "Create User"}</PrimaryButton>
      </>}>
        <div className="mb-5 flex items-center gap-4 rounded-xl bg-slate-50 p-4">
          <span data-testid="avatar-preview"><Avatar name={f.name.trim() || "?"} size={56} /></span>
          <div className="min-w-0"><div className="truncate text-base font-extrabold">{f.name.trim() || "New user"}</div><div className="truncate text-xs text-sub">{f.email.trim() || "email@albumpro.com"}</div><div className="mt-1"><Pill tone={roleTone(f.role)}>{f.role}</Pill></div></div>
        </div>
        <Field label="Full Name" required><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />{touched && errs.name && <span className={ERR}>{errs.name}</span>}</Field>
        <Field label="Work Email" required>
          <input type="email" className={cx(inputCls, errs.email && f.email && "border-rose-400")} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          {f.email && errs.email ? <span data-testid="email-status" className={ERR}>{errs.email}</span> : f.email ? <span data-testid="email-status" className={OK}><Check className="size-3.5" />Email is available</span> : touched && errs.email ? <span className={ERR}>{errs.email}</span> : null}
        </Field>
        <Field label="Mobile" required>
          <input className={cx(inputCls, errs.mobile && f.mobile && "border-rose-400")} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} placeholder="+91 " />
          {f.mobile && errs.mobile ? <span data-testid="mobile-status" className={ERR}>{errs.mobile}</span> : f.mobile ? <span data-testid="mobile-status" className={OK}><Check className="size-3.5" />Mobile is available</span> : touched && errs.mobile ? <span className={ERR}>{errs.mobile}</span> : null}
        </Field>
        <div className="mb-4">
          <span className="mb-1.5 block text-[13px] font-semibold">Role <span className="text-rose-500">*</span></span>
          <Combobox options={roleOpts} value={f.role} onChange={(v) => setF({ ...f, role: v, dept: ROLE_DEPT[v] ?? f.dept })} placeholder="Select role" />
          <div className="mt-2 rounded-lg border border-line p-2.5" data-testid="role-preview">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-sub">{f.role} can access {countModules(perms[f.role])} modules</div>
            <div className="flex flex-wrap gap-1.5">
              {MODULES.filter((m) => perms[f.role]?.[m]?.length).map((m) => <span key={m} className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">{m} · {actLabel(perms[f.role]![m]!)}</span>)}
              {countModules(perms[f.role]) === 0 && <span className="text-xs text-sub">No module access yet</span>}
            </div>
          </div>
        </div>
        <div className="mb-4">
          <span className="mb-1.5 block text-[13px] font-semibold">Department <span className="text-rose-500">*</span> <span className="font-normal text-sub">(follows role, override if needed)</span></span>
          <Combobox options={DEPTS.map((d) => ({ value: d, label: d }))} value={f.dept} onChange={(v) => setF({ ...f, dept: v })} />
        </div>
        {!editing && (<>
          <Field label="Temporary Password" required hint="User must change it on first login; MFA applies per security policy (SRS §2).">
            <div className="flex gap-2">
              <span className="relative block flex-1">
                <input type={showPw ? "text" : "password"} className={cx(inputCls, "pr-10")} value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} aria-label="Temporary password" />
                <button type="button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Hide password" : "Show password"} className="absolute right-3 top-3 text-sub">{showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </span>
              <button type="button" onClick={() => { setF({ ...f, pw: genPassword() }); setShowPw(true); }} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold text-brand hover:bg-brand-soft"><Wand2 className="size-4" />Generate</button>
            </div>
            <div className="mt-2 flex gap-1" aria-label="Password strength meter">{[1, 2, 3, 4].map((n) => <span key={n} className={cx("h-1.5 flex-1 rounded-full", n <= score ? STRENGTH_BAR[score] : "bg-slate-200")} />)}</div>
            <div className="mt-1 flex items-center justify-between text-xs"><span data-testid="pw-strength" className="font-bold">{STRENGTH[score]}</span></div>
            <ul className="mt-1 grid grid-cols-2 gap-x-3 text-xs">{checks.map((c) => <li key={c.k} className={cx("flex items-center gap-1", c.ok ? "text-emerald-600" : "text-sub")}>{c.ok ? <Check className="size-3" /> : <X className="size-3" />}{c.label}</li>)}</ul>
            {touched && errs.pw && <span className={ERR}>{errs.pw}</span>}
          </Field>
          <div className="mb-4 flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm font-semibold"><span className="flex items-center gap-2"><Mail className="size-4 text-sub" />Send invite email</span><Toggle on={f.invite} onChange={(v) => setF({ ...f, invite: v })} /></div>
        </>)}
        {touched && !formOk && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">Please fix the highlighted fields.</div>}
      </SlideOver>

      {/* ---- User drawer ---- */}
      <SlideOver width={560} open={!!dUser} onClose={() => setDrawer(null)} title={dUser?.name ?? "User"} footer={dUser && <>
        <button onClick={() => resetPw(dUser)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold hover:bg-brand-soft">Reset password</button>
        <button onClick={() => { setDrawer(null); openEdit(dUser); }} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Edit user</button>
      </>}>
        {dUser && (<div className="space-y-6" data-testid="user-drawer">
          <section>
            <div className="flex items-center gap-4"><Avatar name={dUser.name} size={60} />
              <div className="min-w-0 flex-1"><div className="text-lg font-extrabold">{dUser.name}</div><div className="mt-1 flex flex-wrap gap-1.5"><Pill tone={roleTone(dUser.role)}>{dUser.role}</Pill><Pill tone={dUser.status === "Active" ? "green" : "red"} dot>{dUser.status}</Pill></div></div>
              <button onClick={() => { setStatus([dUser.id], dUser.status === "Active" ? "Inactive" : "Active"); show(`${dUser.name} ${dUser.status === "Active" ? "deactivated" : "activated"}`); }} className="h-9 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft">{dUser.status === "Active" ? "Deactivate" : "Activate"}</button>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
              {[["Email", dUser.email], ["Mobile", dUser.mobile], ["Department", dUser.dept], ["Employee ID", `EMP-${dUser.id.replace("U", "").padStart(4, "0")}`], ["Last login", dUser.lastLogin ? fmtDT(dUser.lastLogin) : "Never"], ["MFA", "Enabled (OTP)"]].map(([k, v]) => <div key={k} className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-[11px] font-bold uppercase tracking-wide text-sub">{k}</dt><dd className="truncate font-semibold">{v}</dd></div>)}
            </dl>
          </section>
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold"><Shield className="size-4 text-brand" />Assigned permissions <span className="font-normal text-sub">({countModules(perms[dUser.role])} of {MODULES.length} modules via {dUser.role})</span></h3>
            <div className="flex flex-wrap gap-1.5">{MODULES.filter((m) => perms[dUser.role]?.[m]?.length).map((m) => <span key={m} className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand">{m} · {actLabel(perms[dUser.role]![m]!)}</span>)}</div>
          </section>
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold"><History className="size-4 text-brand" />Last login history</h3>
            {genHistory(dUser).length === 0 ? <p className="text-xs text-sub">This user has not signed in yet.</p> : (
              <table className="w-full text-xs"><tbody>{genHistory(dUser).map((h, i) => <tr key={i} className="border-t border-line"><td className="py-1.5 font-semibold">{fmtDT(h.at)}</td><td>{h.device}</td><td className="text-sub">{h.ip}</td><td className="text-right"><Pill tone={h.ok ? "green" : "red"}>{h.ok ? "Success" : "Failed"}</Pill></td></tr>)}</tbody></table>
            )}
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-extrabold"><MonitorSmartphone className="size-4 text-brand" />Active sessions <span className="font-normal text-sub" data-testid="session-count">({dSessions.length})</span></h3>
              {dSessions.filter((s) => !s.current).length > 1 && <button onClick={() => { setSessions((m) => ({ ...m, [dUser.id]: m[dUser.id]!.filter((s) => s.current) })); log("Force logout", dUser.id, "All other sessions revoked"); show("All other sessions revoked"); }} className="text-xs font-bold text-rose-600">Revoke all others</button>}</div>
            {dSessions.length === 0 && <p className="text-xs text-sub">No active sessions.</p>}
            <ul className="space-y-2">{dSessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-xs"><MonitorSmartphone className="size-4 text-sub" /><span className="flex-1"><b className="text-[13px]">{s.device}</b>{s.current && <Pill tone="green" className="ml-2">This device</Pill>}<span className="block text-sub">{s.place} · {s.ip} · since {fmtDT(s.since)}</span></span>
                {!s.current && <button onClick={() => revoke(dUser, s)} className="h-8 rounded-lg border border-rose-200 px-3 font-bold text-rose-600 hover:bg-rose-50">Revoke</button>}</li>
            ))}</ul>
          </section>
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold"><History className="size-4 text-brand" />Audit trail <span className="font-normal text-sub">(SRS §20.2)</span></h3>
            <ol className="space-y-2 border-l-2 border-line pl-4 text-xs" data-testid="audit-trail">{dAudit.map((a) => <li key={a.id} className="relative"><span className="absolute -left-[22px] top-1 size-2.5 rounded-full bg-brand" /><b className="text-[13px]">{a.action}</b> <span className="text-sub">by {a.actor}</span><div className="text-sub">{fmtDT(a.at)} · {a.detail}</div></li>)}</ol>
          </section>
        </div>)}
      </SlideOver>

      {/* ---- Role editor ---- */}
      <SlideOver width={680} open={!!rSlide} onClose={() => setRSlide(null)} title={rSlide?.old ? "Edit Role" : "Create Role"} footer={<>
        <button onClick={() => setRSlide(null)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={Shield} onClick={saveRole}>{rSlide?.old ? "Save Changes" : "Create Role"}</PrimaryButton>
      </>}>
        <Field label="Role Name" required><input className={inputCls} value={rf.name} onChange={(e) => setRf({ ...rf, name: e.target.value })} disabled={rSlide?.old === "Super Admin"} />{rErr.name && <span className={ERR}>{rErr.name}</span>}</Field>
        <Field label="Description" required><textarea className="h-20 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={rf.desc} onChange={(e) => setRf({ ...rf, desc: e.target.value })} />{rErr.desc && <span className={ERR}>{rErr.desc}</span>}</Field>
        {rSlide?.old !== "Super Admin" && (
          <div className="mb-4">
            <span className="mb-1.5 block text-[13px] font-semibold">Copy permissions from</span>
            <Combobox options={roleOpts.filter((o) => o.value !== rSlide?.old)} value={rf.copy} onChange={copyFrom} placeholder="Pick a role to copy its matrix…" />
          </div>
        )}
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-extrabold">Permission matrix</h3><span className="text-xs text-sub">{countModules(rp)} of {MODULES.length} modules granted</span></div>
        {rSlide?.old === "Super Admin" && <p className="mb-2 text-xs text-sub">Super Admin permissions are fixed by the system.</p>}
        <PermGrid value={rp} onChange={setRp} locked={rSlide?.old === "Super Admin"} />
      </SlideOver>
    </div>
  );
}

import { useMemo, useRef, useState } from "react";
import { ArrowRight, Download, KeyRound, Shield, Upload, UserCog, UserPlus, Users, UserCheck, UserX, RotateCcw, ChevronRight, Copy, Pencil, Trash2, LogOut, Plus, Check, CalendarCheck, LineChart, Settings } from "lucide-react";
import { TONE, Avatar, Field, FilterSelect, KpiRow, LinkAction, Pagination, Panel, PageHeader, Pill, PrimaryButton, SearchInput, SlideOver, Td, Th, inputCls, tableCls, trCls, cx } from "../components/ui";
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

const GROUPS = [
  { icon: CalendarCheck, t: "Orders & Production", d: "Orders, pipeline, designing, printing" },
  { icon: Users, t: "Customer Management", d: "Customers, enquiries, data access" },
  { icon: LineChart, t: "Reports & Analytics", d: "Reports, financial data, insights" },
  { icon: Settings, t: "System Settings", d: "Masters, configuration, preferences" },
];

interface RoleDef { name: string; desc: string; tone: Tone }
interface UForm { name: string; email: string; mobile: string; role: string; dept: string; pw: string }
const EMPTY_U: UForm = { name: "", email: "", mobile: "", role: "Reception", dept: "Reception", pw: "" };
const ERR = "mt-1 block text-xs font-semibold text-rose-600";

// level a role gets back when a "No" cell is re-ticked
const INITIAL: Record<string, string[]> = Object.fromEntries(ROLE_COLS.map((c, ci) => [COL_ROLE[c]!, MATRIX.map(([, v]) => v[ci]!)]));
const initialPerms = (): Record<string, string[]> => Object.fromEntries(Object.entries(INITIAL).map(([k, v]) => [k, [...v]]));

export default function UsersRoles() {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<Staff[]>(STAFF);
  const [roles, setRoles] = useState<RoleDef[]>(BASE_ROLES.map((name) => ({ name, desc: ROLE_DESC[name]!, tone: ROLE_TONE[name]! })));
  const [q, setQ] = useState("");
  const [fRole, setFRole] = useState("All Roles");
  const [fDept, setFDept] = useState("All Departments");
  const [fStatus, setFStatus] = useState("All Statuses");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [toast, show] = useToast();
  const [dialog, confirm] = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(100);

  // user form (add / edit)
  const [uSlide, setUSlide] = useState<null | { id: string | null }>(null);
  const [f, setF] = useState<UForm>(EMPTY_U);
  const [errs, setErrs] = useState<Partial<Record<keyof UForm, string>>>({});
  // role form (create / edit)
  const [rSlide, setRSlide] = useState<null | { old: string | null }>(null);
  const [rf, setRf] = useState({ name: "", desc: "" });
  const [rErr, setRErr] = useState<{ name?: string; desc?: string }>({});
  // permissions
  const [perms, setPerms] = useState(initialPerms);
  const [saved, setSaved] = useState(initialPerms);
  const dirty = JSON.stringify(perms) !== JSON.stringify(saved);

  const roleNames = roles.map((r) => r.name);
  const roleTone = (n: string): Tone => roles.find((r) => r.name === n)?.tone ?? "slate";
  const levelBack = (role: string, mi: number) => { const o = INITIAL[role]?.[mi]; return o && o !== "No" ? o : "View"; };

  const filtered = useMemo(() => users.filter((u) => {
    if (fRole !== "All Roles" && u.role !== fRole) return false;
    if (fDept !== "All Departments" && u.dept !== fDept) return false;
    if (fStatus !== "All Statuses" && u.status !== fStatus) return false;
    const t = q.trim().toLowerCase();
    return !t || u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t) || u.mobile.includes(t);
  }), [users, q, fRole, fDept, fStatus]);
  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, maxPage);
  const rows = filtered.slice((cur - 1) * pageSize, cur * pageSize);
  const roleCount = (r: string) => users.filter((u) => u.role === r).length;
  const active = users.filter((u) => u.status === "Active").length;
  const allOnPage = rows.length > 0 && rows.every((u) => sel.has(u.id));

  const reset = () => { setQ(""); setFRole("All Roles"); setFDept("All Departments"); setFStatus("All Statuses"); setPage(1); show("Filters reset"); };
  const newId = () => `U${nextId.current++}`;

  // ---- users ----
  const openAdd = () => { setErrs({}); setF(EMPTY_U); setUSlide({ id: null }); };
  const openEdit = (u: Staff) => { setErrs({}); setF({ name: u.name, email: u.email, mobile: u.mobile, role: u.role, dept: u.dept, pw: "" }); setUSlide({ id: u.id }); };
  const saveUser = () => {
    const e: Partial<Record<keyof UForm, string>> = {};
    const editing = uSlide?.id ?? null;
    if (!f.name.trim()) e.name = "Full name is required";
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = "Enter a valid work email";
    else if (users.some((u) => u.id !== editing && u.email.toLowerCase() === f.email.trim().toLowerCase())) e.email = "A user with this email already exists";
    if (!f.mobile.trim()) e.mobile = "Mobile is required";
    else if (f.mobile.replace(/\D/g, "").length < 10) e.mobile = "Enter a valid mobile number (min 10 digits)";
    if (!editing && f.pw.length < 8) e.pw = "Temporary password must be at least 8 characters";
    setErrs(e);
    if (Object.keys(e).length) return;
    if (editing) {
      setUsers((l) => l.map((u) => (u.id === editing ? { ...u, name: f.name.trim(), email: f.email.trim(), mobile: f.mobile.trim(), role: f.role, dept: f.dept } : u)));
      show(`${f.name.trim()} updated`);
    } else {
      setUsers((l) => [{ id: newId(), name: f.name.trim(), role: f.role, dept: f.dept, email: f.email.trim(), mobile: f.mobile.trim(), status: "Active", lastLogin: "" }, ...l]);
      setQ(""); setFRole("All Roles"); setFDept("All Departments"); setFStatus("All Statuses"); setPage(1);
      show(`User ${f.name.trim()} created. Invite sent to ${f.email.trim()}`);
    }
    setUSlide(null);
    setF(EMPTY_U);
  };
  const setStatus = (ids: string[], status: "Active" | "Inactive") => setUsers((l) => l.map((u) => (ids.includes(u.id) ? { ...u, status } : u)));
  const removeUsers = (ids: string[]) => { setUsers((l) => l.filter((u) => !ids.includes(u.id))); setSel((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; }); };
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = () => setSel((s) => { const n = new Set(s); if (allOnPage) rows.forEach((u) => n.delete(u.id)); else rows.forEach((u) => n.add(u.id)); return n; });
  const rowMenu = (u: Staff) => [
    { label: "Edit user", icon: Pencil, onClick: () => openEdit(u) },
    { label: u.status === "Active" ? "Deactivate" : "Activate", icon: u.status === "Active" ? UserX : UserCheck, onClick: () => { setStatus([u.id], u.status === "Active" ? "Inactive" : "Active"); show(`${u.name} ${u.status === "Active" ? "deactivated" : "activated"}`); } },
    { label: "Reset password", icon: KeyRound, onClick: () => confirm({ title: "Reset password", message: `Send a password reset link to ${u.email}? The current password stops working.`, confirmLabel: "Send reset link" }, () => show(`Password reset link sent to ${u.email}`)) },
    { label: "Force logout", icon: LogOut, onClick: () => confirm({ title: "Force logout", message: `End all active sessions for ${u.name}?`, confirmLabel: "Force logout" }, () => show(`${u.name} signed out of all sessions`)) },
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
    if (add.length) { setUsers((l) => [...add, ...l]); setPage(1); }
    show(`Imported ${add.length} user${add.length === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped (invalid or duplicate)` : ""}`);
    if (fileRef.current) fileRef.current.value = "";
  };
  const exportUsers = () => { downloadCsv("users.csv", [["Name", "Email", "Mobile", "Role", "Department", "Status"], ...users.map((u) => [u.name, u.email, u.mobile, u.role, u.dept, u.status])]); show(`Exported ${users.length} users`); };

  // ---- roles ----
  const openRole = (r?: RoleDef) => { setRErr({}); setRf({ name: r?.name ?? "", desc: r?.desc ?? "" }); setRSlide({ old: r?.name ?? null }); };
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
      if (old !== name) {
        setUsers((l) => l.map((u) => (u.role === old ? { ...u, role: name } : u)));
        const rn = (p: Record<string, string[]>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k === old ? name : k, v]));
        setPerms(rn); setSaved(rn);
        if (INITIAL[old]) { INITIAL[name] = INITIAL[old]!; delete INITIAL[old]; }
        if (fRole === old) setFRole(name);
      }
      show(`Role ${name} updated`);
    } else {
      setRoles((l) => [...l, { name, desc: rf.desc.trim(), tone: EXTRA_TONES[l.length % EXTRA_TONES.length]! }]);
      const blank = MATRIX.map(() => "No");
      setPerms((p) => ({ ...p, [name]: blank })); setSaved((p) => ({ ...p, [name]: blank }));
      show(`Role ${name} created`);
    }
    setRSlide(null);
  };
  const cloneRole = (r: RoleDef) => {
    let name = `${r.name} Copy`, n = 2;
    while (roleNames.includes(name)) name = `${r.name} Copy ${n++}`;
    setRoles((l) => [...l, { ...r, name }]);
    setPerms((p) => ({ ...p, [name]: [...p[r.name]!] })); setSaved((p) => ({ ...p, [name]: [...p[r.name]!] }));
    INITIAL[name] = INITIAL[r.name] ?? MATRIX.map(() => "View");
    show(`Cloned ${r.name} as ${name}`);
  };
  const deleteRole = (r: RoleDef) => {
    if (r.name === "Super Admin") { show("Super Admin is a protected system role"); return; }
    const n = roleCount(r.name);
    if (n > 0) { show(`Cannot delete ${r.name}: ${n} user${n > 1 ? "s" : ""} still assigned. Reassign them first`); return; }
    confirm({ title: "Delete role", message: `Delete the ${r.name} role and its permissions?`, confirmLabel: "Delete", danger: true }, () => {
      setRoles((l) => l.filter((x) => x.name !== r.name));
      const drop = (p: Record<string, string[]>) => { const c = { ...p }; delete c[r.name]; return c; };
      setPerms(drop); setSaved(drop);
      if (fRole === r.name) setFRole("All Roles");
      show(`Role ${r.name} deleted`);
    });
  };

  // ---- permissions ----
  const toggleCell = (role: string, mi: number) => setPerms((p) => ({ ...p, [role]: p[role]!.map((v, i) => (i === mi ? (v === "No" ? levelBack(role, mi) : "No") : v)) }));
  const colAll = (role: string) => perms[role]!.every((v) => v !== "No");
  const toggleCol = (role: string) => {
    const all = colAll(role);
    setPerms((p) => ({ ...p, [role]: p[role]!.map((v, i) => (all ? "No" : v === "No" ? levelBack(role, i) : v)) }));
  };
  const savePerms = () => {
    if (!dirty) { show("No permission changes to save"); return; }
    confirm({ title: "Save permissions", message: "Permission changes need step-up authentication (SRS 2.2) and are recorded in the audit log. Confirm to continue?", confirmLabel: "Confirm & save" }, () => { setSaved(perms); show("Role permissions saved"); });
  };
  const resetPerms = () => {
    if (!dirty) { show("Nothing to reset. Permissions match the saved version"); return; }
    confirm({ title: "Reset permissions", message: "Discard all unsaved permission changes?", confirmLabel: "Reset", danger: true }, () => { setPerms(saved); show("Unsaved permission changes discarded"); });
  };

  const filterOpts = ["All Roles", ...roleNames];
  const bulkIds = [...sel];

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
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <SearchInput className="w-72" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by name, email, mobile..." />
                <FilterSelect className="w-40" value={fRole} onChange={(v) => { setFRole(v); setPage(1); }} options={filterOpts} />
                <FilterSelect className="w-48" value={fDept} onChange={(v) => { setFDept(v); setPage(1); }} options={["All Departments", ...DEPTS]} />
                <FilterSelect className="w-40" value={fStatus} onChange={(v) => { setFStatus(v); setPage(1); }} options={["All Statuses", "Active", "Inactive"]} />
                <button onClick={reset} className="ml-auto inline-flex items-center gap-1.5 text-sm font-bold text-brand"><RotateCcw className="size-4" />Reset</button>
              </div>
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
                  <thead><tr><Th><input type="checkbox" aria-label="Select all on page" className="size-4 accent-[#3f4fe0]" checked={allOnPage} onChange={togglePage} /></Th><Th>#</Th><Th>User</Th><Th>Email / Mobile</Th><Th>Role</Th><Th>Department</Th><Th>Status</Th><Th>Last Login</Th><Th>Actions</Th></tr></thead>
                  <tbody>
                    {rows.map((u, i) => (
                      <tr key={u.id} className={cx(trCls, sel.has(u.id) && "bg-brand-soft/60")}>
                        <Td><input type="checkbox" aria-label={`Select ${u.name}`} className="size-4 accent-[#3f4fe0]" checked={sel.has(u.id)} onChange={() => toggleSel(u.id)} /></Td>
                        <Td>{(cur - 1) * pageSize + i + 1}</Td>
                        <Td><span className="flex items-center gap-2.5"><Avatar name={u.name} size={34} /><span><b>{u.name}</b><span className="block text-xs text-sub">{u.role}</span></span></span></Td>
                        <Td><span className="text-xs leading-snug">{u.email}<br /><span className="text-sub">{u.mobile}</span></span></Td>
                        <Td><Pill tone={roleTone(u.role)}>{u.role}</Pill></Td>
                        <Td>{u.dept}</Td>
                        <Td><Pill tone={u.status === "Active" ? "green" : "red"}>{u.status}</Pill></Td>
                        <Td>{u.lastLogin ? `${fmtDate(u.lastLogin)}, ${new Date(u.lastLogin).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : "Never"}</Td>
                        <Td><span className="flex items-center gap-1">
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
              <ul className="space-y-3 text-[13px]">{roles.map((r) => <li key={r.name} className="flex items-center gap-2.5"><span className={cx("size-2.5 rounded-full", TONE[r.tone].dot)} /><span className="flex-1">{r.name}</span><b>{roleCount(r.name)}</b></li>)}</ul>
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
          {roles.map((r) => (
            <Panel key={r.name}>
              <div className="flex items-start justify-between"><Pill tone={r.tone}>{r.name}</Pill><span className="text-xs text-sub">{roleCount(r.name)} users</span></div>
              <p className="mt-3 text-sm text-sub">{r.desc}</p>
              <div className="mt-3 flex -space-x-2">{users.filter((u) => u.role === r.name).slice(0, 5).map((u) => <span key={u.id} className="rounded-full ring-2 ring-white"><Avatar name={u.name} size={28} /></span>)}</div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button onClick={() => setTab("permissions")} className="mr-auto inline-flex items-center gap-1 text-xs font-bold text-brand">Edit permissions <ArrowRight className="size-3.5" /></button>
                <button onClick={() => openRole(r)} aria-label={`Edit ${r.name}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-brand-soft"><Pencil className="size-3.5" />Edit</button>
                <button onClick={() => cloneRole(r)} aria-label={`Clone ${r.name}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-brand-soft"><Copy className="size-3.5" />Clone</button>
                <button onClick={() => deleteRole(r)} aria-label={`Delete ${r.name}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-2.5 text-xs font-bold text-rose-600 hover:bg-rose-50"><Trash2 className="size-3.5" />Delete</button>
              </div>
            </Panel>
          ))}
          <button onClick={() => openRole()} className="grid min-h-40 place-items-center rounded-2xl border-2 border-dashed border-line text-sm font-bold text-brand hover:bg-brand-soft"><span className="inline-flex items-center gap-2"><Plus className="size-4" />Create Role</span></button>
        </div>
      )}

      {tab === "permissions" && (
        <Panel title="Role Permission Matrix" subtitle="SRS Section 21 - tick to grant the access level shown; untick for No access"
          action={<div className="flex items-center gap-2">
            <button onClick={resetPerms} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold hover:bg-brand-soft"><RotateCcw className="size-4" />Reset</button>
            <PrimaryButton icon={Shield} onClick={savePerms}>Save Permissions</PrimaryButton>
          </div>}>
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><Th>Module / Action</Th>{roleNames.map((r) => (
                <Th key={r} className="text-center"><label className="inline-flex flex-col items-center gap-1 normal-case">
                  {r}
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sub"><input type="checkbox" aria-label={`Select all for ${r}`} className="size-3.5 accent-[#3f4fe0]" checked={colAll(r)} disabled={r === "Super Admin"} onChange={() => toggleCol(r)} />All</span>
                </label></Th>
              ))}</tr></thead>
              <tbody>
                {MATRIX.map(([m], mi) => (
                  <tr key={m} className={trCls}>
                    <Td className="font-semibold">{m}</Td>
                    {roleNames.map((r) => {
                      const val = perms[r]![mi]!;
                      return (
                        <Td key={r} className="text-center">
                          <label className={cx("inline-flex items-center gap-1.5", r === "Super Admin" && "opacity-60")}>
                            <input type="checkbox" aria-label={`${r}: ${m}`} className="size-4 accent-[#3f4fe0]" checked={val !== "No"} disabled={r === "Super Admin"} onChange={() => toggleCell(r, mi)} />
                            <span className={cx("text-xs", val === "No" ? "text-slate-400" : "font-semibold")}>{val}</span>
                          </label>
                        </Td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dirty && <p className="mt-3 text-xs font-semibold text-amber-600">Unsaved changes. Permission changes require step-up authentication and are recorded in the audit log.</p>}
        </Panel>
      )}

      <SlideOver open={!!uSlide} onClose={() => setUSlide(null)} title={uSlide?.id ? "Edit User" : "Add User"} footer={<>
        <button onClick={() => setUSlide(null)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={uSlide?.id ? Check : UserPlus} onClick={saveUser}>{uSlide?.id ? "Save Changes" : "Create User"}</PrimaryButton>
      </>}>
        <Field label="Full Name" required><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />{errs.name && <span className={ERR}>{errs.name}</span>}</Field>
        <Field label="Work Email" required><input type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />{errs.email && <span className={ERR}>{errs.email}</span>}</Field>
        <Field label="Mobile" required><input className={inputCls} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} placeholder="+91 " />{errs.mobile && <span className={ERR}>{errs.mobile}</span>}</Field>
        <Field label="Role" required><select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roleNames.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Department" required><select className={inputCls} value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })}>{DEPTS.map((r) => <option key={r}>{r}</option>)}</select></Field>
        {!uSlide?.id && <Field label="Temporary Password" required hint="Min 8 characters. User must change it on first login; MFA applies per security policy."><input type="password" className={inputCls} value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} />{errs.pw && <span className={ERR}>{errs.pw}</span>}</Field>}
        {Object.keys(errs).length > 0 && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">Please fix the highlighted fields.</div>}
      </SlideOver>

      <SlideOver open={!!rSlide} onClose={() => setRSlide(null)} title={rSlide?.old ? "Edit Role" : "Create Role"} footer={<>
        <button onClick={() => setRSlide(null)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={Shield} onClick={saveRole}>{rSlide?.old ? "Save Changes" : "Create Role"}</PrimaryButton>
      </>}>
        <Field label="Role Name" required><input className={inputCls} value={rf.name} onChange={(e) => setRf({ ...rf, name: e.target.value })} disabled={rSlide?.old === "Super Admin"} />{rErr.name && <span className={ERR}>{rErr.name}</span>}</Field>
        <Field label="Description" required><textarea className="h-24 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={rf.desc} onChange={(e) => setRf({ ...rf, desc: e.target.value })} />{rErr.desc && <span className={ERR}>{rErr.desc}</span>}</Field>
        {!rSlide?.old && <p className="text-xs text-sub">New roles start with no access. Grant permissions on the Permissions tab.</p>}
      </SlideOver>
    </div>
  );
}

import { useMemo, useState } from "react";
import { ArrowRight, Download, KeyRound, Shield, Upload, UserCog, UserPlus, Users, UserCheck, UserX, RotateCcw, ChevronRight, CalendarCheck, LineChart, Settings } from "lucide-react";
import { Avatar, Field, FilterSelect, KpiRow, LinkAction, Pagination, Panel, PageHeader, Pill, PrimaryButton, SearchInput, SlideOver, Td, Th, inputCls, tableCls, trCls, cx } from "../components/ui";
import { useToast } from "../components/Toast";
import { downloadCsv } from "../lib/csv";
import { STAFF, type Staff, type Tone } from "../lib/data";
import { fmtDate } from "../lib/format";

type Tab = "users" | "roles" | "permissions";
const ROLE_TONE: Record<string, Tone> = { "Super Admin": "indigo", Designer: "pink", Printer: "orange", "Colour Grading": "blue", "QC Executive": "amber", Reception: "green", Accounts: "violet" };
const ROLES = ["Super Admin", "Designer", "Printer", "Colour Grading", "QC Executive", "Reception", "Accounts"];
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

export default function UsersRoles() {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<Staff[]>(STAFF);
  const [q, setQ] = useState("");
  const [fRole, setFRole] = useState("All Roles");
  const [fDept, setFDept] = useState("All Departments");
  const [fStatus, setFStatus] = useState("All Statuses");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [open, setOpen] = useState(false);
  const [toast, show] = useToast();
  const [matrix, setMatrix] = useState(MATRIX.map(([m, v]) => ({ m, v, orig: v })));
  const [dirty, setDirty] = useState(false);
  const [f, setF] = useState({ name: "", email: "", mobile: "", role: ROLES[1]!, dept: DEPTS[1]!, pw: "" });
  const [err, setErr] = useState("");

  const filtered = useMemo(() => users.filter((u) => {
    if (fRole !== "All Roles" && u.role !== fRole) return false;
    if (fDept !== "All Departments" && u.dept !== fDept) return false;
    if (fStatus !== "All Statuses" && u.status !== fStatus.replace("Active", "Active")) return false;
    const t = q.trim().toLowerCase();
    return !t || u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t) || u.mobile.includes(t);
  }), [users, q, fRole, fDept, fStatus]);
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const roleCount = (r: string) => users.filter((u) => u.role === r).length;
  const active = users.filter((u) => u.status === "Active").length;

  const reset = () => { setQ(""); setFRole("All Roles"); setFDept("All Departments"); setFStatus("All Statuses"); setPage(1); };
  const addUser = () => {
    if (!f.name.trim()) return setErr("Full name is required");
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return setErr("Enter a valid work email");
    if (!f.mobile.trim()) return setErr("Mobile is required");
    if (f.pw.length < 8) return setErr("Temporary password must be at least 8 characters (password policy)");
    if (users.some((u) => u.email.toLowerCase() === f.email.toLowerCase())) return setErr("A user with this email already exists");
    setUsers((l) => [...l, { id: `U${l.length + 1}`, name: f.name, role: f.role, dept: f.dept, email: f.email, mobile: f.mobile, status: "Active", lastLogin: "" }]);
    setOpen(false);
    show(`User ${f.name} created. Invite sent to ${f.email}`);
  };
  const openAdd = () => { setErr(""); setF({ name: "", email: "", mobile: "", role: ROLES[1]!, dept: DEPTS[1]!, pw: "" }); setOpen(true); };
  const toggleStatus = (id: string) => setUsers((l) => l.map((u) => (u.id === id ? { ...u, status: u.status === "Active" ? "Inactive" : "Active" } : u)));

  const toggleCell = (mi: number, ci: number) => {
    setDirty(true);
    setMatrix((m) => m.map((row, i) => {
      if (i !== mi) return row;
      const v = [...row.v];
      v[ci] = v[ci] === "No" ? (row.orig[ci] !== "No" ? row.orig[ci]! : "View") : "No";
      return { ...row, v };
    }));
  };
  const savePerms = () => {
    if (!window.confirm("Permission changes need step-up authentication (SRS 2.2). Confirm to continue?")) return;
    setDirty(false);
    show("Role permissions saved");
  };

  return (
    <div className="min-w-0">
      {toast}
      <PageHeader title="Users & Roles" subtitle="Manage system users, roles and permissions">
        <PrimaryButton icon={UserPlus} onClick={openAdd}>Add User</PrimaryButton>
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
              { label: "Total Roles", value: ROLES.length, deltaLabel: "System Roles", icon: UserCog, tone: "violet" },
            ]} />
            <Panel>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <SearchInput className="w-72" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by name, email, mobile..." />
                <FilterSelect className="w-40" value={fRole} onChange={(v) => { setFRole(v); setPage(1); }} options={["All Roles", ...ROLES]} />
                <FilterSelect className="w-48" value={fDept} onChange={(v) => { setFDept(v); setPage(1); }} options={["All Departments", ...DEPTS]} />
                <FilterSelect className="w-40" value={fStatus} onChange={(v) => { setFStatus(v); setPage(1); }} options={["All Statuses", "Active", "Inactive"]} />
                <button onClick={reset} className="ml-auto inline-flex items-center gap-1.5 text-sm font-bold text-brand"><RotateCcw className="size-4" />Reset</button>
              </div>
              <div className="overflow-x-auto">
                <table className={tableCls}>
                  <thead><tr><Th>#</Th><Th>User</Th><Th>Email / Mobile</Th><Th>Role</Th><Th>Department</Th><Th>Status</Th><Th>Last Login</Th><Th>Actions</Th></tr></thead>
                  <tbody>
                    {rows.map((u, i) => (
                      <tr key={u.id} className={trCls}>
                        <Td>{(page - 1) * pageSize + i + 1}</Td>
                        <Td><span className="flex items-center gap-2.5"><Avatar name={u.name} size={34} /><span><b>{u.name}</b><span className="block text-xs text-sub">{u.role}</span></span></span></Td>
                        <Td><span className="text-xs leading-snug">{u.email}<br /><span className="text-sub">{u.mobile}</span></span></Td>
                        <Td><Pill tone={ROLE_TONE[u.role] ?? "slate"}>{u.role}</Pill></Td>
                        <Td>{u.dept}</Td>
                        <Td><Pill tone={u.status === "Active" ? "green" : "red"}>{u.status}</Pill></Td>
                        <Td>{u.lastLogin ? `${fmtDate(u.lastLogin)}, ${new Date(u.lastLogin).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : "Never"}</Td>
                        <Td><button onClick={() => { toggleStatus(u.id); show(`${u.name} ${u.status === "Active" ? "deactivated" : "activated"}`); }} className="h-8 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft">{u.status === "Active" ? "Deactivate" : "Activate"}</button></Td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-sub">No users match.</td></tr>}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="users" />
            </Panel>
          </div>

          <div className="min-w-0 space-y-4">
            <Panel title="Users by Role" action={<LinkAction onClick={() => setTab("roles")}>View Roles →</LinkAction>} bodyClassName="pt-3">
              <ul className="space-y-3 text-[13px]">{ROLES.map((r) => <li key={r} className="flex items-center gap-2.5"><span className={cx("size-2.5 rounded-full", ({ indigo: "bg-indigo-500", pink: "bg-pink-500", orange: "bg-orange-500", blue: "bg-sky-500", amber: "bg-amber-500", green: "bg-emerald-500", violet: "bg-violet-500" } as Record<string, string>)[ROLE_TONE[r]!])} /><span className="flex-1">{r}</span><b>{roleCount(r)}</b></li>)}</ul>
            </Panel>
            <Panel title="Quick Actions" bodyClassName="space-y-2 pt-3">
              {[
                { i: UserPlus, t: "Add New User", d: "Create a new system user account", fn: openAdd },
                { i: Shield, t: "Manage Roles", d: "View and edit system roles", fn: () => setTab("roles") },
                { i: KeyRound, t: "Set Permissions", d: "Configure role permissions", fn: () => setTab("permissions") },
                { i: Upload, t: "Import Users", d: "Bulk import users from CSV", fn: () => show("CSV import is not available in this demo") },
                { i: Download, t: "Export Users", d: "Download user list", fn: () => { downloadCsv("users.csv", [["Name", "Email", "Mobile", "Role", "Department", "Status"], ...users.map((u) => [u.name, u.email, u.mobile, u.role, u.dept, u.status])]); show("Users exported"); } },
              ].map((a) => (
                <button key={a.t} onClick={a.fn} className="flex w-full items-center gap-3 rounded-xl border border-line p-2.5 text-left hover:bg-brand-soft">
                  <span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand"><a.i className="size-4" /></span>
                  <span className="flex-1 text-[13px]"><b>{a.t}</b><span className="block text-xs text-sub">{a.d}</span></span>
                  <ChevronRight className="size-4 text-sub" />
                </button>
              ))}
            </Panel>
            <Panel title="Permission Groups" subtitle="" action={<LinkAction onClick={() => setTab("permissions")}>View All →</LinkAction>} bodyClassName="space-y-3 pt-3">
              {GROUPS.map((g) => <div key={g.t} className="flex items-center gap-3"><g.icon className="size-5 text-brand" /><div className="text-[13px]"><b>{g.t}</b><div className="text-xs text-sub">{g.d}</div></div></div>)}
            </Panel>
          </div>
        </div>
      )}

      {tab === "roles" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ROLES.map((r) => (
            <Panel key={r}>
              <div className="flex items-start justify-between"><Pill tone={ROLE_TONE[r]}>{r}</Pill><span className="text-xs text-sub">{roleCount(r)} users</span></div>
              <p className="mt-3 text-sm text-sub">{ROLE_DESC[r]}</p>
              <div className="mt-3 flex -space-x-2">{users.filter((u) => u.role === r).slice(0, 5).map((u) => <span key={u.id} className="rounded-full ring-2 ring-white"><Avatar name={u.name} size={28} /></span>)}</div>
              <button onClick={() => setTab("permissions")} className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-brand">Edit permissions <ArrowRight className="size-3.5" /></button>
            </Panel>
          ))}
        </div>
      )}

      {tab === "permissions" && (
        <Panel title="Role Permission Matrix" subtitle="SRS Section 21 - tick to grant the access level shown; untick for No access"
          action={<PrimaryButton icon={Shield} onClick={savePerms}>Save Permissions</PrimaryButton>}>
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><Th>Module / Action</Th>{ROLE_COLS.map((r) => <Th key={r} className="text-center">{r}</Th>)}</tr></thead>
              <tbody>
                {matrix.map((row, mi) => (
                  <tr key={row.m} className={trCls}>
                    <Td className="font-semibold">{row.m}</Td>
                    {row.v.map((val, ci) => (
                      <Td key={ci} className="text-center">
                        <label className={cx("inline-flex items-center gap-1.5", ci === 0 && "opacity-60")}>
                          <input type="checkbox" className="size-4 accent-[#3f4fe0]" checked={val !== "No"} disabled={ci === 0} onChange={() => toggleCell(mi, ci)} />
                          <span className={cx("text-xs", val === "No" ? "text-slate-400" : "font-semibold")}>{val}</span>
                        </label>
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dirty && <p className="mt-3 text-xs font-semibold text-amber-600">Unsaved changes. Permission changes require step-up authentication and are recorded in the audit log.</p>}
        </Panel>
      )}

      <SlideOver open={open} onClose={() => setOpen(false)} title="Add User" footer={<>
        <button onClick={() => setOpen(false)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={UserPlus} onClick={addUser}>Create User</PrimaryButton>
      </>}>
        <Field label="Full Name" required><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Work Email" required><input type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Mobile" required><input className={inputCls} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} placeholder="+91 " /></Field>
        <Field label="Role" required><select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Department" required><select className={inputCls} value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value })}>{DEPTS.map((r) => <option key={r}>{r}</option>)}</select></Field>
        <Field label="Temporary Password" required hint="Min 8 characters. User must change it on first login; MFA applies per security policy."><input type="password" className={inputCls} value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} /></Field>
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{err}</div>}
      </SlideOver>
    </div>
  );
}

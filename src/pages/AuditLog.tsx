import { useEffect, useMemo, useReducer, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Download, ShieldAlert, ShieldCheck } from "lucide-react";
import { Pagination, PageHeader, Panel, Pill, SearchInput, SlideOver, Td, Th, Toggle, tableCls, trCls, cx } from "../components/ui";
import { DateRangePicker, FilterChips, MultiSelect, SortTh, presetRange, inRange, sortRows, type DateRange, type SortState } from "../components/controls";
import { useToast } from "../components/Toast";
import { downloadCsv } from "../lib/csv";
import { AUDIT, onAudit, type AuditEntry } from "../lib/audit";
import { ROLES } from "../lib/auth";

// SRS §20: append-only audit trail. This screen is read-only by design: no edit or delete controls exist.
const fmtAt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const roleLabel = (r: string) => (r === "system" ? "System" : ROLES[r as keyof typeof ROLES]?.label ?? r);
const tone = (a: AuditEntry) => (a.override ? "red" : /cancel|reject|fail|delete/.test(a.action) ? "amber" : "blue") as "red" | "amber" | "blue";
const uniq = (f: (a: AuditEntry) => string) => [...new Set(AUDIT.map(f).filter(Boolean))].sort();

export default function AuditLog() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onAudit(bump), []);
  const [toast, show] = useToast();
  const [range, setRange] = useState<DateRange>(() => presetRange("All Time"));
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState<string[]>([]);
  const [action, setAction] = useState<string[]>([]);
  const [actor, setActor] = useState<string[]>([]);
  const [role, setRole] = useState<string[]>([]);
  const [onlyOverride, setOnlyOverride] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "at", dir: -1 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState<AuditEntry | null>(null);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const l = AUDIT.filter((a) => {
      if (onlyOverride && !a.override) return false;
      if (entity.length && !entity.includes(a.entity)) return false;
      if (action.length && !action.includes(a.action)) return false;
      if (actor.length && !actor.includes(a.actor)) return false;
      if (role.length && !role.includes(roleLabel(a.role))) return false;
      if (!inRange(a.at, range)) return false;
      return !t || [a.entity, a.entityId, a.action, a.actor, a.detail, a.from, a.to, a.reason].some((x) => x?.toLowerCase().includes(t));
    });
    return sortRows(l, sort, (a, k) => (k === "at" ? a.at : k === "id" ? a.id : k === "actor" ? a.actor.toLowerCase() : k === "role" ? a.role : k === "entity" ? a.entity : k === "action" ? a.action : a.entityId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [AUDIT.length, AUDIT[0]?.id, q, entity, action, actor, role, onlyOverride, range, sort]);
  const maxPage = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, maxPage);
  const shown = rows.slice((cur - 1) * pageSize, cur * pageSize);
  const overrides = AUDIT.filter((a) => a.override).length;

  const clear = () => { setQ(""); setEntity([]); setAction([]); setActor([]); setRole([]); setOnlyOverride(false); setRange(presetRange("All Time")); setPage(1); };
  const chips = [
    ...(q.trim() ? [{ label: `Search: ${q.trim()}`, onRemove: () => setQ("") }] : []),
    ...(range.preset !== "All Time" ? [{ label: `Date: ${range.preset}`, onRemove: () => setRange(presetRange("All Time")) }] : []),
    ...entity.map((v) => ({ label: `Entity: ${v}`, onRemove: () => setEntity(entity.filter((x) => x !== v)) })),
    ...action.map((v) => ({ label: `Action: ${v}`, onRemove: () => setAction(action.filter((x) => x !== v)) })),
    ...actor.map((v) => ({ label: `Actor: ${v}`, onRemove: () => setActor(actor.filter((x) => x !== v)) })),
    ...role.map((v) => ({ label: `Role: ${v}`, onRemove: () => setRole(role.filter((x) => x !== v)) })),
    ...(onlyOverride ? [{ label: "Override events only", onRemove: () => setOnlyOverride(false) }] : []),
  ];
  const exportCsv = () => {
    downloadCsv("audit-log.csv", [["ID", "Timestamp", "Actor", "Role", "Entity", "Entity ID", "Action", "From", "To", "Reason", "Detail", "Override"],
      ...rows.map((a) => [a.id, a.at, a.actor, roleLabel(a.role), a.entity, a.entityId, a.action, a.from ?? "", a.to ?? "", a.reason ?? "", a.detail ?? "", a.override ? "YES" : ""])]);
    show(`Exported ${rows.length} audit entries`);
  };
  const th = (k: string, label: string) => <SortTh k={k} sort={sort} onSort={setSort}>{label}</SortTh>;

  return (
    <div className="min-w-0">
      {toast}
      <PageHeader title="Audit Log" subtitle="Append-only record of every state-changing action (SRS §20)">
        <button onClick={exportCsv} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-[13px] font-bold hover:bg-brand-soft"><Download className="size-4" />Export CSV</button>
      </PageHeader>
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput className="w-72" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search entity, action, user, reason…" />
          <DateRangePicker value={range} onChange={(r) => { setRange(r); setPage(1); }} align="left" />
          <MultiSelect className="w-36" label="Entity" options={uniq((a) => a.entity)} value={entity} onChange={(v) => { setEntity(v); setPage(1); }} />
          <MultiSelect className="w-36" label="Action" options={uniq((a) => a.action)} value={action} onChange={(v) => { setAction(v); setPage(1); }} />
          <MultiSelect className="w-36" label="Actor" options={uniq((a) => a.actor)} value={actor} onChange={(v) => { setActor(v); setPage(1); }} />
          <MultiSelect className="w-36" label="Role" options={[...new Set(AUDIT.map((a) => roleLabel(a.role)))].sort()} value={role} onChange={(v) => { setRole(v); setPage(1); }} />
          <label className="ml-auto flex items-center gap-2 text-[13px] font-semibold"><Toggle on={onlyOverride} onChange={(v) => { setOnlyOverride(v); setPage(1); }} />Override events only<Pill tone="red">{overrides}</Pill></label>
        </div>
        <FilterChips chips={chips} onClearAll={clear} />
        <div className="overflow-x-auto">
          <table className={tableCls} data-testid="audit-table">
            <thead><tr>{th("id", "#")}{th("at", "When")}{th("actor", "Actor")}{th("role", "Role")}{th("entity", "Entity")}{th("action", "Action")}<Th>Change</Th><Th>Reason</Th></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} onClick={() => setOpen(a)} data-override={a.override ? "1" : "0"} className={cx(trCls, "cursor-pointer", a.override && "bg-rose-50/60")}>
                  <Td className="text-sub">{a.id}</Td><Td className="whitespace-nowrap">{fmtAt(a.at)}</Td><Td className="font-semibold">{a.actor}</Td><Td>{roleLabel(a.role)}</Td>
                  <Td>{a.entity}<span className="block text-xs text-sub">{a.entityId}</span></Td>
                  <Td><Pill tone={tone(a)} icon={a.override ? ShieldAlert : undefined}>{a.action}</Pill></Td>
                  <Td className="text-xs">{a.from || a.to ? <span className="inline-flex items-center gap-1">{a.from ?? "—"}<ArrowRight className="size-3 text-sub" />{a.to ?? "—"}</span> : <span className="text-sub">{a.detail ?? "—"}</span>}</Td>
                  <Td className="max-w-[240px] truncate text-xs text-sub">{a.reason ?? ""}</Td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={8} className="py-12 text-center text-sm text-sub">{AUDIT.length === 0 ? "No activity recorded yet. Moves, approvals, uploads and edits will appear here." : "No entries match the filters."}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={cur} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="entries" />
        <p className="mt-3 flex items-center gap-1.5 text-xs text-sub"><ShieldCheck className="size-3.5" />Entries are immutable. Corrections are made by recording a new event, never by editing history.</p>
      </Panel>

      <SlideOver open={!!open} onClose={() => setOpen(null)} title={`Audit entry #${open?.id ?? ""}`} width={480}>
        {open && (
          <div className="space-y-4 text-sm" data-testid="audit-detail">
            {open.override && <div className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-800"><ShieldAlert className="mt-0.5 size-4 shrink-0" />Override event: an admin bypassed the standard workflow. Elevated audit applies.</div>}
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2.5">
              <dt className="text-sub">When</dt><dd className="font-semibold">{fmtAt(open.at)}</dd>
              <dt className="text-sub">Actor</dt><dd className="font-semibold">{open.actor} <span className="font-normal text-sub">({roleLabel(open.role)})</span></dd>
              <dt className="text-sub">Entity</dt><dd className="font-semibold">{open.entity} · {open.entity === "order" ? <Link to={`/orders/${open.entityId}`} className="text-brand hover:underline">{open.entityId}</Link> : open.entityId}</dd>
              <dt className="text-sub">Action</dt><dd><Pill tone={tone(open)}>{open.action}</Pill></dd>
              {open.detail && <><dt className="text-sub">Detail</dt><dd>{open.detail}</dd></>}
            </dl>
            {(open.from || open.to) && (
              <div className="rounded-xl border border-line p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-sub">Change</div>
                <div className="flex items-center gap-3"><span className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold">{open.from ?? "—"}</span><ArrowRight className="size-4 text-sub" /><span className={cx("rounded-lg px-3 py-1.5 font-semibold", open.override ? "bg-rose-100 text-rose-800" : "bg-brand-soft text-brand")}>{open.to ?? "—"}</span></div>
              </div>
            )}
            <div className="rounded-xl border border-line p-3"><div className="mb-1 text-xs font-bold uppercase tracking-wide text-sub">Reason</div><p>{open.reason ?? <span className="text-sub">No reason recorded</span>}</p></div>
          </div>
        )}
      </SlideOver>
    </div>
  );
}

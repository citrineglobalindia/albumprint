import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Award, Download, Gauge, Medal, Timer, TrendingUp, Users } from "lucide-react";
import { DateRangePicker, inRange, presetRange, type DateRange } from "./controls";
import { KpiRow, LineTabs, Panel, Pill, Td, Th, tableCls, trCls, cx } from "./ui";
import { useStore } from "../lib/store";
import { downloadCsv } from "../lib/csv";
import { inr } from "../lib/format";
import { ORDERS, type Order } from "../lib/data";
import { AUDIT } from "../lib/audit";
import { GJOBS, PJOBS, INSPECTIONS, DRECS } from "../lib/production";
import { DJOBS } from "../lib/designJobs";
import { PROOFS } from "../lib/proofs";
import { PAYMENTS } from "../lib/finance";
import { PROGRESS, photosGraded } from "../lib/jobProgress";
import { ALBUM_LABS, LABS, albumPurchase } from "../lib/labs";
import { EMPLOYEES, EVENTS, calcDay, ensureMonth, istDate, monthOf } from "../lib/attendance";
import { STAFF as DEMO_STAFF } from "../lib/data";
import { backendOn } from "../lib/supabase";

// Team performance by role: what each person did in the period (volume), how well (first-pass / pass rate, rework),
// how fast (average time, on time), and per hour on duty (attendance). A score ranks people within the role:
//   40% on time + 35% quality + 25% volume (relative to the busiest person). Everything comes from the recorded work.
type Role = "grading" | "design" | "printing" | "qc" | "front";
const ROLES: { key: Role; label: string }[] = [
  { key: "grading", label: "Colour Grading" }, { key: "design", label: "Designing" }, { key: "printing", label: "Printing & Labs" },
  { key: "qc", label: "Quality Control" }, { key: "front", label: "Reception & Delivery" },
];
type Col = { key: string; label: string; fmt?: (v: number) => string; good?: "high" | "low" };
type PRow = { name: string; v: Record<string, number>; score: number; orders: string[] };

const H = 36e5;
const hrs = (ms: number) => (ms > 0 ? ms / H : 0);
const pct = (n: number) => `${Math.round(n)}%`;
const h1 = (n: number) => (n ? `${n.toFixed(1)} h` : "—");
const num = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0).toLocaleString("en-IN");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const endOfDay = (d: string) => new Date(`${d.slice(0, 10)}T23:59:59`);
const ordOf = (id: string) => ORDERS.find((o) => o.id === id);
const graderOf = (j: (typeof GJOBS)[number]) => (j.colorist && j.colorist !== "Unassigned" ? j.colorist : [...j.events].reverse().find((e) => e.text === "Grading started")?.by ?? "Unassigned");

/** Hours on duty and days present per person in the period (attendance punches). */
function duty(range: DateRange): Map<string, { days: number; hours: number }> {
  const people = backendOn ? EMPLOYEES.map((e) => ({ id: e.id, name: e.name })) : DEMO_STAFF.map((s) => ({ id: s.id, name: s.name }));
  const today = istDate(new Date()), out = new Map<string, { days: number; hours: number }>();
  for (const p of people) {
    const byDay = new Map<string, typeof EVENTS>();
    for (const e of EVENTS) if (e.userId === p.id && !e.superseded && inRange(`${e.date}T12:00:00`, range)) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
    let min = 0; byDay.forEach((evs, d) => { min += calcDay(evs, new Date(), d === today).workedMin; });
    out.set(p.name, { days: byDay.size, hours: min / 60 });
  }
  return out;
}

/** Score: 40% on time, 35% quality, 25% volume against the busiest person of the role. */
function score(rows: PRow[], volKey: string, onTimeKey: string | null, qualityKey: string | null) {
  const top = Math.max(1, ...rows.map((r) => r.v[volKey] ?? 0));
  for (const r of rows) {
    const vol = ((r.v[volKey] ?? 0) / top) * 100, ot = onTimeKey ? r.v[onTimeKey] ?? 0 : vol, q = qualityKey ? r.v[qualityKey] ?? 0 : vol;
    r.score = Math.round(0.4 * ot + 0.35 * q + 0.25 * vol);
  }
  rows.sort((a, b) => b.score - a.score || (b.v[volKey] ?? 0) - (a.v[volKey] ?? 0));
}

function build(role: Role, range: DateRange) {
  const att = duty(range);
  const rows = new Map<string, PRow>();
  const row = (name: string) => { let r = rows.get(name); if (!r) { r = { name, v: {}, score: 0, orders: [] }; rows.set(name, r); } return r; };
  const add = (r: PRow, k: string, n = 1) => { r.v[k] = (r.v[k] ?? 0) + n; };
  const times = new Map<string, number[]>(), ontime = new Map<string, boolean[]>();
  const t = (n: string, ms: number) => times.set(n, [...(times.get(n) ?? []), ms]);
  const ot = (n: string, ok: boolean) => ontime.set(n, [...(ontime.get(n) ?? []), ok]);
  let cols: Col[] = [], volKey = "", onKey: string | null = "onTime", qKey: string | null = null, chartKey = "", chartLabel = "";

  if (role === "grading") {
    for (const j of GJOBS) {
      const when = j.submittedAt ?? j.startedAt; if (!when || !inRange(when, range)) continue;
      const r = row(graderOf(j)); add(r, "jobs"); r.orders.push(j.orderId);
      add(r, "photos", photosGraded(j.orderId) ?? 0);
      if (j.submittedAt) { add(r, "submitted"); if (j.startedAt) t(r.name, +new Date(j.submittedAt) - +new Date(j.startedAt)); ot(r.name, new Date(j.submittedAt) <= endOfDay(j.due)); }
      if (j.status === "Approved") { add(r, "approved"); if (j.rounds <= 1) add(r, "firstPass"); }
      add(r, "rework", Math.max(0, j.rounds - 1) + (j.status === "Rework" ? 1 : 0));
    }
    rows.forEach((r) => { r.v.firstPassPct = r.v.approved ? ((r.v.firstPass ?? 0) / r.v.approved) * 100 : 0; });
    cols = [{ key: "jobs", label: "Jobs" }, { key: "photos", label: "Photos graded" }, { key: "submitted", label: "Submitted" }, { key: "approved", label: "Approved" },
      { key: "firstPassPct", label: "First-pass approval", fmt: pct, good: "high" }, { key: "rework", label: "Rework rounds", good: "low" }];
    volKey = "photos"; qKey = "firstPassPct"; chartKey = "photos"; chartLabel = "Photos graded";
  } else if (role === "design") {
    const seen = new Set<string>();
    for (const j of DJOBS) {
      const when = j.submittedAt ?? j.startedAt; if (!when || !inRange(when, range)) continue;
      const r = row(j.designer || "Unassigned"); add(r, "orders"); r.orders.push(j.orderId); seen.add(`${r.name}|${j.orderId}`);
      if (j.submittedAt && j.startedAt) t(r.name, +new Date(j.submittedAt) - +new Date(j.startedAt));
      const o = ordOf(j.orderId); if (j.submittedAt && o) ot(r.name, new Date(j.submittedAt) <= endOfDay(o.due));
      const pr = PROOFS.filter((p) => p.orderId === j.orderId);
      add(r, "proofs", pr.length); add(r, "corrections", pr.filter((p) => p.status === "corrections" || p.comments.length > 0).length);
      if (pr.some((p) => p.status === "approved") || PROGRESS.some((p) => p.orderId === j.orderId && p.dept === "design" && p.status === "client_approved")) { add(r, "approvedOrders"); if (!pr.some((p) => p.status === "corrections" || p.comments.length > 0)) add(r, "firstPass"); }
    }
    for (const p of PROGRESS) {
      if (p.dept !== "design" || !p.at || !inRange(p.at, range)) continue;
      const name = p.assignee ?? p.by; if (!name) continue;
      const r = row(name); if (!seen.has(`${name}|${p.orderId}`)) { seen.add(`${name}|${p.orderId}`); r.orders.push(p.orderId); }
      if ((p.album ?? 0) > 0) add(r, "albums");
      add(r, "sheets", p.count ?? 0);
      if (p.status === "done" || p.status === "client_approved") add(r, "albumsDone");
    }
    rows.forEach((r) => { r.v.firstPassPct = r.v.approvedOrders ? ((r.v.firstPass ?? 0) / r.v.approvedOrders) * 100 : 0; });
    cols = [{ key: "orders", label: "Orders" }, { key: "albums", label: "Albums" }, { key: "albumsDone", label: "Albums done" }, { key: "sheets", label: "Sheets designed" },
      { key: "proofs", label: "Proofs sent" }, { key: "corrections", label: "Correction rounds", good: "low" }, { key: "firstPassPct", label: "Client approved first time", fmt: pct, good: "high" }];
    volKey = "sheets"; qKey = "firstPassPct"; chartKey = "sheets"; chartLabel = "Sheets designed";
  } else if (role === "printing") {
    for (const j of PJOBS) {
      const stamps = Object.values(j.history).filter(Boolean) as { at: string; by: string }[];
      const last = stamps.sort((a, b) => a.at.localeCompare(b.at)).at(-1); if (!last || !inRange(last.at, range)) continue;
      const r = row(j.operator || last.by || "Unassigned"); add(r, "jobs"); r.orders.push(j.orderId);
      add(r, "sheets", (j.sheets || 0) * (j.copies || 1)); add(r, "reprints", j.reprints || 0); add(r, "exceptions", j.exceptions.length);
      const done = j.history["Sent to QC"] ?? j.history.Completed; if (done) { add(r, "completed"); const s = stamps[0]; if (s) t(r.name, +new Date(done.at) - +new Date(s.at)); const o = ordOf(j.orderId); if (o) ot(r.name, new Date(done.at) <= endOfDay(o.due)); }
    }
    for (const r of rows.values()) r.v.cleanPct = r.v.jobs ? (Math.max(0, r.v.jobs - (r.v.reprints ?? 0) - (r.v.exceptions ?? 0)) / r.v.jobs) * 100 : 0;
    cols = [{ key: "jobs", label: "Print jobs" }, { key: "completed", label: "Completed" }, { key: "sheets", label: "Sheets printed" }, { key: "reprints", label: "Reprints", good: "low" }, { key: "exceptions", label: "Exceptions", good: "low" }, { key: "cleanPct", label: "Right first time", fmt: pct, good: "high" }];
    volKey = "sheets"; qKey = "cleanPct"; chartKey = "sheets"; chartLabel = "Sheets printed";
  } else if (role === "qc") {
    for (const i of INSPECTIONS) {
      const when = i.decidedAt ?? i.startedAt; if (!inRange(when, range)) continue;
      const r = row(i.inspector || "Unassigned"); add(r, "inspections"); r.orders.push(i.orderId);
      if (i.status === "Passed") add(r, "passed"); if (i.status === "Failed" || i.status === "Rework") add(r, "sentBack");
      add(r, "defects", i.defects.length);
      if (i.decidedAt) t(r.name, +new Date(i.decidedAt) - +new Date(i.startedAt));
    }
    rows.forEach((r) => { const decided = (r.v.passed ?? 0) + (r.v.sentBack ?? 0); r.v.passPct = decided ? ((r.v.passed ?? 0) / decided) * 100 : 0; });
    cols = [{ key: "inspections", label: "Inspections" }, { key: "passed", label: "Passed" }, { key: "sentBack", label: "Failed / rework" }, { key: "defects", label: "Defects logged" }, { key: "passPct", label: "Pass rate", fmt: pct }];
    volKey = "inspections"; onKey = null; qKey = null; chartKey = "inspections"; chartLabel = "Inspections";
  } else {
    for (const a of AUDIT) if ((a.entity === "order" || a.entity === "orders") && a.action === "create" && inRange(a.at, range)) { const r = row(a.actor); add(r, "ordersTaken"); r.orders.push(a.entityId); }
    for (const p of PAYMENTS) if (p.kind === "payment" && inRange(p.date, range)) { const r = row(p.by || "—"); add(r, "payments"); add(r, "collected", p.amount); }
    for (const d of DRECS) {
      if (d.status !== "Delivered" || !d.deliveredAt || !inRange(d.deliveredAt, range)) continue;
      const by = [...d.events].reverse().find((e) => /deliver/i.test(e.text))?.by ?? "—";
      const r = row(by); add(r, "delivered"); r.orders.push(d.orderId);
      const o = ordOf(d.orderId); if (o) ot(r.name, new Date(d.deliveredAt) <= endOfDay(o.due));
    }
    cols = [{ key: "ordersTaken", label: "Orders taken" }, { key: "payments", label: "Payments received" }, { key: "collected", label: "Amount collected", fmt: (n) => inr(n) }, { key: "delivered", label: "Deliveries" }];
    volKey = "ordersTaken"; qKey = null; chartKey = "ordersTaken"; chartLabel = "Orders taken";
  }

  const out = [...rows.values()].filter((r) => r.name && r.name !== "—");
  for (const r of out) {
    r.v.avgH = hrs(avg(times.get(r.name) ?? []));
    const ok = ontime.get(r.name) ?? []; r.v.onTime = ok.length ? (ok.filter(Boolean).length / ok.length) * 100 : 0;
    const a = att.get(r.name); r.v.days = a?.days ?? 0; r.v.dutyH = a?.hours ?? 0;
    r.v.perHour = r.v.dutyH > 0 ? (r.v[volKey] ?? 0) / r.v.dutyH : 0;
  }
  if (onKey) cols = [...cols, { key: "avgH", label: role === "qc" ? "Avg inspection" : "Avg time per job", fmt: h1, good: "low" }, { key: "onTime", label: "On time", fmt: pct, good: "high" }];
  else cols = [...cols, ...(role === "qc" ? [{ key: "avgH", label: "Avg inspection", fmt: h1, good: "low" as const }] : [])];
  cols = [...cols, { key: "days", label: "Days present" }, { key: "dutyH", label: "Hours on duty", fmt: h1 }, { key: "perHour", label: `${chartLabel} / hour`, fmt: (n) => (n ? num(n) : "—"), good: "high" }];
  score(out, volKey, role === "front" ? null : onKey, qKey ?? (role === "qc" ? "passPct" : null));
  return { rows: out, cols, chartKey, chartLabel };
}

/** Labs: albums sent and received, how long the lab takes, and what it cost. */
function labRows(range: DateRange) {
  return LABS.map((l) => {
    const mine = ALBUM_LABS.filter((a) => a.labId === l.id && a.sentAt && inRange(a.sentAt, range));
    const back = mine.filter((a) => a.receivedAt);
    const days = avg(back.map((a) => (+new Date(a.receivedAt!) - +new Date(a.sentAt!)) / 864e5));
    const cost = mine.reduce((s, a) => { const o = ordOf(a.orderId); const p = o ? albumPurchase(o, a.position) : undefined; return s + (p?.amount ?? 0); }, 0);
    return { name: l.name, sent: mine.length, received: back.length, pending: mine.length - back.length, days, cost };
  }).filter((r) => r.sent > 0);
}

export function RolePerformance() {
  useStore();
  const [role, setRole] = useState<Role>("grading");
  const [range, setRange] = useState<DateRange>(() => presetRange(backendOn ? "This Month" : "All Time"));   // demo mode: its "today" is a fixed sample date
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // attendance for the months in the period (hours on duty)
  useEffect(() => {
    if (!range.from || !range.to) return;
    const months = new Set<string>(); for (let d = new Date(range.from); d <= range.to; d.setDate(d.getDate() + 14)) months.add(monthOf(istDate(d)));
    months.add(monthOf(istDate(range.to)));
    void Promise.all([...months].map((m) => ensureMonth(m))).then(() => setTick((n) => n + 1));
  }, [range]);
  const data = useMemo(() => build(role, range), [role, range, tick, GJOBS.length, DJOBS.length, PJOBS.length, INSPECTIONS.length, PROGRESS.length, EVENTS.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const labs = useMemo(() => (role === "printing" ? labRows(range) : []), [role, range]);
  const top = data.rows[0];
  const total = data.rows.reduce((s, r) => s + (r.v[data.chartKey] ?? 0), 0);
  const onTimes = data.rows.filter((r) => r.v.onTime > 0).map((r) => r.v.onTime);
  const exportCsv = () => downloadCsv(`performance-${role}.csv`, [["Rank", "Name", "Score", ...data.cols.map((c) => c.label)], ...data.rows.map((r, i) => [i + 1, r.name, r.score, ...data.cols.map((c) => Math.round((r.v[c.key] ?? 0) * 10) / 10)])]);
  const best = (c: Col) => (c.good ? (c.good === "high" ? Math.max(...data.rows.map((r) => r.v[c.key] ?? 0)) : Math.min(...data.rows.filter((r) => (r.v[c.key] ?? 0) > 0).map((r) => r.v[c.key] ?? 0))) : undefined);
  const openRow = data.rows.find((r) => r.name === open);
  return (
    <div className="space-y-4" data-testid="role-performance">
      <div className="flex flex-wrap items-center gap-3">
        <LineTabs<Role> className="!border-0" value={role} onChange={(r) => { setRole(r); setOpen(null); }} tabs={ROLES} />
        <div className="ml-auto flex items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} />
          <button onClick={exportCsv} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold hover:bg-brand-soft"><Download className="size-4" />Export</button>
        </div>
      </div>
      <KpiRow cols={4} items={[
        { label: "People with work", value: data.rows.length, icon: Users, tone: "blue" },
        { label: `${data.chartLabel} (team)`, value: role === "front" ? total : num(total), icon: TrendingUp, tone: "green" },
        { label: "Team on-time", value: onTimes.length ? pct(avg(onTimes)) : "—", icon: Timer, tone: "amber" },
        { label: "Top performer", value: top ? `${top.name} · ${top.score}` : "—", icon: Award, tone: "violet" },
      ]} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Leaderboard" subtitle="Score = 40% on time + 35% quality + 25% volume (vs the busiest person) · click a person for their orders" bodyClassName="p-0">
          <div className="scroll-thin overflow-x-auto">
            <table className={tableCls} data-testid="perf-table">
              <thead><tr><Th>#</Th><Th>Name</Th><Th className="text-right">Score</Th>{data.cols.map((c) => <Th key={c.key} className="whitespace-nowrap text-right">{c.label}</Th>)}</tr></thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.name} onClick={() => setOpen(open === r.name ? null : r.name)} className={cx(trCls, "cursor-pointer", open === r.name && "bg-brand-soft")} data-testid={`perf-${r.name}`}>
                    <Td>{i === 0 ? <Medal className="size-4 text-amber-500" /> : i + 1}</Td>
                    <Td className="font-semibold">{r.name}</Td>
                    <Td className="text-right"><span className="inline-flex items-center gap-2"><span className="h-1.5 w-14 overflow-hidden rounded bg-line"><span className={cx("block h-full", r.score >= 75 ? "bg-emerald-500" : r.score >= 50 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${r.score}%` }} /></span><b className="tabular-nums">{r.score}</b></span></Td>
                    {data.cols.map((c) => { const v = r.v[c.key] ?? 0, b = best(c); return <Td key={c.key} className={cx("text-right tabular-nums", b !== undefined && v === b && v > 0 && data.rows.length > 1 && "font-bold text-emerald-700")}>{c.fmt ? c.fmt(v) : num(v)}</Td>; })}
                  </tr>))}
                {data.rows.length === 0 && <tr><td colSpan={data.cols.length + 3} className="px-5 py-10 text-center text-sm text-sub">No recorded work in this period. Pick a longer period, or check that work is being updated in the department screens.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title={data.chartLabel} subtitle="By person in the period">
          <div style={{ height: Math.max(220, data.rows.length * 34) }}><ResponsiveContainer>
            <BarChart data={data.rows.map((r) => ({ n: r.name, v: Math.round((r.v[data.chartKey] ?? 0) * 10) / 10 }))} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid horizontal={false} stroke="#e6e9f5" /><XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} /><YAxis type="category" dataKey="n" width={110} tick={{ fontSize: 11 }} />
              <Tooltip /><Bar dataKey="v" name={data.chartLabel} fill="#3b5bf0" radius={[0, 6, 6, 0]} onClick={(d) => setOpen(((d as unknown as { payload?: { n?: string } }).payload?.n) ?? null)} />
            </BarChart></ResponsiveContainer></div>
        </Panel>
      </div>
      {openRow && (
        <Panel title={`${openRow.name} · orders in the period`} subtitle={`${openRow.orders.length} order(s) · score ${openRow.score}`} action={<Pill tone="blue" icon={Gauge}>{ROLES.find((x) => x.key === role)!.label}</Pill>}>
          <div className="flex flex-wrap gap-2" data-testid="perf-orders">{[...new Set(openRow.orders)].map((id) => { const o = ordOf(id) as Order | undefined; return <Link key={id} to={`/orders/${id}`} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold hover:bg-brand-soft">{id}{o ? <span className="font-normal text-sub"> · {o.customer}</span> : null}</Link>; })}</div>
        </Panel>
      )}
      {role === "printing" && (
        <Panel title="Labs" subtitle="Albums sent in the period: received back, how long the lab took, and the purchase cost" bodyClassName="p-0">
          <table className={tableCls} data-testid="lab-performance">
            <thead><tr><Th>Lab</Th><Th className="text-right">Albums sent</Th><Th className="text-right">Received</Th><Th className="text-right">Still at lab</Th><Th className="text-right">Avg turnaround</Th><Th className="text-right">Purchase cost</Th></tr></thead>
            <tbody>{labs.map((l) => <tr key={l.name} className={trCls}><Td className="font-semibold">{l.name}</Td><Td className="text-right">{l.sent}</Td><Td className="text-right">{l.received}</Td><Td className={cx("text-right", l.pending && "font-semibold text-amber-700")}>{l.pending}</Td><Td className="text-right">{l.received ? `${l.days.toFixed(1)} days` : "—"}</Td><Td className="text-right">{l.cost ? inr(l.cost) : "—"}</Td></tr>)}
              {labs.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-sub">No albums sent to a lab in this period.</td></tr>}</tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

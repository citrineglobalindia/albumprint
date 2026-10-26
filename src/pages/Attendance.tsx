import { useEffect, useMemo, useState } from "react";
import { AlarmClockCheck, CalendarCheck, CalendarX2, ChevronLeft, ChevronRight, Clock, Coffee, LogIn, LogOut, Plane, Scale, Timer, TimerOff, Users } from "lucide-react";
import { Avatar, Field, KpiRow, LineTabs, Panel, PageHeader, Pill, SlideOver, Td, Th, cx, inputCls, tableCls, trCls, type Kpi } from "../components/ui";
import { ExportBtn } from "../components/listKit";
import { useToast } from "../components/Toast";
import { useAuth } from "../lib/auth";
import { useStore } from "../lib/store";
import { downloadRows } from "../lib/exporters";
import {
  CODE, DAY_NAMES, EVENTS, HIDDEN, addDays, sinceOf, LEAVES, LEAVE_KINDS, addMonths, adjustDay, buildLedger, cancelLeave, daysOf, decideLeave, dow, employees, ensureMonth, getSettings, hm, istClock, istDate, istTime, lastKindToday,
  meId, monthLabel, monthOf, punch, requestLeave, saveSettings, seedDemo, signedHm, summarize, type AttSettings, type Employee, type LeaveKind, type PunchKind, type Row, type Status,
} from "../lib/attendance";

const TONE: Record<Status, "green" | "amber" | "orange" | "red" | "violet" | "indigo" | "slate" | "teal"> = {
  Present: "green", Late: "amber", "Half day": "orange", Absent: "red", Leave: "violet", "Half-day leave": "violet", Holiday: "indigo", "Weekly off": "slate", Incomplete: "red", Working: "teal", "On break": "amber", "Not in yet": "slate", Upcoming: "slate", "Not joined": "slate",
};
const CELL: Record<Status, string> = {
  Present: "bg-emerald-100 text-emerald-800", Late: "bg-amber-100 text-amber-800", "Half day": "bg-orange-100 text-orange-800", Absent: "bg-rose-100 text-rose-700", Leave: "bg-violet-100 text-violet-700", "Half-day leave": "bg-violet-50 text-violet-700",
  Holiday: "bg-indigo-100 text-indigo-700", "Weekly off": "bg-slate-100 text-slate-400", Incomplete: "bg-rose-50 text-rose-600 ring-1 ring-rose-300", Working: "bg-teal-100 text-teal-800", "On break": "bg-amber-50 text-amber-700", "Not in yet": "bg-slate-50 text-slate-400", Upcoming: "text-transparent", "Not joined": "text-transparent hover:bg-slate-100",
};
const useNow = (ms: number) => { const [n, setN] = useState(() => new Date()); useEffect(() => { const t = window.setInterval(() => setN(new Date()), ms); return () => window.clearInterval(t); }, [ms]); return n; };
const timeOf = (iso?: string) => (iso ? istTime(iso) : "—");
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
const EVENT_LABEL: Record<PunchKind, string> = { check_in: "Checked in", check_out: "Checked out", break_start: "Break started", break_end: "Break ended" };
const balTone = (m: number) => (m > 0 ? "text-emerald-700" : m < 0 ? "text-rose-600" : "text-sub");

type Tab = "me" | "team" | "leave" | "settings";

export default function Attendance() {
  const { role, email, loading } = useAuth();
  const isAdmin = role === "admin";
  useStore();
  seedDemo();
  const [tab, setTab] = useState<Tab>("me");
  const [ym, setYm] = useState(() => monthOf(istDate(new Date())));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [toast, show] = useToast();
  useEffect(() => { let alive = true; setBusy(true); void ensureMonth(ym).then((e) => { if (alive) { setErr(e); setBusy(false); } }); return () => { alive = false; }; }, [ym]);
  const me = meId(email);
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "me", label: "My attendance" },
    ...(isAdmin ? [{ key: "team" as const, label: "Team" }] : []),
    { key: "leave", label: "Leave", count: LEAVES.filter((l) => l.status === "pending" && (isAdmin || l.userId === me)).length || undefined },
    ...(isAdmin ? [{ key: "settings" as const, label: "Shift & holidays" }] : []),
  ];
  return (
    <div>
      <PageHeader title="Attendance" subtitle="Check in and out, with a ledger of every day's hours and a running balance" icon={<span className="mt-1 grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><AlarmClockCheck className="size-5" aria-hidden /></span>} />
      {err && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">Could not load attendance: {err}</p>}
      <LineTabs tabs={tabs} value={tab} onChange={setTab} className="mb-5" />
      {loading || (busy && !EVENTS.length && !me) ? <p className="p-6 text-sm text-sub">Loading attendance…</p> : !me ? <p className="p-6 text-sm text-sub">Your account could not be matched to an employee record.</p> : (
        <>
          {tab === "me" && <MyAttendance me={me} ym={ym} setYm={setYm} show={show} />}
          {tab === "team" && isAdmin && <TeamView ym={ym} setYm={setYm} show={show} />}
          {tab === "leave" && <LeaveView me={me} isAdmin={isAdmin} show={show} />}
          {tab === "settings" && isAdmin && <SettingsView show={show} />}
        </>
      )}
      {toast}
    </div>
  );
}

// ───────── my day + my ledger ─────────
function MyAttendance({ me, ym, setYm, show }: { me: string; ym: string; setYm: (v: string) => void; show: (m: string) => void }) {
  const s = getSettings();
  const now = useNow(1000);
  const today = istDate(now);
  const rows = useMemo(() => buildLedger(me, ym, now, sinceOf(me)), [me, ym, Math.floor(now.getTime() / 15000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const todayRow = useMemo(() => buildLedger(me, monthOf(today), now, sinceOf(me)).find((r) => r.date === today)!, [me, today, Math.floor(now.getTime() / 1000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = summarize(rows);
  const last = lastKindToday(me, now);
  const [note, setNote] = useState(""), [pending, setPending] = useState(false), [msg, setMsg] = useState("");
  const todays = EVENTS.filter((e) => e.userId === me && e.date === today && !e.superseded).sort((a, b) => a.at.localeCompare(b.at));
  const expected = Math.round(s.fullDayHours * 60), pct = Math.min(1, todayRow.workedMin / Math.max(expected, 1));
  const R = 54, C = 2 * Math.PI * R;
  const checkedIn = last === "check_in" || last === "break_end", onBreak = last === "break_start";
  const nowMin = Number(istTime(now.toISOString()).slice(0, 2)) * 60 + Number(istTime(now.toISOString()).slice(3));
  const willBeLate = !last && nowMin > Number(s.shiftStart.slice(0, 2)) * 60 + Number(s.shiftStart.slice(3)) + s.graceMinutes;
  const act = async (kind: PunchKind) => {
    setPending(true); setMsg("");
    const e = await punch(me, kind, note);
    setPending(false);
    if (e) { setMsg(e); return; }
    setNote(""); show(EVENT_LABEL[kind] + " at " + istTime(new Date().toISOString()));
  };
  const kpis: Kpi[] = [
    { label: "Days present", value: sum.present, icon: CalendarCheck, tone: "green" },
    { label: "Late arrivals", value: sum.late, icon: TimerOff, tone: "amber" },
    { label: "Absent / half days", value: `${sum.absent} / ${sum.half}`, icon: CalendarX2, tone: "red" },
    { label: "Leave taken", value: sum.leave, icon: Plane, tone: "violet" },
    { label: "Hours worked", value: hm(sum.workedMin), icon: Timer, tone: "blue" },
    { label: "Hours balance", value: signedHm(sum.balanceMin), icon: Scale, tone: sum.balanceMin >= 0 ? "teal" : "orange" },
  ];
  const exportRows = (fmt: "Excel" | "PDF") => void downloadRows(fmt, `attendance-${ym}`, ledgerCells(rows, sum), `Attendance ${monthLabel(ym)}`, `${monthLabel(ym)} · shift ${s.shiftStart}–${s.shiftEnd}`);
  return (
    <>
      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section aria-label="Today" className="rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(20,30,90,0.04)]" data-testid="today-card">
          <div className="flex items-center gap-4">
            <div className="relative size-[132px] shrink-0">
              <svg viewBox="0 0 128 128" className="size-full -rotate-90" aria-hidden>
                <circle cx="64" cy="64" r={R} fill="none" strokeWidth="10" className="stroke-slate-100" />
                <circle cx="64" cy="64" r={R} fill="none" strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} className={cx("transition-[stroke-dashoffset] duration-1000", onBreak ? "stroke-amber-400" : checkedIn ? "stroke-emerald-500" : "stroke-brand")} />
              </svg>
              <div className="absolute inset-0 grid place-content-center text-center">
                <div className="text-[22px] font-extrabold leading-none" data-testid="worked-today">{hm(todayRow.workedMin)}</div>
                <div className="mt-1 text-[11px] font-semibold text-sub">of {hm(expected)}</div>
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-sub">{new Date(`${today}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</div>
              <div className="text-2xl font-extrabold tabular-nums" aria-label="Current time">{istClock(now)}</div>
              <Pill tone={TONE[todayRow.status]} dot className="mt-1.5" >{todayRow.status}</Pill>
              <div className="mt-1.5 text-xs text-sub">Shift {s.shiftStart}–{s.shiftEnd}{todayRow.firstIn ? ` · in ${timeOf(todayRow.firstIn)}` : ""}</div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {onBreak ? (
              <button disabled={pending} onClick={() => void act("break_end")} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-60"><Coffee className="size-4" />End break</button>
            ) : checkedIn ? (
              <>
                <button disabled={pending} onClick={() => void act("check_out")} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-rose-500 px-4 text-sm font-bold text-white hover:bg-rose-600 disabled:opacity-60"><LogOut className="size-4" />Check out</button>
                <button disabled={pending} onClick={() => void act("break_start")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line px-4 text-sm font-bold hover:bg-brand-soft disabled:opacity-60"><Coffee className="size-4" />Start break</button>
              </>
            ) : (
              <button disabled={pending} onClick={() => void act("check_in")} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"><LogIn className="size-4" />{last === "check_out" ? "Check in again" : "Check in"}</button>
            )}
          </div>
          <input aria-label="Note (optional)" className={cx(inputCls, "mt-2 h-9 text-[13px]")} placeholder="Note (optional) — e.g. site visit, client meeting" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          {willBeLate && <p className="mt-2 text-xs font-semibold text-amber-700">Checking in now will be marked late (shift starts {s.shiftStart}, {s.graceMinutes} min grace).</p>}
          {msg && <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{msg}</p>}
        </section>
        <Panel title="Today's timeline" subtitle="Every punch is stamped with the server clock and cannot be edited">
          {todays.length ? (
            <ol className="relative ml-2 border-l border-line pl-5" data-testid="timeline">
              {todays.map((e) => (
                <li key={e.id} className="mb-3 last:mb-0">
                  <span className={cx("absolute -left-[7px] mt-1 size-3.5 rounded-full border-2 border-white", e.kind === "check_in" ? "bg-emerald-500" : e.kind === "check_out" ? "bg-rose-500" : "bg-amber-400")} />
                  <div className="flex flex-wrap items-baseline gap-x-3"><span className="text-sm font-bold">{EVENT_LABEL[e.kind]}</span><span className="text-sm tabular-nums text-sub">{istTime(e.at)}</span>{e.source === "admin" && <Pill tone="violet">Admin entry</Pill>}</div>
                  {(e.note || e.reason) && <div className="text-xs text-sub">{e.note ?? e.reason}</div>}
                </li>
              ))}
            </ol>
          ) : <p className="py-4 text-center text-sm text-sub">No punches yet today. Check in to start your day.</p>}
          <WeekBars me={me} now={now} expected={expected} />
        </Panel>
      </div>

      <KpiRow items={kpis} cols={3} />
      <Panel title="Attendance ledger" subtitle={`${monthLabel(ym)} · each day debits the hours expected and credits the hours worked`}
        action={<div className="flex flex-wrap items-center gap-2"><MonthNav ym={ym} setYm={setYm} /><ExportBtn label="Excel" aria="Export ledger to Excel" onClick={() => exportRows("Excel")} /><ExportBtn label="PDF" aria="Export ledger to PDF" onClick={() => exportRows("PDF")} /></div>} bodyClassName="p-0">
        <Ledger rows={rows} sum={sum} />
      </Panel>
    </>
  );
}

/** The last seven days at a glance: hours worked against the day's target. */
function WeekBars({ me, now, expected }: { me: string; now: Date; expected: number }) {
  const today = istDate(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const rows = useMemo(() => { const by = new Map<string, Row>(); for (const ym of new Set(days.map(monthOf))) for (const r of buildLedger(me, ym, now, sinceOf(me))) by.set(r.date, r); return days.map((d) => by.get(d)!); }, [me, today, Math.floor(now.getTime() / 15000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = Math.max(expected * 1.25, ...rows.map((r) => r.workedMin));
  return (
    <div className="mt-5 border-t border-line pt-4" data-testid="week-bars">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-sub">Last 7 days</div>
      <div className="relative flex h-24 items-end gap-2">
        <span className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-300" style={{ bottom: `${(expected / top) * 100}%` }} aria-hidden />
        {rows.map((r) => (
          <div key={r.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${dayLabel(r.date)} · ${r.status} · ${hm(r.workedMin)}`}>
            <div className={cx("w-full max-w-9 rounded-t-md transition-[height] duration-700", r.status === "Absent" || r.status === "Incomplete" ? "bg-rose-300" : r.late ? "bg-amber-400" : r.workedMin ? "bg-emerald-500" : "bg-slate-200")} style={{ height: `${Math.max(r.workedMin ? 6 : 2, (r.workedMin / top) * 100)}%` }} />
            <span className={cx("text-[10px] font-semibold", r.date === today ? "text-brand" : "text-sub")}>{r.dayName[0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthNav({ ym, setYm }: { ym: string; setYm: (v: string) => void }) {
  const cur = monthOf(istDate(new Date()));
  return (
    <div className="inline-flex items-center rounded-lg border border-line">
      <button aria-label="Previous month" onClick={() => setYm(addMonths(ym, -1))} className="grid size-9 place-items-center hover:bg-brand-soft"><ChevronLeft className="size-4" /></button>
      <span className="min-w-[128px] px-2 text-center text-[13px] font-bold" aria-live="polite">{monthLabel(ym)}</span>
      <button aria-label="Next month" disabled={ym >= cur} onClick={() => setYm(addMonths(ym, 1))} className="grid size-9 place-items-center hover:bg-brand-soft disabled:opacity-30"><ChevronRight className="size-4" /></button>
    </div>
  );
}

function ledgerCells(rows: Row[], sum: ReturnType<typeof summarize>): (string | number)[][] {
  const body = rows.filter((r) => !HIDDEN.includes(r.status)).map((r) => [r.date, r.dayName, timeOf(r.firstIn), timeOf(r.lastOut), r.breakMin ? hm(r.breakMin) : "", hm(r.workedMin), hm(r.expectedMin), r.counted ? signedHm(r.deltaMin) : "", signedHm(r.balanceMin), r.status, r.remark]);
  return [["Date", "Day", "Check-in", "Check-out", "Break", "Worked", "Expected", "Day +/−", "Balance", "Status", "Remarks"], ...body,
    ["Total", "", "", "", "", hm(sum.workedMin), hm(sum.expectedMin), signedHm(sum.balanceMin), signedHm(sum.balanceMin), `${sum.present} present · ${sum.late} late · ${sum.absent} absent · ${sum.half} half`, ""]];
}

function Ledger({ rows, sum }: { rows: Row[]; sum: ReturnType<typeof summarize> }) {
  const shown = rows.filter((r) => !HIDDEN.includes(r.status));
  return (
    <div className="scroll-thin overflow-x-auto" data-testid="ledger">
      <table className={cx(tableCls, "min-w-[900px]")}>
        <thead className="bg-slate-50"><tr><Th>Date</Th><Th>Day</Th><Th>Check-in</Th><Th>Check-out</Th><Th>Break</Th><Th className="text-right">Worked</Th><Th className="text-right">Expected</Th><Th className="text-right">Day +/−</Th><Th className="text-right">Balance</Th><Th>Status</Th><Th>Remarks</Th></tr></thead>
        <tbody>
          <tr className="border-t border-line bg-slate-50/60 text-[12px] italic text-sub"><Td className="font-semibold" >Opening balance</Td><Td /><Td /><Td /><Td /><Td /><Td /><Td /><Td className="text-right font-bold not-italic">0h 00m</Td><Td /><Td /></tr>
          {shown.map((r) => (
            <tr key={r.date} data-testid={`ledger-${r.date}`} className={cx(trCls, (r.status === "Weekly off" || r.status === "Holiday") && "bg-slate-50/70 text-sub")}>
              <Td className="font-semibold">{dayLabel(r.date)}</Td><Td>{r.dayName}</Td>
              <Td className={cx("tabular-nums", r.late && "font-bold text-amber-700")}>{timeOf(r.firstIn)}{r.late && <span className="ml-1 text-[10px]" title={`${r.lateMin} min after shift start`}>+{r.lateMin}m</span>}</Td>
              <Td className="tabular-nums">{r.open ? <span className="text-teal-700">now</span> : timeOf(r.lastOut)}</Td>
              <Td className="tabular-nums">{r.breakMin ? hm(r.breakMin) : "—"}</Td>
              <Td className="text-right font-semibold tabular-nums">{r.workedMin || r.firstIn ? hm(r.workedMin) : "—"}</Td>
              <Td className="text-right tabular-nums text-sub">{r.expectedMin ? hm(r.expectedMin) : "—"}</Td>
              <Td className={cx("text-right tabular-nums font-semibold", r.counted ? balTone(r.deltaMin) : "text-sub")}>{r.counted && (r.expectedMin || r.workedMin) ? signedHm(r.deltaMin) : "—"}</Td>
              <Td className={cx("text-right tabular-nums font-extrabold", balTone(r.balanceMin))}>{signedHm(r.balanceMin)}</Td>
              <Td><Pill tone={TONE[r.status]}>{r.status}</Pill>{r.corrected && <span className="ml-1 text-[10px] font-bold text-violet-600" title="Corrected by an administrator">edited</span>}</Td>
              <Td className="max-w-[260px] truncate text-xs text-sub" ><span title={r.remark}>{r.remark}</span></Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line bg-slate-50 font-extrabold"><Td>Closing balance</Td><Td /><Td /><Td /><Td />
            <Td className="text-right tabular-nums">{hm(sum.workedMin)}</Td><Td className="text-right tabular-nums">{hm(sum.expectedMin)}</Td><Td className={cx("text-right tabular-nums", balTone(sum.balanceMin))}>{signedHm(sum.balanceMin)}</Td><Td className={cx("text-right tabular-nums", balTone(sum.balanceMin))} >{signedHm(sum.balanceMin)}</Td>
            <Td className="text-xs font-semibold text-sub" >{sum.avgIn ? `avg in ${sum.avgIn}` : ""}</Td><Td /></tr>
        </tfoot>
      </table>
    </div>
  );
}

// ───────── team (admin) ─────────
function TeamView({ ym, setYm, show }: { ym: string; setYm: (v: string) => void; show: (m: string) => void }) {
  const now = useNow(30000), today = istDate(now), s = getSettings();
  const [q, setQ] = useState(""), [pick, setPick] = useState<{ emp: Employee; date: string } | null>(null);
  const emps = employees().filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()) || e.role.toLowerCase().includes(q.toLowerCase()));
  const ledgers = useMemo(() => emps.map((e) => ({ emp: e, rows: buildLedger(e.id, ym, now, e.since) })), [emps.map((e) => e.id).join(), ym, EVENTS.length, LEAVES.length, Math.floor(now.getTime() / 30000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const todays = useMemo(() => employees().map((e) => ({ emp: e, row: buildLedger(e.id, monthOf(today), now, e.since).find((r) => r.date === today)! })), [today, EVENTS.length, LEAVES.length, Math.floor(now.getTime() / 30000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (f: (r: Row) => boolean) => todays.filter((t) => f(t.row)).length;
  const days = daysOf(ym);
  const kpis: Kpi[] = [
    { label: "In now", value: count((r) => r.status === "Working" || r.status === "On break"), icon: Users, tone: "green" },
    { label: "Not in yet", value: count((r) => r.status === "Not in yet"), icon: Clock, tone: "slate" },
    { label: "On leave", value: count((r) => r.status === "Leave" || r.status === "Half-day leave"), icon: Plane, tone: "violet" },
    { label: "Late today", value: count((r) => r.late), icon: TimerOff, tone: "amber" },
    { label: "Absent / incomplete", value: count((r) => r.status === "Absent" || r.status === "Incomplete"), icon: CalendarX2, tone: "red" },
  ];
  const exportTeam = (fmt: "Excel" | "PDF") => {
    const head = ["Employee", "Role", ...days.map((d) => String(Number(d.slice(8)))), "Present", "Late", "Half", "Absent", "Leave", "Worked", "Balance"];
    const body = ledgers.map(({ emp, rows }) => { const m = summarize(rows); return [emp.name, emp.role, ...rows.map((r) => CODE[r.status]), m.present, m.late, m.half, m.absent, m.leave, hm(m.workedMin), signedHm(m.balanceMin)]; });
    void downloadRows(fmt, `attendance-team-${ym}`, [head, ...body], `Team attendance ${monthLabel(ym)}`, "P present · L late · H half day · A absent · Lv leave · WO weekly off · HD holiday · ! missed check-out");
  };
  return (
    <>
      <KpiRow items={kpis} cols={5} />
      <Panel title="Today" subtitle={new Date(`${today}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="today-board">
          {todays.map(({ emp, row }) => (
            <button key={emp.id} onClick={() => setPick({ emp, date: today })} className="flex items-center gap-3 rounded-xl border border-line p-3 text-left hover:bg-brand-soft/50">
              <Avatar name={emp.name} size={38} />
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{emp.name}</div><div className="truncate text-xs text-sub">{emp.role}</div></div>
              <div className="text-right"><Pill tone={TONE[row.status]}>{row.status}</Pill><div className="mt-1 text-[11px] tabular-nums text-sub">{row.firstIn ? `${timeOf(row.firstIn)}${row.lastOut && !row.open ? ` – ${timeOf(row.lastOut)}` : ""}` : "—"}</div></div>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Month register" subtitle="Click any day to see the punches or correct it" bodyClassName="p-0"
        action={<div className="flex flex-wrap items-center gap-2"><input aria-label="Search employees" className={cx(inputCls, "h-9 w-44 text-[13px]")} placeholder="Search employee…" value={q} onChange={(e) => setQ(e.target.value)} /><MonthNav ym={ym} setYm={setYm} /><ExportBtn label="Excel" aria="Export team register to Excel" onClick={() => exportTeam("Excel")} /><ExportBtn label="PDF" aria="Export team register to PDF" onClick={() => exportTeam("PDF")} /></div>}>
        <div className="scroll-thin overflow-x-auto" data-testid="register">
          <table className="w-full border-separate border-spacing-0 text-[12px]">
            <thead><tr className="bg-slate-50">
              <th className="sticky left-0 z-10 min-w-[170px] bg-slate-50 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-sub">Employee</th>
              {days.map((d) => <th key={d} className={cx("px-0 py-1 text-center font-bold", s.weeklyOff.includes(dow(d)) ? "text-slate-400" : "text-sub", d === today && "text-brand")}><div className="text-[10px] font-medium">{DAY_NAMES[dow(d)]![0]}</div>{Number(d.slice(8))}</th>)}
              {["P", "L", "H", "A", "Lv", "Hours", "Balance"].map((h) => <th key={h} className="whitespace-nowrap bg-slate-50 px-2 py-2 text-right text-[11px] font-bold uppercase text-sub">{h}</th>)}
            </tr></thead>
            <tbody>
              {ledgers.map(({ emp, rows }) => { const m = summarize(rows); return (
                <tr key={emp.id} data-testid={`register-${emp.id}`}>
                  <td className="sticky left-0 z-10 border-t border-line bg-white px-3 py-1.5"><div className="truncate text-[13px] font-bold">{emp.name}</div><div className="truncate text-[11px] text-sub">{emp.role}</div></td>
                  {rows.map((r) => <td key={r.date} className="border-t border-line p-0.5"><button aria-label={`${emp.name} ${r.date} ${r.status}`} disabled={r.status === "Upcoming"} onClick={() => setPick({ emp, date: r.date })} title={`${dayLabel(r.date)} · ${r.status}${r.firstIn ? ` · ${timeOf(r.firstIn)}–${timeOf(r.lastOut)}` : ""}`} className={cx("grid h-7 w-7 place-items-center rounded-md text-[10px] font-extrabold", CELL[r.status])}>{CODE[r.status]}</button></td>)}
                  <td className="border-t border-line px-2 text-right font-bold">{m.present}</td><td className="border-t border-line px-2 text-right text-amber-700">{m.late}</td><td className="border-t border-line px-2 text-right text-orange-600">{m.half}</td><td className="border-t border-line px-2 text-right text-rose-600">{m.absent}</td><td className="border-t border-line px-2 text-right text-violet-700">{m.leave}</td>
                  <td className="whitespace-nowrap border-t border-line px-2 text-right tabular-nums">{hm(m.workedMin)}</td><td className={cx("whitespace-nowrap border-t border-line px-2 text-right font-bold tabular-nums", balTone(m.balanceMin))}>{signedHm(m.balanceMin)}</td>
                </tr>); })}
              {!ledgers.length && <tr><td colSpan={days.length + 8} className="p-6 text-center text-sm text-sub">No employees match.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-[11px] text-sub">{(["Present", "Late", "Half day", "Absent", "Leave", "Holiday", "Weekly off", "Incomplete"] as Status[]).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><i className={cx("grid h-4 w-5 place-items-center rounded text-[9px] font-extrabold not-italic", CELL[k])}>{CODE[k]}</i>{k}</span>)}</div>
      </Panel>
      {pick && <DaySheet key={`${pick.emp.id}${pick.date}`} emp={pick.emp} date={pick.date} onClose={() => setPick(null)} show={show} />}
    </>
  );
}

function DaySheet({ emp, date, onClose, show }: { emp: Employee; date: string; onClose: () => void; show: (m: string) => void }) {
  useStore();
  const now = new Date();
  const row = buildLedger(emp.id, monthOf(date), now, emp.since).find((r) => r.date === date)!;
  const evs = EVENTS.filter((e) => e.userId === emp.id && e.date === date && !e.superseded).sort((a, b) => a.at.localeCompare(b.at));
  const [tin, setIn] = useState(row.firstIn ? istTime(row.firstIn) : ""), [tout, setOut] = useState(row.lastOut ? istTime(row.lastOut) : ""), [reason, setReason] = useState(""), [msg, setMsg] = useState(""), [saving, setSaving] = useState(false);
  const future = date > istDate(now);
  const save = async (clear: boolean) => {
    setSaving(true); setMsg("");
    const e = await adjustDay(emp.id, date, clear ? null : tin || null, clear ? null : tout || null, reason);
    setSaving(false);
    if (e) { setMsg(e); return; }
    show(`Attendance corrected for ${emp.name}`); onClose();
  };
  return (
    <SlideOver open onClose={onClose} title={`${emp.name} · ${dayLabel(date)}`} width={460}>
      <div className="mb-4 flex flex-wrap items-center gap-2"><Pill tone={TONE[row.status]}>{row.status}</Pill>{row.late && <Pill tone="amber">Late by {row.lateMin} min</Pill>}<span className="text-sm text-sub">{hm(row.workedMin)} worked{row.breakMin ? ` · ${hm(row.breakMin)} break` : ""}</span></div>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-sub">Punches</h3>
      {evs.length ? <ul className="mb-5 divide-y divide-line rounded-xl border border-line">{evs.map((e) => <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="font-semibold">{EVENT_LABEL[e.kind]}</span><span className="tabular-nums text-sub">{istTime(e.at)}</span>{e.source === "admin" && <Pill tone="violet">Admin entry</Pill>}<span className="ml-auto truncate text-xs text-sub">{e.reason ?? e.note ?? ""}</span></li>)}</ul> : <p className="mb-5 rounded-xl border border-dashed border-line p-4 text-center text-sm text-sub">No punches recorded.</p>}
      {future ? <p className="text-sm text-sub">This date is in the future.</p> : (
        <>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-sub">Correct this day</h3>
          <p className="mb-3 text-xs text-sub">The original punches are kept in the record; this replaces what counts for the day, with your reason and name.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in"><input aria-label="Check-in time" type="time" className={inputCls} value={tin} onChange={(e) => setIn(e.target.value)} /></Field>
            <Field label="Check-out"><input aria-label="Check-out time" type="time" className={inputCls} value={tout} onChange={(e) => setOut(e.target.value)} /></Field>
          </div>
          <Field label="Reason" required><input aria-label="Reason for correction" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. forgot to punch, was at the client site" /></Field>
          {msg && <p role="alert" className="mb-3 text-sm font-semibold text-rose-600">{msg}</p>}
          <div className="flex flex-wrap gap-2">
            <button disabled={saving} onClick={() => void save(false)} className="h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-60">Save correction</button>
            <button disabled={saving} onClick={() => void save(true)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-60">Mark no attendance</button>
          </div>
        </>
      )}
    </SlideOver>
  );
}

// ───────── leave ─────────
function LeaveView({ me, isAdmin, show }: { me: string; isAdmin: boolean; show: (m: string) => void }) {
  useStore();
  const today = istDate(new Date());
  const [f, setF] = useState({ kind: "Casual" as LeaveKind, from: today, to: today, reason: "" }), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false), [notes, setNotes] = useState<Record<string, string>>({});
  const nameOf = (id: string) => employees().find((e) => e.id === id)?.name ?? "Employee";
  const mine = LEAVES.filter((l) => l.userId === me), pending = LEAVES.filter((l) => l.status === "pending");
  const submit = async () => {
    setBusy(true); setMsg("");
    const e = await requestLeave(me, { ...f, to: f.kind === "Half day" ? f.from : f.to });
    setBusy(false);
    if (e) { setMsg(e); return; }
    setF({ kind: "Casual", from: today, to: today, reason: "" }); show("Leave request sent");
  };
  const decide = async (id: string, ok: boolean) => { const e = await decideLeave(id, ok, notes[id] ?? ""); show(e ?? (ok ? "Leave approved" : "Leave rejected")); };
  const LeaveTable = ({ items, who, actions }: { items: typeof LEAVES; who?: boolean; actions?: (l: (typeof LEAVES)[number]) => React.ReactNode }) => (
    <div className="scroll-thin overflow-x-auto"><table className={tableCls}>
      <thead className="bg-slate-50"><tr>{who && <Th>Employee</Th>}<Th>Type</Th><Th>Dates</Th><Th>Reason</Th><Th>Status</Th>{actions && <Th />}</tr></thead>
      <tbody>{items.map((l) => (
        <tr key={l.id} className={trCls} data-testid={`leave-${l.id}`}>
          {who && <Td className="font-semibold">{nameOf(l.userId)}</Td>}<Td>{l.kind}</Td><Td>{dayLabel(l.from)}{l.to !== l.from ? ` – ${dayLabel(l.to)}` : ""}</Td><Td className="max-w-[240px] truncate" ><span title={l.reason}>{l.reason}</span></Td>
          <Td><Pill tone={l.status === "approved" ? "green" : l.status === "pending" ? "amber" : l.status === "rejected" ? "red" : "slate"}>{l.status[0]!.toUpperCase() + l.status.slice(1)}</Pill>{l.decisionNote && <span className="ml-2 text-xs text-sub">{l.decisionNote}</span>}</Td>
          {actions && <Td>{actions(l)}</Td>}
        </tr>))}
        {!items.length && <tr><td colSpan={6} className="p-6 text-center text-sm text-sub">Nothing here yet.</td></tr>}</tbody>
    </table></div>
  );
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Panel title="Request leave" subtitle="Approved leave is not counted against your hours">
        <Field label="Type"><select aria-label="Leave type" className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LeaveKind })}>{LEAVE_KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={f.kind === "Half day" ? "Date" : "From"}><input aria-label="Leave from" type="date" className={inputCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to < e.target.value ? e.target.value : f.to })} /></Field>
          {f.kind !== "Half day" && <Field label="To"><input aria-label="Leave to" type="date" min={f.from} className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>}
        </div>
        <Field label="Reason" required><input aria-label="Leave reason" className={inputCls} value={f.reason} maxLength={300} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. family function" /></Field>
        {msg && <p role="alert" className="mb-3 text-sm font-semibold text-rose-600">{msg}</p>}
        <button disabled={busy} onClick={() => void submit()} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-60">Send request</button>
      </Panel>
      <div className="space-y-5">
        {isAdmin && (
          <Panel title="Waiting for your decision" subtitle={`${pending.length} pending`} bodyClassName="p-0">
            <LeaveTable who items={pending} actions={(l) => l.userId === me ? <span className="text-xs text-sub">Your own request</span> : (
              <div className="flex items-center gap-2">
                <input aria-label={`Note for ${nameOf(l.userId)}`} className={cx(inputCls, "h-8 w-36 text-xs")} placeholder="Note (optional)" value={notes[l.id] ?? ""} onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })} />
                <button onClick={() => void decide(l.id, true)} className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700">Approve</button>
                <button onClick={() => void decide(l.id, false)} className="h-8 rounded-lg border border-line px-3 text-xs font-bold text-rose-600 hover:bg-rose-50">Reject</button>
              </div>)} />
          </Panel>
        )}
        <Panel title="My requests" bodyClassName="p-0">
          <LeaveTable items={mine} actions={(l) => l.status === "pending" ? <button onClick={() => void cancelLeave(l.id).then((e) => show(e ?? "Request cancelled"))} className="text-xs font-bold text-rose-600 hover:underline">Cancel</button> : null} />
        </Panel>
        {isAdmin && <Panel title="Everyone's leave" bodyClassName="p-0"><LeaveTable who items={LEAVES.filter((l) => l.status !== "pending")} /></Panel>}
      </div>
    </div>
  );
}

// ───────── shift & holidays (admin) ─────────
function SettingsView({ show }: { show: (m: string) => void }) {
  useStore();
  const [s, setS] = useState<AttSettings>(getSettings()), [msg, setMsg] = useState(""), [h, setH] = useState({ date: "", name: "" });
  const save = async () => { setMsg(""); const e = await saveSettings(s); if (e) setMsg(e); else show("Attendance settings saved"); };
  const addHoliday = () => {
    if (!h.date || h.name.trim().length < 2) { setMsg("Enter the holiday's date and name"); return; }
    if (s.holidays.some((x) => x.date === h.date)) { setMsg("That date is already a holiday"); return; }
    setMsg(""); setS({ ...s, holidays: [...s.holidays, { date: h.date, name: h.name.trim() }].sort((a, b) => a.date.localeCompare(b.date)) }); setH({ date: "", name: "" });
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Shift rules" subtitle="Used to mark late arrivals, half days and absences">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Shift starts"><input aria-label="Shift starts" type="time" className={inputCls} value={s.shiftStart} onChange={(e) => setS({ ...s, shiftStart: e.target.value })} /></Field>
          <Field label="Shift ends"><input aria-label="Shift ends" type="time" className={inputCls} value={s.shiftEnd} onChange={(e) => setS({ ...s, shiftEnd: e.target.value })} /></Field>
          <Field label="Grace period (minutes)"><input aria-label="Grace period" type="number" min={0} max={180} className={inputCls} value={s.graceMinutes} onChange={(e) => setS({ ...s, graceMinutes: Number(e.target.value) })} /></Field>
          <span />
          <Field label="Full day = hours"><input aria-label="Full day hours" type="number" min={1} max={24} step={0.5} className={inputCls} value={s.fullDayHours} onChange={(e) => setS({ ...s, fullDayHours: Number(e.target.value) })} /></Field>
          <Field label="Half day = at least hours"><input aria-label="Half day hours" type="number" min={0} max={24} step={0.5} className={inputCls} value={s.halfDayHours} onChange={(e) => setS({ ...s, halfDayHours: Number(e.target.value) })} /></Field>
        </div>
        <div className="mb-2 text-[13px] font-semibold">Weekly off</div>
        <div className="mb-4 flex flex-wrap gap-2">{DAY_NAMES.map((d, i) => { const on = s.weeklyOff.includes(i); return <button key={d} type="button" aria-pressed={on} onClick={() => setS({ ...s, weeklyOff: on ? s.weeklyOff.filter((x) => x !== i) : [...s.weeklyOff, i].sort() })} className={cx("h-9 min-w-12 rounded-lg border px-3 text-[13px] font-bold", on ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{d}</button>; })}</div>
      </Panel>
      <Panel title="Holidays" subtitle="No hours are expected on these days">
        <div className="mb-3 grid grid-cols-[150px_1fr_auto] items-end gap-2">
          <Field label="Date"><input aria-label="Holiday date" type="date" className={inputCls} value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} /></Field>
          <Field label="Name"><input aria-label="Holiday name" className={inputCls} value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} placeholder="e.g. Diwali" /></Field>
          <button onClick={addHoliday} className="mb-4 h-10 rounded-lg border border-line px-4 text-sm font-bold hover:bg-brand-soft">Add</button>
        </div>
        <ul className="divide-y divide-line rounded-xl border border-line">{s.holidays.map((x) => <li key={x.date} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="w-24 font-semibold tabular-nums">{dayLabel(x.date)} {x.date.slice(0, 4)}</span><span className="flex-1">{x.name}</span><button aria-label={`Remove ${x.name}`} onClick={() => setS({ ...s, holidays: s.holidays.filter((y) => y.date !== x.date) })} className="text-xs font-bold text-rose-600 hover:underline">Remove</button></li>)}
          {!s.holidays.length && <li className="p-4 text-center text-sm text-sub">No holidays added.</li>}</ul>
      </Panel>
      <div className="lg:col-span-2">
        {msg && <p role="alert" className="mb-3 text-sm font-semibold text-rose-600">{msg}</p>}
        <button onClick={() => void save()} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark">Save settings</button>
      </div>
    </div>
  );
}

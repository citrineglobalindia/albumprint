import { persistArray } from "./persist";
import { backendOn } from "./supabase";
import { notify } from "./store";
import { logAudit } from "./audit";
import { loadUsers } from "./users";

// Attendance ledger. Every check-in / break / check-out is an append-only event; a day's hours, status and the running hours balance are
// DERIVED from those events here (the database refuses edits and deletes). Demo: kept in this browser. Database: written by server functions
// that stamp the server clock, so nobody can back-date a punch.
export type PunchKind = "check_in" | "check_out" | "break_start" | "break_end";
export interface AttEvent { id: string; userId: string; kind: PunchKind; at: string; date: string; note?: string; source: "web" | "admin"; reason?: string; superseded?: boolean }
export interface AttSettings { shiftStart: string; shiftEnd: string; graceMinutes: number; halfDayHours: number; fullDayHours: number; weeklyOff: number[]; holidays: { date: string; name: string }[] }
export type LeaveKind = "Casual" | "Sick" | "Earned" | "Comp-off" | "Unpaid" | "Half day";
export const LEAVE_KINDS: LeaveKind[] = ["Casual", "Sick", "Earned", "Comp-off", "Unpaid", "Half day"];
export interface Leave { id: string; userId: string; from: string; to: string; kind: LeaveKind; reason: string; status: "pending" | "approved" | "rejected" | "cancelled"; decisionNote?: string; createdAt: string }
export interface Employee { id: string; name: string; role: string; dept: string; since?: string }   // since: the date the account was created (days before it are not expected)

export const DEFAULT_SETTINGS: AttSettings = { shiftStart: "09:30", shiftEnd: "18:30", graceMinutes: 15, halfDayHours: 4, fullDayHours: 8, weeklyOff: [0], holidays: [] };
export const EVENTS: AttEvent[] = persistArray<AttEvent>("att_events", []);
export const LEAVES: Leave[] = persistArray<Leave>("att_leaves", []);
const SETTINGS: AttSettings[] = persistArray<AttSettings>("att_settings", []);
export const EMPLOYEES: Employee[] = [];                       // database mode: filled by the loader
export const ME = { id: "" };                                  // database mode: the signed-in user's id

export const getSettings = (): AttSettings => ({ ...DEFAULT_SETTINGS, ...(SETTINGS[0] ?? {}) });
export function replaceAll(p: { events?: AttEvent[]; leaves?: Leave[]; settings?: AttSettings; employees?: Employee[] }) {
  if (p.events) EVENTS.splice(0, EVENTS.length, ...p.events);
  if (p.leaves) LEAVES.splice(0, LEAVES.length, ...p.leaves);
  if (p.settings) SETTINGS.splice(0, SETTINGS.length, p.settings);
  if (p.employees) EMPLOYEES.splice(0, EMPLOYEES.length, ...p.employees);
  notify();
}
/** Add events loaded for a date range, replacing what we already held for that range. */
export function mergeRange(from: string, to: string, events: AttEvent[], userId?: string) {
  const rest = EVENTS.filter((e) => !(e.date >= from && e.date <= to && (!userId || e.userId === userId)));
  EVENTS.splice(0, EVENTS.length, ...rest, ...events); notify();
}

// ───────── dates (everything is Asia/Kolkata) ─────────
const IST = "Asia/Kolkata";
const dFmt = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" });
const tFmt = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false });
export const istDate = (d: Date | string) => dFmt.format(typeof d === "string" ? new Date(d) : d);
export const istTime = (iso: string) => tFmt.format(new Date(iso));
export const istClock = (d: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).format(d);
export const dow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const addDays = (date: string, n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const monthOf = (date: string) => date.slice(0, 7);
export const addMonths = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number) as [number, number]; const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
export const daysOf = (ym: string) => { const [y, m] = ym.split("-").map(Number) as [number, number]; const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`); };
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const monthLabel = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const mins = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number) as [number, number]; return h * 60 + m; };
export const hm = (m: number) => `${Math.floor(Math.abs(m) / 60)}h ${String(Math.abs(m) % 60).padStart(2, "0")}m`;
export const signedHm = (m: number) => (m === 0 ? "0h 00m" : `${m > 0 ? "+" : "−"}${hm(m)}`);

// ───────── the day calculation ─────────
export interface DayCalc { firstIn?: string; lastOut?: string; workedMin: number; breakMin: number; sessions: { in: string; out?: string }[]; open: boolean; onBreak: boolean; missedOut: boolean }
export function calcDay(evs: AttEvent[], now: Date, isToday: boolean): DayCalc {
  const sorted = [...evs].filter((e) => !e.superseded).sort((a, b) => a.at.localeCompare(b.at));
  let curIn: string | null = null, brk: string | null = null, sessBreak = 0, worked = 0, breakMin = 0, firstIn: string | undefined, lastOut: string | undefined;
  const sessions: DayCalc["sessions"] = [];
  const diff = (a: string, b: string) => Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  for (const e of sorted) {
    if (e.kind === "check_in" && !curIn) { curIn = e.at; sessBreak = 0; firstIn ??= e.at; }
    else if (e.kind === "break_start" && curIn && !brk) brk = e.at;
    else if (e.kind === "break_end" && curIn && brk) { const b = diff(brk, e.at); sessBreak += b; breakMin += b; brk = null; }
    else if (e.kind === "check_out" && curIn) { worked += Math.max(0, diff(curIn, e.at) - sessBreak); sessions.push({ in: curIn, out: e.at }); lastOut = e.at; curIn = null; brk = null; }
  }
  let open = false, missedOut = false;
  if (curIn) {
    if (isToday) {
      open = true; const end = now.toISOString(); let b = sessBreak;
      if (brk) { const ob = diff(brk, end); b += ob; breakMin += ob; }
      worked += Math.max(0, diff(curIn, end) - b); sessions.push({ in: curIn });
    } else { missedOut = true; sessions.push({ in: curIn }); }
  }
  return { firstIn, lastOut, workedMin: worked, breakMin, sessions, open, onBreak: open && !!brk, missedOut };
}

export type Status = "Present" | "Late" | "Half day" | "Absent" | "Leave" | "Half-day leave" | "Holiday" | "Weekly off" | "Incomplete" | "Working" | "On break" | "Not in yet" | "Upcoming" | "Not joined";
export interface Row extends DayCalc { date: string; userId: string; dayName: string; status: Status; late: boolean; lateMin: number; expectedMin: number; deltaMin: number; balanceMin: number; remark: string; counted: boolean; corrected: boolean }

export const HIDDEN: Status[] = ["Upcoming", "Not joined"];
export function buildLedger(userId: string, ym: string, now = new Date(), since?: string, data = { events: EVENTS, leaves: LEAVES, settings: getSettings() }): Row[] {
  const s = data.settings, today = istDate(now), fullMin = Math.round(s.fullDayHours * 60), halfMin = Math.round(s.halfDayHours * 60);
  const mine = data.events.filter((e) => e.userId === userId), leaves = data.leaves.filter((l) => l.userId === userId && l.status === "approved");
  let balance = 0;
  return daysOf(ym).map((date): Row => {
    const dayEvents = mine.filter((e) => e.date === date), calc = calcDay(dayEvents, now, date === today);
    const base = { ...calc, date, userId, dayName: DAY_NAMES[dow(date)]!, late: false, lateMin: 0, expectedMin: 0, deltaMin: 0, balanceMin: balance, remark: "", counted: false, corrected: dayEvents.some((e) => e.source === "admin" && !e.superseded) };
    if (date > today) return { ...base, status: "Upcoming" };
    if (since && date < since && !dayEvents.length) return { ...base, status: "Not joined" };
    const hol = s.holidays.find((h) => h.date === date), off = s.weeklyOff.includes(dow(date)), leave = leaves.find((l) => l.from <= date && l.to >= date);
    const worked = calc.workedMin, correction = dayEvents.find((e) => e.source === "admin" && !e.superseded);
    let status: Status, expected = 0, remark = correction?.reason ? `Corrected by admin: ${correction.reason}` : dayEvents.find((e) => e.note)?.note ?? "";
    if (hol || off) { expected = 0; status = worked > 0 ? "Present" : hol ? "Holiday" : "Weekly off"; if (hol) remark = hol.name + (worked > 0 ? " — worked" : ""); else if (worked > 0) remark = "Worked on weekly off" + (remark ? ` · ${remark}` : ""); }
    else if (leave && leave.kind !== "Half day") { expected = 0; status = worked > 0 ? "Present" : "Leave"; remark = `${leave.kind} leave`; }
    else {
      expected = leave ? Math.round(fullMin / 2) : fullMin;
      if (leave) remark = "Half-day leave";
      if (calc.missedOut) { status = "Incomplete"; remark = "Missed check-out — ask admin to correct"; }
      else if (calc.open) status = calc.onBreak ? "On break" : "Working";
      else if (!dayEvents.some((e) => !e.superseded)) status = leave ? "Half-day leave" : date === today && now.getTime() < new Date(`${date}T${s.shiftEnd}:00+05:30`).getTime() ? "Not in yet" : "Absent";
      else if (worked >= expected - 1) status = "Present";
      else if (worked >= Math.min(halfMin, expected)) status = "Half day";
      else { status = "Absent"; remark = `${hm(worked)} worked — under the half-day minimum` + (remark ? ` · ${remark}` : ""); }
    }
    let late = false, lateMin = 0;
    if (calc.firstIn && !hol && !off) { const over = mins(istTime(calc.firstIn)) - (mins(s.shiftStart) + s.graceMinutes); if (over > 0) { late = true; lateMin = over + s.graceMinutes; } }
    if (late && status === "Present") status = "Late";
    const inProgress = status === "Working" || status === "On break" || status === "Not in yet";
    const counted = !inProgress;
    const delta = counted ? worked - expected : 0;
    balance += delta;
    return { ...base, status, late, lateMin, expectedMin: expected, deltaMin: delta, balanceMin: balance, remark, counted };
  });
}

export interface Summary { present: number; late: number; half: number; absent: number; leave: number; incomplete: number; workedMin: number; expectedMin: number; balanceMin: number; avgIn?: string }
export function summarize(rows: Row[]): Summary {
  const s: Summary = { present: 0, late: 0, half: 0, absent: 0, leave: 0, incomplete: 0, workedMin: 0, expectedMin: 0, balanceMin: 0 };
  const ins: number[] = [];
  for (const r of rows) {
    if (r.status === "Present" || r.status === "Late") s.present++;
    if (r.late) s.late++;
    if (r.status === "Half day") s.half++;
    if (r.status === "Absent") s.absent++;
    if (r.status === "Leave" || r.status === "Half-day leave") s.leave += r.status === "Leave" ? 1 : 0.5;
    if (r.status === "Incomplete") s.incomplete++;
    if (r.counted) { s.workedMin += r.workedMin; s.expectedMin += r.expectedMin; }
    if (r.firstIn) ins.push(mins(istTime(r.firstIn)));
  }
  s.balanceMin = s.workedMin - s.expectedMin;
  if (ins.length) { const a = Math.round(ins.reduce((x, y) => x + y, 0) / ins.length); s.avgIn = `${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`; }
  return s;
}

/** Short code for the team matrix. */
export const CODE: Record<Status, string> = { Present: "P", Late: "L", "Half day": "H", Absent: "A", Leave: "Lv", "Half-day leave": "½", Holiday: "HD", "Weekly off": "WO", Incomplete: "!", Working: "●", "On break": "☕", "Not in yet": "–", Upcoming: "", "Not joined": "" };

// ───────── people ─────────
export function employees(): Employee[] {
  if (backendOn) return EMPLOYEES;
  return loadUsers().filter((u) => u.status === "Active").map((u) => ({ id: u.id, name: u.name, role: u.role, dept: u.dept }));
}
export const sinceOf = (userId: string) => employees().find((e) => e.id === userId)?.since;
export function meId(email: string): string {
  if (backendOn) return ME.id;
  return loadUsers().find((u) => u.email.toLowerCase() === email.toLowerCase())?.id ?? "";
}

// ───────── actions ─────────
type Backend = {
  punch: (kind: PunchKind, note?: string) => Promise<AttEvent | { error: string }>;
  adjust: (userId: string, date: string, inTime: string | null, outTime: string | null, reason: string) => Promise<string | null>;
  requestLeave: (l: { from: string; to: string; kind: LeaveKind; reason: string }) => Promise<string | null>;
  decide: (id: string, approve: boolean, note: string) => Promise<string | null>;
  cancel: (id: string) => Promise<string | null>;
  saveSettings: (s: AttSettings) => Promise<string | null>;
  load: (from: string, to: string) => Promise<string | null>;
};
let backend: Backend | null = null;
export const registerAttendanceBackend = (b: Backend) => { backend = b; };
const NOT_CONNECTED = "Not connected to the database";
const uid = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** The punch rules (the database enforces the same ones). Returns the reason a punch is refused, or null. */
export function punchError(kind: PunchKind, last: PunchKind | undefined): string | null {
  if (kind === "check_in" && (last === "check_in" || last === "break_start" || last === "break_end")) return "You are already checked in";
  if ((kind === "check_out" || kind === "break_start") && !last) return "Check in first";
  if ((kind === "check_out" || kind === "break_start") && last === "check_out") return "You are already checked out";
  if (kind === "check_out" && last === "break_start") return "End your break before checking out";
  if (kind === "break_start" && last === "break_start") return "You are already on a break";
  if (kind === "break_end" && last !== "break_start") return "You are not on a break";
  return null;
}
export const lastKindToday = (userId: string, now = new Date()): PunchKind | undefined => {
  const today = istDate(now);
  return EVENTS.filter((e) => e.userId === userId && e.date === today && !e.superseded).sort((a, b) => a.at.localeCompare(b.at)).at(-1)?.kind;
};

export async function punch(userId: string, kind: PunchKind, note = ""): Promise<string | null> {
  if (backendOn) {
    if (!backend) return NOT_CONNECTED;
    const r = await backend.punch(kind, note); if ("error" in r) return r.error;
    EVENTS.push(r); notify(); return null;
  }
  const now = new Date(), err = punchError(kind, lastKindToday(userId, now)); if (err) return err;
  EVENTS.push({ id: uid(), userId, kind, at: now.toISOString(), date: istDate(now), note: note.trim() || undefined, source: "web" }); notify();
  return null;
}

export async function adjustDay(userId: string, date: string, inTime: string | null, outTime: string | null, reason: string): Promise<string | null> {
  if (reason.trim().length < 3) return "Give a reason for the correction";
  if (date > istDate(new Date())) return "Cannot record attendance for a future date";
  if (outTime && !inTime) return "Enter the check-in time too";
  if (inTime && outTime && outTime <= inTime) return "Check-out must be after check-in";
  if (backendOn) { if (!backend) return NOT_CONNECTED; const e = await backend.adjust(userId, date, inTime, outTime, reason.trim()); if (e) return e; await backend.load(date, date); return null; }
  EVENTS.forEach((e) => { if (e.userId === userId && e.date === date && !e.superseded) e.superseded = true; });
  const at = (t: string) => new Date(`${date}T${t}:00+05:30`).toISOString();
  if (inTime) EVENTS.push({ id: uid(), userId, kind: "check_in", at: at(inTime), date, source: "admin", reason: reason.trim() });
  if (outTime) EVENTS.push({ id: uid(), userId, kind: "check_out", at: at(outTime), date, source: "admin", reason: reason.trim() });
  notify(); logAudit({ entity: "attendance", entityId: `${userId}/${date}`, action: "update", detail: `Corrected ${date}: ${inTime ?? "no attendance"}${outTime ? `–${outTime}` : ""} (${reason.trim()})` });
  return null;
}

export async function requestLeave(userId: string, l: { from: string; to: string; kind: LeaveKind; reason: string }): Promise<string | null> {
  if (l.reason.trim().length < 3) return "Give a reason";
  if (l.to < l.from) return "The end date is before the start date";
  if (l.kind === "Half day" && l.from !== l.to) return "A half day is a single date";
  if (LEAVES.some((x) => x.userId === userId && (x.status === "pending" || x.status === "approved") && x.from <= l.to && x.to >= l.from)) return "You already have a leave request covering these dates";
  if (backendOn) { if (!backend) return NOT_CONNECTED; const e = await backend.requestLeave({ ...l, reason: l.reason.trim() }); if (e) return e; await backend.load(l.from.slice(0, 7) + "-01", l.to); return null; }
  LEAVES.unshift({ id: uid(), userId, from: l.from, to: l.to, kind: l.kind, reason: l.reason.trim(), status: "pending", createdAt: new Date().toISOString() }); notify();
  return null;
}
export async function decideLeave(id: string, approve: boolean, note = ""): Promise<string | null> {
  const l = LEAVES.find((x) => x.id === id); if (!l) return "Leave request not found";
  if (l.status !== "pending") return `This request was already ${l.status}`;
  if (backendOn) { if (!backend) return NOT_CONNECTED; const e = await backend.decide(id, approve, note); if (e) return e; }
  l.status = approve ? "approved" : "rejected"; l.decisionNote = note.trim() || undefined; notify();
  logAudit({ entity: "attendance_leave", entityId: id, action: "update", detail: `${approve ? "Approved" : "Rejected"} ${l.kind} leave ${l.from}${l.to !== l.from ? ` to ${l.to}` : ""}` });
  return null;
}
export async function cancelLeave(id: string): Promise<string | null> {
  const l = LEAVES.find((x) => x.id === id); if (!l || l.status !== "pending") return "Only a pending request can be cancelled";
  if (backendOn) { if (!backend) return NOT_CONNECTED; const e = await backend.cancel(id); if (e) return e; }
  l.status = "cancelled"; notify(); return null;
}
export async function saveSettings(s: AttSettings): Promise<string | null> {
  if (!/^\d{2}:\d{2}$/.test(s.shiftStart) || !/^\d{2}:\d{2}$/.test(s.shiftEnd) || s.shiftEnd <= s.shiftStart) return "The shift must end after it starts";
  if (!(s.fullDayHours > 0) || s.halfDayHours > s.fullDayHours) return "Half-day hours cannot exceed full-day hours";
  if (backendOn) { if (!backend) return NOT_CONNECTED; const e = await backend.saveSettings(s); if (e) return e; }
  SETTINGS.splice(0, SETTINGS.length, s); notify();
  logAudit({ entity: "attendance_settings", entityId: "attendance", action: "update", detail: `Shift ${s.shiftStart}–${s.shiftEnd}, grace ${s.graceMinutes} min, ${s.holidays.length} holidays` });
  return null;
}
/** Database mode: make sure the events for a month (and the leave, settings and staff list) are loaded. */
const loaded = new Set<string>();
export async function ensureMonth(ym: string, force = false): Promise<string | null> {
  if (!backendOn) return null;
  if (!backend) return NOT_CONNECTED;
  if (!force && loaded.has(ym)) return null;
  const e = await backend.load(`${ym}-01`, daysOf(ym).at(-1)!); if (!e) loaded.add(ym);
  return e;
}

// ───────── demo data: a believable last six weeks, so the ledger is not empty on day one ─────────
export function seedDemo(now = new Date()) {
  if (backendOn) return;
  try { if (localStorage.getItem("albumpro.v1.att_seeded")) return; localStorage.setItem("albumpro.v1.att_seeded", "1"); } catch { /* private mode: seed in memory only */ }
  if (EVENTS.length) return;
  const today = istDate(now);
  const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); };
  for (const emp of employees()) {
    for (let i = 42; i >= 1; i--) {
      const date = addDays(today, -i);
      if (dow(date) === 0) continue;
      const r = hash(`${emp.id}${date}`) % 100, at = (hh: number, mm: number) => new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`).toISOString();
      if (r < 5) continue;                                                      // absent
      const late = r >= 5 && r < 22, inM = late ? 9 * 60 + 50 + (hash(date + emp.id) % 40) : 9 * 60 + 5 + (hash(emp.id + date) % 30);
      const add = (kind: PunchKind, m: number) => EVENTS.push({ id: uid(), userId: emp.id, kind, at: at(Math.floor(m / 60), m % 60), date, source: "web" });
      add("check_in", inM);
      if (r >= 22 && r < 27) { add("check_out", 13 * 60 + 30); continue; }      // half day
      add("break_start", 13 * 60 + (hash(date) % 15)); add("break_end", 13 * 60 + 40 + (hash(emp.id) % 15));
      if (r === 27 && i > 3) continue;                                          // forgot to check out
      add("check_out", 18 * 60 + 5 + (hash(date + emp.id) % 70));
    }
  }
  notify();
}

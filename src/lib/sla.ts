import { ORDERS, STAGES, stageLabel, type Order, type StageKey } from "./data";
import { AUDIT } from "./audit";
import { TODAY } from "./format";

// SRS §18.2 — per-stage SLA targets measured in BUSINESS hours (calendar from Settings > Workflow), pause-aware.
export const SLA_DEFAULTS: Partial<Record<StageKey, number>> = {
  files_received: 4, colour_grading: 24, admin_approval: 8, designing: 72, client_review: 72, final_approval: 8, printing: 72, qc: 8, ready_for_delivery: 24,
};
export const DEPT_OF: Partial<Record<StageKey, string>> = {
  files_received: "Reception", colour_grading: "Colour Grading", admin_approval: "Admin", designing: "Designing", client_review: "Client", final_approval: "Admin",
  printing: "Printing", qc: "Quality Control", ready_for_delivery: "Delivery",
};
export const DEPARTMENTS = ["Reception", "Colour Grading", "Admin", "Designing", "Client", "Printing", "Quality Control", "Delivery"];

export interface BizCfg { start: number; end: number; days: number[]; holidays: string[]; warnPct: number }
export const BIZ_DEFAULT: BizCfg = { start: 10, end: 19, days: [1, 2, 3, 4, 5, 6], holidays: [], warnPct: 75 };

function settings(): Record<string, unknown> { try { return JSON.parse(localStorage.getItem("albumpro.settings") ?? "{}"); } catch { return {}; } }
export function bizConfig(): BizCfg {
  const s = settings();
  const start = Number(s.bh_start), end = Number(s.bh_end), warn = Number(s.sla_warn_pct);
  const days = typeof s.bh_days === "string" ? String(s.bh_days).split(",").map(Number).filter((n) => n >= 0 && n <= 6) : BIZ_DEFAULT.days;
  const holidays = typeof s.bh_holidays === "string" ? String(s.bh_holidays).split(/[\s,;]+/).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) : [];
  return {
    start: Number.isFinite(start) && s.bh_start !== undefined && start >= 0 && start < 24 ? start : BIZ_DEFAULT.start,
    end: Number.isFinite(end) && s.bh_end !== undefined && end > 0 && end <= 24 ? end : BIZ_DEFAULT.end,
    days: days.length ? days : BIZ_DEFAULT.days, holidays, warnPct: Number.isFinite(warn) && warn > 0 && warn < 100 && s.sla_warn_pct !== undefined ? warn : BIZ_DEFAULT.warnPct,
  };
}
/** SLA hours for a stage: Settings > Workflow stage list (if saved) else SRS defaults. null = stage has no SLA clock. */
export function stageSlaHours(stage: StageKey): number | null {
  const s = settings();
  try {
    const list = JSON.parse(String(s.wf_stages ?? "[]")) as { key: string; enabled: boolean; sla: number }[];
    const row = list.find((x) => x.key === stage);
    if (row && stage in SLA_DEFAULTS && row.sla >= 1) return row.sla;
  } catch { /* ignore */ }
  return SLA_DEFAULTS[stage] ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isWorkDay = (d: Date, c: BizCfg) => c.days.includes(d.getDay()) && !c.holidays.includes(ymd(d));
const at = (d: Date, h: number) => { const x = new Date(d); x.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0); return x; };

/** Business hours elapsed between two instants. */
export function bizHoursBetween(a: Date, b: Date, c: BizCfg = bizConfig()): number {
  if (b <= a) return 0;
  let total = 0;
  const day = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  for (let i = 0; i < 4000 && day <= b; i++, day.setDate(day.getDate() + 1)) {
    if (!isWorkDay(day, c)) continue;
    const s = Math.max(+at(day, c.start), +a), e = Math.min(+at(day, c.end), +b);
    if (e > s) total += (e - s) / 36e5;
  }
  return total;
}
/** The instant `hours` business hours after `from`. */
export function addBizHours(from: Date, hours: number, c: BizCfg = bizConfig()): Date {
  let left = hours;
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 4000; i++, day.setDate(day.getDate() + 1)) {
    if (!isWorkDay(day, c)) continue;
    const s = Math.max(+at(day, c.start), +from), e = +at(day, c.end);
    if (e <= s) continue;
    const avail = (e - s) / 36e5;
    if (left <= avail) return new Date(s + left * 36e5);
    left -= avail;
  }
  return new Date(+from + hours * 36e5);
}

export const slaNow = () => new Date(TODAY);   // the demo's "today" (matches isOverdue / dashboards)

/** When the order entered its current stage: latest audit stage move into it, else its pendingAt date. */
export function stageStart(o: Order): Date {
  const lbl = stageLabel(o.stage);
  const hit = AUDIT.find((a) => a.entity === "order" && a.entityId === o.id && (a.action === "stage_change" || a.action === "stage_override") && a.to === lbl);
  if (hit) return new Date(hit.at);
  return new Date(o.pendingAt.length <= 10 ? `${o.pendingAt}T00:00:00` : o.pendingAt);
}

export type SlaStatus = "ok" | "at_risk" | "breached" | "paused";
export interface SlaState { dueAt: Date | null; hoursLeft: number; status: SlaStatus; slaHours: number | null; usedPct: number; dept: string }
export function slaState(o: Order, now: Date = slaNow()): SlaState {
  const hours = stageSlaHours(o.stage);
  const dept = DEPT_OF[o.stage] ?? "—";
  if (hours == null || o.stage === "delivered" || o.closed || o.hold === "Cancelled") return { dueAt: null, hoursLeft: 0, status: "ok", slaHours: hours, usedPct: 0, dept };
  const c = bizConfig();
  const start = stageStart(o);
  // sum business hours spent in earlier completed pauses (from audit) so resumed orders get their time back
  const events = AUDIT.filter((a) => a.entity === "order" && a.entityId === o.id && (a.action === "sla_pause" || a.action === "sla_resume") && new Date(a.at) >= start).reverse();
  let paused = 0, openPause: Date | null = null;
  for (const e of events) {
    if (e.action === "sla_pause") openPause = new Date(e.at);
    else if (openPause) { paused += bizHoursBetween(openPause, new Date(e.at), c); openPause = null; }
  }
  const pauseStart = o.slaPausedAt ? new Date(o.slaPausedAt) : null;
  const end = pauseStart ?? now;
  const used = Math.max(0, bizHoursBetween(start, end, c) - paused);
  const effHours = hours;
  const left = effHours - used;
  const dueAt = pauseStart ? null : addBizHours(now, Math.max(0, left), c);
  const usedPct = effHours ? Math.min(999, (used / effHours) * 100) : 0;
  const status: SlaStatus = pauseStart ? "paused" : left <= 0 ? "breached" : usedPct >= c.warnPct ? "at_risk" : "ok";
  // the due instant for display: where the clock would hit zero measured from stage start (shifted by pauses)
  const due = pauseStart ? null : left <= 0 ? addBizHours(start, effHours + paused, c) : dueAt;
  return { dueAt: due, hoursLeft: Math.round(left * 10) / 10, status, slaHours: hours, usedPct, dept };
}

export const PRIO_ORDER: Record<string, number> = { VIP: 0, Urgent: 1, High: 2, Normal: 3, Low: 4 };
/** Priority sequencing: VIP > Urgent > High > Normal > Low, then earliest due date. */
export function sequenceOrders(list: Order[] = ORDERS): Order[] {
  return list.filter((o) => o.stage !== "delivered" && !o.closed && o.hold !== "Cancelled").sort((a, b) => (PRIO_ORDER[a.priority]! - PRIO_ORDER[b.priority]!) || a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
}
export function fmtHours(h: number): string {
  const a = Math.abs(h);
  const c = bizConfig(), dl = Math.max(1, c.end - c.start);
  const s = a >= dl ? `${Math.floor(a / dl)}d ${Math.round(a % dl)}h` : `${Math.round(a * 10) / 10}h`;
  return h < 0 ? `${s} over` : `${s} left`;
}
export { STAGES };

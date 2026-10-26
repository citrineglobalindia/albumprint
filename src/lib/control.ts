import { AUDIT } from "./audit";
import { buildLedger, employees, istDate, LEAVES, getSettings, addDays, monthOf, type Row } from "./attendance";
import { CUSTOMERS, ORDERS, STAGES, type Order, type StageKey } from "./data";
import { DESIGN_META } from "./design";
import { FILES } from "./files";
import { INVOICES, PAYMENTS, invStatus } from "./finance";
import { DRECS, GJOBS, INSPECTIONS, PJOBS, RTASKS } from "./production";
import { PROOFS } from "./proofs";
import { slaState, slaNow } from "./sla";

// Control Center analytics. Pure functions over the shared in-memory data (demo or database): per-module health, a prioritised alert list,
// a workload table and daily trend series. Nothing here mutates anything.
export type Health = "ok" | "attention" | "critical";
export type Severity = "info" | "warn" | "crit";
export interface Issue { text: string; to: string; severity: Severity; count: number }
export interface ModuleCard { key: string; label: string; to: string; health: Health; metrics: { label: string; value: string | number }[]; issues: Issue[]; note?: string }

const live = (o: Order) => !o.closed && o.hold !== "Cancelled";
const active = () => ORDERS.filter((o) => live(o) && o.stage !== "delivered");
const stageQ = (...k: StageKey[]) => `/orders?stage=${k.join(",")}`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ordOf = (id: string) => ORDERS.find((o) => o.id === id);
const rank: Record<Severity, number> = { crit: 0, warn: 1, info: 2 };
const healthOf = (issues: Issue[]): Health => (issues.some((i) => i.severity === "crit") ? "critical" : issues.some((i) => i.severity === "warn") ? "attention" : "ok");
const issue = (count: number, text: (n: number) => string, to: string, severity: Severity): Issue[] => (count > 0 ? [{ count, text: text(count), to, severity }] : []);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export interface Extras { commQueued?: number; commConnected?: boolean; dbErrors?: number; backend: boolean }

export function attendanceToday(now = new Date()) {
  const s = getSettings(), today = istDate(now), yesterday = addDays(today, -1);
  const rows = employees().map((e) => {
    const month = new Map<string, Row>();
    for (const ym of new Set([monthOf(today), monthOf(yesterday)])) for (const r of buildLedger(e.id, ym, now, e.since)) month.set(r.date, r);
    return { emp: e, today: month.get(today)!, yesterday: month.get(yesterday)! };
  });
  const isOff = s.weeklyOff.includes(new Date(`${today}T00:00:00Z`).getUTCDay()) || s.holidays.some((h) => h.date === today);
  const inNow = rows.filter((r) => r.today.status === "Working" || r.today.status === "On break").length;
  const notIn = rows.filter((r) => r.today.status === "Not in yet").length;
  const late = rows.filter((r) => r.today.late).length;
  const absent = rows.filter((r) => r.today.status === "Absent").length;
  const onLeave = rows.filter((r) => r.today.status === "Leave" || r.today.status === "Half-day leave").length;
  const missed = rows.filter((r) => r.yesterday?.status === "Incomplete" || r.today.status === "Incomplete").length;
  const pendingLeave = LEAVES.filter((l) => l.status === "pending").length;
  return { rows, total: rows.length, inNow, notIn, late, absent, onLeave, missed, pendingLeave, isOff };
}

export function computeModules(x: Extras, now = slaNow()): ModuleCard[] {
  const today = iso(now), act = active();
  const sla = new Map(ORDERS.map((o) => [o.id, slaState(o, now)]));
  const cards: ModuleCard[] = [];
  const add = (key: string, label: string, to: string, metrics: ModuleCard["metrics"], issues: Issue[], note?: string) => cards.push({ key, label, to, metrics, issues: issues.sort((a, b) => rank[a.severity] - rank[b.severity]), health: healthOf(issues), note });

  // Orders
  const overdue = act.filter((o) => !o.hold && o.due < today), held = act.filter((o) => o.hold === "On Hold");
  const breached = act.filter((o) => sla.get(o.id)!.status === "breached"), atRisk = act.filter((o) => sla.get(o.id)!.status === "at_risk");
  add("orders", "Orders", "/orders", [{ label: "Active", value: act.length }, { label: "Overdue", value: overdue.length }, { label: "On hold", value: held.length }, { label: "SLA breached", value: breached.length }], [
    ...issue(overdue.length, (n) => `${plural(n, "order")} past the promised date`, "/orders?overdue=1", overdue.length >= Math.max(3, act.length * 0.25) ? "crit" : "warn"),
    ...issue(breached.length, (n) => `${plural(n, "order")} breached the department SLA`, "/control#escalations", "crit"),
    ...issue(atRisk.length, (n) => `${plural(n, "order")} at risk of breaching SLA`, "/control#escalations", "warn"),
    ...issue(held.length, (n) => `${plural(n, "order")} on hold`, "/orders", "info"),
  ]);

  // Customers
  const owing = new Set(ORDERS.filter((o) => o.hold !== "Cancelled" && o.total - o.paid > 0).map((o) => o.customer));
  add("customers", "Customers", "/customers", [{ label: "Customers", value: CUSTOMERS.length }, { label: "With dues", value: owing.size }], issue(owing.size, (n) => `${plural(n, "customer")} owe money`, "/orders?pay=Unpaid,Partial,Overdue", "info"));

  // Colour grading
  const gOpen = GJOBS.filter((j) => j.status !== "Approved" && ordOf(j.orderId) && live(ordOf(j.orderId)!));
  const gLate = gOpen.filter((j) => (j.status === "New" || j.status === "In Progress" || j.status === "Rework") && j.due && j.due < today);
  const gRework = gOpen.filter((j) => j.status === "Rework");
  const gApproval = ORDERS.filter((o) => live(o) && o.stage === "admin_approval" && !o.hold);
  add("grading", "Colour Grading", "/colour-grading", [{ label: "Open jobs", value: gOpen.length }, { label: "In rework", value: gRework.length }, { label: "Awaiting approval", value: gApproval.length }, { label: "Late", value: gLate.length }], [
    ...issue(gLate.length, (n) => `${plural(n, "grading job")} past due`, "/colour-grading", "warn"),
    ...issue(gRework.length, (n) => `${plural(n, "grading job")} sent back for rework`, "/colour-grading", "warn"),
    ...issue(gApproval.length, (n) => `${plural(n, "grading")} waiting for your approval`, "/control", "warn"),
  ]);

  // Designing
  const inDesign = ORDERS.filter((o) => live(o) && o.stage === "designing");
  const designQ = inDesign.filter((o) => !o.hold && DESIGN_META.some((m) => m.orderId === o.id && m.submitted && !m.adminApproved));
  add("designing", "Album Designing", "/designing", [{ label: "In designing", value: inDesign.length }, { label: "Awaiting approval", value: designQ.length }], [
    ...issue(designQ.length, (n) => `${plural(n, "design")} waiting for your approval`, "/control", "warn"),
    ...issue(inDesign.filter((o) => o.due < today).length, (n) => `${plural(n, "design job")} past the promised date`, "/designing", "warn"),
  ]);

  // Client proofs
  const waiting = PROOFS.filter((p) => p.status === "sent" || p.status === "viewed");
  const corr = PROOFS.filter((p) => p.status === "corrections");
  const soon = waiting.filter((p) => { const t = new Date(p.expiresAt).getTime() - now.getTime(); return t > 0 && t < 864e5; });
  const lapsed = PROOFS.filter((p) => p.status === "expired");
  add("proofs", "Client Proofs", "/orders?stage=client_review", [{ label: "Awaiting client", value: waiting.length }, { label: "Corrections", value: corr.length }, { label: "Expiring < 24h", value: soon.length }], [
    ...issue(corr.length, (n) => `${plural(n, "proof")} came back with corrections`, stageQ("client_review", "designing"), "warn"),
    ...issue(soon.length, (n) => `${plural(n, "proof link")} expire within 24 hours`, stageQ("client_review"), "warn"),
    ...issue(lapsed.length, (n) => `${plural(n, "proof link")} expired without an answer`, stageQ("client_review"), "info"),
  ]);

  // Printing
  const jobs = PJOBS.filter((j) => j.stage !== "Completed" && j.stage !== "Sent to QC");
  const exc = jobs.reduce((a, j) => a + j.exceptions.filter((e) => !e.resolved).length, 0);
  const vendorLate = jobs.filter((j) => j.vendor && j.vendor.status !== "Received" && j.vendor.expectedBack && j.vendor.expectedBack < today);
  const reprints = PJOBS.reduce((a, j) => a + (j.reprints || 0), 0);
  add("printing", "Printing", "/printing", [{ label: "Active jobs", value: jobs.length }, { label: "Open exceptions", value: exc }, { label: "Reprints", value: reprints }], [
    ...issue(vendorLate.length, (n) => `${plural(n, "vendor job")} not back by the expected date`, "/printing", "crit"),
    ...issue(exc, (n) => `${plural(n, "printing exception")} unresolved (blocks the next stage)`, "/printing", "warn"),
    ...issue(jobs.filter((j) => j.due && j.due < today).length, (n) => `${plural(n, "print job")} past due`, "/printing", "warn"),
  ]);

  // Quality control
  const inspecting = INSPECTIONS.filter((i) => i.status === "In Inspection"), openRework = RTASKS.filter((r) => r.status === "Open"), pendingAdmin = INSPECTIONS.filter((i) => i.pendingAdmin);
  add("qc", "Quality Control", "/qc", [{ label: "In inspection", value: inspecting.length }, { label: "Open rework", value: openRework.length }, { label: "Failed rounds", value: INSPECTIONS.filter((i) => i.status === "Failed").length }], [
    ...issue(pendingAdmin.length, (n) => `${plural(n, "QC result")} waiting for admin sign-off`, "/qc", "warn"),
    ...issue(openRework.length, (n) => `${plural(n, "rework task")} still open`, "/qc", "warn"),
  ]);

  // Delivery
  const ready = ORDERS.filter((o) => live(o) && o.stage === "ready_for_delivery");
  const blocked = ready.filter((o) => o.total - o.paid > 0);
  const stuck = DRECS.filter((d) => d.status === "Dispatched" && d.dispatchedAt && now.getTime() - new Date(d.dispatchedAt).getTime() > 3 * 864e5);
  add("delivery", "Delivery", "/delivery", [{ label: "Ready", value: ready.length }, { label: "Dispatched", value: DRECS.filter((d) => d.status === "Dispatched").length }, { label: "Blocked by dues", value: blocked.length }], [
    ...issue(blocked.length, (n) => `${plural(n, "ready order")} cannot ship until dues are cleared`, "/delivery", "warn"),
    ...issue(stuck.length, (n) => `${plural(n, "parcel")} dispatched over 3 days ago and not delivered`, "/delivery", "warn"),
  ]);

  // Payments & invoices
  const dues = ORDERS.reduce((a, o) => a + (o.hold === "Cancelled" ? 0 : Math.max(0, o.total - o.paid)), 0);
  const od = INVOICES.filter((i) => i.kind === "invoice" && invStatus(i) === "Overdue");
  const discountPending = INVOICES.filter((i) => i.approval === "pending");
  const collectedToday = PAYMENTS.filter((p) => p.date === today).reduce((a, p) => a + (p.kind === "refund" ? -p.amount : p.amount), 0);
  add("finance", "Payments & Invoices", "/payments", [{ label: "Pending dues", value: `₹${dues.toLocaleString("en-IN")}` }, { label: "Collected today", value: `₹${collectedToday.toLocaleString("en-IN")}` }, { label: "Overdue invoices", value: od.length }], [
    ...issue(od.length, (n) => `${plural(n, "invoice")} overdue`, "/invoices", "warn"),
    ...issue(discountPending.length, (n) => `${plural(n, "discount")} waiting for admin approval`, "/invoices", "warn"),
  ]);

  // Costing
  const unbilled = ORDERS.filter((o) => live(o) && ["printing", "qc", "ready_for_delivery"].includes(o.stage) && !o.costing?.finalized);
  add("costing", "Costing", "/orders", [{ label: "Finalized", value: ORDERS.filter((o) => o.costing?.finalized).length }, { label: "In progress", value: ORDERS.filter((o) => o.costing && !o.costing.finalized).length }, { label: "Unfinalized", value: unbilled.length }],
    issue(unbilled.length, (n) => `${plural(n, "order")} in printing or later without a finalized cost`, stageQ("printing", "qc", "ready_for_delivery"), "warn"));

  // Files
  const submitted = FILES.filter((f) => !f.archived && f.state === "Submitted"), rejected = FILES.filter((f) => !f.archived && f.state === "Rejected");
  add("files", "Files", "/files", [{ label: "Files", value: FILES.filter((f) => !f.archived).length }, { label: "Awaiting approval", value: submitted.length }, { label: "Print-locked", value: FILES.filter((f) => f.state === "Locked").length }], [
    ...issue(submitted.length, (n) => `${plural(n, "file")} waiting for approval`, "/files", "warn"),
    ...issue(rejected.length, (n) => `${plural(n, "file")} rejected`, "/files", "info"),
  ]);

  // Attendance
  const at = attendanceToday(), s = getSettings();
  const nowMin = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(":", ""));
  const lateWindow = !at.isOff && nowMin > Number(s.shiftStart.replace(":", "")) + s.graceMinutes;
  add("attendance", "Attendance", "/attendance", [{ label: "In now", value: `${at.inNow}/${at.total}` }, { label: "Late today", value: at.late }, { label: "On leave", value: at.onLeave }, { label: "Absent", value: at.absent }], [
    ...issue(at.pendingLeave, (n) => `${plural(n, "leave request")} waiting for a decision`, "/attendance", "warn"),
    ...issue(at.missed, (n) => `${plural(n, "employee")} missed a check-out`, "/attendance", "warn"),
    ...issue(lateWindow ? at.notIn : 0, (n) => `${plural(n, "employee")} not checked in after the grace period`, "/attendance", "info"),
    ...issue(at.absent, (n) => `${plural(n, "employee")} absent today`, "/attendance", "info"),
  ], at.isOff ? "Today is a weekly off or holiday." : undefined);

  // Users & access
  const weekAgo = now.getTime() - 7 * 864e5;
  const overrides = AUDIT.filter((a) => a.override && new Date(a.at).getTime() > weekAgo);
  add("access", "Users & Security", "/users", [{ label: "Active staff", value: employees().length }, { label: "Overrides (7 days)", value: overrides.length }], issue(overrides.length, (n) => `${plural(n, "admin override")} in the last 7 days`, "/audit", overrides.length > 5 ? "warn" : "info"));

  // Messaging
  const q = x.commQueued ?? 0;
  add("messaging", "Messaging", "/notifications", [{ label: "Queued, not sent", value: q }, { label: "Provider", value: x.commConnected ? "Connected" : "Not connected" }],
    x.backend ? issue(q, (n) => `${plural(n, "message")} queued but never sent (no WhatsApp/email/SMS provider connected)`, "/notifications", "warn") : [], x.backend ? undefined : "Demo mode: messages are not sent.");

  // System
  const errs = x.dbErrors ?? 0;
  add("system", "System", "/settings", [{ label: "Mode", value: x.backend ? "Database" : "Demo" }, { label: "Recent errors", value: errs }], issue(errs, (n) => `${plural(n, "background error")} in this session`, "/control", errs > 3 ? "crit" : "warn"));
  return cards;
}

export function overallScore(cards: ModuleCard[]): { score: number; label: string; tone: "green" | "amber" | "red"; crit: number; warn: number } {
  const all = cards.flatMap((c) => c.issues);
  const crit = all.filter((i) => i.severity === "crit").length, warn = all.filter((i) => i.severity === "warn").length;
  const score = Math.max(0, Math.min(100, 100 - crit * 12 - warn * 4));
  return { score, crit, warn, label: score >= 85 ? "Healthy" : score >= 60 ? "Needs attention" : "Critical", tone: score >= 85 ? "green" : score >= 60 ? "amber" : "red" };
}

export interface Alert extends Issue { module: string; moduleKey: string }
export function alertsOf(cards: ModuleCard[], max = 12): Alert[] {
  return cards.flatMap((c) => c.issues.map((i) => ({ ...i, module: c.label, moduleKey: c.key }))).filter((a) => a.severity !== "info").sort((a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count).slice(0, max);
}

/** Open work per person with the SLA trouble on it. */
export function workload(now = slaNow()) {
  const by = new Map<string, { name: string; open: number; overdue: number; risk: number; breached: number; urgent: number }>();
  for (const o of ORDERS) {
    if (!live(o) || o.stage === "delivered" || !o.assignee) continue;
    const w = by.get(o.assignee) ?? { name: o.assignee, open: 0, overdue: 0, risk: 0, breached: 0, urgent: 0 };
    const s = slaState(o, now);
    w.open++; if (!o.hold && o.due < iso(now)) w.overdue++; if (s.status === "at_risk") w.risk++; if (s.status === "breached") w.breached++; if (o.priority === "VIP" || o.priority === "Urgent") w.urgent++;
    by.set(o.assignee, w);
  }
  return [...by.values()].sort((a, b) => b.breached - a.breached || b.overdue - a.overdue || b.open - a.open);
}

/** Per-stage counts for the pipeline funnel. */
export const funnel = () => STAGES.map((s) => ({ key: s.key, label: s.label, tone: s.tone, n: ORDERS.filter((o) => live(o) && o.stage === s.key).length }));

/** The last `days` days (oldest first) of orders received, orders delivered and money collected. */
export function dailySeries(days = 14, now = slaNow()) {
  const keys = Array.from({ length: days }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - (days - 1 - i)); return iso(d); });
  const received = keys.map((k) => ORDERS.filter((o) => o.pendingAt.slice(0, 10) === k).length);
  const deliveredDay = (o: Order) => AUDIT.find((a) => a.entity === "order" && a.entityId === o.id && a.to === "Delivered")?.at.slice(0, 10);
  const delivered = keys.map((k) => ORDERS.filter((o) => o.stage === "delivered" && deliveredDay(o) === k).length);
  const collected = keys.map((k) => PAYMENTS.filter((p) => p.date === k).reduce((a, p) => a + (p.kind === "refund" ? -p.amount : p.amount), 0));
  return { keys, received, delivered, collected };
}
export const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

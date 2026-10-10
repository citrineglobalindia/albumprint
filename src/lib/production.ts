import { persistArray } from "./persist";
import { ORDERS, type Order, type StageKey } from "./data";
import { currentActor, logAudit } from "./audit";
import { FILES, addFile } from "./files";
import { moveStage, setHold, closeOrder, reopenOrder } from "./workflow";
import { notify } from "./store";
import type { RoleKey } from "./auth";

/* ───────────── shared helpers: permissions, settings, results ───────────── */
export type Out = { ok: boolean; msg: string };
export const ok = (msg: string): Out => ({ ok: true, msg });
export const no = (msg: string): Out => ({ ok: false, msg });

// SRS §21 permission matrix (work areas for the six pages in this module).
export type Area = "grading" | "printing" | "qc" | "delivery" | "receive" | "finance";
const MATRIX: Record<Area, RoleKey[]> = {
  grading: ["colour", "admin"], printing: ["printing", "admin"], qc: ["qc", "admin"], delivery: ["reception", "printing", "qc", "admin"],
  receive: ["accounts", "admin", "reception"], finance: ["accounts", "admin"],
};
export const can = (role: RoleKey | null | undefined, a: Area) => !!role && MATRIX[a].includes(role);
export const AREA_NAME: Record<Area, string> = { grading: "colour grading", printing: "printing", qc: "quality control", delivery: "delivery updates", receive: "payment receipt", finance: "finance" };
export const denied = (role: RoleKey | null | undefined, a: Area) => no(`Your role (${role ?? "guest"}) cannot perform ${AREA_NAME[a]} actions`);

export function appSettings(): Record<string, unknown> { try { return JSON.parse(localStorage.getItem("albumpro.settings") ?? "{}") as Record<string, unknown>; } catch { return {}; } }
export const allowDeliveryWithoutPayment = () => { const v = appSettings().deliveryNoPay; return v === true || v === "true"; };
export const discountLimit = () => { const n = Number(appSettings().disc_limit); return Number.isFinite(n) && appSettings().disc_limit !== undefined && appSettings().disc_limit !== "" ? n : 10; };

export const nowIso = () => new Date().toISOString();
export const fmtDT = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const who = () => currentActor();
const ord = (id: string) => ORDERS.find((o) => o.id === id);
const num = (id: string) => Number(id.replace(/\D/g, "")) || 0;
const ago = (hours: number) => new Date(Date.now() - hours * 3600e3).toISOString();

function gate(orderId: string, area: Area): { o: Order } | Out {
  const { role } = who();
  const o = ord(orderId);
  if (!o) return no("Order not found");
  if (!can(role === "system" ? null : (role as RoleKey), area)) return denied(role as RoleKey, area);
  if (o.closed) return no(`${o.id} is closed and read-only — reopen it first`);
  return { o };
}
const isOut = (x: { o: Order } | Out): x is Out => "msg" in x;

/* ───────────────────────── §8 Colour grading ───────────────────────── */
export type GStatus = "New" | "In Progress" | "Submitted" | "Rework" | "Approved";
export interface GEvent { at: string; by: string; text: string }
export interface GJob {
  orderId: string; colorist: string; priority: string; due: string; status: GStatus; instructions: string; internalNote: string; draft?: string;
  revision?: string; revisionAck?: boolean; rounds: number; events: GEvent[]; startedAt?: string; submittedAt?: string;
}
export const GJOBS: GJob[] = persistArray<GJob>("grading_jobs", []);
export const COLORISTS = ["Karthik V", "Suresh", "Ramesh", "Divya", "Manoj", "Anil"];
const gev = (g: GJob, text: string) => { g.events.unshift({ at: nowIso(), by: who().name, text }); };

export function ensureGradingJobs() {
  let changed = false;
  ORDERS.forEach((o, i) => {
    if (o.workflow === "Printing" || GJOBS.some((g) => g.orderId === o.id)) return;
    const idx = ["colour_grading", "admin_approval", "designing", "client_review", "final_approval", "printing", "qc", "ready_for_delivery", "delivered"].indexOf(o.stage);
    if (idx < 0) return;
    const status: GStatus = idx === 0 ? "New" : idx === 1 ? "Submitted" : "Approved";
    const g: GJob = {
      orderId: o.id, colorist: COLORISTS[i % COLORISTS.length]!, priority: o.priority, due: o.due, status, rounds: status === "New" ? 0 : 1,
      instructions: i === 0 ? "Client requested warm & natural tones. Keep skin tones natural. Deliver both colour and B&W versions." : "Standard grading, keep skin tones natural.",
      internalNote: "", events: [{ at: ago(30 + i), by: "System", text: "Grading job created" }],
    };
    if (status !== "New") {
      g.events.unshift({ at: ago(20 + i), by: g.colorist, text: "Submitted for Admin approval" });
      FILES.push({ id: `Fs${o.id}`, orderId: o.id, category: "Graded", name: `${o.id}-graded.zip`, ext: "zip", size: 240 * 1024 ** 2, version: 1, state: status === "Approved" ? "Approved" : "Submitted", by: g.colorist, at: ago(20 + i) });
    }
    GJOBS.push(g); changed = true;
  });
  if (changed) notify();
}
export const gradedFiles = (orderId: string) => FILES.filter((f) => f.orderId === orderId && f.category === "Graded" && !f.archived);
export const gjob = (orderId: string) => GJOBS.find((g) => g.orderId === orderId);

export function createGradingJob(orderId: string, d: { colorist: string; priority: string; due: string; instructions: string }): Out {
  const { role } = who();
  if (role !== "admin") return no("Only an admin can create grading jobs");
  const o = ord(orderId); if (!o) return no("Order not found");
  if (o.workflow === "Printing") return no("Printing Only orders skip colour grading");
  if (o.stage !== "files_received") { if (o.stage !== "colour_grading") return no(`${o.id} must be at Files Received to start grading`); }
  else { const r = moveStage(orderId, "colour_grading"); if (!r.ok) return no(r.error); }
  const ex = gjob(orderId);
  if (ex) { Object.assign(ex, { colorist: d.colorist, priority: d.priority, due: d.due, instructions: d.instructions || ex.instructions, status: "New" as GStatus }); gev(ex, "Grading job re-opened"); }
  else GJOBS.unshift({ orderId, colorist: d.colorist, priority: d.priority, due: d.due, status: "New", instructions: d.instructions || "Standard grading, keep skin tones natural.", internalNote: "", rounds: 0, events: [{ at: nowIso(), by: who().name, text: `Job created and assigned to ${d.colorist}` }] });
  logAudit({ entity: "grading", entityId: orderId, action: "create", detail: `assigned to ${d.colorist}` });
  notify(); return ok(`Job ${orderId} added to ${d.colorist}'s queue`);
}
export function startGrading(orderId: string): Out {
  const g = gate(orderId, "grading"); if (isOut(g)) return g;
  const j = gjob(orderId); if (!j) return no("No grading job for this order");
  if (j.status !== "New") return no("Grading has already started");
  if (g.o.stage !== "colour_grading") return no("Order is not at the Colour Grading stage");
  if (g.o.hold) return no(`${orderId} is ${g.o.hold.toLowerCase()}`);
  j.status = "In Progress"; j.startedAt = nowIso(); gev(j, "Grading started");
  logAudit({ entity: "grading", entityId: orderId, action: "start" }); notify(); return ok(`Grading started on ${orderId}`);
}
export function saveDraft(orderId: string, draft: string, internalNote: string): Out {
  const g = gate(orderId, "grading"); if (isOut(g)) return g;
  const j = gjob(orderId); if (!j) return no("No grading job for this order");
  if (!["In Progress", "Rework"].includes(j.status)) return no("Start grading before saving a draft");
  j.draft = draft; j.internalNote = internalNote; gev(j, "Draft saved");
  logAudit({ entity: "grading", entityId: orderId, action: "save_draft" }); notify(); return ok("Draft saved");
}
export function uploadGraded(orderId: string, name: string, size: number): Out {
  const g = gate(orderId, "grading"); if (isOut(g)) return g;
  const j = gjob(orderId); if (!j) return no("No grading job for this order");
  if (j.status !== "In Progress") return no(j.status === "Rework" ? "Acknowledge the revision request before uploading" : "Start grading before uploading graded files");
  if (!/\.(jpe?g|tiff?|zip)$/i.test(name)) return no(`${name} — only JPG, TIFF or ZIP allowed`);
  const r = addFile(orderId, "Graded", name, size); if (!r.ok) return no(r.error);
  gev(j, `Uploaded ${name} (v${r.file.version})`); notify(); return ok(`${name} uploaded as v${r.file.version}`);
}
export function submitGrading(orderId: string): Out {
  const g = gate(orderId, "grading"); if (isOut(g)) return g;
  const j = gjob(orderId); if (!j) return no("No grading job for this order");
  if (j.status !== "In Progress") return no(j.status === "Rework" ? "Acknowledge the revision before resubmitting" : "Only jobs in progress can be submitted");
  if (!gradedFiles(orderId).length) return no("Upload at least one graded file before submitting");
  const r = moveStage(orderId, "admin_approval"); if (!r.ok) return no(r.error);
  const resub = j.rounds > 0;
  j.status = "Submitted"; j.rounds += 1; j.submittedAt = nowIso(); j.revision = undefined; j.revisionAck = undefined;
  gradedFiles(orderId).forEach((f) => { if (f.state !== "Approved" && f.state !== "Locked") f.state = "Submitted"; });
  gev(j, resub ? `Resubmitted for Admin approval (round ${j.rounds})` : "Submitted for Admin approval");
  logAudit({ entity: "grading", entityId: orderId, action: resub ? "resubmit" : "submit" }); notify();
  return ok(`${orderId} ${resub ? "resubmitted" : "submitted"} to Admin`);
}
export function approveGrading(orderId: string): Out {
  const { role } = who();
  if (role !== "admin") return no("Only an admin can approve grading — graders cannot approve their own work");
  const o = ord(orderId); const j = gjob(orderId); if (!o || !j) return no("No grading job for this order");
  if (j.status !== "Submitted") return no("Only submitted jobs can be approved");
  const r = moveStage(orderId, "designing"); if (!r.ok) return no(r.error);
  j.status = "Approved"; gradedFiles(orderId).forEach((f) => { if (f.state === "Submitted") f.state = "Approved"; });
  gev(j, "Approved by admin"); logAudit({ entity: "grading", entityId: orderId, action: "approve" }); notify();
  return ok(`${orderId} approved — moved to Designing`);
}
export function rejectGrading(orderId: string, reason: string): Out {
  const { role } = who();
  if (role !== "admin") return no("Only an admin can reject grading");
  const j = gjob(orderId); if (!j) return no("No grading job for this order");
  if (j.status !== "Submitted") return no("Only submitted jobs can be rejected");
  if (!reason.trim()) return no("A rejection reason is required");
  const r = moveStage(orderId, "colour_grading", { reason }); if (!r.ok) return no(r.error);
  j.status = "Rework"; j.revision = reason.trim(); j.revisionAck = false; gradedFiles(orderId).forEach((f) => { if (f.state === "Submitted") f.state = "Rejected"; });
  gev(j, `Rejected: ${reason.trim()}`); logAudit({ entity: "grading", entityId: orderId, action: "reject", reason: reason.trim() }); notify();
  return ok(`${orderId} sent back to colour grading`);
}
export function ackRevision(orderId: string): Out {
  const g = gate(orderId, "grading"); if (isOut(g)) return g;
  const j = gjob(orderId); if (!j || j.status !== "Rework") return no("No revision request to acknowledge");
  j.status = "In Progress"; j.revisionAck = true; gev(j, "Revision acknowledged");
  logAudit({ entity: "grading", entityId: orderId, action: "ack_revision" }); notify(); return ok("Revision acknowledged — upload a new version and resubmit");
}

/* ───────────────────────── §12 Printing production ───────────────────────── */
export const PSTAGES = ["Waiting", "File Prep", "Printing", "Finishing", "Assembly", "Packaging", "Completed", "Sent to QC"] as const;
export type PStage = (typeof PSTAGES)[number];
export const EXC_KINDS = ["Machine fault", "Material shortage", "File issue", "Customer hold"] as const;
export type ExcKind = (typeof EXC_KINDS)[number] | "Delay" | "Reprint";
export interface PExc { id: string; kind: ExcKind; note: string; at: string; by: string; resolved?: boolean; resolvedAt?: string }
export interface Vendor { name: string; sentDate: string; expectedBack: string; tracking: string; cost: number; status: "Planned" | "Sent" | "In progress" | "Received" }
export interface PJob {
  id: string; orderId: string; stage: PStage; paper: string; sheets: number; copies: number; operator: string; due: string;
  history: Partial<Record<PStage, { at: string; by: string }>>; exceptions: PExc[]; vendor?: Vendor; reprints: number;
  cover?: string; lamination?: string; box?: string; finishing?: string; events: GEvent[];
}
export const PJOBS: PJob[] = persistArray<PJob>("production_jobs", []);
export const PAPERS = ["Sapphire Matte", "Lustre", "Matte", "Silk", "Glossy"];
export const OPERATORS = ["Manjunath P", "Suresh", "Ramesh", "Divya", "Manoj", "Anil"];
const pev = (j: PJob, text: string) => { j.events.unshift({ at: nowIso(), by: who().name, text }); };

function newJob(o: Order, stage: PStage, i: number): PJob {
  const si = PSTAGES.indexOf(stage); const op = OPERATORS[i % OPERATORS.length]!;
  const history: PJob["history"] = {};
  for (let k = 0; k <= si; k++) history[PSTAGES[k]!] = { at: ago((si - k) * 5 + 2 + (i % 7)), by: op };
  return { id: o.id, orderId: o.id, stage, paper: PAPERS[i % PAPERS.length]!, sheets: o.pages, copies: 1 + (i % 3), operator: op, due: o.due, history, exceptions: [], reprints: 0, events: [{ at: ago(si * 5 + 3), by: "System", text: "Production job created" }] };
}
export function ensureProduction() {
  let changed = false;
  ORDERS.forEach((o, i) => {
    if (!["printing", "qc", "ready_for_delivery", "delivered"].includes(o.stage) || PJOBS.some((j) => j.orderId === o.id)) return;
    PJOBS.push(newJob(o, o.stage === "printing" ? PSTAGES[num(o.id) % 7]! : "Sent to QC", i)); changed = true;
  });
  if (changed) notify();
}
export const pjobOf = (orderId: string) => PJOBS.find((j) => j.orderId === orderId);
export const openExc = (j: PJob) => j.exceptions.filter((e) => !e.resolved && e.kind !== "Delay");

/** §12.1 release gate: only orders at Final Approval (admin) or already in Printing get a production job. */
export function releaseToPrinting(orderId: string, d: { paper: string; sheets: number; copies: number; operator: string; due: string }): Out {
  const { role } = who();
  const o = ord(orderId); if (!o) return no("Order not found");
  if (o.stage !== "final_approval" && o.stage !== "printing") return no("Only orders at Final Approval or Printing can be released to printing");
  if (!can(role === "system" ? null : (role as RoleKey), "printing")) return denied(role as RoleKey, "printing");
  if (o.stage === "final_approval") {
    if (role !== "admin") return no("Only an admin can release an order from Final Approval to printing");
    const r = moveStage(orderId, "printing"); if (!r.ok) return no(r.error);
  }
  if (pjobOf(orderId)) return no(`${orderId} already has a production job`);
  const j = newJob(o, "Waiting", 0); Object.assign(j, { paper: d.paper, sheets: d.sheets, copies: d.copies, operator: d.operator, due: d.due });
  j.history = { Waiting: { at: nowIso(), by: who().name } }; j.events = [{ at: nowIso(), by: who().name, text: "Released to printing" }];
  PJOBS.unshift(j); logAudit({ entity: "production", entityId: orderId, action: "release" }); notify();
  return ok(`${orderId} released to printing`);
}
export function advanceProduction(orderId: string, to?: PStage): Out {
  const g = gate(orderId, "printing"); if (isOut(g)) return g;
  const j = pjobOf(orderId); if (!j) return no("No production job for this order");
  const i = PSTAGES.indexOf(j.stage); const target = to ?? PSTAGES[i + 1];
  if (!target || j.stage === "Sent to QC") return no("Already at the last stage");
  if (PSTAGES.indexOf(target) !== i + 1) return no("Production stages must be completed in order");
  if (g.o.hold) return no(`${orderId} is ${g.o.hold.toLowerCase()} — resolve the hold first`);
  const blocking = openExc(j); if (blocking.length) return no(`Resolve the open exception first: ${blocking[0]!.kind}`);
  if (j.vendor && j.vendor.status !== "Received" && j.vendor.status !== "Planned" && target !== "Printing" && PSTAGES.indexOf(target) > 2) return no("Vendor job is not back yet — mark it received first");
  if (target === "Sent to QC") {
    if (g.o.stage === "printing") { const r = moveStage(orderId, "qc"); if (!r.ok) return no(r.error); }
    else if (g.o.stage !== "qc") return no(`${orderId} is at ${g.o.stage.replace(/_/g, " ")}, not Printing`);
  }
  j.stage = target; j.history[target] = { at: nowIso(), by: j.operator || who().name }; pev(j, `Moved to ${target}`);
  logAudit({ entity: "production", entityId: orderId, action: "stage", from: PSTAGES[i], to: target }); notify();
  return ok(target === "Sent to QC" ? `${orderId} sent to QC — order moved to QC stage` : `${orderId} moved to ${target}`);
}
export function setOperator(orderId: string, op: string): Out {
  const g = gate(orderId, "printing"); if (isOut(g)) return g;
  const j = pjobOf(orderId); if (!j) return no("No production job");
  j.operator = op; pev(j, `Operator set to ${op}`); notify(); return ok(`Assigned to ${op}`);
}
export function raiseException(orderId: string, kind: ExcKind, note: string): Out {
  const g = gate(orderId, "printing"); if (isOut(g)) return g;
  const j = pjobOf(orderId); if (!j) return no("No production job");
  if (!note.trim()) return no("Describe the exception");
  if (kind === "Reprint") {
    if (j.stage === "Waiting" || j.stage === "File Prep") return no("Nothing to reprint yet");
    if (g.o.stage !== "printing") return no("Reprints are only possible while the order is in Printing");
    j.reprints += 1; j.stage = "Printing"; j.history.Printing = { at: nowIso(), by: j.operator }; (["Finishing", "Assembly", "Packaging", "Completed", "Sent to QC"] as PStage[]).forEach((s) => { delete j.history[s]; });
  }
  if (kind === "Customer hold") { const r = setHold(orderId, true, note); if (!r.ok) return no(r.error); }
  j.exceptions.unshift({ id: `X${Date.now().toString(36)}`, kind, note: note.trim(), at: nowIso(), by: who().name, resolved: kind === "Reprint" || undefined, resolvedAt: kind === "Reprint" ? nowIso() : undefined });
  pev(j, `${kind}: ${note.trim()}`); logAudit({ entity: "production", entityId: orderId, action: `exception_${kind.toLowerCase().replace(/ /g, "_")}`, reason: note.trim() }); notify();
  return ok(kind === "Reprint" ? `Reprint #${j.reprints} started for ${orderId}` : `${kind} raised on ${orderId}`);
}
export function resolveException(orderId: string, id: string): Out {
  const g = gate(orderId, "printing"); if (isOut(g)) return g;
  const j = pjobOf(orderId); const e = j?.exceptions.find((x) => x.id === id); if (!j || !e) return no("Exception not found");
  if (e.kind === "Customer hold" && g.o.hold === "On Hold") { const r = setHold(orderId, false); if (!r.ok) return no(r.error); }
  e.resolved = true; e.resolvedAt = nowIso(); pev(j, `Resolved ${e.kind}`); logAudit({ entity: "production", entityId: orderId, action: "exception_resolved", detail: e.kind }); notify();
  return ok(`${e.kind} resolved`);
}
export function saveVendor(orderId: string, v: Vendor): Out {
  const g = gate(orderId, "printing"); if (isOut(g)) return g;
  const j = pjobOf(orderId); if (!j) return no("No production job");
  if (!v.name.trim()) return no("Vendor name is required");
  if (!v.sentDate || !v.expectedBack) return no("Sent date and expected-back date are required");
  if (v.expectedBack < v.sentDate) return no("Expected back cannot be before the sent date");
  if (!(v.cost >= 0)) return no("Enter a valid cost");
  j.vendor = { ...v }; pev(j, `Outsourced to ${v.name} (${v.status})`); logAudit({ entity: "production", entityId: orderId, action: "vendor", detail: `${v.name} · ${v.status} · ₹${v.cost}` }); notify();
  return ok(`Vendor job saved (${v.status})`);
}
export function setSpecs(orderId: string, p: Partial<PJob>): Out {
  const g = gate(orderId, "printing"); if (isOut(g)) return g;
  const j = pjobOf(orderId); if (!j) return no("No production job"); Object.assign(j, p); pev(j, "Specifications updated"); notify(); return ok("Print specifications updated");
}

/* ───────────────────────── §13 Quality control ───────────────────────── */
export const CHECKS = [
  { k: "print", t: "Print quality", d: "Sharpness, no banding" }, { k: "colour", t: "Colour accuracy", d: "Matches approved proof" },
  { k: "align", t: "Alignment & trim", d: "Margins, spreads, page trim" }, { k: "binding", t: "Binding", d: "Lay-flat, glue, spine" },
  { k: "cover", t: "Cover & finish", d: "Lamination, foil, scratches" }, { k: "spec", t: "Specification match", d: "Size, pages, paper vs order" }, { k: "pack", t: "Packaging", d: "Box, protection, labels" },
] as const;
export const DEFECTS = ["Colour", "Scratch", "Alignment", "Binding", "Print", "Damage", "Wrong spec"] as const;
export type Mark = "pass" | "fail" | "na" | "";
export type ReturnDept = "Printing" | "Designing" | "Colour Grading";
export interface Inspection {
  id: string; orderId: string; round: number; status: "In Inspection" | "Passed" | "Failed" | "Rework"; marks: Record<string, Mark>; notes: string; defects: string[];
  inspector: string; startedAt: string; decidedAt?: string; returnTo?: ReturnDept; reason?: string; evidence: string[]; pendingAdmin?: boolean;
}
export const INSPECTIONS: Inspection[] = persistArray<Inspection>("inspections", []);
export interface ReworkTask { id: string; orderId: string; dept: ReturnDept; reason: string; defects: string[]; at: string; by: string; status: "Open" | "Done"; doneBy?: string }
export const RTASKS: ReworkTask[] = persistArray<ReworkTask>("rework_tasks", []);
export const blankMarks = (): Record<string, Mark> => Object.fromEntries(CHECKS.map((c) => [c.k, "" as Mark]));
export const inspectionsOf = (orderId: string) => INSPECTIONS.filter((i) => i.orderId === orderId).sort((a, b) => b.round - a.round);
export const openInspection = (orderId: string) => INSPECTIONS.find((i) => i.orderId === orderId && i.status === "In Inspection");
export const roundsOf = (orderId: string) => INSPECTIONS.filter((i) => i.orderId === orderId).length;

export function startInspection(orderId: string): Out {
  const g = gate(orderId, "qc"); if (isOut(g)) return g;
  if (g.o.stage !== "qc") return no("Only orders at the QC stage can be inspected");
  if (g.o.hold) return no(`${orderId} is ${g.o.hold.toLowerCase()}`);
  if (openInspection(orderId)) return no("An inspection is already open");
  if (RTASKS.some((t) => t.orderId === orderId && t.status === "Open")) return no("A rework task is waiting for admin — inspection resumes after the return");
  INSPECTIONS.unshift({ id: `QI${Date.now().toString(36)}`, orderId, round: roundsOf(orderId) + 1, status: "In Inspection", marks: blankMarks(), notes: "", defects: [], inspector: who().name, startedAt: nowIso(), evidence: [] });
  g.o.qc = "in_progress"; logAudit({ entity: "qc", entityId: orderId, action: "start", detail: `round ${roundsOf(orderId)}` }); notify();
  return ok(`Inspection round ${roundsOf(orderId)} started for ${orderId}`);
}
export function updateInspection(orderId: string, p: Partial<Pick<Inspection, "marks" | "notes" | "defects">>): Out {
  const g = gate(orderId, "qc"); if (isOut(g)) return g;
  const i = openInspection(orderId); if (!i) return no("Start an inspection first");
  Object.assign(i, p); notify(); return ok("Saved");
}
export function addEvidence(orderId: string, name: string, size: number): Out {
  const g = gate(orderId, "qc"); if (isOut(g)) return g;
  const i = openInspection(orderId); if (!i) return no("Start an inspection first");
  const r = addFile(orderId, "QC Evidence", name, size); if (!r.ok) return no(r.error);
  i.evidence.push(name); notify(); return ok(`Evidence ${name} attached`);
}
const toStage: Record<ReturnDept, StageKey> = { Printing: "printing", Designing: "designing", "Colour Grading": "colour_grading" };

export function decideInspection(orderId: string, d: { outcome: "pass" | "rework" | "fail"; returnTo?: ReturnDept; reason?: string; defects?: string[] }): Out {
  const g = gate(orderId, "qc"); if (isOut(g)) return g;
  const o = g.o; const i = openInspection(orderId); const { role } = who();
  if (!i) return no("Start an inspection first");
  if (o.stage !== "qc") return no("Order is not at the QC stage");
  if (d.outcome === "pass") {
    if (Object.values(i.marks).some((m) => m === "fail")) return no("A checklist item is marked Fail — choose Rework / Fail instead");
    if (Object.values(i.marks).some((m) => m === "")) return no("Complete every checklist item before passing");
    const prev = o.qc; o.qc = "passed";
    const r = moveStage(orderId, "ready_for_delivery"); if (!r.ok) { o.qc = prev; return no(r.error); }
    o.qc = "passed"; i.status = "Passed"; i.decidedAt = nowIso();
    logAudit({ entity: "qc", entityId: orderId, action: "pass", detail: `round ${i.round}` }); notify(); return ok(`${orderId} passed QC — Ready for Delivery`);
  }
  const defects = d.defects ?? i.defects; const reason = (d.reason ?? "").trim(); const dept = d.returnTo;
  if (!dept) return no("Choose the department to return the order to");
  if (!reason) return no("A reason is required");
  if (!defects.length) return no("Select at least one defect code");
  if (dept !== "Printing" && o.workflow === "Printing") return no("Printing Only orders have no design or grading stage — return to Printing");
  i.defects = defects; i.reason = reason; i.returnTo = dept; i.decidedAt = nowIso(); i.status = d.outcome === "fail" ? "Failed" : "Rework";
  const verdict: Order["qc"] = d.outcome === "fail" ? "failed" : "rework";
  if (dept === "Printing") {
    const r = moveStage(orderId, "printing", { reason }); if (!r.ok) { i.status = "In Inspection"; i.decidedAt = undefined; return no(r.error); }
    o.qc = verdict; reopenProduction(orderId, `QC ${i.status.toLowerCase()} (round ${i.round}): ${reason}`);
  } else if (role === "admin") {
    const r = moveStage(orderId, toStage[dept], { reason, override: true }); if (!r.ok) { i.status = "In Inspection"; i.decidedAt = undefined; return no(r.error); }
    o.qc = verdict; if (dept === "Colour Grading") { const j = gjob(orderId); if (j) { j.status = "Rework"; j.revision = reason; j.revisionAck = false; } }
  } else {
    o.qc = verdict; i.pendingAdmin = true;
    RTASKS.unshift({ id: `RT${Date.now().toString(36)}`, orderId, dept, reason, defects, at: nowIso(), by: who().name, status: "Open" });
    logAudit({ entity: "qc", entityId: orderId, action: "rework_task", detail: `${dept}: ${reason}` }); notify();
    return ok(`Recorded — a rework task for admin was created (return to ${dept} needs an admin override)`);
  }
  logAudit({ entity: "qc", entityId: orderId, action: d.outcome, detail: `round ${i.round} → ${dept}; ${defects.join(", ")}`, reason }); notify();
  return ok(`${orderId} ${d.outcome === "fail" ? "failed QC" : "sent to rework"} — returned to ${dept}`);
}
function reopenProduction(orderId: string, why: string) {
  const j = pjobOf(orderId); if (!j) return;
  j.reprints += 1; j.stage = "Printing"; j.history.Printing = { at: nowIso(), by: j.operator };
  (["Finishing", "Assembly", "Packaging", "Completed", "Sent to QC"] as PStage[]).forEach((s) => { delete j.history[s]; });
  j.exceptions.unshift({ id: `X${Date.now().toString(36)}`, kind: "Reprint", note: why, at: nowIso(), by: who().name, resolved: true, resolvedAt: nowIso() }); pev(j, `Returned from QC: ${why}`);
}
export function executeReworkTask(id: string): Out {
  const { role } = who(); if (role !== "admin") return no("Only an admin can execute a return to design or grading");
  const t = RTASKS.find((x) => x.id === id); if (!t || t.status !== "Open") return no("Task not found");
  const o = ord(t.orderId); if (!o) return no("Order not found");
  const r = moveStage(t.orderId, toStage[t.dept], { reason: t.reason, override: true }); if (!r.ok) return no(r.error);
  if (t.dept === "Printing") reopenProduction(t.orderId, t.reason);
  if (t.dept === "Colour Grading") { const j = gjob(t.orderId); if (j) { j.status = "Rework"; j.revision = t.reason; j.revisionAck = false; } }
  o.qc = o.qc === "failed" ? "failed" : "rework"; t.status = "Done"; t.doneBy = who().name;
  INSPECTIONS.filter((i) => i.orderId === t.orderId && i.pendingAdmin).forEach((i) => { i.pendingAdmin = false; });
  logAudit({ entity: "qc", entityId: t.orderId, action: "rework_executed", detail: t.dept, reason: t.reason, override: true }); notify();
  return ok(`${t.orderId} returned to ${t.dept}`);
}

/* ───────────────────────── §14 Delivery & closure ───────────────────────── */
export const DMODES = ["Pickup", "Company delivery", "Courier", "Third-party"] as const;
export type DMode = (typeof DMODES)[number];
export interface DRec {
  orderId: string; mode: DMode; carrier: string; tracking: string; contact: string; address: string; status: "Ready" | "Dispatched" | "Delivered";
  dispatchedAt?: string; deliveredAt?: string; receivedBy?: string; pod?: string; podNote?: string; overrideReason?: string; events: GEvent[];
}
export const DRECS: DRec[] = persistArray<DRec>("deliveries", []);
export const drec = (orderId: string) => DRECS.find((d) => d.orderId === orderId);
export const balanceOf = (o: Order) => Math.max(0, o.total - o.paid);
export function ensureDeliveries() {
  let changed = false;
  ORDERS.forEach((o, i) => {
    if (!["ready_for_delivery", "delivered"].includes(o.stage) || drec(o.id)) return;
    const done = o.stage === "delivered";
    DRECS.push({ orderId: o.id, mode: DMODES[i % 4]!, carrier: "", tracking: "", contact: `${o.customer} · ${o.mobile}`, address: "", status: done ? "Delivered" : "Ready", events: [{ at: ago(10 + i), by: "System", text: done ? "Delivered (migrated record)" : "Ready for delivery" }],
      ...(done ? { dispatchedAt: ago(30), deliveredAt: ago(24), receivedBy: o.customer, pod: "handover-note.pdf" } : {}) });
    changed = true;
  });
  if (changed) notify();
}
const dev = (d: DRec, text: string) => { d.events.unshift({ at: nowIso(), by: who().name, text }); };
export function saveDelivery(orderId: string, p: Partial<Pick<DRec, "mode" | "carrier" | "tracking" | "contact" | "address">>): Out {
  const g = gate(orderId, "delivery"); if (isOut(g)) return g;
  const d = drec(orderId); if (!d) return no("No delivery record");
  if (d.status === "Delivered") return no("Delivery is already complete");
  Object.assign(d, p); dev(d, "Delivery details updated"); logAudit({ entity: "delivery", entityId: orderId, action: "update", detail: `${d.mode}${d.tracking ? ` · ${d.tracking}` : ""}` }); notify(); return ok("Delivery details saved");
}
export function dispatchDelivery(orderId: string, override?: string): Out {
  const g = gate(orderId, "delivery"); if (isOut(g)) return g;
  const d = drec(orderId); if (!d) return no("No delivery record");
  const o = g.o;
  if (o.stage !== "ready_for_delivery") return no("Only orders that are Ready for Delivery can be dispatched");
  if (d.status !== "Ready") return no("Already dispatched");
  if (o.hold) return no(`${orderId} is ${o.hold.toLowerCase()}`);
  if ((d.mode === "Courier" || d.mode === "Third-party") && !d.carrier.trim()) return no("Enter the courier / carrier name");
  if ((d.mode === "Courier" || d.mode === "Third-party") && !d.tracking.trim()) return no("Enter the tracking number");
  const dues = balanceOf(o);
  if (dues > 0 && !allowDeliveryWithoutPayment()) {
    if (who().role !== "admin") return no(`Dispatch blocked — ₹${dues.toLocaleString("en-IN")} is outstanding. Collect payment or ask an admin to override.`);
    if (!override?.trim()) return no("Dues are outstanding — enter an override reason to dispatch");
    d.overrideReason = override.trim(); logAudit({ entity: "delivery", entityId: orderId, action: "dispatch_override", reason: override.trim(), override: true });
  }
  d.status = "Dispatched"; d.dispatchedAt = nowIso(); dev(d, `Dispatched via ${d.mode}${d.carrier ? ` (${d.carrier})` : ""}`);
  logAudit({ entity: "delivery", entityId: orderId, action: "dispatch", detail: d.mode }); notify(); return ok(`${orderId} dispatched`);
}
export function markDelivered(orderId: string, p: { receivedBy: string; pod: string; podNote?: string }): Out {
  const g = gate(orderId, "delivery"); if (isOut(g)) return g;
  const d = drec(orderId); if (!d) return no("No delivery record");
  if (d.status !== "Dispatched") return no("Dispatch the order first");
  if (!p.receivedBy.trim()) return no("Enter who received the album");
  if (!p.pod.trim()) return no("Proof of delivery is required (signature or photo)");
  const r = moveStage(orderId, "delivered"); if (!r.ok) return no(r.error);
  d.status = "Delivered"; d.deliveredAt = nowIso(); d.receivedBy = p.receivedBy.trim(); d.pod = p.pod; d.podNote = p.podNote; dev(d, `Delivered — received by ${d.receivedBy}`);
  logAudit({ entity: "delivery", entityId: orderId, action: "delivered", detail: `received by ${d.receivedBy}` }); notify(); return ok(`${orderId} delivered`);
}
export function closeWithChecks(orderId: string, override?: string): Out {
  const { role } = who(); if (role !== "admin") return no("Only an admin can close an order");
  const r = closeOrder(orderId, { override: !!override?.trim(), reason: override }); return r.ok ? ok(`${orderId} closed`) : no(r.error);
}
export function reopen(orderId: string, reason: string): Out { const r = reopenOrder(orderId, reason); return r.ok ? ok(`${orderId} reopened`) : no(r.error); }

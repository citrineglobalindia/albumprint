import { ORDERS } from "../data";
import { notify } from "../store";
import { currentActor } from "../audit";
import { GJOBS, PJOBS, INSPECTIONS, RTASKS, DRECS, COLORISTS, OPERATORS, PSTAGES, PAPERS, DMODES, can, blankMarks,
  type GJob, type GStatus, type GEvent, type PJob, type PStage, type PExc, type ExcKind, type Vendor, type Inspection, type ReworkTask, type ReturnDept, type DRec, type DMode } from "../production";
import { backendOn, sb, q, registerHydrator, reportDbError } from "./core";

// Colour grading, printing, QC and delivery ⇄ tasks, print_*, qc_inspections, rework_tasks, deliveries, production_events.
// The UI changes the shared arrays first (optimistic) and calls the db* functions here; writes run one after another so they reach
// the database in the order they were made, and a refusal (rule or row-level security) reverts the local change and shows a toast.
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Res = { error: { message: string } | null };

/* ───────── staff directory (names ⇄ profile ids) ───────── */
let STAFF: { id: string; name: string; role: string }[] = [];
export const staffName = (id?: string | null) => (id ? STAFF.find((s) => s.id === id)?.name : undefined);
export const staffId = (name?: string) => (name ? STAFF.find((s) => s.name === name)?.id : undefined);

/* ───────── label ⇄ database value ───────── */
const slug = (s: string) => s.toLowerCase().replace(/[ -]+/g, "_");
const GSTAT: Record<string, GStatus> = { pending: "New", not_required: "New", in_progress: "In Progress", submitted: "Submitted", revision: "Rework", approved: "Approved" };
const GSTAT_DB: Record<GStatus, string> = { New: "pending", "In Progress": "in_progress", Submitted: "submitted", Rework: "revision", Approved: "approved" };
export const gstatusToDb = (s: GStatus) => GSTAT_DB[s];
const PRI: Record<string, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent", vip: "VIP" };
const priDb = (p: string) => p.toLowerCase();
// built lazily: ../production and this module import each other, so its constants are not ready at load time
const pstageOf = (db: string): PStage | undefined => PSTAGES.find((s) => slug(s) === db);
export const pstageToDb = (s: PStage) => slug(s);
const EXC: Record<string, ExcKind> = { machine_fault: "Machine fault", material_shortage: "Material shortage", file_issue: "File issue", customer_hold: "Customer hold", delay: "Delay", reprint: "Reprint" };
const excDb = (k: ExcKind) => slug(k);
const VSTAT: Record<string, Vendor["status"]> = { planned: "Planned", sent: "Sent", in_progress: "In progress", received: "Received" };
const vstatDb = (s: Vendor["status"]) => slug(s);
const QSTAT: Record<string, Inspection["status"]> = { pending: "In Inspection", in_progress: "In Inspection", passed: "Passed", failed: "Failed", rework: "Rework", recheck: "Rework" };
const DEPT: Record<string, ReturnDept> = { printing: "Printing", designing: "Designing", colour_grading: "Colour Grading" };
export const deptDb = (d: ReturnDept) => slug(d);
const DSTAT: Record<string, DRec["status"]> = { not_ready: "Ready", ready: "Ready", dispatched: "Dispatched", delivered: "Delivered", failed: "Dispatched", returned: "Ready" };
export const modeDb = (m: DMode) => slug(m);
const modeOf = (db: string): DMode | undefined => DMODES.find((m) => slug(m) === db);

const orderByUid = (uid: string) => ORDERS.find((o) => o.uid === uid);
const uidOf = (code: string) => ORDERS.find((o) => o.id === code)?.uid;
const day = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : "");
const nameOfPath = (p: string) => (p.split("/").pop() ?? p).replace(/-v\d+$/, "");

/* ───────── ordered, error-reporting background writes ───────── */
let tail: Promise<unknown> = Promise.resolve();
/** Queue a write behind the previous ones. Resolves true when stored; on failure reports the error, runs `revert` and resolves false. */
export function enqueue(what: string, op: () => PromiseLike<Res>, revert?: () => void): Promise<boolean> {
  if (!backendOn) return Promise.resolve(true);
  const p = tail.then(async () => {
    try { const { error } = await op(); if (error) { reportDbError(what, error); revert?.(); return false; } return true; }
    catch (e) { reportDbError(what, e); revert?.(); return false; }
  });
  tail = p; return p;
}
/** UPDATE that fails loudly when no row changed (row-level security hides rows instead of raising an error). */
const upd = (table: string, match: Record<string, unknown>, patch: Row) => async (): Promise<Res> => {
  const { data, error } = await sb().from(table).update(patch).match(match).select();
  if (error) return { error };
  return data?.length ? { error: null } : { error: { message: "Not saved: you may not have permission to change this record" } };
};
const ins = (table: string, row: Row | Row[]) => () => sb().from(table).insert(row) as never as PromiseLike<Res>;
const ups = (table: string, row: Row, onConflict: string, ignoreDuplicates = false) => () => sb().from(table).upsert(row, { onConflict, ignoreDuplicates }) as never as PromiseLike<Res>;

/* ───────── hydrate ───────── */
const evMap = (rows: Row[]) => {
  const m = new Map<string, GEvent[]>();
  for (const r of rows) { const k = `${r.area}:${r.order_id}`; (m.get(k) ?? m.set(k, []).get(k)!).push({ at: r.created_at, by: r.actor_name || staffName(r.actor) || "—", text: r.text }); }
  return m;
};
const tried = new Set<string>();

async function hydrate() {
  const c = sb(); tried.clear();
  const [prof, tasks, pj, plog, pexc, pven, qci, rw, dl, ev] = await Promise.all([
    q<Row[]>("Loading staff", c.from("profiles").select("id,full_name,role") as never),
    q<Row[]>("Loading grading jobs", c.from("tasks").select("*").eq("kind", "grading") as never),
    q<Row[]>("Loading print jobs", c.from("print_jobs").select("*") as never),
    q<Row[]>("Loading print history", c.from("print_stage_log").select("*").order("at", { ascending: true }) as never),
    q<Row[]>("Loading print exceptions", c.from("print_exceptions").select("*").order("raised_at", { ascending: false }) as never),
    q<Row[]>("Loading vendor jobs", c.from("print_vendor_jobs").select("*") as never),
    q<Row[]>("Loading QC inspections", c.from("qc_inspections").select("*").order("created_at", { ascending: false }) as never),
    q<Row[]>("Loading rework tasks", c.from("rework_tasks").select("*").order("created_at", { ascending: false }) as never),
    q<Row[]>("Loading deliveries", c.from("deliveries").select("*") as never),
    q<Row[]>("Loading production history", c.from("production_events").select("*").order("created_at", { ascending: false }).limit(3000) as never),
  ]);
  STAFF = (prof ?? []).map((p) => ({ id: p.id, name: String(p.full_name), role: p.role }));
  const events = evMap(ev ?? []);

  // grading
  const gjobs: GJob[] = [];
  for (const t of tasks ?? []) {
    const o = orderByUid(t.order_id); if (!o) continue;
    const status = GSTAT[t.status] ?? "New";
    gjobs.push({ orderId: o.id, colorist: staffName(t.assignee) ?? "Unassigned", priority: PRI[t.priority] ?? "Normal", due: day(t.due_at) || o.due, status, instructions: t.instructions ?? "",
      internalNote: t.internal_note ?? "", draft: t.draft ?? undefined, revision: status === "Rework" ? (t.revision_note ?? undefined) : undefined, revisionAck: t.revision_ack ?? undefined,
      rounds: t.rounds ?? 0, events: events.get(`grading:${t.order_id}`) ?? [], startedAt: t.started_at ?? undefined, submittedAt: t.submitted_at ?? undefined });
  }
  GJOBS.splice(0, GJOBS.length, ...gjobs);

  // printing
  const logBy = new Map<string, Row[]>(); for (const l of plog ?? []) (logBy.get(l.order_id) ?? logBy.set(l.order_id, []).get(l.order_id)!).push(l);
  const excBy = new Map<string, PExc[]>();
  for (const e of pexc ?? []) (excBy.get(e.order_id) ?? excBy.set(e.order_id, []).get(e.order_id)!).push({ id: e.id, kind: EXC[e.kind] ?? "Delay", note: e.note, at: e.raised_at, by: staffName(e.raised_by) ?? "—", resolved: e.resolved || undefined, resolvedAt: e.resolved_at ?? undefined });
  const venBy = new Map((pven ?? []).map((v) => [v.order_id as string, v]));
  const jobs: PJob[] = [];
  for (const j of pj ?? []) {
    const o = orderByUid(j.order_id); if (!o) continue;
    const history: PJob["history"] = {};
    for (const l of logBy.get(j.order_id) ?? []) if (l.reprint_no === j.reprints) history[pstageOf(l.stage)!] = { at: l.at, by: staffName(l.by) ?? "—" };
    const v = venBy.get(j.order_id);
    jobs.push({ id: o.id, orderId: o.id, stage: pstageOf(j.stage) ?? "Waiting", paper: j.paper_type ?? PAPERS[0]!, sheets: j.sheets ?? o.pages, copies: j.copies ?? 1, operator: staffName(j.operator) ?? "", due: day(j.due_at) || o.due,
      history, exceptions: excBy.get(j.order_id) ?? [], reprints: j.reprints ?? 0, cover: j.cover ?? undefined, lamination: j.lamination ?? undefined, box: j.box ?? undefined, finishing: j.finishing ?? undefined,
      events: events.get(`printing:${j.order_id}`) ?? [],
      vendor: v ? { name: v.vendor_name, sentDate: v.sent_date, expectedBack: v.expected_back, tracking: v.tracking ?? "", cost: Number(v.cost), status: VSTAT[v.status] ?? "Planned" } : undefined });
  }
  PJOBS.splice(0, PJOBS.length, ...jobs);

  // QC
  const insps: Inspection[] = [];
  for (const i of qci ?? []) {
    const o = orderByUid(i.order_id); if (!o) continue;
    const status = QSTAT[i.decision] ?? "In Inspection";
    insps.push({ id: i.id, orderId: o.id, round: i.round, status, marks: { ...blankMarks(), ...(i.checklist ?? {}) }, notes: i.notes ?? "", defects: i.defect_codes ?? [], inspector: staffName(i.inspector) ?? "—",
      startedAt: i.created_at, decidedAt: status === "In Inspection" ? undefined : (i.decided_at ?? undefined), returnTo: i.return_to ? DEPT[i.return_to] : undefined, reason: i.reason ?? undefined,
      evidence: (i.evidence_paths ?? []).map(nameOfPath), evidencePaths: i.evidence_paths ?? [], pendingAdmin: i.pending_admin || undefined });
  }
  INSPECTIONS.splice(0, INSPECTIONS.length, ...insps);
  const tasksR: ReworkTask[] = [];
  for (const t of rw ?? []) { const o = orderByUid(t.order_id); if (!o) continue; tasksR.push({ id: t.id, orderId: o.id, dept: DEPT[t.dept] ?? "Printing", reason: t.reason, defects: t.defect_codes ?? [], at: t.created_at, by: staffName(t.created_by) ?? "—", status: t.status === "done" ? "Done" : "Open", doneBy: staffName(t.done_by) }); }
  RTASKS.splice(0, RTASKS.length, ...tasksR);

  // delivery
  const recs: DRec[] = [];
  for (const d of dl ?? []) {
    const o = orderByUid(d.order_id); if (!o) continue;
    recs.push({ orderId: o.id, mode: modeOf(d.mode) ?? "Pickup", carrier: d.courier ?? "", tracking: d.tracking_no ?? "", contact: d.contact ?? "", address: d.address ?? "", status: DSTAT[d.status] ?? "Ready",
      dispatchedAt: d.dispatched_at ?? undefined, deliveredAt: d.delivered_at ?? undefined, receivedBy: d.received_by ?? undefined, pod: d.proof_path ? nameOfPath(d.proof_path).replace(/^POD-/, "") : undefined, podPath: d.proof_path ?? undefined,
      podNote: d.pod_note ?? undefined, overrideReason: d.override_reason ?? undefined, events: events.get(`delivery:${d.order_id}`) ?? [] });
  }
  DRECS.splice(0, DRECS.length, ...recs);

  // pick lists come from the people who hold the roles
  const names = (role: string, extra: string[]) => [...new Set([...STAFF.filter((s) => s.role === role).map((s) => s.name), ...extra])];
  COLORISTS.splice(0, COLORISTS.length, ...names("colour", gjobs.map((g) => g.colorist).filter((n) => n !== "Unassigned")));
  OPERATORS.splice(0, OPERATORS.length, ...names("printing", jobs.map((j) => j.operator).filter(Boolean)));
  notify();
}
if (backendOn) registerHydrator("production", hydrate);

/* ───────── rows that must exist for orders that reached a stage by another route ───────── */
/** Called while a production page renders: creates the grading job / print job / delivery record the order is missing (once per session). */
export function dbEnsure(area: "grading" | "printing" | "delivery") {
  const role = currentActor().role; const areaKey = area === "grading" ? "grading" : area; if (!can(role === "system" ? null : role, areaKey)) return;
  let changed = false;
  for (const o of ORDERS) {
    if (!o.uid || o.closed || o.hold === "Cancelled") continue;
    const key = `${area}:${o.id}`; if (tried.has(key)) continue;
    if (area === "grading" && o.workflow !== "Printing" && o.stage === "colour_grading" && !GJOBS.some((g) => g.orderId === o.id)) {
      tried.add(key); const job: GJob = { orderId: o.id, colorist: "Unassigned", priority: o.priority, due: o.due, status: "New", instructions: "Standard grading, keep skin tones natural.", internalNote: "", rounds: 0, events: [] };
      GJOBS.push(job); changed = true;
      void enqueue("Creating grading job", async () => { const r = await sb().rpc("upsert_grading_task", { p_order: o.uid, p_priority: priDb(o.priority), p_due: `${o.due}T00:00:00Z`, p_instructions: job.instructions }); return { error: r.error }; },
        () => { const i = GJOBS.indexOf(job); if (i >= 0) GJOBS.splice(i, 1); notify(); });
    } else if (area === "printing" && o.stage === "printing" && !PJOBS.some((j) => j.orderId === o.id)) {
      tried.add(key); const job: PJob = { id: o.id, orderId: o.id, stage: "Waiting", paper: PAPERS[0]!, sheets: o.pages, copies: 1, operator: "", due: o.due, history: { Waiting: { at: new Date().toISOString(), by: currentActor().name } }, exceptions: [], reprints: 0, events: [] };
      PJOBS.push(job); changed = true;
      void enqueue("Creating print job", ups("print_jobs", { order_id: o.uid, stage: "waiting", paper_type: job.paper, sheets: job.sheets, copies: 1, due_at: `${o.due}T00:00:00Z` }, "order_id", true),
        () => { const i = PJOBS.indexOf(job); if (i >= 0) PJOBS.splice(i, 1); notify(); });
    } else if (area === "delivery" && o.stage === "ready_for_delivery" && !DRECS.some((d) => d.orderId === o.id)) {
      tried.add(key); const rec: DRec = { orderId: o.id, mode: "Pickup", carrier: "", tracking: "", contact: `${o.customer} · ${o.mobile}`, address: "", status: "Ready", events: [] };
      DRECS.push(rec); changed = true;
      void enqueue("Creating delivery record", ups("deliveries", { order_id: o.uid, mode: "pickup", status: "ready", contact: rec.contact }, "order_id", true),
        () => { const i = DRECS.indexOf(rec); if (i >= 0) DRECS.splice(i, 1); notify(); });
    }
  }
  if (changed) queueMicrotask(notify);   // never notify mid-render
}

/* ───────── activity timeline ───────── */
export function dbEvent(orderCode: string, area: "grading" | "printing" | "qc" | "delivery", text: string) {
  const order_id = uidOf(orderCode); if (!backendOn || !order_id) return;
  void enqueue("Saving history", ins("production_events", { order_id, area, text, actor_name: currentActor().name }));
}

/* ───────── colour grading ───────── */
export function dbGradingCreate(orderCode: string, d: { colorist: string; priority: string; due: string; instructions: string }, revert: () => void) {
  const order_id = uidOf(orderCode); if (!backendOn || !order_id) return;
  void enqueue("Creating grading job", async () => {
    const r = await sb().rpc("upsert_grading_task", { p_order: order_id, p_assignee: staffId(d.colorist) ?? null, p_priority: priDb(d.priority), p_due: `${d.due}T00:00:00Z`, p_instructions: d.instructions || null });
    return { error: r.error };
  }, revert);
}
export function dbTask(orderCode: string, patch: Row, revert?: () => void) {
  const order_id = uidOf(orderCode); if (!backendOn || !order_id) return;
  void enqueue("Updating grading job", upd("tasks", { order_id, kind: "grading" }, patch), revert);
}

/* ───────── printing ───────── */
export function dbPrintRelease(j: PJob, revert: () => void) {
  const order_id = uidOf(j.orderId); if (!backendOn || !order_id) return;
  void enqueue("Releasing to printing", ups("print_jobs", { order_id, stage: "waiting", paper_type: j.paper, sheets: j.sheets, copies: j.copies, operator: staffId(j.operator) ?? null, due_at: `${j.due}T00:00:00Z` }, "order_id"), revert);
}
export function dbPrintPatch(orderCode: string, patch: Row, revert?: () => void) {
  const order_id = uidOf(orderCode); if (!backendOn || !order_id) return;
  void enqueue("Updating print job", upd("print_jobs", { order_id }, patch), revert);
}
export function dbException(orderCode: string, e: PExc, revert: () => void) {
  const order_id = uidOf(orderCode); if (!backendOn || !order_id) return;
  void enqueue("Raising exception", ins("print_exceptions", { id: e.id, order_id, kind: excDb(e.kind), note: e.note, resolved: !!e.resolved }), revert);
}
export function dbExceptionResolve(id: string, revert: () => void) { void enqueue("Resolving exception", upd("print_exceptions", { id }, { resolved: true }), revert); }
export function dbVendor(orderCode: string, v: Vendor, revert: () => void) {
  const order_id = uidOf(orderCode); if (!backendOn || !order_id) return;
  void enqueue("Saving vendor job", ups("print_vendor_jobs", { order_id, vendor_name: v.name.trim(), sent_date: v.sentDate, expected_back: v.expectedBack, tracking: v.tracking || null, cost: v.cost, status: vstatDb(v.status) }, "order_id"), revert);
}
export const printSpecPatch = (p: Partial<PJob>) => {
  const r: Row = {};
  if (p.paper !== undefined) r.paper_type = p.paper; if (p.sheets !== undefined) r.sheets = p.sheets; if (p.copies !== undefined) r.copies = p.copies;
  if (p.cover !== undefined) r.cover = p.cover || null; if (p.lamination !== undefined) r.lamination = p.lamination || null; if (p.box !== undefined) r.box = p.box || null; if (p.finishing !== undefined) r.finishing = p.finishing || null;
  if (p.due !== undefined) r.due_at = `${p.due}T00:00:00Z`; if (p.operator !== undefined) r.operator = staffId(p.operator) ?? null;
  return r;
};

/* ───────── quality control ───────── */
export function dbInspectionStart(i: Inspection, revert: () => void) {
  const order_id = uidOf(i.orderId); if (!backendOn || !order_id) return;
  void enqueue("Starting inspection", ins("qc_inspections", { id: i.id, order_id, decision: "in_progress", checklist: i.marks, defect_codes: [], notes: "" }), revert);
}
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Marks/notes are typed live: save the latest values 600 ms after the last change. */
export function dbInspectionDraft(i: Inspection) {
  if (!backendOn) return; clearTimeout(saveTimers.get(i.id));
  saveTimers.set(i.id, setTimeout(() => { saveTimers.delete(i.id); void enqueue("Saving inspection", upd("qc_inspections", { id: i.id }, { checklist: i.marks, notes: i.notes, defect_codes: i.defects })); }, 600));
}
export const cancelInspectionDraft = (id: string) => { clearTimeout(saveTimers.get(id)); saveTimers.delete(id); };
export function dbInspectionEvidence(i: Inspection) { void enqueue("Saving evidence", upd("qc_inspections", { id: i.id }, { evidence_paths: i.evidencePaths ?? [] })); }
/** Record the verdict. Resolves true once stored — callers move the order only after that (the database requires qc_status = passed first). */
export function dbInspectionDecide(i: Inspection, decision: "passed" | "failed" | "rework", revert: () => void): Promise<boolean> {
  cancelInspectionDraft(i.id);
  return enqueue("Recording QC decision", upd("qc_inspections", { id: i.id }, {
    decision, checklist: i.marks, notes: i.notes, defect_codes: i.defects, reason: i.reason ?? null, return_to: i.returnTo ? deptDb(i.returnTo) : null, pending_admin: !!i.pendingAdmin, evidence_paths: i.evidencePaths ?? [],
  }), revert);
}
export function dbReworkCreate(t: ReworkTask, revert: () => void) {
  const order_id = uidOf(t.orderId); if (!backendOn || !order_id) return;
  void enqueue("Creating rework task", ins("rework_tasks", { id: t.id, order_id, dept: deptDb(t.dept), reason: t.reason, defect_codes: t.defects }), revert);
}
export function dbReworkDone(t: ReworkTask, insp: Inspection[], revert: () => void) {
  if (!backendOn) return;
  void enqueue("Completing rework task", upd("rework_tasks", { id: t.id }, { status: "done" }), revert).then((ok) => {
    if (ok) for (const i of insp) void enqueue("Clearing admin flag", upd("qc_inspections", { id: i.id }, { pending_admin: false }));
  });
}

/* ───────── delivery ───────── */
export function dbDeliveryPatch(orderCode: string, patch: Row, revert?: () => void): Promise<boolean> {
  const order_id = uidOf(orderCode); if (!backendOn || !order_id) return Promise.resolve(true);
  return enqueue("Updating delivery", upd("deliveries", { order_id }, patch), revert);
}
export const deliveryDetailPatch = (p: Partial<DRec>) => {
  const r: Row = {};
  if (p.mode !== undefined) r.mode = modeDb(p.mode); if (p.carrier !== undefined) r.courier = p.carrier || null; if (p.tracking !== undefined) r.tracking_no = p.tracking || null;
  if (p.contact !== undefined) r.contact = p.contact || null; if (p.address !== undefined) r.address = p.address || null;
  return r;
};
/** Run `op` behind the queued writes (used by flows that upload a file first). */
export const enqueueAsync = (what: string, op: () => PromiseLike<Res>, revert?: () => void) => enqueue(what, op, revert);
export { upd as updateRows };

import { backendOn } from "./supabase";
import { sb } from "./db/core";
import { notify, patchOrder } from "./store";
import { ORDERS, STAFF, type Order, type StageKey } from "./data";
import { logAudit } from "./audit";

// Who gets an order when it reaches a department, and assigning by hand from the order page.
// The rules live in settings 'auto_assign' (database: applied by a trigger as the stage changes, migration 0047).
export type AssignMode = "off" | "least_busy" | "person";
export interface AssignRule { mode: AssignMode; person?: string }      // person: profile id (database) or staff name (demo)
export type AssignRules = Partial<Record<DeptStage, AssignRule>>;
export type DeptStage = "colour_grading" | "designing" | "printing" | "qc";
export const DEPTS: { stage: DeptStage; label: string; role: string; demoRole: string }[] = [
  { stage: "colour_grading", label: "Colour Grading", role: "colour", demoRole: "Colour Grading" },
  { stage: "designing", label: "Designing", role: "designer", demoRole: "Designer" },
  { stage: "printing", label: "Printing", role: "printing", demoRole: "Printer" },
  { stage: "qc", label: "Quality Control", role: "qc", demoRole: "QC Executive" },
];
export const deptOf = (stage: StageKey) => DEPTS.find((d) => d.stage === stage);
const KEY = "albumpro.v1.auto_assign";
const OPEN = (o: Order) => !["ready_for_delivery", "delivered", "closed", "cancelled"].includes(o.stage);

let rules: AssignRules = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as AssignRules; } catch { return {}; } })();
export const assignRules = () => rules;
export async function loadAssignRules(): Promise<string | null> {
  if (!backendOn) return null;
  const { data, error } = await sb().from("settings").select("value").eq("key", "auto_assign").maybeSingle();
  if (error) return error.message;
  rules = (data?.value ?? {}) as AssignRules; notify(); return null;
}
export async function saveAssignRules(next: AssignRules): Promise<string | null> {
  for (const d of DEPTS) { const r = next[d.stage]; if (r?.mode === "person" && !r.person) return `Choose the person for ${d.label}`; }
  if (backendOn) { const { error } = await sb().from("settings").upsert({ key: "auto_assign", value: next }, { onConflict: "key" }); if (error) return error.message; }
  else { try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ } logAudit({ entity: "settings", entityId: "auto_assign", action: "update", detail: summary(next) }); }
  rules = next; notify(); return null;
}
const summary = (r: AssignRules) => DEPTS.map((d) => `${d.label}: ${r[d.stage]?.mode === "person" ? r[d.stage]!.person : r[d.stage]?.mode ?? "off"}`).join(" · ");

/** Staff of a department (demo: the staff list; database: profiles of that role, via the production directory). */
export type StaffPick = { id: string; name: string; dept?: string };
let directory: () => { id: string; name: string; role: string }[] = () => [];
export const registerStaffDirectory = (f: () => { id: string; name: string; role: string }[]) => { directory = f; };
export function staffOf(stage: DeptStage | undefined): StaffPick[] {
  const d = DEPTS.find((x) => x.stage === stage);
  if (backendOn) return directory().filter((s) => !d || s.role === d.role).map((s) => ({ id: s.id, name: s.name, dept: DEPTS.find((x) => x.role === s.role)?.label }));
  return STAFF.filter((s) => s.status === "Active" && (!d || s.role === d.demoRole)).map((s) => ({ id: s.name, name: s.name, dept: DEPTS.find((x) => x.demoRole === s.role)?.label }));
}
export const allStaff = (): StaffPick[] => (backendOn ? directory().map((s) => ({ id: s.id, name: s.name, dept: DEPTS.find((x) => x.role === s.role)?.label })) : STAFF.filter((s) => s.status === "Active").map((s) => ({ id: s.name, name: s.name, dept: DEPTS.find((x) => x.demoRole === s.role)?.label })));

/** Demo mode: the person the rule picks for this stage (the database does this itself). */
export function pickFor(stage: StageKey): string | null {
  const d = deptOf(stage); if (!d || d.stage !== stage) return null;
  const r = rules[d.stage]; if (!r || r.mode === "off") return null;
  const people = staffOf(d.stage);
  if (r.mode === "person") return people.find((p) => p.id === r.person)?.name ?? null;
  const load = (n: string) => ORDERS.filter((o) => o.assignee === n && OPEN(o)).length;
  return [...people].sort((a, b) => load(a.name) - load(b.name) || a.name.localeCompare(b.name))[0]?.name ?? null;
}
/** The grading-job side (registered by the production module, which imports this one). */
let gradingAssign: (orderId: string, who: string) => void = () => {};
export const registerGradingAssign = (f: (orderId: string, who: string) => void) => { gradingAssign = f; };
/** Demo mode: apply the rule when an order reaches a stage. */
export function autoAssignLocal(o: Order, to: StageKey) {
  if (backendOn) return;
  const who = pickFor(to); if (!who) return;
  patchOrder(o.id, { assignee: who });
  if (to === "colour_grading" && o.workflow !== "Printing") gradingAssign(o.id, who);
  logAudit({ entity: "order", entityId: o.id, action: "auto_assign", detail: `Auto-assigned to ${who} (${deptOf(to)?.label})` });
}

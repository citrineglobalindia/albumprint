import { backendOn } from "./supabase";
import { loadSettings } from "./localState";
import { currentActor } from "./audit";
import { ROLES, type RoleKey } from "./auth";
import { ME, lastKindToday, meId } from "./attendance";

// Attendance comes first: staff work on jobs only while checked in (not on a break, not checked out).
// Settings › Workflow › "Staff Must Check In Before Working" (wf_require_checkin; on by default with the database, off in the demo).
// The database enforces the same rule (migration 0052, duty_block_reason); this mirrors it so the screen says so before trying.
export const checkinRequired = () => { const v = loadSettings().wf_require_checkin; return v === undefined ? backendOn : v === true; };

/** The signed-in person's attendance id. */
export function myAttendanceId(): string {
  if (backendOn) return ME.id;
  const r = currentActor().role; return r === "system" ? "" : meId(ROLES[r as RoleKey].email);
}

export type DutyState = "exempt" | "working" | "not_in" | "on_break" | "checked_out";
export function dutyState(now = new Date()): DutyState {
  const r = currentActor().role;
  if (r === "admin" || r === "system" || !checkinRequired()) return "exempt";
  const id = myAttendanceId(); if (!id) return "not_in";
  const last = lastKindToday(id, now);
  return last === "check_in" || last === "break_end" ? "working" : last === "break_start" ? "on_break" : last === "check_out" ? "checked_out" : "not_in";
}
const MSG: Partial<Record<DutyState, string>> = {
  not_in: "Check in first: you are not checked in for today (Attendance › My day)",
  on_break: "You are on a break: end your break (Attendance › My day) to continue working",
  checked_out: "You have checked out for today: check in again (Attendance › My day) to continue working",
};
/** Why the signed-in person can't do job work right now, or null when they can. */
export const dutyBlock = (): string | null => MSG[dutyState()] ?? null;

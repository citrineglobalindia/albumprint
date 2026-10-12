import { persistArray } from "./persist";
import { backendOn } from "./supabase";
import { notify } from "./store";
import { logAudit } from "./audit";

// Scheduled reports (SRS 19.3). Demo: kept in this browser. Database mode: stored for every admin; a job notifies the recipients in AlbumPro when one comes due.
export interface Sched {
  id: string; name: string; freq: string; day: string; time: string; to: string; format: string;
  metrics: string[]; groupBy: string; filters: { stage: string[]; priority: string[]; event: string[]; pay: string[] };
  lastRun?: string;
}
export const SCHEDULES: Sched[] = persistArray<Sched>("report_schedules", []);

type Backend = { add: (s: Sched) => Promise<{ id: string } | { error: string }>; remove: (id: string) => Promise<string | null> };
let backend: Backend | null = null;
export const registerScheduleBackend = (b: Backend) => { backend = b; };
export function replaceSchedules(rows: Sched[]) { SCHEDULES.splice(0, SCHEDULES.length, ...rows); notify(); }

export async function addSchedule(s: Omit<Sched, "id">): Promise<string | null> {
  const draft: Sched = { ...s, id: `S${Date.now()}` };
  if (backendOn) {
    if (!backend) return "Not connected to the database";
    const r = await backend.add(draft); if ("error" in r) return r.error;
    draft.id = r.id;
  }
  SCHEDULES.unshift(draft); notify();
  logAudit({ entity: "report_schedule", entityId: draft.id, action: "create", detail: `${draft.name} · ${draft.freq} ${draft.time} · ${draft.format}` });
  return null;
}
export async function removeSchedule(id: string): Promise<string | null> {
  const i = SCHEDULES.findIndex((x) => x.id === id); if (i < 0) return null;
  if (backendOn) { if (!backend) return "Not connected to the database"; const e = await backend.remove(id); if (e) return e; }
  const [gone] = SCHEDULES.splice(i, 1); notify();
  logAudit({ entity: "report_schedule", entityId: id, action: "delete", detail: gone?.name });
  return null;
}

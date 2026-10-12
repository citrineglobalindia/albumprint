import { registerScheduleBackend, replaceSchedules, type Sched } from "../schedules";
import { backendOn, sb, q, registerHydrator } from "./core";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function hydrate() {
  const rows = await q<Row[]>("Loading report schedules", sb().from("report_schedules").select("*").order("created_at", { ascending: false }) as never);
  replaceSchedules((rows ?? []).map((r): Sched => ({ id: r.id, name: r.name, freq: r.freq, day: r.day ?? "", time: r.run_time, to: (r.recipients as string[]).join(", "), format: r.format, metrics: r.metrics ?? [], groupBy: r.group_by ?? "", filters: { stage: [], priority: [], event: [], pay: [], ...(r.filters ?? {}) }, lastRun: r.last_run_at })));
}
registerScheduleBackend({
  async add(s) {
    const { data, error } = await sb().from("report_schedules").insert({ name: s.name, report: "Custom Report", metrics: s.metrics, group_by: s.groupBy, filters: s.filters, freq: s.freq, day: s.freq === "Daily" ? null : s.day, run_time: s.time, format: s.format, recipients: s.to.split(/[,;\s]+/).filter(Boolean) }).select("id").single();
    return error || !data ? { error: error?.message ?? "Could not save the schedule" } : { id: data.id as string };
  },
  async remove(id) { const { error } = await sb().from("report_schedules").delete().eq("id", id); return error ? error.message : null; },
});
if (backendOn) registerHydrator("report schedules", hydrate);

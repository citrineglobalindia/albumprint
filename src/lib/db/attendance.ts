import { ME, istDate, mergeRange, registerAttendanceBackend, replaceAll, type AttEvent, type AttSettings, type Employee, type Leave, type LeaveKind, type PunchKind } from "../attendance";
import { sb } from "./core";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const eventFrom = (r: Row): AttEvent => ({ id: r.id, userId: r.user_id, kind: r.kind as PunchKind, at: r.at, date: r.work_date, note: r.note ?? undefined, source: r.source, reason: r.reason ?? undefined });
const leaveFrom = (r: Row): Leave => ({ id: r.id, userId: r.user_id, from: r.from_date, to: r.to_date, kind: r.kind as LeaveKind, reason: r.reason, status: r.status, decisionNote: r.decision_note ?? undefined, createdAt: r.created_at });
const settingsFrom = (r: Row): AttSettings => ({ shiftStart: String(r.shift_start).slice(0, 5), shiftEnd: String(r.shift_end).slice(0, 5), graceMinutes: r.grace_minutes, halfDayHours: Number(r.half_day_hours), fullDayHours: Number(r.full_day_hours), weeklyOff: r.weekly_off ?? [], holidays: r.holidays ?? [] });

/** PostgREST returns at most 1,000 rows a request: page through. */
async function allEvents(from: string, to: string): Promise<{ rows: Row[]; error: string | null }> {
  const rows: Row[] = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await sb().from("attendance_events").select("id,user_id,kind,at,work_date,note,source,reason").gte("work_date", from).lte("work_date", to).is("superseded_at", null).order("at").order("seq").range(i * 1000, i * 1000 + 999);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  return { rows, error: null };
}

registerAttendanceBackend({
  async punch(kind, note) {
    const { data, error } = await sb().rpc("attendance_punch", { p_kind: kind, p_note: note ?? null });
    return error || !data ? { error: error?.message ?? "Could not record the punch" } : eventFrom(data as Row);
  },
  async adjust(userId, date, inTime, outTime, reason) {
    const { error } = await sb().rpc("attendance_adjust", { p_user: userId, p_date: date, p_in: inTime, p_out: outTime, p_reason: reason });
    return error ? error.message : null;
  },
  async requestLeave(l) {
    const { error } = await sb().from("attendance_leaves").insert({ from_date: l.from, to_date: l.to, kind: l.kind, reason: l.reason });
    return error ? error.message : null;
  },
  async decide(id, approve, note) { const { error } = await sb().rpc("attendance_leave_decide", { p_id: id, p_approve: approve, p_note: note || null }); return error ? error.message : null; },
  async cancel(id) { const { error } = await sb().rpc("attendance_leave_cancel", { p_id: id }); return error ? error.message : null; },
  async saveSettings(s) {
    const { error } = await sb().from("attendance_settings").update({ shift_start: s.shiftStart, shift_end: s.shiftEnd, grace_minutes: s.graceMinutes, half_day_hours: s.halfDayHours, full_day_hours: s.fullDayHours, weekly_off: s.weeklyOff, holidays: s.holidays, updated_at: new Date().toISOString() }).eq("id", true);
    return error ? error.message : null;
  },
  async load(from, to) {
    try {
      const [ev, lv, st, pe, ses] = await Promise.all([
        allEvents(from, to),
        sb().from("attendance_leaves").select("*").order("created_at", { ascending: false }).limit(500),
        sb().from("attendance_settings").select("*").maybeSingle(),
        sb().from("profiles").select("id,full_name,role,department,active,created_at").eq("active", true).order("full_name"),
        sb().auth.getSession(),
      ]);
      if (ev.error) return ev.error;
      if (lv.error) return lv.error.message;
      if (st.error) return st.error.message;
      ME.id = ses.data.session?.user.id ?? ME.id;
      mergeRange(from, to, ev.rows.map(eventFrom));
      replaceAll({ leaves: (lv.data ?? []).map(leaveFrom), settings: st.data ? settingsFrom(st.data) : undefined, employees: (pe.data ?? []).map((p: Row): Employee => ({ id: p.id, name: p.full_name, role: p.role, dept: p.department ?? "", since: istDate(p.created_at) })) });
      return null;
    } catch (e) { return e instanceof Error ? e.message : String(e); }
  },
});

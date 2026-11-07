import { useState } from "react";
import { Link } from "react-router-dom";
import { AlarmClockCheck, Coffee, LogIn } from "lucide-react";
import { useStore } from "../lib/store";
import { dutyState, myAttendanceId } from "../lib/duty";
import { punch } from "../lib/attendance";

/** Attendance first: until the person is checked in (and not on a break), a bar across every page says so, with a one-click check-in. */
export function DutyBar() {
  useStore();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const s = dutyState();
  if (s === "exempt" || s === "working") return null;
  const act = s === "on_break" ? { kind: "break_end" as const, label: "End break", icon: Coffee, text: "You are on a break — job work is paused." }
    : s === "checked_out" ? { kind: "check_in" as const, label: "Check in again", icon: LogIn, text: "You have checked out for today — job work is locked." }
    : { kind: "check_in" as const, label: "Check in now", icon: LogIn, text: "You haven't checked in today — check in to start working on jobs." };
  const go = async () => { setBusy(true); setErr(""); const e = await punch(myAttendanceId(), act.kind); setBusy(false); if (e) setErr(e); };
  return (
    <div role="status" data-testid="duty-bar" data-state={s} className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <AlarmClockCheck className="size-5 shrink-0 text-amber-600" />
      <span className="min-w-0 flex-1 font-semibold">{act.text}{err && <span className="ml-2 text-rose-600">{err}</span>}</span>
      <Link to="/attendance" className="text-xs font-bold text-amber-800 underline">My attendance</Link>
      <button type="button" disabled={busy} onClick={() => void go()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-4 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"><act.icon className="size-4" />{act.label}</button>
    </div>
  );
}

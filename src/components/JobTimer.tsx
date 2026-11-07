import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { cx } from "./ui";
import { useStageHistory } from "./ProcessTracker";
import type { Order, StageKey } from "../lib/data";

// Start time, end time and a running timer for a department's job (grading, printing, QC).
// While the job is running the timer ticks every second; when it ends it shows the total time taken.

/** "2h 05m 09s" / "3d 4h 10m" — compact elapsed time. */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h ${p(m)}m`;
  if (h > 0) return `${h}h ${p(m)}m ${p(sec)}s`;
  return `${m}m ${p(sec)}s`;
}
export const fmtClock = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "—";
  const today = new Date().toDateString() === d.toDateString();
  const t = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return today ? `Today ${t}` : `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} ${t}`;
};

/** Re-renders every second while `on`. */
export function useTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!on) return; setNow(Date.now()); const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [on]);
  return now;
}

/** The ticking (or final) duration on its own — for a table cell. */
export function Elapsed({ start, end, className }: { start?: string; end?: string; className?: string }) {
  const running = !!start && !end;
  const now = useTick(running);
  if (!start) return <span className={cx("text-sub", className)}>Not started</span>;
  const ms = (end ? new Date(end).getTime() : now) - new Date(start).getTime();
  return (
    <span data-testid="elapsed" data-running={running || undefined} className={cx("inline-flex items-center gap-1 font-mono text-[12px] font-bold tabular-nums", running ? "text-brand" : "text-ink", className)}>
      {running && <span className="size-1.5 animate-pulse rounded-full bg-brand" aria-hidden />}{fmtElapsed(ms)}
    </span>
  );
}

/** Started / Ended / Time taken block — for a job's detail panel. */
export function JobTimer({ start, end, label = "Time", paused }: { start?: string; end?: string; label?: string; paused?: string }) {
  const running = !!start && !end && !paused;
  return (
    <div data-testid="job-timer" className={cx("mt-3 grid grid-cols-3 gap-3 rounded-xl border px-3 py-2.5 text-[13px]", running ? "border-brand/40 bg-brand-soft/30" : "border-line")}>
      <div><div className="text-xs text-sub">Start time</div><div className="font-semibold" data-testid="timer-start">{fmtClock(start)}</div></div>
      <div><div className="text-xs text-sub">End time</div><div className="font-semibold" data-testid="timer-end">{end ? fmtClock(end) : start ? <span className="text-sub">{paused ?? "Running…"}</span> : "—"}</div></div>
      <div><div className="flex items-center gap-1 text-xs text-sub"><Timer className="size-3.5" />{end ? `${label} taken` : label}</div><Elapsed start={start} end={end} className="text-[14px]" /></div>
    </div>
  );
}

/** A stage's time on the order itself (e.g. Designing): from the latest move into the stage to the move out of it. */
export function StageTimer({ o, stage, label }: { o: Order; stage: StageKey; label: string }) {
  const h = useStageHistory(o, o.stage);
  const i = h.map((e) => e.stage).lastIndexOf(stage);
  const start = i >= 0 ? h[i]!.at : undefined, end = i >= 0 && o.stage !== stage ? h[i + 1]?.at : undefined;
  return <JobTimer start={start} end={end} label={label} paused={o.hold ? o.hold : undefined} />;
}

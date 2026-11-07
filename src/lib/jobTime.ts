import { GJOBS, PJOBS, INSPECTIONS, PSTAGES } from "./production";

// Time spent on jobs, set against attendance: for one person and one day, the jobs they worked on (grading, printing, QC)
// with the part of each job's running time that falls on that day, and the total without double-counting overlaps.
export interface JobSpan { orderId: string; dept: "Colour Grading" | "Printing" | "QC"; start: number; end: number; running: boolean }

const sameName = (a: string, b: string) => { const x = a.trim().toLowerCase(), y = b.trim().toLowerCase(); return !!x && !!y && (x === y || x.split(" ")[0] === y || y.split(" ")[0] === x); };
const dayBounds = (date: string) => { const s = new Date(`${date}T00:00:00+05:30`).getTime(); return [s, s + 86400000] as const; };   // the IST day

export function jobSpans(name: string, date: string, now = Date.now()): JobSpan[] {
  const [d0, d1] = dayBounds(date), out: JobSpan[] = [];
  const add = (orderId: string, dept: JobSpan["dept"], start?: string, end?: string) => {
    if (!start) return;
    const s = new Date(start).getTime(), running = !end, e = end ? new Date(end).getTime() : now;
    const a = Math.max(s, d0), b = Math.min(e, d1, now);
    if (b > a) out.push({ orderId, dept, start: a, end: b, running });
  };
  for (const j of GJOBS) if (sameName(j.colorist, name)) add(j.orderId, "Colour Grading", j.startedAt, j.status === "Submitted" || j.status === "Approved" ? j.submittedAt : j.status === "In Progress" || j.status === "Rework" ? undefined : j.submittedAt);
  for (const j of PJOBS) if (sameName(j.operator, name)) {
    const start = j.history["File Prep"]?.at ?? PSTAGES.slice(1).map((s) => j.history[s]?.at).find(Boolean);
    add(j.orderId, "Printing", start, j.history["Completed"]?.at ?? j.history["Sent to QC"]?.at);
  }
  for (const i of INSPECTIONS) if (sameName(i.inspector, name)) add(i.orderId, "QC", i.startedAt, i.decidedAt);
  return out.sort((a, b) => a.start - b.start);
}

/** Total minutes on jobs that day, overlapping jobs counted once. */
export function jobMinutes(spans: JobSpan[]): number {
  let total = 0, curS = -1, curE = -1;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start > curE) { if (curE > curS) total += curE - curS; curS = s.start; curE = s.end; } else curE = Math.max(curE, s.end);
  }
  if (curE > curS) total += curE - curS;
  return Math.round(total / 60000);
}

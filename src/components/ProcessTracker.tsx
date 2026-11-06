import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Circle, Clock } from "lucide-react";
import { Avatar, cx } from "./ui";
import { STAGES, stageLabel, type Order, type StageKey } from "../lib/data";
import { AUDIT } from "../lib/audit";
import { backendOn } from "../lib/supabase";
import { sb } from "../lib/db/core";
import { fmtDate } from "../lib/format";
import type { RoleKey } from "../lib/auth";

// The order page's "Process": every step of this order's route, who owns it, who did it and when, and what happens next.
type Step = { stage: StageKey; owner: string; roles: RoleKey[]; todo: string; link?: (o: Order) => string };
const ROUTE: Step[] = [
  { stage: "new_order", owner: "Reception", roles: ["reception"], todo: "Collect the photos and mark the files received" },
  { stage: "files_received", owner: "Reception", roles: ["reception"], todo: "Send the order to Colour Grading (or to Printing for a printing-only order)" },
  { stage: "colour_grading", owner: "Colour Grading", roles: ["colour"], todo: "Start the grading job, upload the graded files and submit to the admin", link: () => "/colour-grading" },
  { stage: "admin_approval", owner: "Admin", roles: ["admin"], todo: "Check the graded files: approve to Designing or send back", link: () => "/colour-grading" },
  { stage: "designing", owner: "Designing", roles: ["designer"], todo: "Design the album and send the proof to the client", link: (o) => `/designing/${o.id}` },
  { stage: "client_review", owner: "Client", roles: ["designer"], todo: "The client reviews the proof link: approves or asks for corrections", link: (o) => `/designing/${o.id}` },
  { stage: "final_approval", owner: "Admin", roles: ["admin"], todo: "Final approval, then release the order to Printing", link: () => "/printing" },
  { stage: "printing", owner: "Printing", roles: ["printing"], todo: "Walk the print job through file prep → printing → finishing → assembly → packaging, then send to QC", link: () => "/printing" },
  { stage: "qc", owner: "Quality Control", roles: ["qc"], todo: "Inspect the album, record the checks and remarks: pass or send back", link: () => "/qc" },
  { stage: "ready_for_delivery", owner: "Delivery", roles: ["reception"], todo: "Hand the album to the customer and record the delivery", link: () => "/delivery" },
  { stage: "delivered", owner: "Delivery", roles: ["reception", "accounts"], todo: "Collect any balance, then the admin closes the order" },
];
const PRINT_ONLY_SKIP: StageKey[] = ["colour_grading", "admin_approval", "designing", "client_review", "final_approval"];
const ROLE_NAME: Record<string, string> = { admin: "Admin", reception: "Reception", colour: "Colour Grading", designer: "Designer", printing: "Printing", qc: "QC", accounts: "Accounts", system: "System" };
const byLabel = new Map(STAGES.map((s) => [s.label, s.key]));

export type StageEvent = { stage: StageKey; at: string; actor: string; role: string; reason?: string };

/** Stage moves of one order: the database keeps them in the audit log (read through order_stage_history, open to every signed-in staff member); demo mode reads its local audit. */
export function useStageHistory(o: Order, tick: unknown): StageEvent[] {
  const [rows, setRows] = useState<StageEvent[]>([]);
  useEffect(() => {
    if (!backendOn) {
      setRows(AUDIT.filter((a) => a.entity === "order" && a.entityId === o.id && (a.action === "stage_change" || a.action === "stage_override") && a.to && byLabel.has(a.to))
        .map((a) => ({ stage: byLabel.get(a.to!)!, at: a.at, actor: a.actor, role: a.role, reason: a.reason }))
        .sort((x, y) => x.at.localeCompare(y.at)));
      return;
    }
    if (!o.uid) return;
    let live = true;
    void sb().rpc("order_stage_history", { p_order: o.uid }).then(({ data, error }) => {
      if (!live || error || !Array.isArray(data)) return;
      setRows((data as { stage: string; at: string; actor_name: string; actor_role: string; reason: string | null }[])
        .map((r) => ({ stage: r.stage as StageKey, at: r.at, actor: r.actor_name, role: r.actor_role, reason: r.reason ?? undefined })));
    });
    return () => { live = false; };
  }, [o.id, o.uid, o.stage, tick]);
  return rows;
}

const when = (at: string) => { const d = new Date(at); return `${fmtDate(at)} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`; };

export function ProcessTracker({ o, role, tick }: { o: Order; role: RoleKey | null; tick: unknown }) {
  const history = useStageHistory(o, tick);
  const route = ROUTE.filter((s) => !(o.workflow === "Printing" && PRINT_ONLY_SKIP.includes(s.stage)));
  const curIdx = route.findIndex((s) => s.stage === o.stage);
  const assigned = o.assignee && o.assignee !== "—" && o.assignee !== "Unassigned" ? o.assignee : "";
  // who finished a step = who moved the order out of it (the next stage's move); who started it = the move into it
  const entered = (st: StageKey) => [...history].reverse().find((h) => h.stage === st);
  const doneBy = (i: number) => { const nxt = route[i + 1]; return nxt ? entered(nxt.stage) : undefined; };
  const ended = o.hold === "Cancelled" || !!o.closed;
  return (
    <ol className="space-y-1.5" aria-label="Process" data-testid="process-tracker">
      {route.map((s, i) => {
        const state = curIdx < 0 ? "upcoming" : i < curIdx ? "done" : i === curIdx ? "current" : "upcoming";
        const by = state === "done" ? doneBy(i) : undefined;
        const into = state === "current" ? entered(s.stage) : undefined;
        const mine = state === "current" && !ended && !!role && s.roles.includes(role);
        const oversee = state === "current" && !ended && role === "admin" && !mine;        // the admin can open any department's screen
        return (
          <li key={s.stage} data-testid={`step-${s.stage}`} data-state={state} className={cx("flex flex-wrap items-start gap-3 rounded-lg border px-3 py-2", state === "current" ? "border-brand bg-brand-soft/40" : "border-line", state === "upcoming" && "opacity-70")}>
            <span className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", state === "done" ? "bg-brand text-white" : state === "current" ? "border-2 border-brand text-brand" : "border border-line text-slate-400")} aria-hidden>
              {state === "done" ? <Check className="size-3.5" /> : state === "current" ? <Clock className="size-3.5" /> : <Circle className="size-2.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-sm font-bold">{stageLabel(s.stage)}<span className="text-[11px] font-semibold text-sub">· {s.owner}</span>
                {state === "done" && <span className="text-[11px] font-bold text-emerald-700">Done</span>}
                {state === "current" && <span className="text-[11px] font-bold text-brand">{ended ? (o.closed ? "Closed" : "Cancelled") : o.hold ? o.hold : "In progress"}</span>}
              </div>
              {state === "done" && <div className="text-xs text-sub" data-testid="step-by">{by ? <>by <b className="text-ink">{by.actor}</b> ({ROLE_NAME[by.role] ?? by.role}) · {when(by.at)}{by.reason ? ` · “${by.reason}”` : ""}</> : "Completed"}</div>}
              {state === "current" && <>
                <div className="text-xs text-sub">{s.todo}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-sub">
                  {["colour_grading", "designing", "printing", "qc"].includes(s.stage) && <span data-testid="step-assignee">{assigned ? <span className="inline-flex items-center gap-1">With <Avatar name={assigned} size={16} /><b className="text-ink">{assigned}</b></span> : <span className="font-semibold text-amber-700">Not assigned yet</span>}</span>}
                  {into && <span>since {when(into.at)} (sent by {into.actor})</span>}
                </div>
              </>}
            </div>
            {mine && s.link && <Link to={s.link(o)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand px-3 text-xs font-bold text-white hover:bg-brand-dark" data-testid="your-turn">Your turn <ArrowRight className="size-3.5" /></Link>}
            {oversee && s.link && <Link to={s.link(o)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-xs font-bold text-brand hover:bg-brand-soft" data-testid="open-step">Open {s.owner} <ArrowRight className="size-3.5" /></Link>}
            {mine && !s.link && <span className="inline-flex h-8 items-center rounded-lg bg-brand/10 px-3 text-xs font-bold text-brand" data-testid="your-turn">Your turn: use the buttons above</span>}
          </li>
        );
      })}
    </ol>
  );
}

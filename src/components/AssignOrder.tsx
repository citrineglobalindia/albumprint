import { useEffect, useState } from "react";
import { UserPlus, Wand2 } from "lucide-react";
import { Avatar, cx, inputCls } from "./ui";
import { useStore } from "../lib/store";
import { stageLabel, type Order } from "../lib/data";
import { editOrder } from "../lib/orderEdit";
import { createGradingJob, gjob } from "../lib/production";
import { allStaff, assignRules, deptOf, loadAssignRules, staffOf } from "../lib/autoAssign";

/** The order page's "Assigned To": who has it, and (admins) Assign / Change — the department's staff first. At Colour Grading it assigns the grading job too. */
export function AssignOrder({ o, canAssign, onDone }: { o: Order; canAssign: boolean; onDone: (msg: string, ok: boolean) => void }) {
  useStore();
  const [open, setOpen] = useState(false); const [who, setWho] = useState("");
  useEffect(() => { void loadAssignRules(); }, []);
  const dept = deptOf(o.stage);
  const team = staffOf(dept?.stage), others = allStaff().filter((p) => !team.some((t) => t.name === p.name));
  const rule = dept ? assignRules()[dept.stage] : undefined;
  const assigned = o.assignee && o.assignee !== "—" && o.assignee !== "Unassigned" ? o.assignee : "";
  const save = () => {
    if (!who) return;
    if (o.stage === "colour_grading" && o.workflow !== "Printing") {          // the grader's queue follows the order
      const g = gjob(o.id);
      const r = createGradingJob(o.id, { colorist: who, priority: g?.priority ?? o.priority, due: g?.due ?? o.due, instructions: g?.instructions ?? "" });
      if (!r.ok) { onDone(r.msg, false); return; }
    }
    editOrder(o.id, { assignee: who }, "assign", `Assigned to ${who}${dept ? ` (${dept.label})` : ""}`);
    setOpen(false); setWho(""); onDone(`${o.id} assigned to ${who}`, true);
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="assigned-to">
      {assigned ? <><Avatar name={assigned} size={20} />{assigned}</> : <span className="text-sub">Not assigned</span>}
      {canAssign && !open && <button type="button" onClick={() => setOpen(true)} className="ml-1 inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11px] font-bold text-brand hover:bg-brand-soft"><UserPlus className="size-3" />{assigned ? "Change" : "Assign"}</button>}
      {rule && rule.mode !== "off" && <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700" title="Set in Settings › Workflow › Auto-assign"><Wand2 className="size-3" />auto-assign on</span>}
      {open && (
        <span className="mt-1 flex w-full flex-wrap items-center gap-2">
          <select aria-label="Assign to" className={cx(inputCls, "h-9 w-60 text-sm")} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">{dept ? `Choose from ${dept.label}…` : "Choose a person…"}</option>
            {team.length > 0 && <optgroup label={dept ? `${dept.label} team` : "Staff"}>{team.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</optgroup>}
            {dept && others.length > 0 && <optgroup label="Other staff">{others.map((p) => <option key={p.id} value={p.name}>{p.name}{p.dept ? ` · ${p.dept}` : ""}</option>)}</optgroup>}
          </select>
          <button type="button" disabled={!who} onClick={save} className="h-9 rounded-lg bg-brand px-3 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-40">Assign</button>
          <button type="button" onClick={() => { setOpen(false); setWho(""); }} className="h-9 rounded-lg px-2 text-xs font-bold text-sub hover:bg-slate-100">Cancel</button>
          {dept && team.length === 0 && <span className="basis-full text-[11px] font-semibold text-amber-700">No active {dept.label} staff yet — add them in Users & Roles. You can still pick anyone below.</span>}
          {o.stage === "colour_grading" && <span className="basis-full text-[11px] text-sub">At {stageLabel(o.stage)} this also assigns the grading job, so it appears in that grader's queue.</span>}
        </span>
      )}
    </span>
  );
}

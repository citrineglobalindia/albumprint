import { useEffect, useState } from "react";
import { Wand2 } from "lucide-react";
import { cx, inputCls } from "./ui";
import { useStore } from "../lib/store";
import { DEPTS, assignRules, loadAssignRules, saveAssignRules, staffOf, type AssignMode, type AssignRules } from "../lib/autoAssign";

/** Settings › Workflow: for each department, who gets an order automatically when it reaches that stage. */
export function AutoAssignSettings({ show }: { show: (m: string) => void }) {
  useStore();
  const [r, setR] = useState<AssignRules>(assignRules());
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { void loadAssignRules().then((e) => { if (e) setMsg(e); else setR(assignRules()); }); }, []);
  const set = (stage: (typeof DEPTS)[number]["stage"], mode: AssignMode, person?: string) => setR({ ...r, [stage]: mode === "person" ? { mode, person: person ?? r[stage]?.person } : { mode } });
  const save = async () => { setBusy(true); setMsg(""); const e = await saveAssignRules(r); setBusy(false); if (e) setMsg(e); else show("Auto-assign rules saved"); };
  return (
    <section className="rounded-xl border border-line p-4" data-testid="auto-assign-settings">
      <div className="mb-1 flex items-center gap-2 text-sm font-extrabold"><Wand2 className="size-4 text-brand" />Auto-assign jobs</div>
      <p className="mb-3 text-xs text-sub">When an order reaches a department, it is assigned automatically and that person is notified. Admins can still change it on the order page.</p>
      <div className="space-y-2">
        {DEPTS.map((d) => {
          const cur = r[d.stage] ?? { mode: "off" as AssignMode }; const people = staffOf(d.stage);
          return (
            <div key={d.stage} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2">
              <span className="w-36 text-sm font-bold">{d.label}</span>
              <select aria-label={`Auto-assign ${d.label}`} className={cx(inputCls, "h-9 w-56 text-sm")} value={cur.mode} onChange={(e) => set(d.stage, e.target.value as AssignMode)}>
                <option value="off">Off — assign by hand</option>
                <option value="least_busy">Least busy {d.label} person</option>
                <option value="person">Always a specific person</option>
              </select>
              {cur.mode === "person" && <select aria-label={`Person for ${d.label}`} className={cx(inputCls, "h-9 w-56 text-sm")} value={cur.person ?? ""} onChange={(e) => set(d.stage, "person", e.target.value)}>
                <option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
              <span className={cx("text-xs", people.length ? "text-sub" : "font-semibold text-amber-700")}>{people.length ? `${people.length} active in ${d.label}` : `No ${d.label} staff yet — add them in Users & Roles`}</span>
            </div>);
        })}
      </div>
      {msg && <p role="alert" className="mt-2 text-sm font-semibold text-rose-600">{msg}</p>}
      <button type="button" onClick={() => void save()} disabled={busy} className="mt-3 h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-50">Save auto-assign</button>
    </section>
  );
}

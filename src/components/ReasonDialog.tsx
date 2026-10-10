import { useState, type ReactNode } from "react";
import { cx, inputCls } from "./ui";

interface Opts {
  title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean;
  /** Optional drop-down shown above the reason (e.g. target stage for an admin override). */
  choice?: { label: string; options: { value: string; label: string }[] };
  placeholder?: string;
}
type Done = (reason: string, choice: string) => void;

/** Shared "a reason is required" dialog. `const [dialog, askReason] = useReason();` render `{dialog}` once; `askReason({title}, (reason, choice) => …)`. */
export function useReason() {
  const [st, setSt] = useState<{ o: Opts; yes: Done } | null>(null);
  const node = st ? <ReasonBody key={st.o.title} o={st.o} onCancel={() => setSt(null)} onOk={(r, c) => { const y = st.yes; setSt(null); y(r, c); }} /> : null;
  return [node, (o: Opts, yes: Done) => setSt({ o, yes })] as const;
}

function ReasonBody({ o, onCancel, onOk }: { o: Opts; onCancel: () => void; onOk: Done }) {
  const [reason, setReason] = useState("");
  const [choice, setChoice] = useState(o.choice?.options[0]?.value ?? "");
  const [err, setErr] = useState("");
  const submit = () => { if (reason.trim().length < 3) { setErr("A reason is required (at least 3 characters)."); return; } onOk(reason.trim(), choice); };
  return (
    <div className="fixed inset-0 z-[75] grid place-items-center bg-ink/40 p-4" onMouseDown={onCancel}>
      <div role="dialog" aria-label={o.title} aria-modal="true" data-testid="reason-dialog" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl sm:p-6" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold">{o.title}</h3>
        {o.message && <p className="mt-1.5 text-sm text-sub">{o.message}</p>}
        {o.choice && (
          <label className="mt-4 block">
            <span className="mb-1.5 block text-[13px] font-semibold">{o.choice.label}</span>
            <select value={choice} onChange={(e) => setChoice(e.target.value)} className={inputCls} data-testid="reason-choice">{o.choice.options.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
          </label>
        )}
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-semibold">Reason <span className="text-rose-600">*</span></span>
          <textarea autoFocus data-testid="reason-input" value={reason} onChange={(e) => { setReason(e.target.value); setErr(""); }} aria-invalid={!!err} aria-describedby={err ? "reason-err" : undefined}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder={o.placeholder ?? "Why is this needed? Recorded in the audit trail."} className={cx(inputCls, "h-24 resize-none py-2", err && "border-rose-400")} />
        </label>
        {err && <p id="reason-err" role="alert" className="mt-1 text-xs font-semibold text-rose-600">{err}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="h-11 rounded-lg px-4 text-sm font-bold hover:bg-slate-100">Cancel</button>
          <button type="button" data-testid="reason-confirm" onClick={submit} className={cx("h-11 rounded-lg px-5 text-sm font-bold text-white", o.danger ? "bg-rose-600 hover:bg-rose-700" : "bg-brand hover:bg-brand-dark")}>{o.confirmLabel ?? "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

import { useState, type ReactNode } from "react";
import { cx } from "./ui";

interface Opts { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }

/** `const [dialog, confirm] = useConfirm();` render `{dialog}` once; `confirm({title, message}, () => doIt())`. */
export function useConfirm() {
  const [st, setSt] = useState<{ o: Opts; yes: () => void } | null>(null);
  const node = st ? (
    <div className="fixed inset-0 z-[58] grid place-items-center bg-ink/40 p-4" onClick={() => setSt(null)}>
      <div role="alertdialog" aria-label={st.o.title} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold">{st.o.title}</h3>
        <p className="mt-2 text-sm text-sub">{st.o.message}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={() => setSt(null)} className="h-10 rounded-lg px-4 text-sm font-bold hover:bg-slate-100">Cancel</button>
          <button onClick={() => { const y = st.yes; setSt(null); y(); }} className={cx("h-10 rounded-lg px-5 text-sm font-bold text-white", st.o.danger ? "bg-rose-600 hover:bg-rose-700" : "bg-brand hover:bg-brand-dark")}>{st.o.confirmLabel ?? "Confirm"}</button>
        </div>
      </div>
    </div>
  ) : null;
  return [node, (o: Opts, yes: () => void) => setSt({ o, yes })] as const;
}

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cx } from "./ui";

/** Like useToast, but with an error/warning variant for workflow-engine refusals. `const [node, ok, err] = useNotice()`. */
export function useNotice() {
  const [m, setM] = useState<{ msg: string; err: boolean; n: number } | null>(null);
  const t = useRef<number | undefined>(undefined);
  const push = useCallback((msg: string, err: boolean) => {
    setM((p) => ({ msg, err, n: (p?.n ?? 0) + 1 }));
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setM(null), err ? 6000 : 3200);
  }, []);
  const ok = useCallback((msg: string) => push(msg, false), [push]);
  const err = useCallback((msg: string) => push(msg, true), [push]);
  const node = m ? (
    <div role={m.err ? "alert" : "status"} aria-live={m.err ? "assertive" : "polite"} data-testid={m.err ? "notice-error" : "notice-ok"}
      className={cx("fixed bottom-4 left-4 right-4 z-[80] mx-auto flex max-w-xl items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-2xl sm:bottom-6", m.err ? "bg-rose-700" : "bg-ink")}>
      {m.err ? <AlertTriangle className="size-4 shrink-0" aria-hidden /> : <CheckCircle2 className="size-4 shrink-0 text-emerald-400" aria-hidden />}
      <span className="min-w-0">{m.msg}</span>
    </div>
  ) : null;
  return [node, ok, err] as const;
}

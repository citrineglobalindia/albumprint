import { useCallback, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";

/** Minimal toast: `const [toast, show] = useToast();` render `{toast}` once in the page. */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setMsg(null), 2800);
  }, []);
  const node = msg ? (
    <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white shadow-2xl">
      <CheckCircle2 className="size-4 text-emerald-400" />
      {msg}
    </div>
  ) : null;
  return [node, show] as const;
}

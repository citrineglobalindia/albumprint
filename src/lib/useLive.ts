import { useEffect, useReducer } from "react";
import { useStore } from "./store";
import { onAudit } from "./audit";

/** Re-renders when ORDERS/CUSTOMERS change via notify() OR a new AUDIT row is written. Returns a tick that changes each time (use as a memo dependency). */
export function useLive(poll = true): number {
  useStore();
  const [tick, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const off = onAudit(bump);
    const t = poll ? window.setInterval(bump, 4000) : 0;   // picks up silent mutations (file register, proofs)
    return () => { off(); if (t) window.clearInterval(t); };
  }, [poll]);
  return tick;
}

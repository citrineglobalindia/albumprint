import { useEffect, useReducer } from "react";
import { presetRange, type DateRange } from "../components/controls";
import { ORDERS, CUSTOMERS, STAGES, type Order, type StageKey } from "./data";

// ORDERS / CUSTOMERS are mutable shared arrays. Mutate in place, then call notify() so mounted views re-render.
const subs = new Set<() => void>();
export const notify = () => subs.forEach((f) => f());
/** Re-render the calling component whenever shared data changes via notify(). */
export function useStore() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { subs.add(bump); return () => { subs.delete(bump); }; }, []);
}
export function patchOrder(id: string, p: Partial<Order>) { const o = ORDERS.find((x) => x.id === id); if (o) { Object.assign(o, p); notify(); } return o; }
export const progressFor = (k: StageKey) => Math.min(100, ((STAGES.findIndex((s) => s.key === k) + 1) / STAGES.length) * 100 | 0);
export function moveOrder(id: string, stage: StageKey) { return patchOrder(id, { stage, progress: progressFor(stage) }); }
export const SKIPPED_FOR_PRINTING: StageKey[] = ["colour_grading", "admin_approval", "designing", "client_review", "final_approval"];
export { ORDERS, CUSTOMERS };

/** Press "/" anywhere (outside inputs) to focus the first input inside the referenced element. */
export function useSlashFocus(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable))) return;
      const el = ref.current?.querySelector("input");
      if (el) { e.preventDefault(); el.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [ref]);
}

/** DateRange <-> JSON-safe form (for SavedViews). */
export const packRange = (r: DateRange) => ({ preset: r.preset, from: r.from ? r.from.toISOString() : null, to: r.to ? r.to.toISOString() : null });
export const unpackRange = (r: { preset: string; from: string | null; to: string | null } | undefined): DateRange =>
  !r ? presetRange("All Time") : r.preset !== "Custom" ? presetRange(r.preset) : { preset: "Custom", from: r.from ? new Date(r.from) : null, to: r.to ? new Date(r.to) : null };

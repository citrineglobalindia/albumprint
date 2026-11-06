import type { RealtimeChannel } from "@supabase/supabase-js";
import { notify } from "../store";
import { backendOn, hydrateAll, rehydrate, sb } from "./core";

// Live updates. Supabase Realtime tells us when a row changes (migration 0049 publishes the tables; row-level security still applies),
// and we reload just the data that changed, a moment later so a burst of changes is one reload. If Realtime can't connect
// (blocked network, local stand-in), the app falls back to refreshing every few seconds while the tab is visible.
const LOADER: Record<string, string> = {
  orders: "customers and orders", customers: "customers and orders", order_albums: "customers and orders", order_items: "customers and orders", order_specs: "customers and orders",
  order_pricing: "order pricing",
  tasks: "production", production_events: "production", print_jobs: "production", print_stage_log: "production", print_exceptions: "production",
  print_vendor_jobs: "production", qc_inspections: "production", rework_tasks: "production", deliveries: "production",
  order_files: "files",
  proofs: "proofs and design", proof_comments: "proofs and design", design_corrections: "proofs and design", design_docs: "proofs and design",
  payments: "payments and invoices", invoices: "payments and invoices",
  notifications: "settings, masters and notifications", settings: "settings, masters and notifications",
};
// orders first: the other loaders map order ids to codes
const ORDER = ["customers and orders", "order pricing", "production", "files", "proofs and design", "payments and invoices", "settings, masters and notifications"];
const FALLBACK = ["customers and orders", "production", "files", "proofs and design", "settings, masters and notifications"];
const DEBOUNCE_MS = 700, POLL_MS = 10_000;

export type LiveState = "off" | "connecting" | "live" | "polling";
let state: LiveState = "off";
const subs = new Set<(s: LiveState) => void>();
export const liveState = () => state;
export const onLiveState = (f: (s: LiveState) => void) => { subs.add(f); return () => { subs.delete(f); }; };
const setState = (s: LiveState) => { if (s !== state) { state = s; subs.forEach((f) => f(s)); notify(); } };

let channel: RealtimeChannel | null = null;
let pending = new Set<string>(), timer = 0, poll = 0, running = false, lastFull = Date.now();

async function flush() {
  timer = 0;
  if (running) { timer = window.setTimeout(() => void flush(), DEBOUNCE_MS); return; }   // one reload at a time
  const names = ORDER.filter((n) => pending.has(n)); pending = new Set();
  if (!names.length) return;
  running = true;
  try { await rehydrate(names); } finally { running = false; notify(); }
}
/** Ask for a reload of some loaders (debounced). Exported for tests and for screens that know something changed elsewhere. */
export function queueReload(names: string[]) {
  names.forEach((n) => pending.add(n));
  if (!timer) timer = window.setTimeout(() => void flush(), DEBOUNCE_MS);
}

function startPolling() {
  if (poll) return;
  setState("polling");
  poll = window.setInterval(() => { if (document.visibilityState === "visible") queueReload(FALLBACK); }, POLL_MS);
}
function stopPolling() { if (poll) { window.clearInterval(poll); poll = 0; } }

const onVisible = () => {
  if (document.visibilityState !== "visible") return;
  // back on the tab after a while: realtime may have missed changes while the device slept
  if (Date.now() - lastFull > 60_000) { lastFull = Date.now(); void hydrateAll().then(notify); }
};

/** Start listening (after sign-in and the first load). Safe to call again. */
export function startLive() {
  if (!backendOn || channel) return;
  setState("connecting");
  let ch = sb().channel("albumpro-live");
  for (const table of Object.keys(LOADER)) {
    ch = ch.on("postgres_changes" as never, { event: "*", schema: "public", table } as never, () => queueReload([LOADER[table]]));
  }
  // if it hasn't connected in a few seconds, poll meanwhile; realtime takes over when it connects
  const fallback = window.setTimeout(() => { if (state !== "live") startPolling(); }, 8000);
  channel = ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      window.clearTimeout(fallback); stopPolling(); setState("live");
      queueReload(FALLBACK);                                                    // catch anything that changed while connecting
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      if (channel) startPolling();
    }
  });
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}

/** Stop listening (sign-out). */
export function stopLive() {
  stopPolling();
  if (timer) { window.clearTimeout(timer); timer = 0; }
  pending = new Set();
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("focus", onVisible);
  const ch = channel; channel = null;
  if (ch) void sb().removeChannel(ch);
  setState("off");
}

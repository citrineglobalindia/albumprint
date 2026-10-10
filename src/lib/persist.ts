// Keeps the in-memory demo data across page reloads (localStorage). When the real backend is wired in,
// this module is the single seam to replace: each registered collection becomes an API-backed store.
const PREFIX = "albumpro.v1.";
const registry: { key: string; arr: unknown[]; last: string }[] = [];

function read(key: string): unknown[] | null {
  try { const v = localStorage.getItem(PREFIX + key); const j = v ? JSON.parse(v) : null; return Array.isArray(j) ? j : null; } catch { return null; }
}
function write(e: { key: string; arr: unknown[]; last: string }) {
  try { const s = JSON.stringify(e.arr); if (s !== e.last) { localStorage.setItem(PREFIX + e.key, s); e.last = s; } } catch { /* quota or private mode: stay in-memory */ }
}

/** Replace the array's contents with the saved copy (if any) and autosave it from now on. */
export function persistArray<T>(key: string, arr: T[], opts: { cap?: number } = {}): T[] {
  const saved = read(key);
  if (saved) arr.splice(0, arr.length, ...(saved as T[]));
  const e = { key, arr: arr as unknown[], last: saved ? JSON.stringify(saved) : "" };
  registry.push(e);
  if (opts.cap) Object.defineProperty(e, "cap", { value: opts.cap });
  return arr;
}

export function flushAll() { registry.forEach((e) => { const cap = (e as { cap?: number }).cap; if (cap && e.arr.length > cap) e.arr.length = cap; write(e); }); }

if (typeof window !== "undefined") {
  window.setInterval(flushAll, 1200);
  window.addEventListener("beforeunload", flushAll);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushAll());
}

/** Wipe saved demo data and reload with the original seed. */
export function resetDemoData() {
  try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  window.location.reload();
}
export const savedKeys = () => { try { return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)); } catch { return []; } };

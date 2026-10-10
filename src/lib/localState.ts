import { useEffect, useState } from "react";
// Small keyed JSON store for non-array demo state (masters, pricing, roles...). Keys live under the same
// "albumpro.v1." prefix as persist.ts so "Reset demo data" and backup/restore see them.
const PREFIX = "albumpro.v1.";
export function loadJson<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(PREFIX + key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
export function saveJson(key: string, value: unknown) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* quota / private mode: stay in-memory */ }
}

/** useState that restores from / autosaves to localStorage (JSON). */
export function usePersistentState<T>(key: string, init: () => T) {
  const [v, setV] = useState<T>(() => loadJson<T>(key, undefined as unknown as T) ?? init());
  useEffect(() => { saveJson(key, v); }, [key, v]);
  return [v, setV] as const;
}

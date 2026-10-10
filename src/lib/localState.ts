import { useEffect, useState } from "react";
import { backendOn } from "./supabase";

// Small keyed JSON store for non-array state (masters, pricing, settings...).
//  • Demo mode: keys live in localStorage under the same "albumpro.v1." prefix as persist.ts, so "Reset demo data" and backup/restore see them.
//  • Backend mode: the database is the source of truth. Values live in memory, are filled from the database after sign-in (hydrateJson),
//    and every change is written through in the background by the writer that src/lib/db/admin.ts registers. A refused write reverts the value.
const PREFIX = "albumpro.v1.";
const mem = new Map<string, string>();                       // backend mode only (JSON strings)

export type JsonWriter = (key: string, value: unknown, prev: unknown) => Promise<string | null> | string | null;   // resolves to an error message, or null when saved
let jsonWriter: JsonWriter | null = null;
export const registerJsonWriter = (w: JsonWriter) => { jsonWriter = w; };
const subs = new Map<string, Set<(v: unknown) => void>>();
const emitJson = (key: string, v: unknown) => subs.get(key)?.forEach((f) => f(v));

/** Backend mode: fill a key from the database (does not trigger a write). */
export function hydrateJson(key: string, value: unknown) { if (value === undefined) mem.delete(key); else mem.set(key, JSON.stringify(value)); }

export function loadJson<T>(key: string, fallback: T): T {
  if (backendOn) { const v = mem.get(key); try { return v !== undefined ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } }
  try { const v = localStorage.getItem(PREFIX + key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
export function saveJson(key: string, value: unknown) {
  if (backendOn) {
    const s = JSON.stringify(value);
    const old = mem.get(key);
    if (s === old) return;                                   // nothing changed (also stops mount-time echo writes)
    const prev = old === undefined ? undefined : JSON.parse(old);
    mem.set(key, s);
    if (!jsonWriter) return;
    void Promise.resolve(jsonWriter(key, value, prev)).then((err) => {
      if (!err) return;
      if (mem.get(key) === s) { if (prev === undefined) mem.delete(key); else mem.set(key, JSON.stringify(prev)); emitJson(key, prev); }
    });
    return;
  }
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* quota / private mode: stay in-memory */ }
}

/** useState that restores from / autosaves to localStorage (demo) or the database (backend). */
export function usePersistentState<T>(key: string, init: () => T) {
  const [v, setV] = useState<T>(() => loadJson<T>(key, undefined as unknown as T) ?? init());
  useEffect(() => { saveJson(key, v); }, [key, v]);
  useEffect(() => {      // a refused database write puts the previous value back
    if (!backendOn) return;
    const f = (x: unknown) => { if (x !== undefined) setV(x as T); };
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key)!.add(f);
    return () => { subs.get(key)?.delete(f); };
  }, [key]);
  return [v, setV] as const;
}

// ───────── Settings > flat key/value map (shared by Settings, SLA clock, production rules) ─────────
const SETTINGS_KEY = "albumpro.settings";
export type SettingsWriter = (next: Record<string, unknown>, prev: Record<string, unknown>) => Promise<string | null>;
let settingsWriter: SettingsWriter | null = null;
export const registerSettingsWriter = (w: SettingsWriter) => { settingsWriter = w; };
let settingsMem: Record<string, unknown> = {};
export const SECRET_SETTING_KEYS = ["smtp_pass", "wa_token"];       // never stored in the database or mirrored to browser storage in backend mode

/** The saved settings (flat keys such as bh_start, wf_stages). Backend mode mirrors them into localStorage so older readers keep working. */
export function loadSettings(): Record<string, unknown> {
  if (backendOn) return settingsMem;
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Record<string, unknown>; } catch { return {}; }
}
export function hydrateSettings(flat: Record<string, unknown>) {
  settingsMem = flat;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(flat)); } catch { /* ignore */ }
}
/** Save settings. Resolves to null on success, "storage" if the browser refused (demo), or the database error message. */
export async function saveSettings(next: Record<string, unknown>): Promise<string | null> {
  if (!backendOn) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); return null; } catch { return "storage"; } }
  if (!settingsWriter) return "Backend is not ready";
  const err = await settingsWriter(next, settingsMem);
  if (!err) hydrateSettings(Object.fromEntries(Object.entries(next).filter(([k]) => !SECRET_SETTING_KEYS.includes(k))));
  return err;
}

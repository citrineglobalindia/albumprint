// Album sizes for pickers: the admin's list (Masters), every size already used on an order, and custom sizes typed on
// this device — so a custom size is typed once and offered from then on.
import { SIZES } from "./pricing";
import { ORDERS } from "./data";

const KEY = "albumpro.customSizes";
const CUSTOM = "Custom";
const read = (): string[] => { try { const j = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(j) ? j.filter((x) => typeof x === "string") : []; } catch { return []; } };

/** Tidy a typed size: "15 X 24 " → "15x24". */
export const cleanSize = (v: string) => v.trim().replace(/\s*[xX×*]\s*/g, "x").replace(/\s+/g, " ").slice(0, 40);

/** Remember a custom size (no-op for an empty one or one already in the admin list). */
export function rememberSize(v: string) {
  const s = cleanSize(v);
  if (!s || s.toLowerCase() === CUSTOM.toLowerCase() || SIZES.includes(s)) return;
  const list = read().filter((x) => x.toLowerCase() !== s.toLowerCase());
  try { localStorage.setItem(KEY, JSON.stringify([s, ...list].slice(0, 30))); } catch { /* private mode */ }
}
export function forgetSize(v: string) { try { localStorage.setItem(KEY, JSON.stringify(read().filter((x) => x !== v))); } catch { /* ignore */ } }

/** Every size to offer, without the "Custom" placeholder: the admin's list first, then saved and used custom sizes. */
export function sizeOptions(current?: string): string[] {
  const out: string[] = [];
  const add = (s?: string) => { const c = (s ?? "").trim(); if (c && c !== CUSTOM && !out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c); };
  SIZES.forEach(add); read().forEach(add); ORDERS.forEach((o) => add(o.size)); add(current);
  return out;
}
/** Saved/used sizes that are not in the admin's list. */
export const customSizes = () => { const base = new Set(SIZES.map((s) => s.toLowerCase())); return sizeOptions().filter((s) => !base.has(s.toLowerCase())); };

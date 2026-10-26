import { useMemo, useSyncExternalStore } from "react";
import { backendOn } from "./supabase";

export interface Notif { id: string; title: string; body: string; time: string; to: string; read: boolean; roles?: string[] }   // roles (demo): who the notification is for; none = everyone

// Demo mode: a seeded in-memory list. Backend mode: starts empty and is filled from the per-user `notifications` table (src/lib/db/admin.ts).
const KEY = "albumpro.v1.notifs";
const saved = (): Notif[] | null => { if (backendOn) return null; try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); return Array.isArray(v) ? (v as Notif[]) : null; } catch { return null; } };
let items: Notif[] = backendOn ? [] : saved() ?? [
  { id: "n1", title: "WhatsApp message failed", body: "IDP00067 dispatch update: number not on WhatsApp", time: "2h ago", to: "/notifications", read: false },
  { id: "n2", title: "Client replied", body: "IDP00071: requested page 12 colour change", time: "3h ago", to: "/notifications", read: false },
  { id: "n3", title: "Payment received", body: "INR 25,000 against IDP00072 (UPI)", time: "4h ago", to: "/payments", read: false },
  { id: "n4", title: "QC failed", body: "IDP00064: colour shift detected", time: "Yesterday", to: "/qc", read: true },
  { id: "n5", title: "Design submitted", body: "IDP00070 awaiting Admin review", time: "Yesterday", to: "/designing", read: true },
  { id: "n6", title: "Order created", body: "IDP00069 for Meera Studio", time: "2 days ago", to: "/orders", read: true },
];
const subs = new Set<() => void>();
const emit = () => { if (!backendOn) { try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, 100))); } catch { /* private mode */ } } subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Backend hooks (set by src/lib/db/admin.ts): persist read state. */
interface Sync { read(ids: string[]): void }
let sync: Sync | null = null;
export const bindNotifSync = (s: Sync) => { sync = s; };

/** Called when a notification arrives that the user has not seen (the bell polls the database; demo events are immediate). */
const arriveSubs = new Set<(n: Notif[]) => void>();
export const onNotifArrive = (f: (n: Notif[]) => void) => { arriveSubs.add(f); return () => { arriveSubs.delete(f); }; };
let loaded = false;
const roleNow = () => { try { return localStorage.getItem("albumpro.role") ?? ""; } catch { return ""; } };

export const notifStore = {
  get: () => items,
  /** Backend mode: replace the list with the signed-in user's rows. */
  setAll(next: Notif[]) { const known = new Set(items.map((i) => i.id)); const fresh = loaded ? next.filter((n) => !n.read && !known.has(n.id)) : []; loaded = true; items = next; emit(); if (fresh.length) arriveSubs.forEach((f) => f(fresh)); },
  markAllRead() { const ids = items.filter((n) => !n.read).map((n) => n.id); items = items.map((n) => (n.read ? n : { ...n, read: true })); emit(); if (ids.length) sync?.read(ids); },
  markRead(id: string) { const was = items.find((n) => n.id === id); items = items.map((n) => (n.id === id ? { ...n, read: true } : n)); emit(); if (was && !was.read) sync?.read([id]); },
  push(n: Omit<Notif, "id" | "read">) { const item: Notif = { ...n, id: `n${Date.now()}${Math.random().toString(36).slice(2, 6)}`, read: false }; items = [item, ...items]; emit(); if (!item.roles || item.roles.includes(roleNow())) arriveSubs.forEach((f) => f([item])); },
};
/** The signed-in user's notifications (demo mode also filters by role). */
export const useNotifs = () => {
  const all = useSyncExternalStore(subscribe, notifStore.get, notifStore.get), role = roleNow();
  return useMemo(() => all.filter((n) => !n.roles || n.roles.includes(role)), [all, role]);
};

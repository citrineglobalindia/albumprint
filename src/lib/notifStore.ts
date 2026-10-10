import { useSyncExternalStore } from "react";
import { backendOn } from "./supabase";

export interface Notif { id: string; title: string; body: string; time: string; to: string; read: boolean }

// Demo mode: a seeded in-memory list. Backend mode: starts empty and is filled from the per-user `notifications` table (src/lib/db/admin.ts).
let items: Notif[] = backendOn ? [] : [
  { id: "n1", title: "WhatsApp message failed", body: "IDP00067 dispatch update: number not on WhatsApp", time: "2h ago", to: "/notifications", read: false },
  { id: "n2", title: "Client replied", body: "IDP00071: requested page 12 colour change", time: "3h ago", to: "/notifications", read: false },
  { id: "n3", title: "Payment received", body: "INR 25,000 against IDP00072 (UPI)", time: "4h ago", to: "/payments", read: false },
  { id: "n4", title: "QC failed", body: "IDP00064: colour shift detected", time: "Yesterday", to: "/qc", read: true },
  { id: "n5", title: "Design submitted", body: "IDP00070 awaiting Admin review", time: "Yesterday", to: "/designing", read: true },
  { id: "n6", title: "Order created", body: "IDP00069 for Meera Studio", time: "2 days ago", to: "/orders", read: true },
];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Backend hooks (set by src/lib/db/admin.ts): persist read state. */
interface Sync { read(ids: string[]): void }
let sync: Sync | null = null;
export const bindNotifSync = (s: Sync) => { sync = s; };

export const notifStore = {
  get: () => items,
  /** Backend mode: replace the list with the signed-in user's rows. */
  setAll(next: Notif[]) { items = next; emit(); },
  markAllRead() { const ids = items.filter((n) => !n.read).map((n) => n.id); items = items.map((n) => (n.read ? n : { ...n, read: true })); emit(); if (ids.length) sync?.read(ids); },
  markRead(id: string) { const was = items.find((n) => n.id === id); items = items.map((n) => (n.id === id ? { ...n, read: true } : n)); emit(); if (was && !was.read) sync?.read([id]); },
  push(n: Omit<Notif, "id" | "read">) { items = [{ ...n, id: `n${Date.now()}`, read: false }, ...items]; emit(); },
};
export const useNotifs = () => useSyncExternalStore(subscribe, notifStore.get, notifStore.get);

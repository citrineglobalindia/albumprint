import { backendOn } from "./supabase";
import type { RoleKey } from "./auth";

// Extra modules per user, on top of their role (migration 0057, user_modules): e.g. a designer who also handles Printing.
// The database honours them in has_perm; here they open the menu items, pages and job actions of those modules.
export type Module = "order" | "customer" | "grading" | "design" | "printing" | "qc" | "delivery" | "payments" | "invoices" | "reports";
export const MODULES: { key: Module; label: string; routes: string[] }[] = [
  { key: "order", label: "Orders", routes: ["/orders"] },
  { key: "customer", label: "Customers", routes: ["/customers"] },
  { key: "grading", label: "Colour Grading", routes: ["/colour-grading", "/my-jobs"] },
  { key: "design", label: "Album Designing", routes: ["/designing", "/my-jobs"] },
  { key: "printing", label: "Printing & Labs", routes: ["/printing", "/labs"] },
  { key: "qc", label: "Quality Control", routes: ["/qc"] },
  { key: "delivery", label: "Delivery", routes: ["/delivery"] },
  { key: "payments", label: "Payments", routes: ["/payments"] },
  { key: "invoices", label: "Invoices", routes: ["/invoices"] },
  { key: "reports", label: "Reports", routes: ["/reports"] },
];
/** The role that normally owns each module (used for in-app checks that are written per role). */
export const MODULE_ROLE: Partial<Record<Module, RoleKey>> = { grading: "colour", design: "designer", printing: "printing", qc: "qc", delivery: "reception", payments: "accounts", invoices: "accounts", order: "reception", customer: "reception" };

let mine: Module[] = [];
const subs = new Set<() => void>();
export const myModules = () => mine;
export const hasModule = (m: Module) => mine.includes(m);
export const onModules = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function setMyModules(m: Module[]) { mine = [...new Set(m)]; subs.forEach((f) => f()); }
export const extraRoutes = () => MODULES.filter((m) => mine.includes(m.key)).flatMap((m) => m.routes);
/** The signed-in user acts like the module's usual role for in-app checks, e.g. a designer with Printing can advance print jobs. */
export const actsAs = (role: RoleKey | null | undefined, r: RoleKey) => role === r || mine.some((m) => MODULE_ROLE[m] === r);

// demo mode: grants kept in this browser, per user id
const DEMO_KEY = "albumpro.v1.user_modules";
export function demoGrants(): Record<string, Module[]> { try { return JSON.parse(localStorage.getItem(DEMO_KEY) ?? "{}") as Record<string, Module[]>; } catch { return {}; } }
export function saveDemoGrants(userId: string, mods: Module[]) { const g = demoGrants(); g[userId] = mods; try { localStorage.setItem(DEMO_KEY, JSON.stringify(g)); } catch { /* private mode */ } }

/** Load the signed-in user's extra modules (database: their user_modules rows). */
export async function loadMyModules(userIdOrEmail: string): Promise<void> {
  if (!backendOn) {
    const { loadUsers } = await import("./users");
    const u = loadUsers().find((x) => x.email.toLowerCase() === userIdOrEmail.toLowerCase() || x.id === userIdOrEmail);
    setMyModules(u ? demoGrants()[u.id] ?? [] : []); return;
  }
  const { sb } = await import("./db/core");
  const { data } = await sb().from("user_modules").select("module").eq("user_id", userIdOrEmail);
  setMyModules(((data ?? []) as { module: Module }[]).map((r) => r.module));
}

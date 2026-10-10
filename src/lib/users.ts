import { STAFF, type Staff } from "./data";

// Persisted user directory (shared by Users & Roles and the login screen). Key is read by Login via isUserActive().
const KEY = "albumpro.users";
export function loadUsers(): Staff[] {
  try { const v = localStorage.getItem(KEY); const j = v ? JSON.parse(v) : null; if (Array.isArray(j) && j.length) return j as Staff[]; } catch { /* ignore */ }
  return STAFF.map((u) => ({ ...u }));
}
export function saveUsers(users: Staff[]) { try { localStorage.setItem(KEY, JSON.stringify(users)); } catch { /* ignore */ } }

/** false only when a saved user with this email (or mobile digits) exists and is Inactive. Unknown identifiers are not blocked (demo). */
export function isUserActive(identifier: string): boolean {
  const id = identifier.trim().toLowerCase();
  if (!id) return true;
  const digits = id.replace(/\D/g, "");
  const u = loadUsers().find((x) => x.email.toLowerCase() === id || (digits.length >= 10 && x.mobile.replace(/\D/g, "").slice(-10) === digits.slice(-10)));
  return !u || u.status === "Active";
}

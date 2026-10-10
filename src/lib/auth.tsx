import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, backendOn } from "./supabase";
import ChangePassword from "../pages/ChangePassword";
import { Navigate, useLocation } from "react-router-dom";

// SRS §1.2 role model. Demo-only auth: replace with real session/MFA service.
export type RoleKey = "admin" | "reception" | "colour" | "designer" | "printing" | "qc" | "accounts";

export const ROLES: Record<RoleKey, { label: string; user: string; email: string; dept: string; nav: string[] }> = {
  admin: { label: "Admin", user: "Admin", email: "admin@albumpro.com", dept: "Head Office", nav: ["/", "/orders", "/customers", "/pipeline", "/colour-grading", "/designing", "/printing", "/qc", "/delivery", "/payments", "/invoices", "/reports", "/masters", "/users", "/settings", "/notifications", "/control", "/audit", "/files"] },
  reception: { label: "Reception", user: "Priya N", email: "priya@albumpro.com", dept: "Reception", nav: ["/", "/orders", "/customers", "/delivery", "/payments", "/notifications", "/files"] },
  colour: { label: "Colour Grading", user: "Karthik V", email: "karthik@albumpro.com", dept: "Colour Grading", nav: ["/", "/colour-grading"] },
  designer: { label: "Designing", user: "Ramesh Kumar", email: "ramesh@albumpro.com", dept: "Designing", nav: ["/", "/designing"] },
  printing: { label: "Printing", user: "Manjunath P", email: "manjunath@albumpro.com", dept: "Printing", nav: ["/", "/printing"] },
  qc: { label: "QC", user: "Divya S", email: "divya@albumpro.com", dept: "Quality Control", nav: ["/", "/qc", "/delivery"] },
  accounts: { label: "Accounts", user: "Suresh B", email: "suresh@albumpro.com", dept: "Accounts", nav: ["/", "/payments", "/invoices", "/reports"] },
};

export interface AuthResult { ok: boolean; error?: string; needsConfirmation?: boolean }
interface Auth {
  role: RoleKey | null; user: string; email: string; loading: boolean; backend: boolean; mustChangePassword: boolean;
  finishPasswordChange: (newPassword: string) => Promise<AuthResult>;
  login: (r: RoleKey) => void;                                       // demo mode only
  signIn: (email: string, password: string) => Promise<AuthResult>;  // Supabase
  signUp: (email: string, password: string) => Promise<AuthResult>;  // Supabase (only invited emails receive a profile)
  resetPassword: (email: string) => Promise<AuthResult>;
  logout: () => void;
}
const Ctx = createContext<Auth>(null!);
const KEY = "albumpro.role";

const mirror = (r: RoleKey | null, name = "") => {      // other modules (audit, engine) read the actor from localStorage
  try { if (r) { localStorage.setItem(KEY, r); localStorage.setItem("albumpro.actor", name); } else { localStorage.removeItem(KEY); localStorage.removeItem("albumpro.actor"); } } catch { /* ignore */ }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<RoleKey | null>(() => {
    if (backendOn) return null;
    try { const v = localStorage.getItem(KEY) as RoleKey | null; return v && v in ROLES ? v : null; } catch { return null; }
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(backendOn);
  const [mustChange, setMustChange] = useState(false);

  // Supabase: load the signed-in user's profile (role comes from the database, never from the browser).
  useEffect(() => {
    if (!supabase) return;
    const sb = supabase;
    let alive = true;
    const load = async (uid: string | null) => {
      if (!uid) { if (alive) { setRole(null); setName(""); setEmail(""); mirror(null); setLoading(false); } return; }
      const { data } = await sb.from("profiles").select("full_name,email,role,active,must_change_password").eq("id", uid).maybeSingle();
      if (!alive) return;
      if (data && data.active && data.role in ROLES) {
        setRole(data.role as RoleKey); setName(data.full_name); setEmail(data.email ?? ""); setMustChange(!!data.must_change_password); mirror(data.role as RoleKey, data.full_name);
        if (!data.must_change_password) { const { hydrateAll } = await import("./db"); await hydrateAll(); }   // load customers, orders… for this user's role
      }
      else { setRole(null); mirror(null); }                       // signed in but not an invited/active staff member → no access
      setLoading(false);
    };
    sb.auth.getSession().then(({ data }) => load(data.session?.user.id ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => { setTimeout(() => load(session?.user.id ?? null), 0); });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const login = (r: RoleKey) => { mirror(r, ROLES[r].user); setRole(r); };
  const signIn: Auth["signIn"] = async (e, p) => {
    if (!supabase) return { ok: false, error: "Backend is not configured" };
    const { error } = await supabase.auth.signInWithPassword({ email: e.trim().toLowerCase(), password: p });
    return error ? { ok: false, error: error.message } : { ok: true };
  };
  const signUp: Auth["signUp"] = async (e, p) => {
    if (!supabase) return { ok: false, error: "Backend is not configured" };
    const { data, error } = await supabase.auth.signUp({ email: e.trim().toLowerCase(), password: p });
    if (error) return { ok: false, error: error.message };
    return { ok: true, needsConfirmation: !data.session };
  };
  const resetPassword: Auth["resetPassword"] = async (e) => {
    if (!supabase) return { ok: true };
    const { error } = await supabase.auth.resetPasswordForEmail(e.trim().toLowerCase(), { redirectTo: `${location.origin}/login` });
    return error ? { ok: false, error: error.message } : { ok: true };
  };
  const finishPasswordChange: Auth["finishPasswordChange"] = async (pw) => {
    if (!supabase) return { ok: false, error: "Backend is not configured" };
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return { ok: false, error: error.message };
    const { error: e2 } = await supabase.rpc("complete_password_change");
    if (e2) return { ok: false, error: e2.message };
    setMustChange(false);
    const { hydrateAll } = await import("./db"); await hydrateAll();
    return { ok: true };
  };
  const logout = () => { mirror(null); setRole(null); if (supabase) void supabase.auth.signOut(); };

  return <Ctx.Provider value={{ role, user: backendOn ? name : role ? ROLES[role].user : "", email: backendOn ? email : role ? ROLES[role].email : "", loading, backend: backendOn, mustChangePassword: backendOn && mustChange, finishPasswordChange, login, signIn, signUp, resetPassword, logout }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);

/** Redirects to /login when signed out, and to "/" when the role may not open the path. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { role, loading, mustChangePassword } = useAuth();
  const { pathname } = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-sub" role="status">Loading…</div>;
  if (!role) return <Navigate to="/login" replace state={{ from: pathname }} />;
  if (mustChangePassword) return <ChangePassword />;
  const base = "/" + (pathname.split("/")[1] ?? "");
  const allowed = ROLES[role].nav.includes(base) || pathname.startsWith("/orders/") && ROLES[role].nav.includes("/orders");
  if (!allowed && pathname !== "/") return <Navigate to="/" replace />;
  return <>{children}</>;
}

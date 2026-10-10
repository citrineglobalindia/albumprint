import { createContext, useContext, useState, type ReactNode } from "react";
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

interface Auth { role: RoleKey | null; user: string; login: (r: RoleKey) => void; logout: () => void }
const Ctx = createContext<Auth>(null!);
const KEY = "albumpro.role";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<RoleKey | null>(() => {
    try { const v = localStorage.getItem(KEY) as RoleKey | null; return v && v in ROLES ? v : null; } catch { return null; }
  });
  const login = (r: RoleKey) => { try { localStorage.setItem(KEY, r); } catch { /* ignore */ } setRole(r); };
  const logout = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } setRole(null); };
  return <Ctx.Provider value={{ role, user: role ? ROLES[role].user : "", login, logout }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);

/** Redirects to /login when signed out, and to "/" when the role may not open the path. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const { pathname } = useLocation();
  if (!role) return <Navigate to="/login" replace state={{ from: pathname }} />;
  const base = "/" + (pathname.split("/")[1] ?? "");
  const allowed = ROLES[role].nav.includes(base) || pathname.startsWith("/orders/") && ROLES[role].nav.includes("/orders");
  if (!allowed && pathname !== "/") return <Navigate to="/" replace />;
  return <>{children}</>;
}

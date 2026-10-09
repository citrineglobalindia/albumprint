import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, Link } from "react-router-dom";
import {
  LayoutDashboard, ClipboardList, Users, KanbanSquare, Palette, LayoutTemplate, Printer, ShieldCheck, Truck,
  CreditCard, FileText, BarChart3, Boxes, UserCog, Settings, Search, Bell, CircleHelp, ChevronDown, Aperture, LogOut, MonitorSmartphone, MessagesSquare,
} from "lucide-react";
import { cx } from "./ui";
import { Avatar } from "./ui";
import { ORDERS, CUSTOMERS } from "../lib/data";
import { useAuth, ROLES } from "../lib/auth";

export const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/orders", label: "Orders", icon: ClipboardList },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/pipeline", label: "Production Pipeline", icon: KanbanSquare },
  { to: "/colour-grading", label: "Colour Grading", icon: Palette },
  { to: "/designing", label: "Album Designing", icon: LayoutTemplate },
  { to: "/printing", label: "Printing", icon: Printer },
  { to: "/qc", label: "Quality Control", icon: ShieldCheck },
  { to: "/delivery", label: "Delivery", icon: Truck },
  { to: "/payments", label: "Payments", icon: CreditCard },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/masters", label: "Masters", icon: Boxes },
  { to: "/users", label: "Users & Roles", icon: UserCog },
  { to: "/notifications", label: "Notifications", icon: MessagesSquare },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function Sidebar() {
  const { role } = useAuth();
  const items = NAV.filter((n) => ROLES[role!].nav.includes(n.to));
  return (
    <aside className="flex w-[220px] shrink-0 flex-col bg-side px-3 py-5 text-white">
      <div className="mb-6 flex items-center gap-2.5 px-3">
        <span className="grid size-9 place-items-center rounded-xl bg-brand"><Aperture className="size-5" /></span>
        <span className="text-xl font-extrabold tracking-tight">AlbumPro</span>
      </div>
      <nav className="scroll-thin flex flex-1 flex-col gap-1 overflow-y-auto">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition", isActive ? "bg-brand text-white shadow-lg shadow-brand/30" : "text-slate-300 hover:bg-side-hover hover:text-white")}>
            <Icon className="size-[18px]" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

function SearchBox() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); document.getElementById("global-search")?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const term = q.trim().toLowerCase();
  const orders = term ? ORDERS.filter((o) => o.id.toLowerCase().includes(term) || o.customer.toLowerCase().includes(term) || o.mobile.includes(term) || o.event.toLowerCase().includes(term)).slice(0, 5) : [];
  const customers = term ? CUSTOMERS.filter((c) => c.name.toLowerCase().includes(term) || c.studio.toLowerCase().includes(term) || c.mobile.includes(term)).slice(0, 3) : [];
  const go = (to: string) => { setOpen(false); setQ(""); nav(to); };
  return (
    <div className="relative w-full max-w-[520px]">
      <label className="flex h-11 items-center gap-2.5 rounded-xl border border-line bg-white px-3.5">
        <Search className="size-4 text-sub" />
        <input id="global-search" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Search orders, customers, mobile number..." className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" />
        <kbd className="shrink-0 whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-sub">⌘ K</kbd>
      </label>
      {open && term && (
        <div className="absolute left-0 right-0 top-12 z-40 rounded-xl border border-line bg-white p-2 shadow-xl">
          {orders.length + customers.length === 0 && <div className="px-3 py-2 text-sm text-sub">No results</div>}
          {orders.map((o) => <button key={o.id} onMouseDown={() => go(`/orders/${o.id}`)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-soft"><b>{o.id}</b><span className="text-sub">{o.customer} · {o.event}</span></button>)}
          {customers.map((c) => <button key={c.id} onMouseDown={() => go("/customers")} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-soft"><b>{c.name}</b><span className="text-sub">{c.studio} · {c.mobile}</span></button>)}
        </div>
      )}
    </div>
  );
}

function Topbar() {
  const { role, user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <header className="flex items-center justify-between gap-4 px-7 pt-5">
      <SearchBox />
      <div className="flex items-center gap-5">
        <Link to="/notifications" className="relative text-ink" aria-label="Notifications">
          <Bell className="size-5" />
          <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-rose-500 text-[10px] font-bold text-white">3</span>
        </Link>
        <button aria-label="Help"><CircleHelp className="size-5" /></button>
        <div className="relative">
          <button onClick={() => setOpen(!open)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="flex items-center gap-2.5">
            <Avatar name={user} size={38} />
            <span className="text-left leading-tight"><span className="block text-sm font-bold">{user}</span><span className="block text-[11px] text-sub">{ROLES[role!].label}</span></span>
            <ChevronDown className="size-4 text-sub" />
          </button>
          {open && (
            <div className="absolute right-0 top-12 z-40 w-60 rounded-xl border border-line bg-white p-1.5 shadow-xl">
              <div className="px-3 py-2 text-xs text-sub">{ROLES[role!].email}<br />{ROLES[role!].dept}</div>
              <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"><MonitorSmartphone className="mt-0.5 size-4 text-sub" /><span><b className="block text-[13px]">Active session</b>Chrome · this device · just now</span></div>
              <button onMouseDown={() => { logout(); nav("/login"); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold hover:bg-brand-soft"><LogOut className="size-4" />Logout</button>
              <button onMouseDown={() => { logout(); nav("/login"); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-rose-600 hover:bg-rose-50"><LogOut className="size-4" />Logout all sessions</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default function Shell() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="scroll-thin flex-1 overflow-y-auto px-7 pb-8 pt-5"><Outlet /></main>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, ClipboardList, Users, KanbanSquare, Palette, LayoutTemplate, Printer, ShieldCheck, Truck,
  CreditCard, FileText, BarChart3, Boxes, UserCog, Settings, Search, Bell, CircleHelp, ChevronDown, Aperture, LogOut, MonitorSmartphone, MessagesSquare, CheckCheck, Keyboard,
} from "lucide-react";
import { cx } from "./ui";
import { Avatar } from "./ui";
import { ORDERS, CUSTOMERS } from "../lib/data";
import { useAuth, ROLES } from "../lib/auth";
import { notifStore, useNotifs } from "../lib/notifStore";

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
  const [hi, setHi] = useState(0);
  const nav = useNavigate();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); const el = document.getElementById("global-search") as HTMLInputElement | null; el?.focus(); el?.select(); setOpen(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const term = q.trim().toLowerCase();
  const orders = term ? ORDERS.filter((o) => o.id.toLowerCase().includes(term) || o.customer.toLowerCase().includes(term) || o.mobile.includes(term) || o.event.toLowerCase().includes(term)).slice(0, 5) : [];
  const customers = term ? CUSTOMERS.filter((c) => c.name.toLowerCase().includes(term) || c.studio.toLowerCase().includes(term) || c.mobile.includes(term)).slice(0, 3) : [];
  const results = [
    ...orders.map((o) => ({ key: o.id, to: `/orders/${o.id}`, a: o.id, b: `${o.customer} · ${o.event}` })),
    ...customers.map((c) => ({ key: c.id, to: "/customers", a: c.name, b: `${c.studio} · ${c.mobile}` })),
  ];
  const go = (to: string) => { setOpen(false); setQ(""); setHi(0); (document.getElementById("global-search") as HTMLInputElement | null)?.blur(); nav(to); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); setQ(""); setHi(0); (e.target as HTMLInputElement).blur(); }
    else if (e.key === "Enter") { const r = results[hi] ?? results[0]; if (r) { e.preventDefault(); go(r.to); } }
    else if (e.key === "ArrowDown" && results.length) { e.preventDefault(); setHi((hi + 1) % results.length); }
    else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); setHi((hi - 1 + results.length) % results.length); }
  };
  return (
    <div className="relative w-full max-w-[520px]">
      <label className="flex h-11 items-center gap-2.5 rounded-xl border border-line bg-white px-3.5">
        <Search className="size-4 text-sub" />
        <input id="global-search" value={q} onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey} placeholder="Search orders, customers, mobile number..." className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" />
        <kbd className="shrink-0 whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-sub">⌘ K</kbd>
      </label>
      {open && term && (
        <div className="absolute left-0 right-0 top-12 z-40 rounded-xl border border-line bg-white p-2 shadow-xl">
          {results.length === 0 && <div className="px-3 py-2 text-sm text-sub">No results</div>}
          {results.map((r, i) => <button key={r.key} onMouseDown={() => go(r.to)} onMouseEnter={() => setHi(i)} className={cx("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm", i === hi ? "bg-brand-soft" : "hover:bg-brand-soft")}><b>{r.a}</b><span className="text-sub">{r.b}</span></button>)}
          {results.length > 0 && <div className="px-3 pb-1 pt-2 text-[11px] text-sub">Enter to open · ↑↓ to move · Esc to close</div>}
        </div>
      )}
    </div>
  );
}

function Topbar() {
  const { role, user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const [help, setHelp] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const notifs = useNotifs();
  const unread = notifs.filter((n) => !n.read).length;
  useEffect(() => { setBell(false); setHelp(false); }, [loc.pathname]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (e.key === "Escape") { setBell(false); setHelp(false); setOpen(false); }
      else if (e.key === "?" && !typing) { e.preventDefault(); setHelp((x) => !x); setBell(false); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <header className="flex items-center justify-between gap-4 px-7 pt-5">
      <SearchBox />
      <div className="flex items-center gap-5">
        <div className="relative">
          <button onClick={() => { setBell(!bell); setHelp(false); }} className="relative text-ink" aria-label="Notifications" aria-expanded={bell}>
            <Bell className="size-5" />
            {unread > 0 && <span data-testid="bell-badge" className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-rose-500 text-[10px] font-bold text-white">{unread}</span>}
          </button>
          {bell && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setBell(false)} />
              <div role="dialog" aria-label="Recent notifications" className="absolute right-0 top-9 z-40 w-[360px] rounded-xl border border-line bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <b className="text-sm">Notifications{unread > 0 && <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-600">{unread} new</span>}</b>
                  <button onClick={() => notifStore.markAllRead()} disabled={!unread} className="inline-flex items-center gap-1 text-xs font-bold text-brand disabled:opacity-40"><CheckCheck className="size-3.5" />Mark all read</button>
                </div>
                <ul className="scroll-thin max-h-80 overflow-y-auto">
                  {notifs.slice(0, 6).map((n) => (
                    <li key={n.id}><button onClick={() => { notifStore.markRead(n.id); setBell(false); nav(n.to); }} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-brand-soft">
                      <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand")} />
                      <span className="min-w-0 flex-1"><b className="block text-[13px]">{n.title}</b><span className="block truncate text-xs text-sub">{n.body}</span></span>
                      <span className="shrink-0 text-[11px] text-sub">{n.time}</span>
                    </button></li>
                  ))}
                </ul>
                <button onClick={() => { setBell(false); nav("/notifications"); }} className="block w-full border-t border-line px-4 py-3 text-center text-[13px] font-bold text-brand hover:bg-brand-soft">View all</button>
              </div>
            </>
          )}
        </div>
        <div className="relative">
          <button aria-label="Help" aria-expanded={help} onClick={() => { setHelp(!help); setBell(false); }}><CircleHelp className="size-5" /></button>
          {help && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setHelp(false)} />
              <div role="dialog" aria-label="Help and shortcuts" className="absolute right-0 top-9 z-40 w-72 rounded-xl border border-line bg-white p-4 text-[13px] shadow-xl">
                <div className="mb-2 flex items-center gap-2 font-extrabold"><Keyboard className="size-4 text-brand" />Keyboard shortcuts</div>
                <ul className="space-y-2">
                  {[["⌘/Ctrl + K", "Focus global search"], ["Enter", "Open first search result"], ["↑ ↓", "Move through results"], ["Esc", "Close search, menus and popovers"], ["?", "Toggle this help"]].map(([k, d]) => <li key={k} className="flex items-center justify-between gap-3"><span className="text-sub">{d}</span><kbd className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold">{k}</kbd></li>)}
                </ul>
                <div className="mt-3 border-t border-line pt-3">
                  <a href="mailto:support@albumpro.com?subject=AlbumPro%20help" className="font-bold text-brand hover:underline">Contact support</a>
                </div>
              </div>
            </>
          )}
        </div>
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

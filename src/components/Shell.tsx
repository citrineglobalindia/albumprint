import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, ClipboardList, Users, KanbanSquare, Palette, LayoutTemplate, Printer, ShieldCheck, Truck,
  CreditCard, FileText, BarChart3, Boxes, UserCog, Settings, Search, Bell, CircleHelp, ChevronDown, Aperture, LogOut, MonitorSmartphone, MessagesSquare, Gauge, ScrollText, FolderOpen, CheckCheck, Keyboard, Plus, UserPlus, Wallet, Clock, CornerDownLeft, Menu, X,
} from "lucide-react";
import { cx } from "./ui";
import { Avatar } from "./ui";
import { ORDERS, CUSTOMERS } from "../lib/data";
import { useAuth, ROLES } from "../lib/auth";
import { notifStore, useNotifs } from "../lib/notifStore";
import { useNewOrder } from "./NewOrderWizard";
import A11yLayer from "./A11yLayer";
import { useToast } from "./Toast";
import { onDbError } from "../lib/db/core";

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
  { to: "/control", label: "Control Center", icon: Gauge },
  { to: "/files", label: "Files", icon: FolderOpen },
  { to: "/notifications", label: "Notifications", icon: MessagesSquare },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

/** True at >= 1024px (Tailwind `lg`): the sidebar is docked. Below that it is an off-canvas drawer. */
function useDesktop() {
  const q = "(min-width: 1024px)";
  const [d, setD] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const h = () => setD(m.matches); m.addEventListener("change", h); return () => m.removeEventListener("change", h); }, []);
  return d;
}

function Sidebar({ open, desktop, onClose }: { open: boolean; desktop: boolean; onClose: () => void }) {
  const { role } = useAuth();
  const items = NAV.filter((n) => ROLES[role!].nav.includes(n.to));
  const hidden = !desktop && !open;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (open && !desktop) ref.current?.querySelector<HTMLElement>("a")?.focus(); }, [open, desktop]);
  useEffect(() => {
    if (!open || desktop) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>("a[href],button")];
      if (!f.length) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, desktop, onClose]);
  return (
    <>
      {open && !desktop && <div className="no-print fixed inset-0 z-40 bg-ink/50" onClick={onClose} aria-hidden data-testid="drawer-backdrop" />}
      <aside id="app-sidebar" ref={ref} aria-label="Main navigation" {...(!desktop && open ? { role: "dialog", "aria-modal": true } : {})} inert={hidden}
        className={cx("app-sidebar no-print flex w-[260px] shrink-0 flex-col bg-side px-3 py-5 text-white transition-transform duration-200 lg:static lg:z-auto lg:w-[220px] lg:translate-x-0", "fixed inset-y-0 left-0 z-50", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <span className="grid size-9 place-items-center rounded-xl bg-brand"><Aperture className="size-5" aria-hidden /></span>
          <span className="text-xl font-extrabold tracking-tight">AlbumPro</span>
          <button type="button" onClick={onClose} aria-label="Close menu" className="ml-auto grid size-11 place-items-center rounded-lg hover:bg-side-hover lg:hidden"><X className="size-5" /></button>
        </div>
        <nav className="app-nav scroll-thin flex flex-1 flex-col gap-1 overflow-y-auto" aria-label="Primary">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} onClick={onClose} className={({ isActive }) => cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition", isActive ? "bg-brand text-white shadow-lg shadow-brand/30" : "text-slate-300 hover:bg-side-hover hover:text-white")}>
              <Icon className="size-[18px]" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}

const RECENT_KEY = "albumpro.recent";
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; } };
const writeRecent = (q: string) => { const t = q.trim(); if (!t) return; try { localStorage.setItem(RECENT_KEY, JSON.stringify([t, ...readRecent().filter((x) => x !== t)].slice(0, 5))); } catch { /* ignore */ } };

interface Cmd { key: string; group: "Actions" | "Pages" | "Orders" | "Customers"; label: string; sub?: string; icon: ComponentType<{ className?: string }>; run: () => void }

/** Global ⌘K / Ctrl+K command palette: actions, pages, orders and customers with keyboard navigation. */
function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <PaletteInner onClose={onClose} /> : null;
}
function PaletteInner({ onClose }: { onClose: () => void }) {
  const open = true;
  const nav = useNavigate();
  const { role } = useAuth();
  const newOrder = useNewOrder();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setQ(""); setHi(0); setRecent(readRecent()); } }, [open]);
  const allowed = role ? ROLES[role].nav : [];
  const term = q.trim().toLowerCase();
  const items = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];
    const can = (p: string) => allowed.includes(p);
    const actions: Cmd[] = [
      ...(can("/orders") ? [{ key: "a-order", group: "Actions" as const, label: "New Order", sub: "Create an album order", icon: Plus, run: () => newOrder.open() }] : []),
      ...(can("/customers") ? [{ key: "a-cust", group: "Actions" as const, label: "Add Customer", sub: "Register a studio / customer", icon: UserPlus, run: () => nav("/customers?new=1") }] : []),
      ...(can("/payments") ? [{ key: "a-pay", group: "Actions" as const, label: "Record Payment", sub: "Receive an advance or balance", icon: Wallet, run: () => nav("/payments?new=1") }] : []),
      ...(can("/users") ? [{ key: "a-user", group: "Actions" as const, label: "Add User", sub: "Create a staff account", icon: UserCog, run: () => nav("/users?new=1") }] : []),
      ...(can("/reports") ? [{ key: "a-rep", group: "Actions" as const, label: "Open Reports", sub: "Charts, drill-down and exports", icon: BarChart3, run: () => nav("/reports") }] : []),
    ];
    out.push(...actions.filter((a) => !term || (a.label + " " + a.sub).toLowerCase().includes(term)));
    out.push(...NAV.filter((n) => can(n.to) && (!term || n.label.toLowerCase().includes(term))).map((n) => ({ key: "p-" + n.to, group: "Pages" as const, label: n.label, sub: n.to, icon: n.icon as ComponentType<{ className?: string }>, run: () => nav(n.to) })));
    if (term && can("/orders")) out.push(...ORDERS.filter((o) => o.id.toLowerCase().includes(term) || o.customer.toLowerCase().includes(term) || o.mobile.includes(term) || o.event.toLowerCase().includes(term)).slice(0, 5).map((o) => ({ key: "o-" + o.id, group: "Orders" as const, label: o.id, sub: `${o.customer} · ${o.event}`, icon: ClipboardList, run: () => nav(`/orders/${o.id}`) })));
    if (term && can("/customers")) out.push(...CUSTOMERS.filter((c) => c.name.toLowerCase().includes(term) || c.studio.toLowerCase().includes(term) || c.mobile.includes(term)).slice(0, 4).map((c) => ({ key: "c-" + c.id, group: "Customers" as const, label: c.name, sub: `${c.studio} · ${c.mobile}`, icon: Users, run: () => nav("/customers") })));
    return out;
  }, [term, allowed, nav, newOrder]);
  useEffect(() => { setHi(0); }, [term]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-idx="${hi}"]`)?.scrollIntoView({ block: "nearest" }); }, [hi]);
  if (!open) return null;
  const run = (c: Cmd) => { writeRecent(q); onClose(); c.run(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown" && items.length) { e.preventDefault(); setHi((hi + 1) % items.length); }
    else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); setHi((hi - 1 + items.length) % items.length); }
    else if (e.key === "Enter") { const c = items[hi]; if (c) { e.preventDefault(); run(c); } }
  };
  const groups = (["Actions", "Pages", "Orders", "Customers"] as const).map((g) => ({ g, rows: items.map((c, i) => ({ c, i })).filter(({ c }) => c.group === g) })).filter((x) => x.rows.length);
  return (
    <div className="no-print fixed inset-0 z-[70] flex items-start justify-center bg-ink/40 p-3 pt-[8vh] sm:p-4 sm:pt-[12vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <label className="flex h-14 items-center gap-3 border-b border-line px-4">
          <Search className="size-5 text-sub" aria-hidden />
          <input id="palette-input" aria-label="Search commands, pages, orders and customers" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command, page, order or customer…" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400" />
          <kbd className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-sub">Esc</kbd>
        </label>
        <div ref={listRef} role="listbox" aria-label="Results" className="scroll-thin max-h-[60dvh] overflow-y-auto p-2 sm:max-h-[52vh]">
          {!term && recent.length > 0 && (
            <div className="mb-1">
              <div className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-sub">Recent searches</div>
              <div className="flex flex-wrap gap-1.5 px-3 pb-2">{recent.map((r) => <button key={r} onClick={() => setQ(r)} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold hover:bg-brand-soft"><Clock className="size-3 text-sub" />{r}</button>)}</div>
            </div>
          )}
          {groups.map(({ g, rows }) => (
            <div key={g} role="presentation">
              <div className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-sub">{g}</div>
              {rows.map(({ c, i }) => (
                <button key={c.key} data-idx={i} role="option" aria-selected={i === hi} onMouseMove={() => i !== hi && setHi(i)} onClick={() => run(c)} className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm", i === hi ? "bg-brand-soft text-brand" : "hover:bg-slate-50")}>
                  <c.icon className="size-4 shrink-0" /><b className="font-semibold">{c.label}</b><span className="truncate text-xs text-sub">{c.sub}</span>
                  {i === hi && <CornerDownLeft className="ml-auto size-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          ))}
          {items.length === 0 && <div className="px-3 py-8 text-center text-sm text-sub">No results for “{q}”</div>}
        </div>
        <div className="hidden items-center gap-4 border-t border-line bg-slate-50 px-4 py-2 text-[11px] text-sub sm:flex"><span>↑↓ navigate</span><span>Enter run</span><span>Esc close</span><span className="ml-auto">Press ? for all shortcuts</span></div>
      </div>
    </div>
  );
}

function SearchBox({ openPalette }: { openPalette: () => void }) {
  return (
    <div className="relative hidden w-full max-w-[520px] md:block">
      <label className="flex h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-white px-3.5">
        <Search className="size-4 text-sub" />
        <input id="global-search" aria-label="Search orders, customers, mobile number" readOnly onFocus={(e) => { e.currentTarget.blur(); openPalette(); }} onClick={openPalette} placeholder="Search orders, customers, mobile number..." className="w-full cursor-pointer bg-transparent text-sm outline-none placeholder:text-slate-400" />
        <kbd className="shrink-0 whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-sub">⌘ K</kbd>
      </label>
    </div>
  );
}

function Topbar({ openPalette, onMenu, menuOpen }: { openPalette: () => void; onMenu: () => void; menuOpen: boolean }) {
  const { role, user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const [help, setHelp] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const notifs = useNotifs();
  const newOrder = useNewOrder();
  const unread = notifs.filter((n) => !n.read).length;
  useEffect(() => { setBell(false); setHelp(false); }, [loc.pathname]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (e.key === "Escape") { setBell(false); setHelp(false); setOpen(false); }
      else if (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector("[role=dialog]")) { e.preventDefault(); newOrder.open(); }
      else if (e.key === "?" && !typing) { e.preventDefault(); setHelp((x) => !x); setBell(false); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [newOrder]);
  return (
    <header className="app-topbar no-print flex items-center justify-between gap-2 px-3 pt-3 sm:gap-4 sm:px-7 sm:pt-5">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <button type="button" onClick={onMenu} aria-label="Open menu" aria-expanded={menuOpen} aria-controls="app-sidebar" data-testid="hamburger" className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-white lg:hidden"><Menu className="size-5" /></button>
        <SearchBox openPalette={openPalette} />
      </div>
      <div className="flex items-center gap-1 sm:gap-5">
        <button type="button" onClick={openPalette} aria-label="Search" data-testid="search-icon" className="grid size-11 place-items-center rounded-xl md:hidden"><Search className="size-5" /></button>
        <div className="relative">
          <button onClick={() => { setBell(!bell); setHelp(false); }} className="relative grid size-11 place-items-center text-ink" aria-label="Notifications" aria-haspopup="dialog" aria-expanded={bell}>
            <Bell className="size-5" />
            {unread > 0 && <span data-testid="bell-badge" className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-rose-500 text-[10px] font-bold text-white">{unread}</span>}
          </button>
          {bell && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setBell(false)} />
              <div role="dialog" aria-label="Recent notifications" className="fixed inset-x-3 top-16 z-40 rounded-xl border border-line bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[360px]">
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
          <button aria-label="Help" aria-haspopup="dialog" aria-expanded={help} onClick={() => { setHelp(!help); setBell(false); }} className="grid size-11 place-items-center"><CircleHelp className="size-5" /></button>
          {help && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setHelp(false)} />
              <div role="dialog" aria-label="Help and shortcuts" className="fixed inset-x-3 top-16 z-40 max-h-[80dvh] overflow-y-auto rounded-xl border border-line bg-white p-4 text-[13px] shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-80">
                <div className="mb-2 flex items-center gap-2 font-extrabold"><Keyboard className="size-4 text-brand" />Keyboard shortcuts</div>
                <ul className="space-y-2">
                  {[["⌘/Ctrl + K", "Command palette"], ["↑ ↓ / Enter", "Move / run in palette"], ["n", "New order"], ["g d", "Go to Dashboard"], ["g o", "Go to Orders"], ["g c", "Go to Customers"], ["g p", "Go to Payments"], ["g r", "Go to Reports"], ["Esc", "Close palette, menus, popovers"], ["?", "Toggle this help"]].map(([k, d]) => <li key={k} className="flex items-center justify-between gap-3"><span className="text-sub">{d}</span><kbd className="whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold">{k}</kbd></li>)}
                </ul>
                <div className="mt-3 border-t border-line pt-3">
                  <a href="mailto:support@albumpro.com?subject=AlbumPro%20help" className="font-bold text-brand hover:underline">Contact support</a>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="relative">
          <button aria-label={`Account menu, ${user}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} onBlur={() => setTimeout(() => setOpen(false), 200)} className="flex items-center gap-2.5">
            <Avatar name={user} size={38} />
            <span className="hidden text-left leading-tight sm:block"><span className="block text-sm font-bold">{user}</span><span className="block text-[11px] text-sub">{ROLES[role!].label}</span></span>
            <ChevronDown className="hidden size-4 text-sub sm:block" />
          </button>
          {open && (
            <div role="menu" className="absolute right-0 top-12 z-40 w-60 rounded-xl border border-line bg-white p-1.5 shadow-xl">
              <div className="px-3 py-2 text-xs text-sub">{ROLES[role!].email}<br />{ROLES[role!].dept}</div>
              <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"><MonitorSmartphone className="mt-0.5 size-4 text-sub" /><span><b className="block text-[13px]">Active session</b>Chrome · this device · just now</span></div>
              <button role="menuitem" onClick={() => { logout(); nav("/login"); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold hover:bg-brand-soft"><LogOut className="size-4" />Logout</button>
              <button role="menuitem" onClick={() => { logout(); nav("/login"); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-rose-600 hover:bg-rose-50"><LogOut className="size-4" />Logout all sessions</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

const GO: Record<string, string> = { d: "/", o: "/orders", c: "/customers", p: "/payments", r: "/reports", i: "/invoices", u: "/users", s: "/settings", n: "/notifications" };

function titleFor(path: string) {
  if (path.startsWith("/orders/")) return `Order ${path.split("/")[2]}`;
  if (path.startsWith("/designing/")) return `Designing ${path.split("/")[2]}`;
  return NAV.find((n) => (n.to === "/" ? path === "/" : path === n.to || path.startsWith(n.to + "/")))?.label ?? "AlbumPro";
}

export default function Shell() {
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const desktop = useDesktop();
  const { role } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const newOrder = useNewOrder();
  const [dbToast, showDbToast] = useToast();
  useEffect(() => onDbError(showDbToast), [showDbToast]);   // background database errors become visible messages
  const pending = useRef<number | undefined>(undefined);
  const gMode = useRef(false);
  useEffect(() => { setDrawer(false); }, [loc.pathname]);
  useEffect(() => { if (desktop) setDrawer(false); }, [desktop]);
  useEffect(() => { document.title = `${titleFor(loc.pathname)} · AlbumPro`; }, [loc.pathname]);
  useEffect(() => {
    const allowed = role ? ROLES[role].nav : [];
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((x) => !x); return; }
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (gMode.current) {
        gMode.current = false; window.clearTimeout(pending.current);
        const to = GO[k];
        if (to && allowed.includes(to)) { e.preventDefault(); nav(to); }
        return;
      }
      if (palette) return;
      if (k === "g") { gMode.current = true; pending.current = window.setTimeout(() => { gMode.current = false; }, 1200); }
      else if (k === "n" && allowed.includes("/orders")) { e.preventDefault(); newOrder.open(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [role, nav, newOrder, palette]);
  return (
    <div className="flex h-full">
      <a href="#main" className="skip-link sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2.5 focus:text-sm focus:font-bold focus:text-white">Skip to content</a>
      <Sidebar open={drawer} desktop={desktop} onClose={() => setDrawer(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar openPalette={() => setPalette(true)} onMenu={() => setDrawer(true)} menuOpen={drawer} />
        <main id="main" tabIndex={-1} className="app-main scroll-thin min-w-0 flex-1 overflow-y-auto px-3 pb-8 pt-4 outline-none sm:px-7 sm:pt-5"><Outlet /></main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <A11yLayer />
      {dbToast}
    </div>
  );
}

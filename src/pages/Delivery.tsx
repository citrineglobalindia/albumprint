import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Truck, PackageCheck, Send, CheckCircle2, Lock, AlertTriangle, Download, FileCheck2, Wallet } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, Thumb, SearchInput, CountTabs, TodayChip, MoreButton, Td, tableCls, trCls, Field, inputCls, cx, type Kpi } from "../components/ui";
import { Banner } from "../components/pageKit";
import { useToast } from "../components/Toast";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { ORDERS, stageLabel } from "../lib/data";
import { fmtDate, inr } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { DRECS, DMODES, ensureDeliveries, drec, saveDelivery, dispatchDelivery, markDelivered, closeWithChecks, reopen, balanceOf, allowDeliveryWithoutPayment, can, fmtDT, type DMode, type Out } from "../lib/production";

type Tab = "all" | "ready" | "dispatched" | "delivered" | "closed";
const ordOf = (id: string) => ORDERS.find((o) => o.id === id)!;
const dstate = (id: string): Tab => { const o = ordOf(id); const d = drec(id); return o.closed ? "closed" : d?.status === "Delivered" ? "delivered" : d?.status === "Dispatched" ? "dispatched" : "ready"; };

export default function Delivery() {
  const { role } = useAuth();
  const work = can(role, "delivery");
  const isAdmin = role === "admin";
  ensureDeliveries();
  useStore();
  const nav = useNavigate();
  const [toast, show] = useToast();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [override, setOverride] = useState("");
  const [pod, setPod] = useState({ receivedBy: "", file: "", note: "" });
  const [closeReason, setCloseReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const podInput = useRef<HTMLInputElement>(null);
  const run = (r: Out) => { show(r.msg); return r.ok; };
  const guard = () => { if (work) return true; show(`Your role (${role}) cannot update deliveries`); return false; };

  const all = DRECS.filter((d) => ordOf(d.orderId) && ["ready_for_delivery", "delivered"].includes(ordOf(d.orderId).stage));
  const matches = all.filter((d) => { const o = ordOf(d.orderId); const t = q.trim().toLowerCase(); return !t || `${o.id} ${o.customer} ${d.tracking}`.toLowerCase().includes(t); });
  const list = matches.filter((d) => tab === "all" || dstate(d.orderId) === tab);
  const cur = all.find((d) => d.orderId === selId) ?? list[0] ?? null;
  const o = cur ? ordOf(cur.orderId) : null;
  const closed = !!o?.closed;
  const canAct = work && !closed;
  const dues = o ? balanceOf(o) : 0;
  const blocked = dues > 0 && !allowDeliveryWithoutPayment();
  const cnt = (t: Tab) => all.filter((d) => dstate(d.orderId) === t).length;

  const kpis: Kpi[] = [
    { label: "Ready for Delivery", value: cnt("ready"), icon: PackageCheck, tone: "amber" },
    { label: "Dispatched", value: cnt("dispatched"), icon: Truck, tone: "blue" },
    { label: "Delivered", value: cnt("delivered"), icon: CheckCircle2, tone: "green" },
    { label: "Blocked by dues", value: all.filter((d) => d.status === "Ready" && balanceOf(ordOf(d.orderId)) > 0 && !allowDeliveryWithoutPayment()).length, icon: AlertTriangle, tone: "red", invert: true },
    { label: "Closed", value: cnt("closed"), icon: Lock, tone: "slate" },
  ];
  const [dd, setDd] = useState({ carrier: "", tracking: "", contact: "", address: "" });
  const [ddFor, setDdFor] = useState("");
  if (cur && ddFor !== cur.orderId) { setDdFor(cur.orderId); setDd({ carrier: cur.carrier, tracking: cur.tracking, contact: cur.contact, address: cur.address }); }
  const setMode = (m: DMode) => { if (cur && guard()) run(saveDelivery(cur.orderId, { mode: m })); };
  const saveDetails = () => { if (!cur || !guard()) return false; const r = saveDelivery(cur.orderId, dd); if (!r.ok) show(r.msg); return r.ok; };

  return (
    <div>
      <PageHeader title="Delivery" subtitle="Manage ready albums, dispatch, tracking, proof of delivery and order closure." icon={<Truck className="mt-1 size-8 text-brand" />}>
        <TodayChip /><MoreButton />
      </PageHeader>
      {!work && <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-[13px] font-semibold text-amber-800"><Lock className="size-4" />View only — delivery updates are limited to Reception, Printing, QC and Admin.</div>}
      <KpiRow items={kpis} cols={5} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Panel title="Delivery List" action={<button aria-label="Export" onClick={() => downloadCsv("deliveries.csv", [["Order", "Customer", "Mode", "Status", "Tracking", "Balance"], ...list.map((d) => [d.orderId, ordOf(d.orderId).customer, d.mode, dstate(d.orderId), d.tracking, balanceOf(ordOf(d.orderId))])])} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-brand-soft"><Download className="size-4 text-sub" />Export</button>}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <CountTabs<Tab> value={tab} onChange={setTab} tabs={[{ key: "all", label: "All", count: all.length }, { key: "ready", label: "Ready", count: cnt("ready") }, { key: "dispatched", label: "Dispatched", count: cnt("dispatched") }, { key: "delivered", label: "Delivered", count: cnt("delivered") }, { key: "closed", label: "Closed", count: cnt("closed") }]} />
            <SearchInput className="w-56" value={q} onChange={setQ} placeholder="Search order, customer, tracking…" />
          </div>
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr>{["Order", "Customer", "Mode", "Tracking", "Balance", "Status", ""].map((h) => <th key={h} className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub">{h}</th>)}</tr></thead>
              <tbody>
                {list.map((d) => {
                  const oo = ordOf(d.orderId); const st = dstate(d.orderId); const bal = balanceOf(oo);
                  return (
                    <tr key={d.orderId} data-testid={`del-${d.orderId}`} onClick={() => setSelId(d.orderId)} className={cx(trCls, "cursor-pointer", cur?.orderId === d.orderId && "bg-brand-soft")}>
                      <Td><div className="flex items-center gap-2"><Thumb seed={d.orderId} size={28} /><div><div className="font-bold">{d.orderId}</div><div className="text-[11px] text-sub">{oo.event}</div></div></div></Td>
                      <Td>{oo.customer}</Td><Td>{d.mode}</Td><Td>{d.tracking || "—"}</Td>
                      <Td className={bal > 0 ? "font-semibold text-rose-600" : "text-emerald-600"}>{bal > 0 ? inr(bal) : "Paid"}</Td>
                      <Td><Pill tone={st === "closed" ? "slate" : st === "delivered" ? "green" : st === "dispatched" ? "blue" : bal > 0 && !allowDeliveryWithoutPayment() ? "red" : "amber"}>{st === "ready" && bal > 0 && !allowDeliveryWithoutPayment() ? "Payment hold" : st === "closed" ? "Closed" : d.status}</Pill></Td>
                      <Td><button className="h-8 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft">Open</button></Td>
                    </tr>
                  );
                })}
                {list.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-sub">No deliveries in this view.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>

        {cur && o ? (
          <Panel bodyClassName="!p-5" className="xl:sticky xl:top-4">
            <div className="flex items-start justify-between">
              <div><h3 className="text-xl font-extrabold">{cur.orderId}</h3><div className="text-[13px] text-sub">{o.customer} · {o.mobile} · {stageLabel(o.stage)}</div></div>
              <Pill tone={closed ? "slate" : cur.status === "Delivered" ? "green" : cur.status === "Dispatched" ? "blue" : "amber"}>{closed ? "Closed" : cur.status}</Pill>
            </div>
            {closed && <div className="mt-3"><Banner tone="amber">Order is closed — read-only. Reopen it (admin) to make changes.</Banner></div>}

            {dues > 0 && cur.status === "Ready" && (
              <div role="alert" data-testid="dues-banner" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">
                <b>{inr(dues)} outstanding.</b> {allowDeliveryWithoutPayment() ? "Settings allow delivery without full payment." : isAdmin ? "Dispatch needs an override reason." : "Dispatch is blocked until payment is collected or an admin overrides."}
              </div>
            )}

            <h4 className="mb-2 mt-4 text-sm font-extrabold">Dispatch details</h4>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Delivery mode">
              {DMODES.map((m) => <button key={m} disabled={!canAct || cur.status !== "Ready"} aria-pressed={cur.mode === m} onClick={() => setMode(m)} className={cx("rounded-full border px-3 py-1 text-xs font-bold disabled:opacity-60", cur.mode === m ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{m}</button>)}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-3">
              <Field label={cur.mode === "Pickup" ? "Collected by" : cur.mode === "Company delivery" ? "Driver / vehicle" : "Courier / carrier"}><input aria-label="Carrier" disabled={!canAct || cur.status !== "Ready"} className={inputCls} value={dd.carrier} onChange={(e) => setDd({ ...dd, carrier: e.target.value })} /></Field>
              <Field label="Tracking no."><input aria-label="Tracking" disabled={!canAct || cur.status !== "Ready"} className={inputCls} value={dd.tracking} onChange={(e) => setDd({ ...dd, tracking: e.target.value })} /></Field>
              <Field label="Contact"><input aria-label="Contact" disabled={!canAct || cur.status !== "Ready"} className={inputCls} value={dd.contact} onChange={(e) => setDd({ ...dd, contact: e.target.value })} /></Field>
              <Field label="Address"><input aria-label="Address" disabled={!canAct || cur.status !== "Ready"} className={inputCls} value={dd.address} onChange={(e) => setDd({ ...dd, address: e.target.value })} /></Field>
            </div>

            {canAct && cur.status === "Ready" && o.stage === "ready_for_delivery" && (
              <div className="space-y-2">
                <button onClick={() => { if (saveDetails()) show("Delivery details saved"); }} className="h-9 w-full rounded-lg border border-line text-xs font-bold hover:bg-brand-soft">Save details</button>
                {isAdmin && blocked && <input aria-label="Dispatch override reason" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Admin override reason (dues outstanding)" className={inputCls} />}
                <button data-testid="dispatch" onClick={() => { if (!saveDetails()) return; if (run(dispatchDelivery(cur.orderId, override))) setOverride(""); }} className={cx("inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-white", blocked && !isAdmin ? "bg-slate-400" : "bg-brand hover:bg-brand-dark")}><Send className="size-4" />{cur.mode === "Pickup" ? "Release for pickup" : "Dispatch"}{blocked && isAdmin ? " (override)" : ""}</button>
              </div>
            )}

            {canAct && cur.status === "Dispatched" && (
              <div className="mt-2 rounded-xl border border-line p-3">
                <h4 className="text-sm font-extrabold">Proof of delivery</h4>
                <Field label="Received by"><input aria-label="Received by" className={inputCls} value={pod.receivedBy} onChange={(e) => setPod({ ...pod, receivedBy: e.target.value })} /></Field>
                <div className="mb-3 flex items-center gap-2 text-[13px]">
                  <button onClick={() => podInput.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft"><FileCheck2 className="size-4" />Attach signature / photo</button>
                  <input ref={podInput} data-testid="pod-input" type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPod({ ...pod, file: f.name }); e.target.value = ""; }} />
                  <span className="text-sub">{pod.file || "none attached"}</span>
                </div>
                <Field label="Note"><input aria-label="POD note" className={inputCls} value={pod.note} onChange={(e) => setPod({ ...pod, note: e.target.value })} /></Field>
                <button data-testid="mark-delivered" onClick={() => { if (run(markDelivered(cur.orderId, { receivedBy: pod.receivedBy, pod: pod.file, podNote: pod.note }))) setPod({ receivedBy: "", file: "", note: "" }); }} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700"><CheckCircle2 className="size-4" />Mark Delivered</button>
              </div>
            )}
            {cur.status === "Delivered" && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-[13px] text-emerald-800">Delivered {fmtDT(cur.deliveredAt)} · received by <b>{cur.receivedBy}</b> · proof: {cur.pod}</p>}

            <h4 className="mb-2 mt-5 flex items-center gap-2 text-sm font-extrabold"><Wallet className="size-4 text-brand" />Closure (§14.2)</h4>
            <div data-testid="closure" className="rounded-xl border border-line p-3 text-[13px]">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-sub">Operational</div><Pill tone={o.stage === "delivered" ? "green" : "amber"}>{o.stage === "delivered" ? "Delivered — complete" : `Pending (${stageLabel(o.stage)})`}</Pill></div>
                <div><div className="text-xs text-sub">Financial</div><Pill tone={dues === 0 ? "green" : "red"}>{dues === 0 ? "Settled" : `${inr(dues)} due`}</Pill></div>
              </div>
              {closed ? (
                <div className="mt-3">
                  <div className="text-xs text-sub">Closed {fmtDT(o.closedAt)}</div>
                  {isAdmin ? (
                    <div className="mt-2 flex gap-2"><input aria-label="Reopen reason" className={inputCls} placeholder="Reason to reopen (required)" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
                      <button onClick={() => { if (run(reopen(o.id, reopenReason))) setReopenReason(""); }} className="h-10 rounded-lg border border-brand px-4 text-sm font-bold text-brand">Reopen</button></div>
                  ) : <p className="mt-1 text-xs text-sub">Only an admin can reopen a closed order.</p>}
                </div>
              ) : (
                <div className="mt-3">
                  {isAdmin ? (<>
                    {dues > 0 && <input aria-label="Close override reason" className={cx(inputCls, "mb-2")} placeholder="Override reason (required while dues remain)" value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />}
                    <button data-testid="close-order" onClick={() => { if (run(closeWithChecks(o.id, closeReason))) setCloseReason(""); }} className="h-10 w-full rounded-lg bg-slate-800 text-sm font-bold text-white hover:bg-slate-900">Close order</button>
                  </>) : <button onClick={() => show("Only an admin can close an order")} className="h-10 w-full rounded-lg border border-line text-sm font-bold text-sub">Close order (admin only)</button>}
                  <p className="mt-1 text-[11px] text-sub">Closing needs Delivered + fully paid; an admin may override with a reason.</p>
                </div>
              )}
            </div>

            <h4 className="mb-1 mt-5 text-sm font-extrabold">Timeline</h4>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-[12px]">{cur.events.map((e, i) => <li key={i} className="rounded-lg border border-line px-3 py-1.5"><b>{e.text}</b><span className="block text-sub">{e.by} · {fmtDT(e.at)}</span></li>)}</ul>
            <button onClick={() => nav(`/orders/${o.id}`)} className="mt-3 text-xs font-bold text-brand">Open order →</button>
            <p className="mt-1 text-[11px] text-sub">Due {fmtDate(o.due)}</p>
          </Panel>
        ) : <Panel bodyClassName="!p-6"><p className="text-sm text-sub">No delivery selected.</p></Panel>}
      </div>
      {toast}
    </div>
  );
}

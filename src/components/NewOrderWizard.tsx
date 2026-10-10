import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, X, UserPlus, Palette, Printer, PartyPopper } from "lucide-react";
import { cx, Field, inputCls, Toggle } from "./ui";
import { Combobox } from "./controls";
import { CUSTOMERS, ORDERS, ASSIGNEES, PRIORITIES, type Customer, type Order, type Priority } from "../lib/data";
import { ALBUM_TYPES, BINDING, BOXES, COVERS, EVENT_TYPES, FINISHES, LAMINATION, PAPER, SIZES, DISCOUNT_APPROVAL_PCT, GST_RATE, price, type Spec } from "../lib/pricing";
import { inr } from "../lib/format";
import { useToast } from "./Toast";
import { logAudit } from "../lib/audit";

// SRS §4.3 (order fields), §5 (workflow routing), §6.1 (album spec), §3.2 (pricing).
interface Draft {
  customerId: string; newCustomer: { studio: string; mobile: string } | null;
  workflow: "Design + Printing" | "Printing"; orderDate: string; due: string; eventName: string; event: string; bride: string; groom: string; eventDate: string; priority: Priority; instructions: string;
  size: string; orientation: string; sheets: number; binding: string; gsm: string; nameText: string; spec: Spec;
}
const iso = (n = 0) => { const d = new Date("2026-10-03"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const blank = (): Draft => ({
  customerId: "", newCustomer: null, workflow: "Design + Printing", orderDate: iso(), due: iso(14), eventName: "", event: "Wedding", bride: "", groom: "", eventDate: "", priority: "Normal", instructions: "",
  size: "12x36", orientation: "Landscape", sheets: 30, binding: "Lay-flat", gsm: "300", nameText: "",
  spec: { albumType: "Premium Album", paper: "Matte", sheets: 30, copies: 1, cover: "Leatherette", lamination: "Matte", box: "None", finishes: [], designed: true, images: 300, discountPct: 0 },
});
const STEPS = ["Customer & type", "Event & dates", "Album spec", "Pricing", "Review"];

interface Ctx { open: (opts?: { customerId?: string }) => void }
const NewOrderCtx = createContext<Ctx>({ open: () => {} });
export const useNewOrder = () => useContext(NewOrderCtx);

export function NewOrderProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  const [seed, setSeed] = useState<string | undefined>();
  const open = useCallback((o?: { customerId?: string }) => { setSeed(o?.customerId); setOn(true); }, []);
  return (
    <NewOrderCtx.Provider value={{ open }}>
      {children}
      {on && <Wizard seedCustomer={seed} onClose={() => setOn(false)} />}
    </NewOrderCtx.Provider>
  );
}

function Wizard({ onClose, seedCustomer }: { onClose: () => void; seedCustomer?: string }) {
  const nav = useNavigate();
  const [toast, show] = useToast();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(() => ({ ...blank(), customerId: seedCustomer ?? "" }));
  const [err, setErr] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setSpec = (p: Partial<Spec>) => setD((x) => ({ ...x, spec: { ...x.spec, ...p } }));
  const designed = d.workflow === "Design + Printing";
  const p = useMemo(() => price({ ...d.spec, designed, sheets: d.sheets }), [d.spec, d.sheets, designed]);
  const cust = CUSTOMERS.find((c) => c.id === d.customerId);
  const custName = d.newCustomer ? d.newCustomer.studio : cust?.studio ?? "";

  const validate = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) { if (!d.customerId && !d.newCustomer) e.customer = "Choose a customer or add a new one"; if (d.newCustomer) { if (d.newCustomer.studio.trim().length < 2) e.studio = "Enter studio name"; if (!/^\+?[0-9 ]{10,14}$/.test(d.newCustomer.mobile.trim())) e.mobile = "Valid mobile required"; } }
    if (s === 1) { if (!d.due) e.due = "Required"; else if (d.due < d.orderDate) e.due = "Delivery date cannot be before order date"; }
    if (s === 2) { if (d.sheets < 1) e.sheets = "Positive number"; if (d.spec.copies < 1) e.copies = "At least 1"; }
    if (s === 3 && (d.spec.discountPct < 0 || d.spec.discountPct > 100)) e.discount = "0–100%";
    setErr(e); return Object.keys(e).length === 0;
  };
  const next = () => validate(step) && setStep(step + 1);

  const create = () => {
    if (![0, 1, 2, 3].every(validate)) { setStep(0); return; }
    const n = Math.max(...ORDERS.map((o) => Number(o.id.replace("IDP", "")))) + 1;
    if (d.newCustomer) {
      const c: Customer = { id: `IDC${String(1249 + CUSTOMERS.length).padStart(6, "0")}`, name: d.newCustomer.studio, studio: d.newCustomer.studio, mobile: d.newCustomer.mobile, email: "", city: "", state: "", type: "New", status: "Active", activeOrders: 1, lifetime: 0, lastOrder: d.orderDate, since: d.orderDate, dues: 0, tags: [] };
      CUSTOMERS.unshift(c);
    }
    const order: Order = {
      id: `IDP${String(n).padStart(5, "0")}`, customer: custName, mobile: d.newCustomer?.mobile ?? cust?.mobile ?? "", event: d.event, workflow: d.workflow, size: d.size, pages: d.sheets,
      stage: "new_order", priority: d.priority, pendingAt: d.orderDate, assignee: "Priya", due: d.due, pay: "Unpaid", total: p.total, paid: 0, progress: 0,
    };
    ORDERS.unshift(order);
    logAudit({ entity: "order", entityId: order.id, action: "create", detail: `${order.workflow} · ${d.spec.albumType} ${order.size} · ${inr(p.total)}${d.newCustomer ? " · new customer " + custName : ""}` });
    show(`Order ${order.id} created`);
    onClose(); nav(`/orders/${order.id}`);
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-ink/40 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-label="New Order" className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <div><h2 className="text-xl font-extrabold">New Order</h2><p className="text-xs text-sub">Reception intake — customer, event, album specification and pricing</p></div>
          <button onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-lg hover:bg-slate-100"><X className="size-5" /></button>
        </header>
        <ol className="flex gap-1 border-b border-line bg-slate-50 px-6 py-3">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2">
              <button onClick={() => i < step && setStep(i)} className={cx("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold", i < step ? "bg-brand text-white" : i === step ? "bg-brand-soft text-brand ring-2 ring-brand" : "bg-white text-slate-400 ring-1 ring-line")}>{i < step ? <Check className="size-4" /> : i + 1}</button>
              <span className={cx("text-xs font-bold", i === step ? "text-ink" : "text-sub")}>{s}</span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px flex-1 bg-line" />}
            </li>
          ))}
        </ol>

        <div className="scroll-thin flex-1 overflow-y-auto p-6">
          {step === 0 && (
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <Field label="Customer" required hint={err.customer}>
                  {d.newCustomer ? (
                    <div className="space-y-2 rounded-xl border border-brand/30 bg-brand-soft/40 p-3">
                      <div className="flex items-center justify-between text-xs font-bold text-brand"><span className="flex items-center gap-1"><UserPlus className="size-3.5" />New customer</span><button onClick={() => set("newCustomer", null)}>Use existing</button></div>
                      <input className={cx(inputCls, err.studio && "border-rose-400")} placeholder="Studio / customer name" value={d.newCustomer.studio} onChange={(e) => set("newCustomer", { ...d.newCustomer!, studio: e.target.value })} />
                      <input className={cx(inputCls, err.mobile && "border-rose-400")} placeholder="Mobile number" value={d.newCustomer.mobile} onChange={(e) => set("newCustomer", { ...d.newCustomer!, mobile: e.target.value })} />
                      {(err.studio || err.mobile) && <p className="text-xs text-rose-600">{err.studio ?? err.mobile}</p>}
                    </div>
                  ) : (
                    <Combobox error={!!err.customer} value={d.customerId} onChange={(v) => set("customerId", v)} placeholder="Search by name, studio or mobile…" options={CUSTOMERS.map((c) => ({ value: c.id, label: c.studio, sub: `${c.name} · ${c.mobile}` }))} onCreate={(q) => set("newCustomer", { studio: q, mobile: "" })} createLabel="Add new customer" />
                  )}
                </Field>
                {cust && !d.newCustomer && <div className="rounded-xl border border-line p-3 text-xs text-sub"><b className="text-ink">{cust.name}</b> · {cust.city}<br />{cust.type} customer · {cust.activeOrders} active orders{cust.dues > 0 && <span className="font-bold text-rose-600"> · dues {inr(cust.dues)}</span>}</div>}
              </div>
              <div>
                <div className="mb-1.5 text-[13px] font-semibold">Order type <span className="text-rose-500">*</span></div>
                <div className="grid gap-3">
                  {([["Design + Printing", Palette, "Colour grading → design → client proof → print → QC → delivery"], ["Printing", Printer, "File verification → print → QC → delivery. Grading/design skipped"]] as const).map(([w, I, desc]) => (
                    <button key={w} onClick={() => { set("workflow", w); }} className={cx("flex items-start gap-3 rounded-xl border-2 p-4 text-left", d.workflow === w ? "border-brand bg-brand-soft/50" : "border-line hover:bg-slate-50")}>
                      <span className="grid size-10 place-items-center rounded-lg bg-white text-brand ring-1 ring-line"><I className="size-5" /></span>
                      <span><b className="block">{w === "Printing" ? "Album Printing Only" : w}</b><span className="text-xs text-sub">{desc}</span></span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-x-6 md:grid-cols-2">
              <Field label="Event Name"><input className={inputCls} value={d.eventName} onChange={(e) => set("eventName", e.target.value)} placeholder="e.g. Rahul & Priya Wedding" /></Field>
              <Field label="Event Type"><select className={inputCls} value={d.event} onChange={(e) => set("event", e.target.value)}>{EVENT_TYPES.map((x) => <option key={x}>{x}</option>)}</select></Field>
              {d.event.includes("Wedding") || d.event === "Engagement" || d.event === "Reception" ? <><Field label="Bride Name"><input className={inputCls} value={d.bride} onChange={(e) => set("bride", e.target.value)} /></Field><Field label="Groom Name"><input className={inputCls} value={d.groom} onChange={(e) => set("groom", e.target.value)} /></Field></> : null}
              <Field label="Event Date"><input type="date" className={inputCls} value={d.eventDate} onChange={(e) => set("eventDate", e.target.value)} /></Field>
              <Field label="Priority" required><div className="flex gap-1.5">{PRIORITIES.filter((x) => x !== "Low").map((x) => <button key={x} onClick={() => set("priority", x)} className={cx("h-10 flex-1 rounded-lg border text-[13px] font-bold", d.priority === x ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{x}</button>)}</div></Field>
              <Field label="Order Date" required><input type="date" className={inputCls} value={d.orderDate} onChange={(e) => set("orderDate", e.target.value)} /></Field>
              <Field label="Expected Delivery Date" required hint={err.due}><input type="date" min={d.orderDate} className={cx(inputCls, err.due && "border-rose-400")} value={d.due} onChange={(e) => set("due", e.target.value)} /></Field>
              <div className="md:col-span-2"><Field label="Special Instructions"><textarea className={cx(inputCls, "h-20 py-2")} value={d.instructions} onChange={(e) => set("instructions", e.target.value)} /></Field></div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-x-6 md:grid-cols-3">
              <Field label="Album Type" required><select className={inputCls} value={d.spec.albumType} onChange={(e) => setSpec({ albumType: e.target.value })}>{Object.keys(ALBUM_TYPES).map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Album Size" required><select className={inputCls} value={d.size} onChange={(e) => set("size", e.target.value)}>{SIZES.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Orientation" required><select className={inputCls} value={d.orientation} onChange={(e) => set("orientation", e.target.value)}>{["Landscape", "Portrait", "Square"].map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Pages / Sheets" required hint={err.sheets}><input type="number" min={1} className={inputCls} value={d.sheets} onChange={(e) => set("sheets", Number(e.target.value))} /></Field>
              <Field label="Copies" required hint={err.copies}><input type="number" min={1} className={inputCls} value={d.spec.copies} onChange={(e) => setSpec({ copies: Number(e.target.value) })} /></Field>
              <Field label="Binding" required><select className={inputCls} value={d.binding} onChange={(e) => set("binding", e.target.value)}>{BINDING.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Paper Type" required><select className={inputCls} value={d.spec.paper} onChange={(e) => { setSpec({ paper: e.target.value }); set("gsm", String(PAPER[e.target.value]!.gsm[0])); }}>{Object.keys(PAPER).map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Paper GSM"><select className={inputCls} value={d.gsm} onChange={(e) => set("gsm", e.target.value)}>{PAPER[d.spec.paper]!.gsm.map((g) => <option key={g}>{g}</option>)}</select></Field>
              <Field label="Cover Type" required><select className={inputCls} value={d.spec.cover} onChange={(e) => setSpec({ cover: e.target.value })}>{Object.keys(COVERS).map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Lamination"><select className={inputCls} value={d.spec.lamination} onChange={(e) => setSpec({ lamination: e.target.value })}>{Object.keys(LAMINATION).map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Box Required"><select className={inputCls} value={d.spec.box} onChange={(e) => setSpec({ box: e.target.value })}>{Object.keys(BOXES).map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Name Printing"><input className={inputCls} value={d.nameText} onChange={(e) => set("nameText", e.target.value)} placeholder="Text on cover" /></Field>
              <div className="md:col-span-3"><div className="mb-1.5 text-[13px] font-semibold">Special finishes</div>
                <div className="flex flex-wrap gap-2">{Object.keys(FINISHES).map((f) => { const on = d.spec.finishes.includes(f); return <button key={f} onClick={() => setSpec({ finishes: on ? d.spec.finishes.filter((x) => x !== f) : [...d.spec.finishes, f] })} className={cx("h-9 rounded-full border px-4 text-[13px] font-bold", on ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{on && "✓ "}{f} <span className="font-medium opacity-70">+{inr(FINISHES[f]!)}</span></button>; })}</div></div>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-6 md:grid-cols-[1fr_320px]">
              <div>
                {designed && <Field label="Source images to colour-grade" hint="Charged per image (SRS ALB-FR-0034)"><input type="number" min={0} className={inputCls} value={d.spec.images} onChange={(e) => setSpec({ images: Number(e.target.value) })} /></Field>}
                <Field label="Discount %" hint={err.discount ?? (d.spec.discountPct > DISCOUNT_APPROVAL_PCT ? `Above ${DISCOUNT_APPROVAL_PCT}% — admin approval will be requested` : "Requires discount permission above 0%")}><input type="number" min={0} max={100} className={inputCls} value={d.spec.discountPct} onChange={(e) => setSpec({ discountPct: Number(e.target.value) })} /></Field>
                <Field label="Assign / owner"><select className={inputCls} defaultValue="Priya">{ASSIGNEES.map((a) => <option key={a}>{a}</option>)}</select></Field>
                <label className="flex items-center gap-3 text-sm"><Toggle on={designed} onChange={(v) => set("workflow", v ? "Design + Printing" : "Printing")} />Include design & colour grading</label>
              </div>
              <PriceCard p={p} designed={designed} />
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-6 md:grid-cols-[1fr_320px]">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[["Customer", custName], ["Order type", d.workflow], ["Event", `${d.event}${d.eventName ? ` · ${d.eventName}` : ""}`], ["Priority", d.priority], ["Order date", d.orderDate], ["Delivery date", d.due], ["Album", `${d.spec.albumType} · ${d.size} · ${d.orientation}`], ["Pages / copies", `${d.sheets} / ${d.spec.copies}`], ["Paper", `${d.spec.paper} ${d.gsm} GSM`], ["Cover / lamination", `${d.spec.cover} / ${d.spec.lamination}`], ["Binding", d.binding], ["Box", d.spec.box], ["Finishes", d.spec.finishes.join(", ") || "None"], ["Instructions", d.instructions || "—"]].map(([k, v]) => <div key={k}><dt className="text-xs text-sub">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
              </dl>
              <div><PriceCard p={p} designed={designed} /><p className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700"><PartyPopper className="size-4 shrink-0" />On create, the order gets an ID, enters the {designed ? "Colour Grading" : "File Verification"} queue and the customer is acknowledged.</p></div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-line px-6 py-4">
          <button onClick={step === 0 ? onClose : () => setStep(step - 1)} className="inline-flex h-10 items-center gap-1 rounded-lg border border-line px-4 text-sm font-bold hover:bg-slate-50">{step > 0 && <ChevronLeft className="size-4" />}{step === 0 ? "Cancel" : "Back"}</button>
          <span className="text-sm text-sub">Total <b className="ml-1 text-lg text-ink">{inr(p.total)}</b></span>
          {step < STEPS.length - 1
            ? <button onClick={next} className="inline-flex h-10 items-center gap-1 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark">Next<ChevronRight className="size-4" /></button>
            : <button onClick={create} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark"><Check className="size-4" />Create Order</button>}
        </footer>
        {toast}
      </div>
    </div>
  );
}

function PriceCard({ p, designed }: { p: ReturnType<typeof price>; designed: boolean }) {
  const rows: [string, number][] = [["Base album", p.base], ["Sheets / pages", p.sheets], ["Cover, lamination, box & finishes", p.addons], ...(designed ? ([["Design charge", p.design], ["Colour grading", p.grading]] as [string, number][]) : [])];
  return (
    <div className="rounded-2xl border border-line bg-slate-50 p-4 text-sm">
      <div className="mb-2 font-extrabold">Price breakup</div>
      {rows.map(([k, v]) => <div key={k} className="flex justify-between py-1"><span className="text-sub">{k}</span><span className="font-semibold">{inr(v)}</span></div>)}
      <div className="mt-1 flex justify-between border-t border-line py-1.5"><span className="text-sub">Subtotal</span><b>{inr(p.sub)}</b></div>
      {p.discount > 0 && <div className="flex justify-between py-1 text-emerald-700"><span>Discount</span><b>−{inr(p.discount)}</b></div>}
      <div className="flex justify-between py-1"><span className="text-sub">GST ({GST_RATE * 100}%)</span><b>{inr(p.gst)}</b></div>
      <div className="mt-1 flex justify-between border-t-2 border-ink/10 pt-2 text-base"><b>Total</b><b className="text-brand">{inr(p.total)}</b></div>
    </div>
  );
}

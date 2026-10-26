import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, X, UserPlus, Palette, Printer, PartyPopper, Plus, Copy, Trash2 } from "lucide-react";
import { cx, Field, inputCls, Toggle } from "./ui";
import { Combobox } from "./controls";
import { CATALOG, catalogCategories, subNameOf } from "../lib/catalog";
import { CUSTOMERS, ORDERS, ASSIGNEES, PRIORITIES, type Customer, type Order, type OrderItem, type Priority } from "../lib/data";
import { ALBUM_TYPES, BINDING, BOXES, COVERS, EVENT_TYPES, FINISHES, LAMINATION, PAPER, SIZES, DISCOUNT_APPROVAL_PCT, GST_RATE, blankAlbum, priceAlbums, albumName, WORK_GROUPS, type AlbumSpec } from "../lib/pricing";
import { inr, cleanMobile, mobileError } from "../lib/format";
import { useToast } from "./Toast";
import { logAudit } from "../lib/audit";
import { backendOn } from "../lib/supabase";
import { dbCreateCustomer, dbCreateOrder } from "../lib/db/orders";

// SRS §4.3 (order fields), §5 (workflow routing), §6.1 (album spec), §3.2 (pricing).
interface Draft {
  customerId: string; newCustomer: { studio: string; mobile: string } | null;
  workflow: "Design + Printing" | "Printing"; orderDate: string; due: string; couple: string; workGroup: string; eventName: string; event: string; eventDate: string; priority: Priority; instructions: string;
  albums: AlbumSpec[];     // each album has its own specification; the admin prices them afterwards (Costing & Invoices)
}
const iso = (n = 0) => { const d = new Date("2026-10-03"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const blank = (): Draft => ({
  customerId: "", newCustomer: null, workflow: "Design + Printing", orderDate: iso(), due: iso(14), couple: "", workGroup: "", eventName: "", event: EVENT_TYPES.includes("Wedding") ? "Wedding" : EVENT_TYPES[0] ?? "Wedding", eventDate: "", priority: "Normal", instructions: "",
  albums: [blankAlbum()],
});
const STEPS = ["Customer & type", "Event & dates", "Albums", "Review"];

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
  const [cur, setCur] = useState(0);                       // album being edited on the "Album spec" step
  const al = d.albums[Math.min(cur, d.albums.length - 1)]!;
  const setAlbum = (patch: Partial<AlbumSpec>) => setD((x) => ({ ...x, albums: x.albums.map((a, i) => (i === cur ? { ...a, ...patch } : a)) }));
  const addAlbum = (copyOf?: AlbumSpec) => { setD((x) => ({ ...x, albums: [...x.albums, copyOf ? { ...copyOf, finishes: [...copyOf.finishes] } : blankAlbum()] })); setCur(d.albums.length); };
  const removeAlbum = (i: number) => { setD((x) => ({ ...x, albums: x.albums.filter((_, j) => j !== i) })); setCur(Math.max(0, i - 1)); };
  const designed = d.workflow === "Design + Printing";
  const nameOf = (a: AlbumSpec, i: number) => albumName(a, i, d.couple, d.event);
  const eventTitle = (d.couple.trim() ? `${d.couple.trim()} ${d.event}` : "");
  const cust = CUSTOMERS.find((c) => c.id === d.customerId);
  const custName = d.newCustomer ? d.newCustomer.studio : cust?.studio ?? "";

  const validate = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) { if (!d.customerId && !d.newCustomer) e.customer = "Choose a customer or add a new one"; if (d.newCustomer) { if (d.newCustomer.studio.trim().length < 2) e.studio = "Enter studio name"; { const m = mobileError(d.newCustomer.mobile); if (m) e.mobile = m; } } }
    if (s === 1) { if (!d.due) e.due = "Required"; else if (d.due < d.orderDate) e.due = "Delivery date cannot be before order date"; }
    if (s === 2) { const bad = d.albums.findIndex((a) => a.sheets < 1 || a.copies < 1); if (bad >= 0) { setCur(bad); if (d.albums[bad]!.sheets < 1) e.sheets = "Positive number"; if (d.albums[bad]!.copies < 1) e.copies = "At least 1"; } }
    setErr(e); return Object.keys(e).length === 0;
  };
  const next = () => validate(step) && setStep(step + 1);

  const [saving, setSaving] = useState(false);
  const create = async () => {
    if (![0, 1, 2].every(validate)) { setStep(0); return; }
    const named = d.albums.map((a, i) => ({ ...a, title: nameOf(a, i) }));     // every album is saved with its name

    if (backendOn) {                                  // database mode: the server assigns the order number; nothing is shown until it is saved
      setSaving(true);
      try {
        let customerUid = cust?.uid;
        if (d.newCustomer) {
          const c = await dbCreateCustomer({ studio: d.newCustomer.studio, mobile: d.newCustomer.mobile });
          if (!c) { setSaving(false); return; }
          customerUid = c.uid;
        }
        if (!customerUid) { setSaving(false); show("Choose a customer"); return; }
        const order = await dbCreateOrder({
          customerUid, type: designed ? "design_printing" : "printing_only", priority: d.priority, eventName: eventTitle, eventType: d.event, couple: d.couple.trim() || undefined, workGroup: d.workGroup || undefined, eventDate: d.eventDate || undefined,
          orderDate: d.orderDate, dueDate: d.due, total: 0, instructions: d.instructions, albums: named,
        });
        setSaving(false);
        if (!order) return;                           // the error was already shown by the data layer
        show(`Order ${order.id} created`); onClose(); nav(`/orders/${order.id}`);
      } catch (e) { setSaving(false); show(String((e as Error).message ?? e)); }
      return;
    }

    const n = Math.max(...ORDERS.map((o) => Number(o.id.replace("IDP", "")))) + 1;
    if (d.newCustomer) {
      const c: Customer = { id: `IDC${String(1249 + CUSTOMERS.length).padStart(6, "0")}`, name: d.newCustomer.studio, studio: d.newCustomer.studio, mobile: d.newCustomer.mobile, email: "", city: "", state: "", type: "New", status: "Active", activeOrders: 1, lifetime: 0, lastOrder: d.orderDate, since: d.orderDate, dues: 0, tags: [] };
      CUSTOMERS.unshift(c);
    }
    const order: Order = {
      id: `IDP${String(n).padStart(5, "0")}`, customer: custName, mobile: d.newCustomer?.mobile ?? cust?.mobile ?? "", event: d.event, workflow: d.workflow, size: d.albums[0]!.size, pages: d.albums[0]!.sheets,
      couple: d.couple.trim() || undefined, workGroup: d.workGroup || undefined, albums: named,
      stage: "new_order", priority: d.priority, pendingAt: d.orderDate, assignee: "Priya", due: d.due, pay: "Unpaid", total: 0, paid: 0, progress: 0,
    };
    ORDERS.unshift(order);
    logAudit({ entity: "order", entityId: order.id, action: "create", detail: `${order.workflow} · ${d.albums.length > 1 ? `${d.albums.length} albums` : `${d.albums[0]!.albumType} ${order.size}`} · costing pending${d.newCustomer ? " · new customer " + custName : ""}` });
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
                      <input className={cx(inputCls, err.mobile && "border-rose-400")} placeholder="Mobile number" inputMode="numeric" maxLength={10} value={d.newCustomer.mobile} onChange={(e) => set("newCustomer", { ...d.newCustomer!, mobile: cleanMobile(e.target.value) })} />
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
              <div className="md:col-span-2"><Field label="Couple Name" hint="Names of the couple, e.g. Rahul & Priya"><input className={inputCls} value={d.couple} onChange={(e) => set("couple", e.target.value)} placeholder="e.g. Rahul & Priya" /></Field></div>
              <Field label="Work Group"><select className={inputCls} value={d.workGroup} onChange={(e) => set("workGroup", e.target.value)}><option value="">Select</option>{WORK_GROUPS.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Event Date"><input type="date" className={inputCls} value={d.eventDate} onChange={(e) => set("eventDate", e.target.value)} /></Field>
              <Field label="Priority" required><div className="flex gap-1.5">{PRIORITIES.filter((x) => x !== "Low").map((x) => <button key={x} onClick={() => set("priority", x)} className={cx("h-10 flex-1 rounded-lg border text-[13px] font-bold", d.priority === x ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{x}</button>)}</div></Field>
              <Field label="Order Date" required><input type="date" className={inputCls} value={d.orderDate} onChange={(e) => set("orderDate", e.target.value)} /></Field>
              <Field label="Expected Delivery Date" required hint={err.due}><input type="date" min={d.orderDate} className={cx(inputCls, err.due && "border-rose-400")} value={d.due} onChange={(e) => set("due", e.target.value)} /></Field>
              <div className="md:col-span-2"><Field label="Special Instructions"><textarea className={cx(inputCls, "h-20 py-2")} value={d.instructions} onChange={(e) => set("instructions", e.target.value)} /></Field></div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Albums on this order">
                {d.albums.map((a, i) => (
                  <button key={i} role="tab" aria-selected={i === cur} onClick={() => setCur(i)} className={cx("h-10 rounded-lg border px-4 text-[13px] font-bold", i === cur ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>
                    {nameOf(a, i)}<span className={cx("ml-2 font-medium", i === cur ? "opacity-80" : "text-sub")}>{a.albumType} · {a.size}{a.copies > 1 ? ` ×${a.copies}` : ""}</span>
                  </button>
                ))}
                <button onClick={() => addAlbum()} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-dashed border-brand px-4 text-[13px] font-bold text-brand hover:bg-brand-soft"><Plus className="size-4" />Add album</button>
              </div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-extrabold">Album {cur + 1} of {d.albums.length}</h3>
                <div className="flex gap-2">
                  <button onClick={() => addAlbum(al)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold hover:bg-slate-50"><Copy className="size-3.5" />Duplicate</button>
                  {d.albums.length > 1 && <button onClick={() => removeAlbum(cur)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50"><Trash2 className="size-3.5" />Remove</button>}
                </div>
              </div>
              <div className="grid gap-x-6 md:grid-cols-3">
                <div className="md:col-span-3"><Field label="Album Name" hint="Shown on the order, proofs and production, e.g. “Engagement Album”"><input className={inputCls} value={al.title} onChange={(e) => setAlbum({ title: e.target.value })} placeholder={cur === 0 && d.couple.trim() ? nameOf({ ...al, title: "" }, 0) : "e.g. Engagement Album"} /></Field></div>
                <Field label="Album Type" required><select className={inputCls} value={al.albumType} onChange={(e) => setAlbum({ albumType: e.target.value })}>{Object.keys(ALBUM_TYPES).map((x) => <option key={x}>{x}</option>)}</select></Field>
                <Field label="Album Size" required><select className={inputCls} value={al.size} onChange={(e) => setAlbum({ size: e.target.value })}>{SIZES.map((x) => <option key={x}>{x}</option>)}</select></Field>
                <Field label="Orientation" required><select className={inputCls} value={al.orientation} onChange={(e) => setAlbum({ orientation: e.target.value })}>{["Landscape", "Portrait", "Square"].map((x) => <option key={x}>{x}</option>)}</select></Field>
                <Field label="No. of Sheets" required hint={err.sheets || "The admin splits these sheets into priced items afterwards"}><input type="number" min={1} className={inputCls} value={al.sheets} onChange={(e) => setAlbum({ sheets: Number(e.target.value) })} /></Field>
                <Field label="Copies" required hint={err.copies}><input type="number" min={1} className={inputCls} value={al.copies} onChange={(e) => setAlbum({ copies: Number(e.target.value) })} /></Field>
                <details className="md:col-span-3 mb-4 rounded-xl border border-line px-4 py-3"><summary className="cursor-pointer text-sm font-bold text-brand">More specification (optional)</summary><div className="mt-3 grid gap-x-6 md:grid-cols-3">
                <Field label="Binding" required><select className={inputCls} value={al.binding} onChange={(e) => setAlbum({ binding: e.target.value })}>{BINDING.map((x) => <option key={x}>{x}</option>)}</select></Field>
                <Field label="Paper Type" required><select className={inputCls} value={al.paper} onChange={(e) => setAlbum({ paper: e.target.value, gsm: String(PAPER[e.target.value]!.gsm[0]) })}>{Object.keys(PAPER).map((x) => <option key={x}>{x}</option>)}</select></Field>
                <Field label="Paper GSM"><select className={inputCls} value={al.gsm} onChange={(e) => setAlbum({ gsm: e.target.value })}>{PAPER[al.paper]!.gsm.map((g) => <option key={g}>{g}</option>)}</select></Field>
                <Field label="Cover Type" required><select className={inputCls} value={al.cover} onChange={(e) => setAlbum({ cover: e.target.value })}>{Object.keys(COVERS).map((x) => <option key={x}>{x}</option>)}</select></Field>
                <Field label="Lamination"><select className={inputCls} value={al.lamination} onChange={(e) => setAlbum({ lamination: e.target.value })}>{Object.keys(LAMINATION).map((x) => <option key={x}>{x}</option>)}</select></Field>
                <Field label="Box Required"><select className={inputCls} value={al.box} onChange={(e) => setAlbum({ box: e.target.value })}>{Object.keys(BOXES).map((x) => <option key={x}>{x}</option>)}</select></Field>
                <Field label="Name Printing"><input className={inputCls} value={al.nameText} onChange={(e) => setAlbum({ nameText: e.target.value })} placeholder="Text on cover" /></Field>
                <div className="md:col-span-3"><div className="mb-1.5 text-[13px] font-semibold">Special finishes</div>
                  <div className="flex flex-wrap gap-2">{Object.keys(FINISHES).map((f) => { const on = al.finishes.includes(f); return <button key={f} onClick={() => setAlbum({ finishes: on ? al.finishes.filter((x) => x !== f) : [...al.finishes, f] })} className={cx("h-9 rounded-full border px-4 text-[13px] font-bold", on ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{on && "✓ "}{f}</button>; })}</div></div>
                </div></details>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-6 md:grid-cols-[1fr_320px]">
              <div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  {[["Customer", custName], ["Order type", d.workflow], ["Work group", d.workGroup || "—"], ["Couple", d.couple || "—"], ["Priority", d.priority], ["Order date", d.orderDate], ["Delivery date", d.due], ["Albums", String(d.albums.length)], ["Instructions", d.instructions || "—"]].map(([k, v]) => <div key={k}><dt className="text-xs text-sub">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
                </dl>
                <div className="mt-4 space-y-3">
                  {d.albums.map((a, i) => (
                    <div key={i} className="rounded-xl border border-line p-3 text-sm">
                      <div className="mb-1 flex items-center justify-between"><b>{nameOf(a, i)} · {a.albumType}</b></div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-sub">
                        <span>{a.size} · {a.orientation}</span><span>{a.sheets} pages × {a.copies} {a.copies === 1 ? "copy" : "copies"}</span>
                        <span>{a.paper} {a.gsm} GSM · {a.binding}</span><span>{a.cover} cover · {a.lamination} lamination</span>
                        <span>Box: {a.box}</span><span>Finishes: {a.finishes.join(", ") || "None"}</span>
                        {a.nameText && <span className="col-span-2">Name printing: {a.nameText}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-line bg-slate-50 p-4 text-sm">
                <div className="mb-1 font-extrabold">What happens next</div>
                <p className="text-xs text-sub">The order gets an ID and enters the {designed ? "Colour Grading" : "File Verification"} queue. An admin then splits each album&apos;s sheets into priced items (cover, paper, box…) under <b>Costing &amp; Invoices</b>, finalizes the total and generates the invoice(s).</p>
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700"><PartyPopper className="size-4 shrink-0" />The customer is acknowledged as soon as the order is created.</p>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-line px-6 py-4">
          <button onClick={step === 0 ? onClose : () => setStep(step - 1)} className="inline-flex h-10 items-center gap-1 rounded-lg border border-line px-4 text-sm font-bold hover:bg-slate-50">{step > 0 && <ChevronLeft className="size-4" />}{step === 0 ? "Cancel" : "Back"}</button>
          <span />
          {step < STEPS.length - 1
            ? <button onClick={next} className="inline-flex h-10 items-center gap-1 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark">Next<ChevronRight className="size-4" /></button>
            : <button onClick={create} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-60"><Check className="size-4" />{saving ? "Saving…" : "Create Order"}</button>}
        </footer>
        {toast}
      </div>
    </div>
  );
}

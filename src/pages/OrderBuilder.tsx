import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, FileText, Palette, Plus, Printer, Save, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { Field, Pill, Toggle, cx, inputCls } from "../components/ui";
import { Combobox } from "../components/controls";
import { CategoryPicker, type SheetBalance } from "../components/CategoryPicker";
import { AlbumItemsTable } from "../components/AlbumItemsTable";
import { InvoiceView } from "../components/InvoiceView";
import { useToast } from "../components/Toast";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { backendOn } from "../lib/supabase";
import { CUSTOMERS, ORDERS } from "../lib/data";
import { LAMINATION, PAPER, SIZES, WORK_GROUPS } from "../lib/pricing";
import { PRIORITIES } from "../lib/data";
import { cleanMobile, mobileError } from "../lib/format";
import { ITEMS, SCOPE_LABEL, itemById, loadCatalog2, optionItems, pricingSettings, rateCard, seedDemoCatalog, type OptionKind } from "../lib/catalog2";
import { money, type DraftAlbum, type OrderDraft, type PricedOrder } from "../lib/orderPricing";
import { DRAFTS, addDays, blankDraft, deleteDraft, draftProblems, finalizeDraft, listDrafts, newAlbum, openDrafts, orderToday, previewSnapshot, price, saveDraft, serverPrice, type FinalizeResult, type InvoiceSnapshot } from "../lib/orders2";
import { downloadBlob, invoicePdf, openBlob } from "../lib/invoicePdf";

const STEPS = ["Order type", "Customer", "Event & dates", "Albums & items", "Invoice", "Finalize"];
const ORIENT = ["Landscape", "Portrait", "Square"];
const SLOTS: OptionKind[] = ["cover", "binding", "box"];
const SLOT_LABEL: Record<string, string> = { cover: "Cover", binding: "Binding", box: "Box" };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export default function OrderBuilder() {
  useStore();
  const { role } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [toast, show] = useToast();
  const [d, setD] = useState<OrderDraft>(() => { const b = blankDraft(); const c = params.get("customer"); const cc = c ? CUSTOMERS.find((x) => x.id === c || x.uid === c) : undefined; if (cc) b.customerId = cc.uid ?? cc.id; return b; });
  const [draftId, setDraftId] = useState<string | undefined>(params.get("draft") ?? undefined);
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState(0);
  const [cur, setCur] = useState(0);
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<FinalizeResult | null>(null);
  const [server, setServer] = useState<{ total?: number; error?: string; checking?: boolean } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    seedDemoCatalog();
    void (async () => {
      await Promise.all([loadCatalog2(), listDrafts()]);
      const id = params.get("draft");
      const rec = id ? DRAFTS.find((x) => x.id === id) : undefined;
      if (rec) {
        const copy = clone(rec.payload); setD(copy); setDraftId(rec.id); lastSaved.current = JSON.stringify(copy);
        if (rec.result) { setDone(rec.result); setStep(5); setVisited(5); } else { setStep(rec.payload.orderType ? 3 : 0); setVisited(5); }
      }
      setLoaded(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const p: PricedOrder = useMemo(() => price(d), [d, ITEMS.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const problems = useMemo(() => draftProblems(d), [d, p]); // eslint-disable-line react-hooks/exhaustive-deps
  const reopenOf = d.reopenOrder ? ORDERS.find((o) => o.id === d.reopenOrder || o.uid === d.reopenOrder) : undefined;
  const paid = reopenOf?.paid ?? 0;
  const designed = d.orderType === "design_printing";
  const set = (patch: Partial<OrderDraft>) => { setD((x) => ({ ...x, ...patch })); setServer(null); };
  const album = d.albums[Math.min(cur, d.albums.length - 1)]!;
  const setAlbum = (patch: Partial<DraftAlbum>) => set({ albums: d.albums.map((a, i) => (i === cur ? { ...a, ...patch } : a)) });
  const pAlbum = p.albums[Math.min(cur, p.albums.length - 1)];

  const stepProblems = (s: number) => problems.filter((x) => x.step === s).map((x) => x.message);
  const go = async (s: number) => {
    if (s > step && step < 4) { const e = stepProblems(step).filter((m) => !(step === 3 && /not configured|rate card/.test(m))); if (e.length) { setErrs(e); return; } }
    setErrs([]); setStep(s); setVisited(Math.max(visited, s)); window.scrollTo({ top: 0 });
    if (d.orderType || d.customerId || d.newCustomer) void persist(true);
  };
  // ───── drafts: saved by hand, and automatically while an order is being entered ─────
  const dRef = useRef(d); dRef.current = d;
  const draftRef = useRef(draftId); draftRef.current = draftId;
  const doneRef = useRef(done); doneRef.current = done;
  const saving = useRef<Promise<unknown> | null>(null);
  const lastSaved = useRef("");
  const [saveState, setSaveState] = useState<{ s: "idle" | "saving" | "saved" | "error"; at?: Date; msg?: string }>({ s: "idle" });
  const started = (x: OrderDraft) => !!(x.orderType || x.customerId || x.newCustomer?.name?.trim());   // nothing worth keeping before this
  const save = async (): Promise<string | null> => {
    if (saving.current) await saving.current.catch(() => undefined);              // one save at a time, so one draft per order
    const cur = dRef.current, json = JSON.stringify(cur);
    if (json === lastSaved.current && draftRef.current) return null;
    setSaveState({ s: "saving" });
    const job = saveDraft(draftRef.current, cur); saving.current = job;
    const r = await job; saving.current = null;
    if ("error" in r) { setSaveState({ s: "error", msg: r.error }); return r.error; }
    lastSaved.current = json;
    if (r.id !== draftRef.current) { draftRef.current = r.id; setDraftId(r.id); setParams((x) => { const n = new URLSearchParams(x); n.set("draft", r.id); return n; }, { replace: true }); }
    setSaveState({ s: "saved", at: new Date() });
    return null;
  };
  const autosave = () => { if (loaded && !doneRef.current && !busyRef.current && started(dRef.current)) void save(); };
  useEffect(() => { if (!loaded || done) return; const t = window.setTimeout(autosave, 1200); return () => window.clearTimeout(t); }, [d, step, loaded, done]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const away = () => { if (document.visibilityState === "hidden") autosave(); };
    document.addEventListener("visibilitychange", away); window.addEventListener("pagehide", autosave);
    return () => { document.removeEventListener("visibilitychange", away); window.removeEventListener("pagehide", autosave); autosave(); };   // leaving the page saves too
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const persist = async (quiet = false) => {
    const e = await save();
    if (e) { show(e); return; }
    if (!quiet) show("Draft saved — you can come back to it from Orders › Drafts");
  };
  const finalize = async () => {
    if (busyRef.current) return;                                                         // a second click while the first is in flight does nothing
    busyRef.current = true; setBusy(true); setErrs([]);
    if (saving.current) await saving.current.catch(() => undefined);                    // let an auto-save in flight finish first
    try {
      const r = await finalizeDraft(draftId, d);
      if ("error" in r) { setErrs([r.error]); return; }
      setDraftId(r.draftId); setDone(r.result); setStep(5); setVisited(5);
      show(`Order ${r.result.code} finalized · invoice ${r.result.invoiceNumber}`);
    } finally { busyRef.current = false; setBusy(false); }
  };
  const verify = async () => {
    if (!backendOn) return;
    setServer({ checking: true });
    const r = await serverPrice(d);
    if (!r) return setServer(null);
    if ("error" in r) setServer({ error: r.error }); else setServer({ total: r.total });
  };
  useEffect(() => {                                                                      // re-check with the server shortly after every change on the invoice step
    if (step !== 4 || !backendOn) return;
    const t = window.setTimeout(() => void verify(), 500); return () => window.clearTimeout(t);
  }, [step, d]); // eslint-disable-line react-hooks/exhaustive-deps
  const [snap, setSnap] = useState<InvoiceSnapshot | null>(null);
  useEffect(() => { if (step === 4) { let live = true; void previewSnapshot(d, p).then((x) => live && setSnap(x)); return () => { live = false; }; } }, [step, d, p]); // eslint-disable-line react-hooks/exhaustive-deps

  const snapshotOf = async (): Promise<InvoiceSnapshot> => previewSnapshot(d, p);
  const pdf = async (kind: "open" | "download") => {
    const s = done ? (await import("../lib/orders2")).pricingOf(done.code)?.snapshot ?? await snapshotOf() : await snapshotOf();
    const blob = await invoicePdf(s, { preview: !done, paid });
    if (kind === "download") downloadBlob(blob, `${done ? done.invoiceNumber : "invoice-preview"}.pdf`); else openBlob(blob);
  };

  if (role && !["admin", "reception"].includes(role)) return <p className="p-8 text-sm text-sub">Only reception and admin create orders.</p>;
  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold tracking-tight">{reopenOf ? `Edit order ${reopenOf.id}` : "New order"}</h1>
          <p className="text-sm text-sub">Order type → customer → event → albums & items → invoice → finalize. Nothing is lost when you move between steps.</p>
          <span className={cx("mt-1 block text-[11px] font-semibold", saveState.s === "error" ? "text-rose-600" : "text-sub")} data-testid="autosave" aria-live="polite">
            {saveState.s === "saving" ? "Saving draft…" : saveState.s === "saved" ? `Draft saved automatically · ${saveState.at!.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : saveState.s === "error" ? `Not saved: ${saveState.msg}` : started(d) ? "" : "Auto-saves as a draft once you start"}
          </span></div>
        {!done && <div className="flex flex-wrap gap-2">
          <DraftMenu current={draftId} onOpen={(id) => { nav(`/orders/new?draft=${id}`); window.location.reload(); }} />
          <button onClick={() => void persist()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] font-bold hover:bg-brand-soft"><Save className="size-4" />Save draft</button>
        </div>}
      </div>
      {loaded && !done && !draftId && !started(d) && openDrafts().length > 0 && (() => { const last = openDrafts()[0]!; return (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" data-testid="resume-banner">
          <span className="min-w-0 flex-1">You have {openDrafts().length} unfinished order{openDrafts().length === 1 ? "" : "s"}. Latest: <b>{last.title}</b> <span className="text-xs">({new Date(last.updatedAt).toLocaleString("en-IN")})</span></span>
          <button onClick={() => { nav(`/orders/new?draft=${last.id}`); window.location.reload(); }} className="h-9 rounded-lg bg-sky-700 px-4 text-xs font-bold text-white hover:bg-sky-800">Resume</button>
        </div>); })()}
      {reopenOf && !done && <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Authorized edit of a finalized order. Its previous invoice was voided and is kept on record; finalizing issues a new invoice revision. Payments already received ({money(paid)}) stay with the order.</div>}

      <ol className="mb-5 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-white p-2 scroll-thin" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex min-w-fit flex-1 items-center">
            <button disabled={!!done && i < 5} onClick={() => i <= visited && !done && void go(i)} aria-current={i === step ? "step" : undefined}
              className={cx("flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-bold", i === step ? "bg-brand-soft text-brand" : i <= visited ? "text-ink hover:bg-slate-50" : "text-sub")}>
              <span className={cx("grid size-6 shrink-0 place-items-center rounded-full text-[11px]", i < step || (done && i <= 5) ? "bg-brand text-white" : i === step ? "border-2 border-brand" : "border border-line")}>{i < step || done ? <Check className="size-3.5" /> : i + 1}</span>{s}
            </button>
            {i < STEPS.length - 1 && <span className="mx-1 hidden h-px min-w-3 flex-1 bg-line sm:block" />}
          </li>
        ))}
      </ol>

      {!loaded ? <p className="p-6 text-sm text-sub">Loading…</p> : (
        <div className={cx("grid gap-5", step >= 3 && !done && "xl:grid-cols-[minmax(0,1fr)_340px]")}>
          <div className="min-w-0">
            {errs.length > 0 && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><b>Please fix:</b><ul className="ml-4 list-disc">{errs.map((e) => <li key={e}>{e}</li>)}</ul></div>}

            {step === 0 && <TypeStep value={d.orderType} onChange={(t) => set({ orderType: t })} />}
            {step === 1 && <CustomerStep d={d} set={set} />}
            {step === 2 && <EventStep d={d} set={set} />}
            {step === 3 && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Albums">
                  {d.albums.map((a, i) => (
                    <button key={a.id} role="tab" aria-selected={i === cur} onClick={() => setCur(i)} className={cx("rounded-xl border px-3 py-2 text-left text-sm font-bold", i === cur ? "border-brand bg-brand text-white" : "border-line bg-white hover:bg-brand-soft")}>
                      {a.name.trim() || `Album ${i + 1}`}<span className={cx("ml-2 text-xs font-medium", i === cur ? "opacity-80" : "text-sub")}>{money(p.albums[i]?.total ?? 0)}</span>
                    </button>))}
                  <button onClick={() => { set({ albums: [...d.albums, newAlbum(d.albums.length + 1)] }); setCur(d.albums.length); }} className="inline-flex items-center gap-1 rounded-xl border border-dashed border-brand px-3 py-2 text-sm font-bold text-brand hover:bg-brand-soft"><Plus className="size-4" />Add another album</button>
                </div>
                <AlbumEditor key={album.id} a={album} n={cur + 1} total={d.albums.length} designed={designed} priced={pAlbum} designErr={p.errors.find((e) => e.path === `album.${cur + 1}.design`)?.message} taxRate={p.taxEnabled ? p.taxRate : 0} set={setAlbum}
                  onDuplicate={() => { set({ albums: [...d.albums.slice(0, cur + 1), newAlbum(0, album), ...d.albums.slice(cur + 1)] }); setCur(cur + 1); show("Album duplicated — edit the copy independently"); }}
                  onRemove={() => { if (d.albums.length === 1) return; if (!window.confirm(`Remove “${album.name || `Album ${cur + 1}`}” from this order?`)) return; set({ albums: d.albums.filter((_, i) => i !== cur) }); setCur(Math.max(0, cur - 1)); }} />
                <section className="rounded-2xl border border-line bg-white p-4" aria-label="Order charges">
                  <h2 className="text-sm font-extrabold">One-time order charges</h2><p className="mb-3 text-xs text-sub">Charged once for the whole order (not per album or per copy).</p>
                  {d.orderCharges.length > 0 && <ul className="mb-3 divide-y divide-line rounded-xl border border-line">{d.orderCharges.map((c) => { const it = itemById(c.itemId); const l = p.orderLines.find((x) => x.itemId === c.itemId); return (
                    <li key={c.itemId} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="flex-1 font-semibold">{it?.name ?? "Unavailable item"}</span><span className={cx("tabular-nums", l?.missing && "font-bold text-rose-600")}>{l ? (l.missing ? "Price not configured" : money(l.amount)) : "—"}</span>
                      <button aria-label={`Remove ${it?.name ?? "charge"}`} onClick={() => set({ orderCharges: d.orderCharges.filter((x) => x.itemId !== c.itemId) })} className="text-rose-600"><Trash2 className="size-4" /></button></li>); })}</ul>}
                  <CategoryPicker testId="order-charge-picker" label="Add an order charge" accept={(i) => i.method === "one_time_order"} onAdd={(id) => { if (d.orderCharges.some((c) => c.itemId === id)) return "Already added"; set({ orderCharges: [...d.orderCharges, { itemId: id }] }); return null; }} />
                </section>
              </div>
            )}
            {step === 4 && (
              <div className="space-y-4">
                <DiscountTax d={d} set={set} p={p} />
                {backendOn && server && <p className={cx("flex items-center gap-2 text-xs font-semibold", server.error ? "text-rose-600" : server.checking ? "text-sub" : server.total === p.total ? "text-emerald-700" : "text-amber-700")} data-testid="server-check">
                  <ShieldCheck className="size-4" />{server.checking ? "Checking the prices with the server…" : server.error ? `Server check failed: ${server.error}` : server.total === p.total ? `Verified by the server: ${money(server.total!)}` : `The server calculates ${money(server.total ?? 0)} — the catalog changed; the server's figure will be used`}</p>}
                <InvoiceView s={snap ?? ({ ...p, customer: { name: customerLabel(d) }, event: d.event, dueDate: d.event.delivery || addDays(orderToday(), pricingSettings().defaultDeliveryDays) } as InvoiceSnapshot)} paid={paid} preview />
                <div className="flex flex-wrap gap-2"><button onClick={() => void pdf("open")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-bold hover:bg-brand-soft"><FileText className="size-4" />Preview PDF</button></div>
              </div>
            )}
            {step === 5 && (done ? <Done r={done} onPdf={pdf} onNew={() => { nav("/orders/new"); window.location.reload(); }} /> : (
              <section className="rounded-2xl border border-line bg-white p-5" aria-label="Finalize">
                <h2 className="text-lg font-extrabold">Finalize order</h2>
                <p className="mb-4 text-sm text-sub">The server checks every price again, creates the order and its albums, and issues the invoice with its final number. Prices, item names and tax are saved with the order, so later catalog changes never alter it.</p>
                {problems.length ? (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-testid="blocking"><b>Not ready yet:</b>
                    <ul className="ml-4 mt-1 list-disc">{problems.map((x) => <li key={x.message}><button className="text-left underline" onClick={() => void go(x.step)}>{x.message}</button></li>)}</ul></div>
                ) : <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="size-4" />Everything is priced and complete.</p>}
                <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-sub">Customer</dt><dd className="font-bold">{customerLabel(d) || "—"}</dd></div>
                  <div><dt className="text-xs text-sub">Order type</dt><dd className="font-bold">{designed ? "Design + Printing" : d.orderType ? "Album Printing Only" : "—"}</dd></div>
                  <div><dt className="text-xs text-sub">Albums</dt><dd className="font-bold">{d.albums.length}</dd></div>
                  <div><dt className="text-xs text-sub">Final amount</dt><dd className="text-lg font-extrabold text-brand">{money(p.total)}</dd></div>
                </dl>
                <button disabled={busy || problems.length > 0} onClick={() => void finalize()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-6 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 className="size-4" />{busy ? "Finalizing…" : reopenOf ? "Finalize changes & issue new invoice" : "Finalize order & issue invoice"}</button>
              </section>
            ))}

            {!done && (
              <div className="mt-5 flex items-center justify-between">
                <button disabled={step === 0} onClick={() => void go(step - 1)} className="inline-flex h-10 items-center gap-1 rounded-lg border border-line bg-white px-4 text-sm font-bold disabled:opacity-40"><ChevronLeft className="size-4" />Back</button>
                {step < 5 && <button onClick={() => void go(step + 1)} className="inline-flex h-10 items-center gap-1 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark">Next<ChevronRight className="size-4" /></button>}
              </div>
            )}
          </div>
          {step >= 3 && !done && <Summary p={p} paid={paid} onPick={(i) => { setCur(i); setStep(3); }} />}
        </div>
      )}
      {toast}
    </div>
  );
}

const customerLabel = (d: OrderDraft) => d.newCustomer ? d.newCustomer.name : CUSTOMERS.find((c) => (c.uid ?? c.id) === d.customerId)?.studio ?? "";

function TypeStep({ value, onChange }: { value: OrderDraft["orderType"]; onChange: (t: OrderDraft["orderType"]) => void }) {
  const card = (t: "design_printing" | "printing_only", title: string, text: string, Icon: typeof Palette) => (
    <button role="radio" aria-checked={value === t} onClick={() => onChange(t)} className={cx("flex items-start gap-4 rounded-2xl border-2 bg-white p-5 text-left transition", value === t ? "border-brand bg-brand-soft/40" : "border-line hover:border-brand/50")}>
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-6" /></span>
      <span><span className="block text-base font-extrabold">{title}</span><span className="text-sm text-sub">{text}</span></span>
    </button>
  );
  return <div role="radiogroup" aria-label="Order type" className="grid gap-4 md:grid-cols-2">
    {card("design_printing", "Design + Printing", "We design the album and print it. Each album carries a design charge per sheet as well as printing.", Palette)}
    {card("printing_only", "Album Printing Only", "The customer supplies print-ready designs. Printing and the selected options only — no design charge.", Printer)}
  </div>;
}

function CustomerStep({ d, set }: { d: OrderDraft; set: (p: Partial<OrderDraft>) => void }) {
  const isNew = !!d.newCustomer;
  const nc = d.newCustomer ?? { name: "", phone: "", email: "", address: "" };
  const dup = isNew && nc.phone.length === 10 ? CUSTOMERS.find((c) => c.mobile.replace(/\D/g, "").slice(-10) === nc.phone) : undefined;
  return (
    <section className="rounded-2xl border border-line bg-white p-5" aria-label="Customer">
      <div className="mb-4 flex gap-2">
        <button onClick={() => set({ newCustomer: null })} className={cx("inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold", !isNew ? "bg-brand text-white" : "border border-line")}><Users className="size-4" />Existing customer</button>
        <button onClick={() => set({ newCustomer: nc, customerId: "" })} className={cx("inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold", isNew ? "bg-brand text-white" : "border border-line")}><UserPlus className="size-4" />New customer</button>
      </div>
      {!isNew ? (
        <Field label="Search customer" required hint="Search by name, studio or phone">
          <Combobox value={d.customerId} onChange={(v) => set({ customerId: v })} placeholder="Search by name, studio or phone…" options={CUSTOMERS.filter((c) => c.status !== "Inactive").map((c) => ({ value: c.uid ?? c.id, label: c.studio, sub: `${c.name} · ${c.mobile}` }))}
            onCreate={(q) => set({ newCustomer: { ...nc, name: q }, customerId: "" })} createLabel="Add as a new customer" />
        </Field>
      ) : (
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="Customer name" required><input aria-label="Customer name" className={inputCls} value={nc.name} maxLength={150} onChange={(e) => set({ newCustomer: { ...nc, name: e.target.value } })} /></Field>
          <Field label="Phone number" required hint={nc.phone ? mobileError(nc.phone) ?? undefined : "10 digits, starting with 6, 7, 8 or 9"}><input aria-label="Phone number" inputMode="numeric" maxLength={10} className={inputCls} value={nc.phone} onChange={(e) => set({ newCustomer: { ...nc, phone: cleanMobile(e.target.value) } })} /></Field>
          <Field label="Email (optional)"><input aria-label="Email" type="email" className={inputCls} value={nc.email} onChange={(e) => set({ newCustomer: { ...nc, email: e.target.value } })} /></Field>
          <Field label="Address"><input aria-label="Address" className={inputCls} value={nc.address} onChange={(e) => set({ newCustomer: { ...nc, address: e.target.value } })} /></Field>
          {dup && <p className="md:col-span-2 text-sm font-semibold text-amber-700">{dup.studio} already uses this number — <button className="underline" onClick={() => set({ newCustomer: null, customerId: dup.uid ?? dup.id })}>select them instead</button></p>}
        </div>
      )}
    </section>
  );
}

function EventStep({ d, set }: { d: OrderDraft; set: (p: Partial<OrderDraft>) => void }) {
  const ev = d.event; const e = (k: keyof OrderDraft["event"], v: string) => set({ event: { ...ev, [k]: v } });
  return (
    <section className="grid gap-x-4 rounded-2xl border border-line bg-white p-5 md:grid-cols-2" aria-label="Event details">
      <Field label="Event name" hint="e.g. Asha & Ravi wedding"><input aria-label="Event name" className={inputCls} value={ev.name} maxLength={150} onChange={(x) => e("name", x.target.value)} /></Field>
      <Field label="Event date" required><input aria-label="Event date" type="date" className={inputCls} value={ev.date} onChange={(x) => e("date", x.target.value)} /></Field>
      <Field label="Delivery date (optional)" hint={`If left empty: ${pricingSettings().defaultDeliveryDays} days after the order date`}><input aria-label="Delivery date" type="date" min={orderToday()} className={inputCls} value={ev.delivery} onChange={(x) => e("delivery", x.target.value)} /></Field>
      <Field label="Work group"><select aria-label="Work Group" className={inputCls} value={ev.workGroup ?? ""} onChange={(x) => e("workGroup", x.target.value)}><option value="">Select</option>{WORK_GROUPS.map((w) => <option key={w}>{w}</option>)}</select></Field>
      <Field label="Priority"><select aria-label="Priority" className={inputCls} value={ev.priority || "Normal"} onChange={(x) => e("priority", x.target.value)}>{PRIORITIES.filter((x) => x !== "Low").map((x) => <option key={x}>{x}</option>)}</select></Field>
      <div className="md:col-span-2"><Field label="Notes"><textarea aria-label="Order notes" className="h-24 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={ev.notes} maxLength={1000} onChange={(x) => e("notes", x.target.value)} /></Field></div>
    </section>
  );
}

function AlbumEditor({ a, n, total, designed, priced, designErr, taxRate, set, onDuplicate, onRemove }: { a: DraftAlbum; n: number; total: number; designed: boolean; priced?: PricedOrder["albums"][number]; designErr?: string; taxRate: number; set: (p: Partial<DraftAlbum>) => void; onDuplicate: () => void; onRemove: () => void }) {
  const num = (v: string) => (v === "" ? ("" as unknown as number) : Number(v));
  const slotItem = (k: OptionKind) => a.items.find((i) => itemById(i.itemId)?.kind === k);
  const setSlot = (k: OptionKind, id: string) => {
    const rest = a.items.filter((i) => itemById(i.itemId)?.kind !== k);
    set({ items: id ? [...rest, { itemId: id, qty: 1 }] : rest });
  };
  const design = { mode: a.design?.mode || (rateCard("design") ? "card" as const : "per_sheet" as const), amount: a.design?.amount ?? "" };
  // sheet allocation: the quantities of all per-sheet items together should add up to the album's sheets
  const albumSheets = Number(a.sheets) || 0;
  let sheetsUsed = 0, perSheetLines = 0;
  for (const x of a.items) { const it = itemById(x.itemId); if (it?.method !== "per_sheet") continue; perSheetLines++; sheetsUsed += x.sheetQty == null || x.sheetQty === "" ? albumSheets : Number(x.sheetQty) || 0; }
  const sheetBalance = (): SheetBalance => ({ group: "this album", used: sheetsUsed, balance: albumSheets - sheetsUsed });
  const addItem = (id: string, qty: number, sheetQty?: number, full = false): string | null => {
    const it = itemById(id);
    if (a.items.some((x) => x.itemId === id)) return "Already on this album — change its quantity in the table";
    if (it?.kind && a.items.some((x) => itemById(x.itemId)?.kind === it.kind)) return `This album already has a ${it.kind} — change it above`;
    if (full) return `All ${albumSheets} sheets are already allocated — reduce another line first`;
    set({ items: [...a.items, sheetQty != null ? { itemId: id, qty, sheetQty } : { itemId: id, qty }] }); return null;
  };
  const isAdmin = useAuth().role === "admin";
  const missingCards = [!rateCard("printing") && "printing", designed && design.mode === "card" && !rateCard("design") && "design"].filter(Boolean);
  return (
    <section className="rounded-2xl border border-line bg-white p-5" aria-label={`Album ${n}`} data-testid={`album-${n}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2"><h2 className="text-base font-extrabold">Album {n} of {total}</h2>
        <div className="ml-auto flex gap-2"><button onClick={onDuplicate} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft"><Copy className="size-3.5" />Duplicate</button>
          <button disabled={total === 1} onClick={onRemove} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="size-3.5" />Remove</button></div></div>
      <div className="grid gap-x-4 md:grid-cols-3">
        <div className="md:col-span-3"><Field label="Album name / reference" required><input aria-label="Album name" className={inputCls} value={a.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Wedding album" /></Field></div>
        <Field label="Sheets" required><input aria-label="Sheets" type="number" min={1} step={1} className={inputCls} value={a.sheets} onChange={(e) => set({ sheets: num(e.target.value) })} /></Field>
        <Field label="Copies" required><input aria-label="Copies" type="number" min={1} step={1} className={inputCls} value={a.copies} onChange={(e) => set({ copies: num(e.target.value) })} /></Field>
        <Field label="Orientation"><select aria-label="Orientation" className={inputCls} value={a.orientation} onChange={(e) => set({ orientation: e.target.value })}>{ORIENT.map((o) => <option key={o}>{o}</option>)}</select></Field>
        <Field label="Size"><select aria-label="Size" className={inputCls} value={a.size} onChange={(e) => set({ size: e.target.value })}><option value="">Select…</option>{SIZES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Paper type"><select aria-label="Paper type" className={inputCls} value={a.paper} onChange={(e) => set({ paper: e.target.value })}><option value="">Select…</option>{Object.keys(PAPER).map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Finish"><select aria-label="Finish" className={inputCls} value={a.finish} onChange={(e) => set({ finish: e.target.value })}><option value="">Select…</option>{Object.keys(LAMINATION).map((s) => <option key={s}>{s}</option>)}</select></Field>
        {SLOTS.map((k) => { const opts = optionItems(k); if (!opts.length) return null; const cur = slotItem(k); return (
          <Field key={k} label={SLOT_LABEL[k]!}><select aria-label={SLOT_LABEL[k]} className={inputCls} value={cur?.itemId ?? ""} onChange={(e) => setSlot(k, e.target.value)}><option value="">None</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>); })}
      </div>
      {designed && (
        <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50/50 p-4" data-testid={`design-charge-${n}`}>
          <div className="mb-2 text-[13px] font-extrabold text-violet-900">Design charges</div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] font-bold text-sub">Charge design
              <select aria-label="Design charge type" className={cx(inputCls, "mt-1 w-60")} value={design.mode} onChange={(e) => set({ design: { ...design, mode: e.target.value as "card" | "per_sheet" | "fixed" } })}>
                <option value="per_sheet">Per sheet (rate × sheets)</option>
                <option value="fixed">Fixed amount for this album</option>
                <option value="card" disabled={!rateCard("design") && design.mode !== "card"}>From design rate card{rateCard("design") ? "" : " (not set up)"}</option>
              </select></label>
            {design.mode !== "card" && <label className="text-[11px] font-bold text-sub">{design.mode === "per_sheet" ? "Design rate per sheet (₹)" : "Design charge (₹)"}
              <input aria-label="Design charge" inputMode="decimal" className={cx(inputCls, "mt-1 w-40")} placeholder={design.mode === "per_sheet" ? "e.g. 50" : "e.g. 5000"} value={design.amount} onChange={(e) => set({ design: { ...design, amount: e.target.value } })} /></label>}
            <p className="min-w-0 flex-1 pb-2 text-xs text-sub">{design.mode === "card" ? "Design rate card × sheets, for every copy." : design.mode === "per_sheet"
              ? `${Number(a.sheets) || 0} sheets × ₹${design.amount || 0} = ${money((Number(a.sheets) || 0) * (Number(design.amount) || 0))} · charged once per album (not per copy)`
              : "Charged once per album (not per copy)."}</p>
          </div>
          {designErr && (a.design?.amount ?? "") !== "" && <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{designErr}</p>}
        </div>
      )}
      {missingCards.length > 0 && <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800" data-testid="missing-rate-card">
        <span>The {missingCards.join(" and ")} rate card is not set up{isAdmin ? "" : " — an admin adds it in Catalog & Pricing"}. Until then this album shows “Price not configured”.</span>
        {isAdmin && (missingCards as string[]).map((k) => <Link key={k} to={`/catalog?setup=${k}&return=${encodeURIComponent(window.location.pathname + window.location.search)}`} className="rounded-md bg-amber-600 px-2.5 py-1 text-white hover:bg-amber-700">Set up the {k} rate card →</Link>)}
      </p>}
      <AlbumItemsTable a={a} n={n} priced={priced} set={set} taxRate={taxRate}
        accept={(i) => i.method !== "one_time_order" && i.kind !== "printing" && i.kind !== "design"}
        onAdd={(id) => { const it = itemById(id); if (!it) return "Item not found"; const b = it.method === "per_sheet" ? sheetBalance() : null; return addItem(id, 1, b && b.used > 0 ? (b.balance > 0 ? b.balance : undefined) : undefined, !!b && b.used > 0 && b.balance <= 0); }}
        browse={<CategoryPicker testId={`picker-${n}`} sheets={a.sheets} sheetBalance={sheetBalance} accept={(i) => i.method !== "one_time_order" && i.kind !== "printing" && i.kind !== "design"}
          onAdd={(id, qty, sheetQty) => addItem(id, qty, sheetQty)} />}
        footer={<div className="px-3 pb-1">
        {perSheetLines > 0 && albumSheets > 0 && (() => { const bal = albumSheets - sheetsUsed; return (
        <div className="mt-3" data-testid={`sheet-allocation-${n}`} aria-label="Sheet allocation">
          <span className={cx("inline-block rounded-lg border px-3 py-1.5 text-xs font-semibold", bal === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : bal > 0 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-rose-200 bg-rose-50 text-rose-700")} data-testid={`sheet-balance-${n}`}>
            Sheets: {sheetsUsed} of {albumSheets} allocated · {bal === 0 ? "all allocated ✓" : bal > 0 ? `balance ${bal}` : `${-bal} over`}
          </span>
        </div>); })()}
        </div>} />
      <div className="mt-4"><Field label="Additional requirements & notes"><textarea aria-label="Album notes" className="h-20 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={a.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} /></Field></div>
    </section>
  );
}

function DiscountTax({ d, set, p }: { d: OrderDraft; set: (p: Partial<OrderDraft>) => void; p: PricedOrder }) {
  const st = pricingSettings();
  const err = p.errors.find((e) => e.path === "discount")?.message;
  return (
    <section className="grid gap-4 rounded-2xl border border-line bg-white p-5 md:grid-cols-2" aria-label="Discount and tax">
      <div>
        <div className="mb-1.5 text-[13px] font-semibold">Discount</div>
        <div className="flex gap-2">
          <select aria-label="Discount type" className={cx(inputCls, "w-44")} value={d.discount.type} onChange={(e) => set({ discount: { type: e.target.value as OrderDraft["discount"]["type"], value: e.target.value === "none" ? "" : d.discount.value } })}>
            <option value="none">No discount</option><option value="percent">Percentage (%)</option><option value="fixed">Fixed amount (₹)</option></select>
          {d.discount.type !== "none" && <input aria-label="Discount value" inputMode="decimal" className={inputCls} value={d.discount.value} onChange={(e) => set({ discount: { ...d.discount, value: e.target.value } })} placeholder={d.discount.type === "percent" ? "e.g. 5" : "e.g. 500"} />}
        </div>
        <p className={cx("mt-1 text-xs", err ? "font-semibold text-rose-600" : "text-sub")}>{err ?? "Applied to the order subtotal (it can never exceed it)."}</p>
      </div>
      <div>
        <div className="mb-1.5 text-[13px] font-semibold">Tax</div>
        {st.taxEnabled ? <div className="flex items-center justify-between rounded-xl border border-line px-4 py-2.5"><span className="text-sm">{st.taxLabel} @ {st.taxRate}% on the amount after discount</span><Toggle label="Apply tax" on={d.applyTax} onChange={(v) => set({ applyTax: v })} /></div>
          : <p className="rounded-xl border border-line px-4 py-2.5 text-sm text-sub">Tax is switched off in Catalog & Pricing › Tax & defaults.</p>}
      </div>
    </section>
  );
}

function Summary({ p, paid, onPick }: { p: PricedOrder; paid: number; onPick: (i: number) => void }) {
  return (
    <aside className="h-fit rounded-2xl border border-line bg-white p-4 xl:sticky xl:top-4" aria-label="Live pricing summary" data-testid="summary">
      <h2 className="mb-3 text-sm font-extrabold">Live summary</h2>
      <ul className="space-y-2">{p.albums.map((a, i) => (
        <li key={a.index}><button onClick={() => onPick(i)} className="w-full rounded-xl border border-line p-2.5 text-left hover:bg-brand-soft/50">
          <div className="flex justify-between gap-2 text-[13px] font-bold"><span className="truncate">{a.name}</span><span className="tabular-nums">{money(a.total)}</span></div>
          <div className="text-[11px] text-sub">{a.sheets} sheets · {money(a.perCopy)} per copy × {a.copies}{a.perAlbum ? ` + ${money(a.perAlbum)} per album` : ""}</div>
          {a.lines.some((l) => l.missing) && <div className="mt-1 text-[11px] font-bold text-rose-600">Price not configured</div>}
        </button></li>))}</ul>
      {p.orderLines.length > 0 && <div className="mt-2 flex justify-between text-[13px]"><span className="text-sub">Order charges</span><span className="tabular-nums">{money(p.orderLines.reduce((x, l) => x + l.amount, 0))}</span></div>}
      <dl className="mt-3 space-y-1 border-t border-line pt-3 text-[13px]">
        <div className="flex justify-between"><dt className="text-sub">Subtotal</dt><dd className="tabular-nums" data-testid="sum-subtotal">{money(p.subtotal)}</dd></div>
        {p.discountAmount > 0 && <div className="flex justify-between"><dt className="text-sub">Discount</dt><dd className="tabular-nums">− {money(p.discountAmount)}</dd></div>}
        {p.taxEnabled && <div className="flex justify-between"><dt className="text-sub">{p.taxLabel} {p.taxRate}%</dt><dd className="tabular-nums">{money(p.tax)}</dd></div>}
        <div className="flex justify-between text-base font-extrabold"><dt>Final amount</dt><dd className="text-brand tabular-nums" data-testid="sum-total">{money(p.total)}</dd></div>
        <div className="flex justify-between"><dt className="text-sub">Payments received</dt><dd className="tabular-nums">{money(paid)}</dd></div>
        <div className="flex justify-between font-bold"><dt>Balance</dt><dd className="tabular-nums">{money(Math.round((p.total - paid) * 100) / 100)}</dd></div>
      </dl>
      {!p.canFinalize && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">{p.hasMissingPrice ? "Some prices are not configured — the order cannot be finalized until they are." : p.errors[0]?.message}</p>}
    </aside>
  );
}

function Done({ r, onPdf, onNew }: { r: FinalizeResult; onPdf: (k: "open" | "download") => void; onNew: () => void }) {
  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6" aria-label="Order finalized" data-testid="finalized">
      <div className="flex items-center gap-3"><CheckCircle2 className="size-8 text-emerald-600" /><div><h2 className="text-lg font-extrabold">Order {r.code} is finalized</h2>
        <p className="text-sm text-emerald-900">Invoice <b data-testid="done-invoice">{r.invoiceNumber}</b>{r.revision > 1 ? ` (revision ${r.revision})` : ""} · final amount <b>{money(r.total)}</b></p></div></div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => onPdf("download")} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark"><Download className="size-4" />Download invoice PDF</button>
        <button onClick={() => onPdf("open")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-bold hover:bg-brand-soft"><Printer className="size-4" />Open / print</button>
        <Link to={`/orders/${r.code}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-bold hover:bg-brand-soft">Open the order</Link>
        <button onClick={onNew} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-bold hover:bg-brand-soft"><Plus className="size-4" />Create another order</button>
      </div>
    </section>
  );
}

function DraftMenu({ current, onOpen }: { current?: string; onOpen: (id: string) => void }) {
  useStore();
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).has("drafts"));
  const list = openDrafts().filter((x) => x.id !== current);
  if (!list.length) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] font-bold hover:bg-brand-soft">Drafts <span className="rounded-full bg-slate-100 px-2 text-xs">{list.length}</span></button>
      {open && <div className="absolute right-0 z-30 mt-1 w-80 rounded-xl border border-line bg-white p-2 shadow-xl" role="dialog" aria-label="Saved drafts">
        {list.map((x) => <div key={x.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
          <button className="min-w-0 flex-1 truncate text-left text-sm font-semibold" onClick={() => onOpen(x.id)}>{x.title}<span className="block text-[11px] font-normal text-sub">{new Date(x.updatedAt).toLocaleString("en-IN")}</span></button>
          <button aria-label={`Delete draft ${x.title}`} onClick={() => void deleteDraft(x.id)} className="text-rose-600"><Trash2 className="size-4" /></button></div>)}
      </div>}
    </div>
  );
}

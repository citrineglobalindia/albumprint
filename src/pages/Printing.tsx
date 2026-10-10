import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Printer, PlayCircle, Layers, Package, ShieldCheck, Flag, ArrowRight, CheckCircle2, Circle, Download, AlertTriangle, Truck, Lock, Hourglass } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, Thumb, SearchInput, Pagination, Td, trCls, tableCls, PrimaryButton, TodayChip, MoreButton, SlideOver, Field, inputCls, cx, type Kpi } from "../components/ui";
import { MultiSelect, Combobox } from "../components/controls";
import { Banner, DateField, Err, FieldBox, orderOpt, strOpts, TODAY_ISO, useSlashSearch } from "../components/pageKit";
import { useToast } from "../components/Toast";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { ORDERS, stageLabel } from "../lib/data";
import { fmtDate, inr } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { PJOBS, PSTAGES, EXC_KINDS, PAPERS, OPERATORS, ensureProduction, releaseToPrinting, advanceProduction, setOperator, raiseException, resolveException, saveVendor, setSpecs, can, fmtDT, openExc, type PStage, type ExcKind, type Out, type Vendor } from "../lib/production";

const STAGE_ICON: Record<PStage, typeof Printer> = { Waiting: Hourglass, "File Prep": Layers, Printing: PlayCircle, Finishing: Layers, Assembly: Package, Packaging: Package, Completed: Flag, "Sent to QC": ShieldCheck };
const ordOf = (id: string) => ORDERS.find((o) => o.id === id)!;
const blankVendor = (): Vendor => ({ name: "", sentDate: TODAY_ISO, expectedBack: "", tracking: "", cost: 0, status: "Planned" });

export default function Printing() {
  const { role } = useAuth();
  const work = can(role, "printing");
  ensureProduction();
  useStore();
  const nav = useNavigate();
  const [toast, show] = useToast();
  const [fStage, setFStage] = useState<string[]>([]);
  const [fOp, setFOp] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selId, setSelId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [form, setForm] = useState({ order: "", paper: PAPERS[0]!, sheets: "", copies: "1", operator: OPERATORS[0]!, due: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [exc, setExc] = useState<{ kind: ExcKind; note: string }>({ kind: "Machine fault", note: "" });
  const [vend, setVend] = useState<Vendor>(blankVendor());
  const [vendFor, setVendFor] = useState<string | null>(null);
  const [spec, setSpec] = useState({ paper: "", sheets: "", copies: "", cover: "", lamination: "", box: "", finishing: "" });
  const tableRef = useRef<HTMLDivElement>(null);
  useSlashSearch();
  const run = (r: Out) => { show(r.msg); return r.ok; };
  const guard = () => { if (work) return true; show(`Your role (${role}) cannot perform printing actions`); return false; };

  const counts = Object.fromEntries(PSTAGES.map((s) => [s, PJOBS.filter((j) => j.stage === s).length])) as Record<PStage, number>;
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return PJOBS.filter((j) => (!fStage.length || fStage.includes(j.stage)) && (!fOp.length || fOp.includes(j.operator)) && (!t || `${j.orderId} ${ordOf(j.orderId)?.customer ?? ""} ${j.operator}`.toLowerCase().includes(t)));
  }, [q, fStage, fOp, PJOBS.length, PJOBS.map((j) => j.stage + j.operator).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = filtered.slice((page - 1) * 8, page * 8);
  const sel = PJOBS.find((j) => j.orderId === selId) ?? null;
  const so = sel ? ordOf(sel.orderId) : null;
  const closed = !!so?.closed;
  const canAct = work && !closed;
  const si = sel ? PSTAGES.indexOf(sel.stage) : 0;
  if (sel && vendFor !== sel.orderId) { setVendFor(sel.orderId); setVend(sel.vendor ?? blankVendor()); }

  const eligible = ORDERS.filter((o) => o.stage === "final_approval" && !PJOBS.some((j) => j.orderId === o.id));
  const fOrder = ORDERS.find((o) => o.id === form.order);
  const submitNew = () => {
    if (!guard()) return;
    const e: Record<string, string> = {};
    if (!fOrder) e.order = "Select an order at Final Approval";
    if (!(Number.isInteger(Number(form.sheets)) && Number(form.sheets) > 0)) e.sheets = "Enter a whole number of sheets";
    if (!(Number.isInteger(Number(form.copies)) && Number(form.copies) >= 1 && Number(form.copies) <= 50)) e.copies = "Copies must be between 1 and 50";
    if (!form.due) e.due = "Choose a due date";
    setErrs(e);
    if (Object.keys(e).length || !fOrder) return;
    if (run(releaseToPrinting(fOrder.id, { paper: form.paper, sheets: Number(form.sheets), copies: Number(form.copies), operator: form.operator, due: form.due }))) { setSelId(fOrder.id); setNewOpen(false); setFStage([]); }
  };
  const openSpec = (orderId: string) => {
    const j = PJOBS.find((x) => x.orderId === orderId)!;
    setSpec({ paper: j.paper, sheets: String(j.sheets), copies: String(j.copies), cover: j.cover ?? "", lamination: j.lamination ?? "", box: j.box ?? "", finishing: j.finishing ?? "" }); setSelId(orderId); setSpecOpen(true);
  };

  const kpis: Kpi[] = [
    { label: "Waiting / File Prep", value: counts.Waiting + counts["File Prep"], icon: Hourglass, tone: "violet" },
    { label: "Printing", value: counts.Printing, icon: PlayCircle, tone: "teal" },
    { label: "Finishing / Assembly", value: counts.Finishing + counts.Assembly, icon: Layers, tone: "pink" },
    { label: "Packaging", value: counts.Packaging, icon: Package, tone: "orange" },
    { label: "Completed", value: counts.Completed, icon: Flag, tone: "teal" },
    { label: "Open exceptions", value: PJOBS.reduce((a, j) => a + openExc(j).length, 0), icon: AlertTriangle, tone: "red", invert: true },
  ];

  return (
    <div className="min-w-0">
      <PageHeader title="Printing" subtitle="Manage and track all printing operations for album production">
        <TodayChip />
        {work && <PrimaryButton onClick={() => { setForm({ order: "", paper: PAPERS[0]!, sheets: "", copies: "1", operator: OPERATORS[0]!, due: "" }); setErrs({}); setNewOpen(true); }}>Release to Printing</PrimaryButton>}
        <MoreButton />
      </PageHeader>
      {!work && <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-[13px] font-semibold text-amber-800"><Lock className="size-4" />View only — printing work is limited to the Printing team and Admin.</div>}
      <KpiRow items={kpis} />

      <div className="min-w-0 space-y-4">
        <Panel title="Production Pipeline" subtitle="Click a stage to filter the job list." bodyClassName="pt-3">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button onClick={() => setFStage([])} className={cx("min-w-[70px] flex-1 rounded-xl border bg-sky-50 p-2.5 text-center", fStage.length === 0 ? "border-brand ring-2 ring-brand/30" : "border-transparent")}>
              <div className="truncate text-[11px] text-sub">All Jobs</div><div className="text-lg font-extrabold">{PJOBS.length}</div>
            </button>
            {PSTAGES.map((s) => { const I = STAGE_ICON[s]; return (
              <div key={s} className="flex min-w-0 flex-1 items-center gap-1.5">
                <ArrowRight className="size-3 shrink-0 text-slate-400" />
                <button data-stage={s} onClick={() => setFStage(fStage.length === 1 && fStage[0] === s ? [] : [s])} className={cx("min-w-[70px] flex-1 rounded-xl border bg-slate-50 p-2.5 text-center", fStage.includes(s) ? "border-brand ring-2 ring-brand/30" : "border-transparent")}>
                  <I className="mx-auto size-5 text-brand" /><div className="truncate text-[11px] text-sub">{s}</div><div className="text-lg font-extrabold">{counts[s]}</div>
                </button>
              </div>); })}
          </div>
        </Panel>

        <div ref={tableRef} />
        <Panel title="Printing Jobs" subtitle="Click a row for the timeline, exceptions and vendor outsourcing" action={<button onClick={() => { downloadCsv("print-jobs.csv", [["Order", "Customer", "Stage", "Paper", "Sheets", "Copies", "Operator", "Due"], ...filtered.map((j) => [j.orderId, ordOf(j.orderId)?.customer ?? "", j.stage, j.paper, j.sheets, j.copies, j.operator, j.due])]); show(`Exported ${filtered.length} jobs`); }} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-brand-soft"><Download className="size-4 text-sub" />Export</button>}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <MultiSelect className="w-44" label="Stage" options={[...PSTAGES]} value={fStage} onChange={(v) => { setFStage(v); setPage(1); }} />
            <MultiSelect className="w-40" label="Operator" options={OPERATORS} value={fOp} onChange={(v) => { setFOp(v); setPage(1); }} />
            <SearchInput className="w-60" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search order, customer... ( / )" />
          </div>
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr>{["Order ID", "Customer", "Album", "Paper", "Sheets × Copies", "Stage", "Operator", "Flags", "Due", ""].map((h) => <th key={h} className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((j) => {
                  const o = ordOf(j.orderId); const I = STAGE_ICON[j.stage];
                  return (
                    <tr key={j.orderId} data-testid={`pjob-${j.orderId}`} onClick={() => setSelId(j.orderId)} className={cx(trCls, "cursor-pointer", selId === j.orderId && "bg-brand-soft")}>
                      <Td><div className="flex items-center gap-2"><Thumb seed={j.orderId} size={30} /><div><div className="font-bold">{j.orderId}</div><div className="text-[11px] text-sub">{o.event}</div></div></div></Td>
                      <Td>{o.customer}</Td><Td>{o.size}<div className="text-[11px] text-sub">{o.pages} pages</div></Td><Td>{j.paper}</Td><Td>{j.sheets} × {j.copies}</Td>
                      <Td><Pill tone={j.stage === "Sent to QC" ? "green" : "blue"} icon={I}>{j.stage}</Pill></Td>
                      <Td>{j.operator}</Td>
                      <Td><span className="flex gap-1">{openExc(j).length > 0 && <Pill tone="red">{openExc(j).length} exc</Pill>}{j.vendor && j.vendor.status !== "Received" && <Pill tone="amber">Vendor</Pill>}{j.reprints > 0 && <Pill tone="orange">R{j.reprints}</Pill>}{o.hold && <Pill tone="slate">{o.hold}</Pill>}</span></Td>
                      <Td className="font-semibold text-rose-600">{fmtDate(j.due)}</Td>
                      <Td><button onClick={(e) => { e.stopPropagation(); setSelId(j.orderId); }} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold hover:bg-brand-soft">View</button></Td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={10} className="py-10 text-center text-sub">No jobs match the filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={8} total={filtered.length} onPage={setPage} noun="jobs" />
        </Panel>
      </div>
      {toast}

      {/* ───── job drawer ───── */}
      <SlideOver open={!!sel && !specOpen} onClose={() => setSelId(null)} title={sel ? `Print Job ${sel.orderId}` : "Print Job"} width={560} footer={sel && <>
        <button onClick={() => nav(`/orders/${sel.orderId}`)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">View Order</button>
        {canAct && <button onClick={() => openSpec(sel.orderId)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Edit specs</button>}
        {canAct && si < PSTAGES.length - 1 && <button data-testid="advance" onClick={() => run(advanceProduction(sel.orderId))} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark">
          {PSTAGES[si + 1] === "Sent to QC" ? "Send to QC" : `Advance to ${PSTAGES[si + 1]}`}<ArrowRight className="size-4" /></button>}
      </>}>
        {sel && so && (
          <div>
            <div className="flex gap-3">
              <Thumb seed={sel.orderId} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="text-lg font-extrabold">{sel.orderId}</span><Pill tone={sel.stage === "Sent to QC" ? "green" : "blue"}>{sel.stage}</Pill></div>
                <div className="text-xs text-sub">{so.customer} · {so.event} · order at <b>{stageLabel(so.stage)}</b>{so.hold ? ` · ${so.hold}` : ""}</div>
                <div className="mt-1 text-xs text-sub">Due {fmtDate(sel.due)} · {inr(so.total)} · {so.pay}</div>
              </div>
            </div>
            {closed && <div className="mt-3"><Banner tone="amber">Order is closed — read-only.</Banner></div>}
            {!work && <div className="mt-3"><Banner tone="amber">View only — your role cannot change production.</Banner></div>}
            {sel.stage === "Sent to QC" && <div className="mt-3"><Banner tone="green">Handed to QC — order is now at {stageLabel(so.stage)}.</Banner></div>}
            {PSTAGES[si + 1] === "Sent to QC" && canAct && <div className="mt-3"><Banner tone="blue">Advancing sends this album to QC and moves the order to the QC stage.</Banner></div>}

            <FieldBox label="Operator">
              <Combobox value={sel.operator} onChange={(v) => { if (guard()) run(setOperator(sel.orderId, v)); }} options={strOpts(OPERATORS)} />
            </FieldBox>

            <h4 className="mb-2 mt-2 text-sm font-extrabold">Production stages</h4>
            <ol className="space-y-2">
              {PSTAGES.map((s, i) => {
                const h = sel.history[s]; const done = !!h && i < si || (s === "Sent to QC" && i === si); const cur = i === si && s !== "Sent to QC";
                return (
                  <li key={s} className={cx("flex items-start gap-3 rounded-lg px-1.5 py-0.5 text-[13px]", cur && "bg-brand-soft")}>
                    {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <Circle className={cx("mt-0.5 size-4 shrink-0", cur ? "fill-brand text-brand" : "text-slate-300")} />}
                    <div className="min-w-0 flex-1"><div className={cx("font-semibold", !done && !cur && "text-sub")}>{s}</div>{h && <div className="text-[11px] text-sub">{fmtDT(h.at)} · {h.by}</div>}</div>
                    <Pill tone={done ? "green" : cur ? "indigo" : "slate"}>{done ? "Done" : cur ? "In progress" : "Pending"}</Pill>
                  </li>
                );
              })}
            </ol>

            <h4 className="mb-2 mt-5 flex items-center gap-2 text-sm font-extrabold"><AlertTriangle className="size-4 text-rose-500" />Exceptions ({sel.exceptions.length})</h4>
            <ul data-testid="exceptions" className="space-y-1.5">
              {sel.exceptions.map((e) => (
                <li key={e.id} className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-[12px]">
                  <Pill tone={e.resolved ? "green" : e.kind === "Delay" ? "amber" : "red"}>{e.kind}</Pill>
                  <div className="min-w-0 flex-1">{e.note}<div className="text-sub">{e.by} · {fmtDT(e.at)}{e.resolvedAt ? ` · resolved ${fmtDT(e.resolvedAt)}` : ""}</div></div>
                  {!e.resolved && canAct && <button onClick={() => run(resolveException(sel.orderId, e.id))} className="rounded-lg border border-line px-2 py-1 text-[11px] font-bold hover:bg-brand-soft">Resolve</button>}
                </li>
              ))}
              {sel.exceptions.length === 0 && <li className="text-xs text-sub">No exceptions raised.</li>}
            </ul>
            {canAct && (
              <div className="mt-2 rounded-xl border border-line p-3">
                <div className="grid grid-cols-[150px_1fr] gap-2">
                  <select aria-label="Exception type" className={inputCls} value={exc.kind} onChange={(e) => setExc({ ...exc, kind: e.target.value as ExcKind })}>
                    {[...EXC_KINDS, "Delay", "Reprint"].map((k) => <option key={k}>{k}</option>)}
                  </select>
                  <input aria-label="Exception note" className={inputCls} placeholder="What happened? (required)" value={exc.note} onChange={(e) => setExc({ ...exc, note: e.target.value })} />
                </div>
                <button onClick={() => { if (run(raiseException(sel.orderId, exc.kind, exc.note))) setExc({ ...exc, note: "" }); }} className="mt-2 h-9 rounded-lg bg-rose-600 px-4 text-xs font-bold text-white hover:bg-rose-700">{exc.kind === "Reprint" ? "Start reprint" : exc.kind === "Delay" ? "Log delay" : "Raise exception"}</button>
                <p className="mt-1 text-[11px] text-sub">Open exceptions block advancing. “Customer hold” places the order on hold until resolved.</p>
              </div>
            )}

            <h4 className="mb-2 mt-5 flex items-center gap-2 text-sm font-extrabold"><Truck className="size-4 text-brand" />Vendor outsourcing {sel.vendor && <Pill tone={sel.vendor.status === "Received" ? "green" : "amber"}>{sel.vendor.status}</Pill>}</h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vendor name"><input aria-label="Vendor name" disabled={!canAct} className={inputCls} value={vend.name} onChange={(e) => setVend({ ...vend, name: e.target.value })} /></Field>
              <Field label="Status"><select aria-label="Vendor status" disabled={!canAct} className={inputCls} value={vend.status} onChange={(e) => setVend({ ...vend, status: e.target.value as Vendor["status"] })}>{["Planned", "Sent", "In progress", "Received"].map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Sent date"><input aria-label="Vendor sent date" type="date" disabled={!canAct} className={inputCls} value={vend.sentDate} onChange={(e) => setVend({ ...vend, sentDate: e.target.value })} /></Field>
              <Field label="Expected back"><input aria-label="Vendor expected back" type="date" disabled={!canAct} className={inputCls} value={vend.expectedBack} onChange={(e) => setVend({ ...vend, expectedBack: e.target.value })} /></Field>
              <Field label="Tracking"><input aria-label="Vendor tracking" disabled={!canAct} className={inputCls} value={vend.tracking} onChange={(e) => setVend({ ...vend, tracking: e.target.value })} /></Field>
              <Field label="Cost (₹)"><input aria-label="Vendor cost" type="number" min={0} disabled={!canAct} className={inputCls} value={vend.cost} onChange={(e) => setVend({ ...vend, cost: Number(e.target.value) })} /></Field>
            </div>
            {canAct && <button onClick={() => run(saveVendor(sel.orderId, vend))} className="h-9 rounded-lg border border-brand px-4 text-xs font-bold text-brand hover:bg-brand-soft">Save vendor job</button>}

            <h4 className="mb-2 mt-5 text-sm font-extrabold">Print specifications</h4>
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <div><div className="text-xs text-sub">Album size</div>{so.size} ({so.pages} pages)</div><div><div className="text-xs text-sub">Paper</div>{sel.paper}</div>
              <div><div className="text-xs text-sub">Sheets × copies</div>{sel.sheets} × {sel.copies}</div><div><div className="text-xs text-sub">Reprints</div>{sel.reprints}</div>
            </div>
            <h4 className="mb-2 mt-5 text-sm font-extrabold">Activity</h4>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-[12px]">{sel.events.map((e, i) => <li key={i} className="rounded-lg border border-line px-3 py-1.5"><b>{e.text}</b><span className="block text-sub">{e.by} · {fmtDT(e.at)}</span></li>)}</ul>
          </div>
        )}
      </SlideOver>

      {/* ───── release to printing ───── */}
      <SlideOver open={newOpen} onClose={() => setNewOpen(false)} title="Release to Printing" width={520} footer={<><button onClick={() => setNewOpen(false)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Cancel</button><button onClick={submitNew} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Release</button></>}>
        <Banner tone="blue">Only orders at Final Approval (released by an admin) or already in Printing can have a production job.</Banner>
        <div className="h-3" />
        <FieldBox label="Order (Final Approval)" required>
          <Combobox error={!!errs.order} placeholder="Search order or customer…" value={form.order} onChange={(id) => { const o = ordOf(id); setForm((f) => ({ ...f, order: id, sheets: String(o.pages), due: o.due })); setErrs({}); }} options={eligible.map(orderOpt)} />
          <Err>{errs.order}</Err>
          {eligible.length === 0 && <p className="mt-1 text-xs text-sub">No orders are waiting at Final Approval.</p>}
          {role !== "admin" && <p className="mt-1 text-xs font-semibold text-amber-700">Only an admin can release an order from Final Approval.</p>}
        </FieldBox>
        <FieldBox label="Paper type"><Combobox value={form.paper} onChange={(v) => setForm({ ...form, paper: v })} options={strOpts(PAPERS)} /></FieldBox>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sheets" required><input aria-label="Sheets" type="number" className={cx(inputCls, errs.sheets && "border-rose-400")} value={form.sheets} onChange={(e) => setForm({ ...form, sheets: e.target.value })} /><Err>{errs.sheets}</Err></Field>
          <Field label="Copies" required><input aria-label="Copies" type="number" className={cx(inputCls, errs.copies && "border-rose-400")} value={form.copies} onChange={(e) => setForm({ ...form, copies: e.target.value })} /><Err>{errs.copies}</Err></Field>
        </div>
        <FieldBox label="Operator"><Combobox value={form.operator} onChange={(v) => setForm({ ...form, operator: v })} options={strOpts(OPERATORS)} /></FieldBox>
        <FieldBox label="Due date" required><DateField label="Due date" value={form.due} error={!!errs.due} min={TODAY_ISO} onChange={(v) => setForm({ ...form, due: v })} /><Err>{errs.due}</Err></FieldBox>
      </SlideOver>

      <SlideOver open={specOpen && !!sel} onClose={() => setSpecOpen(false)} title={`Edit Specifications - ${sel?.orderId ?? ""}`} footer={<><button onClick={() => setSpecOpen(false)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Back</button><button onClick={() => {
        if (!sel || !guard()) return;
        if (!(Number(spec.sheets) > 0) || !(Number(spec.copies) > 0)) { show("Sheets and copies must be positive numbers"); return; }
        if (run(setSpecs(sel.orderId, { paper: spec.paper, sheets: Number(spec.sheets), copies: Number(spec.copies), cover: spec.cover, lamination: spec.lamination, box: spec.box, finishing: spec.finishing }))) setSpecOpen(false);
      }} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Save</button></>}>
        <FieldBox label="Paper type"><Combobox value={spec.paper} onChange={(v) => setSpec({ ...spec, paper: v })} options={strOpts(PAPERS)} /></FieldBox>
        <Field label="Sheets" required><input aria-label="Spec sheets" type="number" className={inputCls} value={spec.sheets} onChange={(e) => setSpec({ ...spec, sheets: e.target.value })} /></Field>
        <Field label="Copies" required><input type="number" className={inputCls} value={spec.copies} onChange={(e) => setSpec({ ...spec, copies: e.target.value })} /></Field>
        <Field label="Cover type"><input className={inputCls} value={spec.cover} onChange={(e) => setSpec({ ...spec, cover: e.target.value })} /></Field>
        <Field label="Lamination"><input className={inputCls} value={spec.lamination} onChange={(e) => setSpec({ ...spec, lamination: e.target.value })} /></Field>
        <Field label="Box details"><input className={inputCls} value={spec.box} onChange={(e) => setSpec({ ...spec, box: e.target.value })} /></Field>
        <Field label="Additional finishing"><input className={inputCls} value={spec.finishing} onChange={(e) => setSpec({ ...spec, finishing: e.target.value })} /></Field>
      </SlideOver>
    </div>
  );
}

import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Search, CheckCircle2, XCircle, Wrench, Truck, ShieldCheck, Check, X, Minus, Lock, UploadCloud } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, Thumb, SearchInput, TodayChip, MoreButton, SlideOver, Pagination, Td, tableCls, trCls, Field, inputCls, cx, type Kpi } from "../components/ui";
import { ColumnsMenu, DateRangePicker, FilterChips, MultiSelect, SavedViews, SortTh, sortRows, type DateRange, type SortState } from "../components/controls";
import { ALL_TIME, Banner, desRange, inRangeOpt, rangeLabel, serRange, useSlashSearch, type SavedRange } from "../components/pageKit";
import { RowMenu } from "../components/RowMenu";
import { BulkBar, BulkBtn, ExportBtn, SelectTd, SelectTh, Toolbar, rangeChip, useSelection } from "../components/listKit";
import { useToast } from "../components/Toast";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { ORDERS, stageLabel } from "../lib/data";
import { fmtDate } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { INSPECTIONS, RTASKS, CHECKS, DEFECTS, type Inspection, openInspection, inspectionsOf, startInspection, updateInspection, addEvidence, decideInspection, executeReworkTask, can, fmtDT, type Mark, type ReturnDept, type Out } from "../lib/production";

const ordOf = (id: string) => ORDERS.find((o) => o.id === id)!;
const DEPTS: ReturnDept[] = ["Printing", "Designing", "Colour Grading"];
const RCOLS = [{ key: "order", label: "Order" }, { key: "round", label: "Round" }, { key: "status", label: "Status" }, { key: "inspector", label: "Inspector" }, { key: "returned", label: "Returned to" }, { key: "defects", label: "Defects" }, { key: "evidence", label: "Evidence" }, { key: "decided", label: "Decided" }];
interface QView { q: string; state: string[]; range: SavedRange }
interface RView { q: string; status: string[]; insp: string[]; ret: string[]; range: SavedRange; hidden: string[]; sort: SortState }

export default function QualityControl() {
  const { role } = useAuth();
  const work = can(role, "qc");
  const isAdmin = role === "admin";
  useStore();
  const nav = useNavigate();
  const [toast, show] = useToast();
  const [q, setQ] = useState("");
  const [qState, setQState] = useState<string[]>([]);
  const [qRange, setQRange] = useState<DateRange>(ALL_TIME());
  const [rq, setRq] = useState("");
  const [rStatus, setRStatus] = useState<string[]>([]);
  const [rInsp, setRInsp] = useState<string[]>([]);
  const [rRet, setRRet] = useState<string[]>([]);
  const [rRange, setRRange] = useState<DateRange>(ALL_TIME());
  const [rSort, setRSort] = useState<SortState>({ key: "started", dir: -1 });
  const [rHidden, setRHidden] = useState<string[]>([]);
  const [rPage, setRPage] = useState(1);
  const [viewId, setViewId] = useState<string | null>(null);
  const rsel = useSelection();
  useSlashSearch();
  const [selId, setSelId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"rework" | "fail">("rework");
  const [dept, setDept] = useState<ReturnDept>("Printing");
  const [reason, setReason] = useState("");
  const [deciding, setDeciding] = useState(false);
  const evInput = useRef<HTMLInputElement>(null);
  const run = (r: Out) => { show(r.msg); return r.ok; };
  const guard = () => { if (work) return true; show(`Your role (${role}) cannot perform quality control actions`); return false; };

  const qStateOf = (id: string) => (RTASKS.some((t) => t.orderId === id && t.status === "Open") ? "Admin task" : openInspection(id) ? "In inspection" : "Awaiting");
  const queue = ORDERS.filter((o) => o.stage === "qc" && (!q.trim() || `${o.id} ${o.customer} ${o.event}`.toLowerCase().includes(q.trim().toLowerCase())) && (!qState.length || qState.includes(qStateOf(o.id))) && inRangeOpt(o.due, qRange));
  const cur = ORDERS.find((o) => o.id === selId) ?? queue[0] ?? null;
  const insp = cur ? openInspection(cur.id) : undefined;
  const history = cur ? inspectionsOf(cur.id).filter((i) => i.status !== "In Inspection") : [];
  const openTask = cur ? RTASKS.find((t) => t.orderId === cur.id && t.status === "Open") : undefined;
  const closed = !!cur?.closed;
  const canAct = work && !closed;
  const decided = INSPECTIONS.filter((i) => i.status !== "In Inspection");

  const rvis = (k: string) => !rHidden.includes(k);
  const inspectors = [...new Set(INSPECTIONS.map((i) => i.inspector))].sort();
  const rlist = sortRows(INSPECTIONS.filter((i) => {
    const t = rq.trim().toLowerCase();
    if (t && !`${i.orderId} ${ordOf(i.orderId)?.customer ?? ""} ${i.inspector} ${i.defects.join(" ")}`.toLowerCase().includes(t)) return false;
    if (rStatus.length && !rStatus.includes(i.status)) return false;
    if (rInsp.length && !rInsp.includes(i.inspector)) return false;
    if (rRet.length && !(i.returnTo && rRet.includes(i.returnTo))) return false;
    return inRangeOpt(i.decidedAt ?? i.startedAt, rRange);
  }), rSort, (i, k) => {
    switch (k) { case "order": return i.orderId; case "round": return i.round; case "status": return i.status; case "inspector": return i.inspector; case "returned": return i.returnTo ?? ""; case "defects": return i.defects.length; case "evidence": return i.evidence.length; case "decided": return i.decidedAt ?? ""; default: return i.startedAt; }
  });
  const rrows = rlist.slice((rPage - 1) * 8, rPage * 8);
  const rselected = rsel.within(rlist.map((i) => i.id));
  const vi: Inspection | undefined = INSPECTIONS.find((i) => i.id === viewId);
  const exportRows = (items: Inspection[]) => { downloadCsv("qc-register.csv", [["Order", "Round", "Status", "Inspector", "Return to", "Defects", "Reason", "Decided"], ...items.map((i) => [i.orderId, i.round, i.status, i.inspector, i.returnTo ?? "", i.defects.join("|"), i.reason ?? "", i.decidedAt ?? ""])]); show(`Exported ${items.length} inspections`); };
  const rchips = [
    ...rStatus.map((x) => ({ label: `Status: ${x}`, onRemove: () => setRStatus(rStatus.filter((y) => y !== x)) })),
    ...rInsp.map((x) => ({ label: `Inspector: ${x}`, onRemove: () => setRInsp(rInsp.filter((y) => y !== x)) })),
    ...rRet.map((x) => ({ label: `Returned to: ${x}`, onRemove: () => setRRet(rRet.filter((y) => y !== x)) })),
    ...rangeChip("Date", rRange.preset, rangeLabel(rRange), () => setRRange(ALL_TIME())),
    ...(rq ? [{ label: `Search: ${rq}`, onRemove: () => setRq("") }] : []),
  ];
  const rclear = () => { setRStatus([]); setRInsp([]); setRRet([]); setRRange(ALL_TIME()); setRq(""); setRPage(1); };
  const rview: RView = { q: rq, status: rStatus, insp: rInsp, ret: rRet, range: serRange(rRange), hidden: rHidden, sort: rSort };
  const applyRView = (v: RView) => { setRq(v.q); setRStatus(v.status); setRInsp(v.insp); setRRet(v.ret); setRRange(desRange(v.range)); setRHidden(v.hidden); setRSort(v.sort); setRPage(1); };

  const kpis: Kpi[] = [
    { label: "Awaiting QC", value: ORDERS.filter((o) => o.stage === "qc" && !openInspection(o.id)).length, icon: Clock, tone: "orange" },
    { label: "In Inspection", value: INSPECTIONS.filter((i) => i.status === "In Inspection").length, icon: Search, tone: "violet" },
    { label: "Passed", value: decided.filter((i) => i.status === "Passed").length, icon: CheckCircle2, tone: "green" },
    { label: "Failed", value: decided.filter((i) => i.status === "Failed").length, icon: XCircle, tone: "red", invert: true },
    { label: "Rework", value: decided.filter((i) => i.status === "Rework").length, icon: Wrench, tone: "orange", invert: true },
    { label: "Ready for Delivery", value: ORDERS.filter((o) => o.stage === "ready_for_delivery").length, icon: Truck, tone: "blue" },
  ];

  const setMark = (k: string, m: Mark) => { if (!cur || !insp || !guard()) return; updateInspection(cur.id, { marks: { ...insp.marks, [k]: insp.marks[k] === m ? "" : m } }); };
  const toggleDefect = (d: string) => { if (!cur || !insp || !guard()) return; updateInspection(cur.id, { defects: insp.defects.includes(d) ? insp.defects.filter((x) => x !== d) : [...insp.defects, d] }); };
  const pass = () => { if (cur && guard()) run(decideInspection(cur.id, { outcome: "pass" })); };
  const fail = () => { if (!cur || !guard()) return; if (run(decideInspection(cur.id, { outcome, returnTo: dept, reason, defects: insp?.defects }))) { setDeciding(false); setReason(""); } };
  const openPending = RTASKS.filter((t) => t.status === "Open");

  return (
    <div>
      <PageHeader title="Quality Control" subtitle="Inspect completed albums for quality, ensure perfection before delivery." icon={<ShieldCheck className="size-10 text-brand" />}>
        <TodayChip /><MoreButton />
      </PageHeader>
      {!work && <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-[13px] font-semibold text-amber-800"><Lock className="size-4" />View only — inspections are limited to the QC team and Admin.</div>}
      <KpiRow items={kpis} cols={6} />

      {openPending.length > 0 && (
        <Panel title="Rework tasks awaiting admin" subtitle="QC cannot return an order to Designing / Colour Grading directly" className="mb-4" bodyClassName="!p-4">
          <ul data-testid="rework-tasks" className="space-y-2">
            {openPending.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2 text-[13px]">
                <b>{t.orderId}</b><Pill tone="orange">→ {t.dept}</Pill><span className="min-w-0 flex-1">{t.reason} <span className="text-sub">({t.defects.join(", ")})</span></span>
                {isAdmin ? <button onClick={() => run(executeReworkTask(t.id))} className="h-8 rounded-lg bg-brand px-3 text-xs font-bold text-white">Return to {t.dept}</button> : <span className="text-xs text-sub">Admin action needed</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel title="Inspection Queue" action={<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold">{queue.length}</span>} bodyClassName="p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Search orders… ( / )" />
          <div className="mt-2 grid gap-2">
            <DateRangePicker className="[&>button]:w-full" value={qRange} onChange={setQRange} align="left" />
            <MultiSelect label="Queue state" options={["Awaiting", "In inspection", "Admin task"]} value={qState} onChange={setQState} />
          </div>
          <div className="mt-2"><SavedViews<QView> storageKey="qc-queue" current={{ q, state: qState, range: serRange(qRange) }} onApply={(v) => { setQ(v.q); setQState(v.state); setQRange(desRange(v.range)); }} /></div>
          <div className="mt-2"><FilterChips chips={[...qState.map((x) => ({ label: `State: ${x}`, onRemove: () => setQState(qState.filter((y) => y !== x)) })), ...rangeChip("Due", qRange.preset, rangeLabel(qRange), () => setQRange(ALL_TIME())), ...(q ? [{ label: `Search: ${q}`, onRemove: () => setQ("") }] : [])]} onClearAll={() => { setQState([]); setQRange(ALL_TIME()); setQ(""); }} /></div>
          <ul className="mt-3 space-y-2">
            {queue.map((o) => {
              const oi = openInspection(o.id); const task = RTASKS.some((t) => t.orderId === o.id && t.status === "Open");
              return (
                <li key={o.id}><button data-testid={`qc-${o.id}`} onClick={() => { setSelId(o.id); setDeciding(false); }} className={cx("flex w-full items-center gap-3 rounded-xl border p-2.5 text-left", cur?.id === o.id ? "border-brand bg-brand-soft" : "border-line hover:bg-slate-50")}>
                  <Thumb seed={o.id} size={36} /><div className="min-w-0 flex-1"><div className="font-bold">{o.id}</div><div className="truncate text-xs text-sub">{o.customer} · {o.event}</div></div>
                  <Pill tone={task ? "orange" : oi ? "violet" : "amber"}>{task ? "Admin" : oi ? `R${oi.round}` : "Awaiting"}</Pill>
                </button></li>
              );
            })}
            {queue.length === 0 && <li className="py-6 text-center text-sm text-sub">No orders waiting at QC.</li>}
          </ul>
        </Panel>

        {cur ? (
          <Panel title={`${cur.id} · ${cur.customer}`} subtitle={`${cur.event} · ${cur.size} · ${cur.pages} pages · due ${fmtDate(cur.due)}`} bodyClassName="!p-5"
            action={<span className="flex items-center gap-2"><Pill tone="indigo">Round {insp?.round ?? history.length + (cur.stage === "qc" ? 1 : 0)}</Pill>{cur.qc && <Pill tone={cur.qc === "passed" ? "green" : cur.qc === "pending" ? "slate" : "red"}>QC: {cur.qc}</Pill>}</span>}>
            {closed && <div className="mb-3"><Banner tone="amber">Order is closed — read-only.</Banner></div>}
            {openTask && <div className="mb-3"><Banner tone="amber">Rework task for {openTask.dept} is waiting for an admin override: {openTask.reason}</Banner></div>}
            {!insp ? (
              <div className="rounded-xl border border-dashed border-line p-6 text-center">
                <p className="text-sm text-sub">{history.length ? `${history.length} earlier round(s) recorded. ` : ""}No inspection is open for this order.</p>
                {canAct && <button onClick={() => run(startInspection(cur.id))} className="mt-3 h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark">Start inspection (round {history.length + 1})</button>}
              </div>
            ) : (<>
              <h4 className="text-sm font-extrabold">Checklist</h4>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {CHECKS.map((c) => (
                  <li key={c.k} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <div className="min-w-0 flex-1"><div className="font-semibold">{c.t}</div><div className="text-xs text-sub">{c.d}</div></div>
                    {(["pass", "fail", "na"] as Mark[]).map((m) => (
                      <button key={m} disabled={!canAct} aria-label={`${c.t} ${m}`} aria-pressed={insp.marks[c.k] === m} onClick={() => setMark(c.k, m)}
                        className={cx("grid h-8 w-12 place-items-center rounded-lg border text-xs font-bold disabled:opacity-50", insp.marks[c.k] === m ? (m === "pass" ? "border-emerald-500 bg-emerald-500 text-white" : m === "fail" ? "border-rose-500 bg-rose-500 text-white" : "border-slate-500 bg-slate-500 text-white") : "border-line hover:bg-slate-50")}>
                        {m === "pass" ? <Check className="size-4" /> : m === "fail" ? <X className="size-4" /> : <Minus className="size-4" />}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>

              <h4 className="mt-4 text-sm font-extrabold">Defect codes</h4>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {DEFECTS.map((d) => <button key={d} disabled={!canAct} aria-pressed={insp.defects.includes(d)} onClick={() => toggleDefect(d)} className={cx("rounded-full border px-3 py-1 text-xs font-bold disabled:opacity-50", insp.defects.includes(d) ? "border-rose-500 bg-rose-500 text-white" : "border-line hover:bg-rose-50")}>{d}</button>)}
              </div>

              <Field label="Inspector notes"><textarea rows={2} disabled={!canAct} className={cx(inputCls, "mt-1 h-auto py-2")} value={insp.notes} onChange={(e) => canAct && updateInspection(cur.id, { notes: e.target.value })} /></Field>

              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <b>Evidence</b>
                {canAct && <button onClick={() => evInput.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft"><UploadCloud className="size-4" />Add evidence</button>}
                <input ref={evInput} data-testid="evidence-input" type="file" multiple accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={(e) => { Array.from(e.target.files ?? []).forEach((f) => { const r = addEvidence(cur.id, f.name, f.size); if (!r.ok) show(r.msg); else show(`Evidence ${f.name} recorded`); }); e.target.value = ""; }} />
                {insp.evidence.map((n) => <Pill key={n} tone="slate">{n}</Pill>)}
              </div>

              {canAct && !deciding && (
                <div className="mt-5 flex gap-2">
                  <button onClick={pass} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700"><CheckCircle2 className="size-4" />Pass → Ready for Delivery</button>
                  <button onClick={() => setDeciding(true)} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-rose-300 text-sm font-bold text-rose-600 hover:bg-rose-50"><XCircle className="size-4" />Fail / Rework…</button>
                </div>
              )}
              {canAct && deciding && (
                <div className="mt-5 space-y-3 rounded-xl border border-rose-200 bg-rose-50/40 p-4">
                  <div className="flex gap-2">{(["rework", "fail"] as const).map((o) => <button key={o} aria-pressed={outcome === o} onClick={() => setOutcome(o)} className={cx("h-9 flex-1 rounded-lg border text-xs font-bold", outcome === o ? "border-rose-500 bg-rose-500 text-white" : "border-line bg-white")}>{o === "rework" ? "Rework" : "Fail"}</button>)}</div>
                  <div className="flex gap-2">{DEPTS.map((d) => <button key={d} aria-pressed={dept === d} onClick={() => setDept(d)} className={cx("h-9 flex-1 rounded-lg border text-xs font-bold", dept === d ? "border-brand bg-brand text-white" : "border-line bg-white")}>Return to {d}</button>)}</div>
                  {dept !== "Printing" && !isAdmin && <p className="text-xs font-semibold text-amber-700">Only an admin can move an order back to {dept}. A rework task for admin will be created.</p>}
                  <textarea aria-label="Failure reason" rows={2} className={cx(inputCls, "h-auto py-2")} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <p className="text-xs text-sub">Defects selected: {insp.defects.length ? insp.defects.join(", ") : "none — pick at least one above"}</p>
                  <div className="flex gap-2"><button onClick={() => setDeciding(false)} className="h-10 rounded-lg border border-line bg-white px-4 text-sm font-bold">Cancel</button><button onClick={fail} className="h-10 flex-1 rounded-lg bg-rose-600 text-sm font-bold text-white hover:bg-rose-700">Confirm {outcome === "fail" ? "failure" : "rework"}</button></div>
                </div>
              )}
            </>)}

            {history.length > 0 && (
              <div className="mt-5">
                <h4 className="text-sm font-extrabold">Earlier rounds</h4>
                <ul className="mt-2 space-y-1.5 text-[12px]">{history.map((i) => <li key={i.id} className="rounded-lg border border-line px-3 py-2"><b>Round {i.round}</b> · <Pill tone={i.status === "Passed" ? "green" : "red"}>{i.status}</Pill> {i.returnTo && <>→ {i.returnTo} · </>}{i.defects.join(", ")}{i.reason ? ` · “${i.reason}”` : ""}<span className="block text-sub">{i.inspector} · {fmtDT(i.decidedAt)}</span></li>)}</ul>
              </div>
            )}
            <div className="mt-4 text-xs text-sub">Order stage: {stageLabel(cur.stage)} · <button className="font-bold text-brand" onClick={() => nav(`/orders/${cur.id}`)}>Open order</button></div>
          </Panel>
        ) : <Panel bodyClassName="!p-6"><p className="text-sm text-sub">Select an order from the queue.</p></Panel>}
      </div>

      <Panel title="Inspection Register" subtitle="All inspection rounds — click a row for the full record" className="mt-4" action={<ExportBtn onClick={() => exportRows(rlist)} />}>
        <Toolbar right={<><SavedViews<RView> storageKey="qc-register" current={rview} onApply={applyRView} /><ColumnsMenu columns={RCOLS} hidden={rHidden} onChange={setRHidden} /></>}>
          <DateRangePicker value={rRange} onChange={(r) => { setRRange(r); setRPage(1); }} align="left" />
          <MultiSelect className="w-40" label="Status" options={["In Inspection", "Passed", "Failed", "Rework"]} value={rStatus} onChange={(v) => { setRStatus(v); setRPage(1); }} />
          <MultiSelect className="w-40" label="Inspector" options={inspectors} value={rInsp} onChange={(v) => { setRInsp(v); setRPage(1); }} />
          <MultiSelect className="w-44" label="Returned to" options={DEPTS} value={rRet} onChange={(v) => { setRRet(v); setRPage(1); }} />
          <SearchInput className="w-56" value={rq} onChange={(v) => { setRq(v); setRPage(1); }} placeholder="Search register…" />
        </Toolbar>
        <FilterChips chips={rchips} onClearAll={rclear} />
        <BulkBar count={rselected.length} onClear={rsel.clear}>
          <BulkBtn testid="bulk-export" onClick={() => exportRows(INSPECTIONS.filter((i) => rselected.includes(i.id)))}>Export selected</BulkBtn>
        </BulkBar>
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead><tr>
              <SelectTh rows={rrows.map((i) => i.id)} sel={rsel} />
              {rvis("order") && <SortTh k="order" sort={rSort} onSort={setRSort}>Order</SortTh>}
              {rvis("round") && <SortTh k="round" sort={rSort} onSort={setRSort}>Round</SortTh>}
              {rvis("status") && <SortTh k="status" sort={rSort} onSort={setRSort}>Status</SortTh>}
              {rvis("inspector") && <SortTh k="inspector" sort={rSort} onSort={setRSort}>Inspector</SortTh>}
              {rvis("returned") && <SortTh k="returned" sort={rSort} onSort={setRSort}>Returned to</SortTh>}
              {rvis("defects") && <SortTh k="defects" sort={rSort} onSort={setRSort}>Defects</SortTh>}
              {rvis("evidence") && <SortTh k="evidence" sort={rSort} onSort={setRSort}>Evidence</SortTh>}
              {rvis("decided") && <SortTh k="decided" sort={rSort} onSort={setRSort}>Decided</SortTh>}
              <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub">Actions</th>
            </tr></thead>
            <tbody>
              {rrows.map((i) => (
                <tr key={i.id} data-testid={`insp-${i.id}`} onClick={() => setViewId(i.id)} className={cx(trCls, "cursor-pointer", rsel.has(i.id) && "bg-brand-soft/60")}>
                  <SelectTd id={i.id} sel={rsel} />
                  {rvis("order") && <Td className="font-bold">{i.orderId}</Td>}
                  {rvis("round") && <Td>{i.round}</Td>}
                  {rvis("status") && <Td><Pill tone={i.status === "Passed" ? "green" : i.status === "In Inspection" ? "violet" : "red"}>{i.status}</Pill></Td>}
                  {rvis("inspector") && <Td>{i.inspector}</Td>}
                  {rvis("returned") && <Td>{i.returnTo ?? "—"}</Td>}
                  {rvis("defects") && <Td>{i.defects.join(", ") || "—"}</Td>}
                  {rvis("evidence") && <Td>{i.evidence.length}</Td>}
                  {rvis("decided") && <Td>{fmtDT(i.decidedAt)}</Td>}
                  <Td><div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setViewId(i.id)} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold hover:bg-brand-soft">View</button>
                    <RowMenu label={`Actions for ${i.orderId} round ${i.round}`} items={[
                      { label: "View record", onClick: () => setViewId(i.id) },
                      ...(ordOf(i.orderId)?.stage === "qc" ? [{ label: "Show in queue", onClick: () => { setSelId(i.orderId); setDeciding(false); window.scrollTo({ top: 0, behavior: "smooth" }); } }] : []),
                      ...(ordOf(i.orderId)?.stage === "qc" && !openInspection(i.orderId) ? [{ label: "Start inspection", onClick: () => { if (guard()) run(startInspection(i.orderId)); } }] : []),
                      { label: "Export row", onClick: () => exportRows([i]) },
                      { label: "Open order", onClick: () => nav(`/orders/${i.orderId}`) },
                    ]} />
                  </div></Td>
                </tr>
              ))}
              {rrows.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-sub">{INSPECTIONS.length ? "No inspections match the filters." : "No inspections recorded yet."}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={rPage} pageSize={8} total={rlist.length} onPage={setRPage} noun="inspections" />
      </Panel>

      <SlideOver open={!!vi} onClose={() => setViewId(null)} title={vi ? `Inspection ${vi.orderId} · round ${vi.round}` : "Inspection"} width={520}
        footer={vi && <button onClick={() => nav(`/orders/${vi.orderId}`)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Open order</button>}>
        {vi && (
          <div className="text-[13px]">
            <div className="flex items-center gap-2"><Pill tone={vi.status === "Passed" ? "green" : vi.status === "In Inspection" ? "violet" : "red"}>{vi.status}</Pill><span className="text-sub">{ordOf(vi.orderId)?.customer} · inspector {vi.inspector}</span></div>
            <p className="mt-1 text-xs text-sub">Started {fmtDT(vi.startedAt)}{vi.decidedAt ? ` · decided ${fmtDT(vi.decidedAt)}` : ""}{vi.returnTo ? ` · returned to ${vi.returnTo}` : ""}</p>
            {vi.reason && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-rose-700">“{vi.reason}”</p>}
            <h4 className="mb-1 mt-4 text-sm font-extrabold">Checklist</h4>
            <ul className="divide-y divide-line rounded-xl border border-line">{CHECKS.map((c) => <li key={c.k} className="flex items-center justify-between px-3 py-1.5"><span>{c.t}</span><Pill tone={vi.marks[c.k] === "pass" ? "green" : vi.marks[c.k] === "fail" ? "red" : "slate"}>{vi.marks[c.k] || "—"}</Pill></li>)}</ul>
            <h4 className="mb-1 mt-4 text-sm font-extrabold">Defects</h4>
            <div className="flex flex-wrap gap-1.5">{vi.defects.length ? vi.defects.map((d) => <Pill key={d} tone="red">{d}</Pill>) : <span className="text-sub">None recorded</span>}</div>
            <h4 className="mb-1 mt-4 text-sm font-extrabold">Notes & evidence</h4>
            <p className="text-sub">{vi.notes || "No inspector notes."}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{vi.evidence.map((n) => <Pill key={n} tone="slate">{n}</Pill>)}</div>
          </div>
        )}
      </SlideOver>
      {toast}
    </div>
  );
}

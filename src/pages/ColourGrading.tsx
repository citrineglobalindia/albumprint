import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Settings, Users, RotateCcw, CheckCircle2, Clock, Plus, Image as ImageIcon, Pencil, UploadCloud, Send, X, FileArchive, AlertCircle } from "lucide-react";
import { PageHeader, PrimaryButton, OutlineButton, MoreButton, SlideOver, Field, inputCls, KpiRow, Panel, Pill, Avatar, Thumb, SearchInput, LineTabs, TodayChip, ProgressBar, Pagination, PriorityPill, tableCls, Th, Td, trCls, cx, type Kpi } from "../components/ui";
import { ORDERS, ASSIGNEES, PRIORITIES, type Priority } from "../lib/data";
import { MultiSelect, Combobox } from "../components/controls";
import { useStore, moveOrder, useSlashFocus } from "../lib/store";
import { fmtDate, TODAY } from "../lib/format";
import { useToast } from "../components/Toast";
import { ActionMenu } from "../components/ActionMenu";
import type { Tone } from "../lib/data";

type Status = "New" | "In Progress" | "Pending" | "Rework" | "Submitted" | "Approved" | "Overdue";
interface Job { id: string; customer: string; event: string; files: number; colorist: string; priority: Priority; due: string; status: Status; notes: string[] }
type Tab = "queue" | "progress" | "submitted" | "approved" | "rework";

const STATUS_TONE: Record<Status, Tone> = { New: "blue", "In Progress": "blue", Pending: "amber", Rework: "red", Submitted: "violet", Approved: "green", Overdue: "red" };
const SEQ: Status[] = ["New", "In Progress", "New", "Pending", "In Progress", "New", "Rework", "Submitted", "In Progress", "New", "Overdue", "Submitted", "Approved", "Approved"];
const COLORISTS = ["Suresh", "Ramesh", "Divya", "Manoj", "Admin", "Karthik", "Anil"];

const INITIAL: Job[] = ORDERS.slice(0, 40).map((o, i) => ({
  id: o.id, customer: o.customer, event: o.event, files: 180 + ((i * 97) % 460), colorist: COLORISTS[i % COLORISTS.length]!,
  priority: i % 3 === 0 ? "High" : i % 11 === 6 ? "Low" : "Normal", due: o.due, status: SEQ[i % SEQ.length]!,
  notes: i === 0 ? ["Client requested warm & natural tones.", "Keep skin tones natural.", "Deliver both colour and B&W versions."] : ["Standard grading, keep skin tones natural."],
}));

// Graded-file upload rules: JPG / TIFF / ZIP, up to 5 GB per file.
const MAX_BYTES = 5 * 1024 ** 3;
const OK_EXT = /\.(jpe?g|tiff?|zip)$/i;
const fmtSize = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
interface UFile { uid: number; name: string; size: number; progress: number }
let uidSeq = 1;
const fileCount = (id: string) => 180 + ((Number(id.replace(/\D/g, "")) * 97) % 460);

const inTab = (j: Job, t: Tab) => t === "queue" ? ["New", "Pending", "In Progress", "Overdue", "Rework"].includes(j.status) : t === "progress" ? j.status === "In Progress" : t === "submitted" ? j.status === "Submitted" : t === "approved" ? j.status === "Approved" : j.status === "Rework";

export default function ColourGrading() {
  const [jobs, setJobs] = useState<Job[]>(INITIAL);
  const [tab, setTab] = useState<Tab>("queue");
  const [q, setQ] = useState("");
  const [col, setCol] = useState<string[]>([]);
  const [prio, setPrio] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState(INITIAL[0]!.id);
  const [dtab, setDtab] = useState<"preview" | "details" | "notes" | "history">("preview");
  const [uploads, setUploads] = useState<Record<string, UFile[]>>({});
  const [rejected, setRejected] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchWrap = useRef<HTMLDivElement>(null);
  useSlashFocus(searchWrap);
  useStore();
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, string[]>>({});
  const pageSize = 12;
  const [toast, show] = useToast();
  const [creating, setCreating] = useState(false);
  const EMPTY = { order: "", colorist: "", priority: "Normal" as Priority, due: "", notes: "" };
  const [f, setF] = useState(EMPTY);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const available = ORDERS.filter((o) => (o.stage === "files_received" || o.stage === "new_order") && o.workflow !== "Printing" && !o.hold && !jobs.some((j) => j.id === o.id));
  const picked = ORDERS.find((o) => o.id === f.order);
  const saveJob = () => {
    const e: Record<string, string> = {};
    if (!f.order) e.order = "Pick an order";
    if (!f.colorist) e.colorist = "Assign a colorist";
    if (!f.due) e.due = "Choose a due date";
    setErrs(e);
    if (Object.keys(e).length) return;
    const o = ORDERS.find((x) => x.id === f.order)!;
    const j: Job = { id: o.id, customer: o.customer, event: o.event, files: fileCount(o.id), colorist: f.colorist, priority: f.priority, due: f.due, status: "New", notes: [f.notes.trim() || "Standard grading, keep skin tones natural."] };
    moveOrder(o.id, "colour_grading");
    setJobs((p) => [j, ...p]); setActiveId(j.id); setTab("queue"); setPage(1); setCreating(false); setF(EMPTY); setErrs({});
    show(`Job ${j.id} added to ${j.colorist}'s queue`);
  };
  const bulk = (fn: (j: Job) => Job, msg: string) => {
    setJobs((p) => p.map((j) => (checked.has(j.id) ? fn(j) : j)));
    show(`${msg} (${checked.size} jobs)`); setChecked(new Set());
  };

  const base = useMemo(() => jobs.filter((j) => {
    const s = q.trim().toLowerCase();
    if (s && ![j.id, j.customer, j.event].some((v) => v.toLowerCase().includes(s))) return false;
    if (col.length && !col.includes(j.colorist)) return false;
    if (prio.length && !prio.includes(j.priority)) return false;
    return true;
  }), [jobs, q, col, prio]);
  const list = base.filter((j) => inTab(j, tab));
  const rows = list.slice((page - 1) * pageSize, page * pageSize);
  const cur = jobs.find((j) => j.id === activeId)!;
  const cnt = (s: Status) => jobs.filter((j) => j.status === s).length;
  const allChecked = rows.length > 0 && rows.every((j) => checked.has(j.id));

  const kpis: Kpi[] = [
    { label: "New Jobs", value: cnt("New"), delta: 20, icon: ClipboardList, tone: "blue", deltaLabel: "vs last week" },
    { label: "In Progress", value: cnt("In Progress"), delta: 12, icon: Settings, tone: "blue", deltaLabel: "vs last week" },
    { label: "Pending Admin Approval", value: cnt("Submitted"), delta: -14, icon: Users, tone: "pink", deltaLabel: "vs last week" },
    { label: "Rework", value: cnt("Rework"), delta: 50, icon: RotateCcw, tone: "orange", deltaLabel: "vs last week", invert: true },
    { label: "Completed", value: cnt("Approved"), delta: 33, icon: CheckCircle2, tone: "green", deltaLabel: "vs last week" },
    { label: "Overdue", value: cnt("Overdue"), delta: 67, icon: Clock, tone: "red", deltaLabel: "vs last week", invert: true },
  ];

  const act = (j: Job, to: Status, msg: string) => {
    setJobs((p) => p.map((x) => (x.id === j.id ? { ...x, status: to } : x)));
    setHistory((h) => ({ ...h, [j.id]: [`${msg} — ${TODAY.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`, ...(h[j.id] ?? [])] }));
  };
  const rowAction = (j: Job) => {
    if (j.status === "New") return { label: "Start", primary: true, run: () => act(j, "In Progress", "Grading started") };
    if (j.status === "In Progress" || j.status === "Rework") return { label: "Continue", run: () => setActiveId(j.id) };
    return { label: "View", run: () => setActiveId(j.id) };
  };
  const curFiles = uploads[cur.id] ?? [];
  const uploading = curFiles.some((x) => x.progress < 100);
  const canSubmit = (cur.status === "In Progress" || cur.status === "Rework") && curFiles.length >= 1 && !uploading;
  const anyUploading = Object.values(uploads).some((l) => l.some((x) => x.progress < 100));
  useEffect(() => {
    if (!anyUploading) return;
    const t = window.setInterval(() => setUploads((u) => Object.fromEntries(Object.entries(u).map(([k, l]) => [k, l.map((x) => (x.progress < 100 ? { ...x, progress: Math.min(100, x.progress + 8 + Math.round(Math.random() * 14)) } : x))]))), 220);
    return () => window.clearInterval(t);
  }, [anyUploading]);
  const addFiles = (list: FileList | File[]) => {
    const ok: UFile[] = []; const bad: string[] = [];
    Array.from(list).forEach((fl) => {
      if (!OK_EXT.test(fl.name)) bad.push(`${fl.name} — only JPG, TIFF or ZIP allowed`);
      else if (fl.size > MAX_BYTES) bad.push(`${fl.name} — ${fmtSize(fl.size)} exceeds the 5 GB limit`);
      else ok.push({ uid: uidSeq++, name: fl.name, size: fl.size, progress: 0 });
    });
    setRejected(bad);
    if (ok.length) { setUploads((u) => ({ ...u, [cur.id]: [...(u[cur.id] ?? []), ...ok] })); show(`${ok.length} file${ok.length > 1 ? "s" : ""} added to ${cur.id}`); }
  };
  const doneCount = (id: string) => (uploads[id] ?? []).filter((x) => x.progress >= 100).length;

  const tabs: { key: Tab; label: string }[] = [{ key: "queue", label: "My Queue" }, { key: "progress", label: "In Progress" }, { key: "submitted", label: "Submitted" }, { key: "approved", label: "Approved" }, { key: "rework", label: "Rework" }];

  return (
    <div>
      <PageHeader title="Colour Grading" subtitle="Manage and process colour grading jobs for all orders.">
        <TodayChip />
        <PrimaryButton onClick={() => setCreating(true)}>New Job</PrimaryButton>
        <MoreButton />
      </PageHeader>
      <KpiRow items={kpis} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel bodyClassName="!p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <LineTabs<Tab> className="!border-0" value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={tabs.map((t) => ({ ...t, count: base.filter((j) => inTab(j, t.key)).length }))} />
            <div ref={searchWrap} className="w-64"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by order ID, customer, event...  ( / )" /></div>
          </div>
          <div className="mt-3 flex justify-end gap-3">
            <MultiSelect className="w-40" label="Colorist" options={COLORISTS} value={col} onChange={(v) => { setCol(v); setPage(1); }} />
            <MultiSelect className="w-36" label="Priority" options={PRIORITIES} value={prio} onChange={(v) => { setPrio(v); setPage(1); }} />
            {(col.length > 0 || prio.length > 0) && <button onClick={() => { setCol([]); setPrio([]); }} className="text-xs font-bold text-brand">Clear</button>}
          </div>
          {checked.size > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft px-3 py-2 text-[13px]">
              <b>{checked.size} selected</b>
              <OutlineButton onClick={() => bulk((j) => j.status === "New" ? { ...j, status: "In Progress" } : j, "Started grading")}>Start selected</OutlineButton>
              <OutlineButton onClick={() => bulk((j) => ({ ...j, priority: "High" }), "Priority set to High")}>Set High priority</OutlineButton>
              <OutlineButton onClick={() => bulk((j) => j.status === "In Progress" || j.status === "Rework" ? { ...j, status: "Submitted" } : j, "Submitted for approval")}>Submit selected</OutlineButton>
              <button onClick={() => setChecked(new Set())} className="ml-auto text-xs font-bold text-brand">Clear</button>
            </div>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className={tableCls}>
              <thead><tr>
                <Th><input type="checkbox" checked={allChecked} onChange={() => setChecked((p) => { const n = new Set(p); rows.forEach((j) => allChecked ? n.delete(j.id) : n.add(j.id)); return n; })} /></Th>
                <Th /><Th>Order ID</Th><Th>Customer</Th><Th>Event</Th><Th>Files</Th><Th>Assigned Colorist</Th><Th>Priority</Th><Th>Due Date</Th><Th>Status</Th><Th className="text-right">Actions</Th>
              </tr></thead>
              <tbody>
                {rows.map((j) => {
                  const a = rowAction(j);
                  return (
                    <tr key={j.id} onClick={() => setActiveId(j.id)} className={cx(trCls, "cursor-pointer", activeId === j.id && "bg-brand-soft")}>
                      <Td><input type="checkbox" checked={checked.has(j.id)} onClick={(e) => e.stopPropagation()} onChange={() => setChecked((p) => { const n = new Set(p); n.has(j.id) ? n.delete(j.id) : n.add(j.id); return n; })} /></Td>
                      <Td><Thumb seed={j.customer} size={28} rounded="rounded-md" /></Td>
                      <Td className="font-bold">{j.id}</Td><Td>{j.customer}</Td><Td>{j.event}</Td>
                      <Td><span className="inline-flex items-center gap-1.5"><ImageIcon className="size-3.5 text-sub" />{j.files}</span></Td>
                      <Td><span className="inline-flex items-center gap-2"><Avatar name={j.colorist} size={24} />{j.colorist}</span></Td>
                      <Td><PriorityPill p={j.priority} /></Td>
                      <Td className={j.status === "Overdue" || new Date(j.due) < TODAY ? "text-rose-600" : ""}>{fmtDate(j.due)}</Td>
                      <Td><Pill tone={STATUS_TONE[j.status]} className="min-w-[84px] justify-center">{j.status}</Pill></Td>
                      <Td className="text-right"><span className="inline-flex items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); a.run(); }} className={cx("h-8 w-[84px] rounded-lg border text-xs font-bold", a.primary ? "border-brand bg-brand text-white hover:bg-brand-dark" : "border-line bg-white hover:bg-brand-soft")}>{a.label}</button>
                        <ActionMenu items={[
                          { label: "View details", onClick: () => { setActiveId(j.id); setDtab("details"); } },
                          { label: "Start grading", hidden: j.status !== "New", onClick: () => act(j, "In Progress", "Grading started") },
                          { label: "Add note", onClick: () => { setActiveId(j.id); setDtab("notes"); setNoteDraft(""); } },
                          { label: "Send to rework", hidden: j.status !== "Submitted", onClick: () => { act(j, "Rework", "Sent back for rework"); show(`${j.id} sent to rework`); } },
                          { label: "Mark approved", hidden: j.status !== "Submitted", onClick: () => { act(j, "Approved", "Approved by admin"); show(`${j.id} approved`); } },
                        ]} /></span></Td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-sub">No jobs found.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={list.length} onPage={setPage} noun="jobs" />
        </Panel>

        <Panel bodyClassName="!p-5" className="xl:sticky xl:top-4">
          <div className="flex items-start justify-between">
            <div><h3 className="text-xl font-extrabold">{cur.id}</h3><div className="text-[13px] text-sub">{cur.customer} • {cur.event} • {fmtDate(cur.due)}</div></div>
            <Pill tone={STATUS_TONE[cur.status]}>{cur.status}</Pill>
          </div>
          <LineTabs<"preview" | "details" | "notes" | "history"> className="mt-4" value={dtab} onChange={setDtab} tabs={[{ key: "preview", label: "Preview" }, { key: "details", label: "Details" }, { key: "notes", label: `Notes (${cur.notes.length})` }, { key: "history", label: "History" }]} />

          {dtab === "preview" && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[0, 1, 2, 3, 4].map((i) => <Thumb key={i} seed={cur.id.length + i + Number(cur.id.slice(-2))} size={110} className="!aspect-[4/3] !h-auto !w-full" rounded="rounded-lg" />)}
              <div className="grid aspect-[4/3] place-items-center rounded-lg bg-slate-700 text-lg font-extrabold text-white">+{Math.max(0, cur.files + doneCount(cur.id) - 5)}</div>
            </div>
          )}
          {dtab === "details" && (
            <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
              {([["Order ID", cur.id], ["Customer", cur.customer], ["Event", cur.event], ["Files", String(cur.files + doneCount(cur.id))], ["Colorist", cur.colorist], ["Priority", cur.priority], ["Due", fmtDate(cur.due)], ["Status", cur.status]] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-sub">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
            </dl>
          )}
          {dtab === "history" && (
            <ul className="mt-4 space-y-2 text-[13px]">
              {(history[cur.id] ?? []).concat([`Job created — ${fmtDate(cur.due)}`]).map((h, i) => <li key={i} className="rounded-lg border border-line px-3 py-2">{h}</li>)}
            </ul>
          )}

          {(dtab === "preview" || dtab === "notes") && (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-extrabold">Job Notes</span>
                <button onClick={() => setNoteDraft(noteDraft === null ? "" : null)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold text-brand"><Plus className="size-3.5" />Add Note</button>
              </div>
              {noteDraft !== null && (
                <div className="mb-2 flex gap-2">
                  <input autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand" placeholder="Write a note…" />
                  <button onClick={() => { if (noteDraft.trim()) setJobs((p) => p.map((x) => x.id === cur.id ? { ...x, notes: [...x.notes, noteDraft.trim()] } : x)); setNoteDraft(null); }} className="h-9 rounded-lg bg-brand px-3 text-xs font-bold text-white">Save</button>
                </div>
              )}
              <div className="relative space-y-0.5 rounded-xl bg-slate-50 p-3 text-[13px]">
                {cur.notes.map((n, i) => <p key={i}>{n}</p>)}
                <button aria-label="Edit note" onClick={() => setNoteDraft(cur.notes[cur.notes.length - 1] ?? "")} className="absolute right-3 top-3 text-sub hover:text-brand"><Pencil className="size-3.5" /></button>
              </div>
            </div>
          )}

          <div data-testid="dropzone" role="button" tabIndex={0} aria-label="Upload graded files"
            onClick={() => fileInput.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            className={cx("mt-4 flex w-full cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-4 text-center transition", dragOver ? "border-brand bg-brand-soft ring-2 ring-brand/40" : "border-brand/50 bg-brand-soft/40")}>
            <span className="inline-flex items-center gap-2 font-extrabold"><UploadCloud className="size-5 text-brand" />{dragOver ? "Drop to upload" : "Upload Graded Files"}</span>
            <span className="text-xs text-sub">Drag & drop files here or click to browse</span>
            <span className="text-xs text-slate-400">Supports JPG, TIFF, ZIP · max 5 GB per file</span>
          </div>
          <input ref={fileInput} data-testid="file-input" type="file" multiple accept=".jpg,.jpeg,.tif,.tiff,.zip" className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          {rejected.length > 0 && (
            <ul data-testid="rejected" className="mt-2 space-y-1 rounded-lg bg-rose-50 p-2.5 text-xs font-semibold text-rose-600">
              {rejected.map((r) => <li key={r} className="flex items-start gap-1.5"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{r}</li>)}
            </ul>
          )}
          {curFiles.length > 0 && (
            <ul data-testid="file-list" className="mt-2 space-y-2">
              {curFiles.map((x) => (
                <li key={x.uid} className="rounded-lg border border-line px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    {/zip$/i.test(x.name) ? <FileArchive className="size-4 text-sub" /> : <ImageIcon className="size-4 text-sub" />}
                    <span className="min-w-0 flex-1 truncate font-semibold">{x.name}</span>
                    <span className="text-sub">{fmtSize(x.size)} / 5 GB</span>
                    <span className={cx("w-9 text-right font-bold", x.progress >= 100 ? "text-emerald-600" : "text-brand")}>{x.progress >= 100 ? "Done" : `${x.progress}%`}</span>
                    <button aria-label={`Remove ${x.name}`} onClick={() => setUploads((u) => ({ ...u, [cur.id]: (u[cur.id] ?? []).filter((y) => y.uid !== x.uid) }))} className="text-sub hover:text-rose-600"><X className="size-4" /></button>
                  </div>
                  <ProgressBar value={x.progress} tone={x.progress >= 100 ? "green" : "blue"} className="mt-1.5" />
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex gap-2">
            {cur.status === "New" && <button onClick={() => act(cur, "In Progress", "Grading started")} className="h-11 flex-1 rounded-xl border border-brand text-sm font-bold text-brand hover:bg-brand-soft">Start Job</button>}
            {cur.status === "In Progress" && <button onClick={() => setDtab("preview")} className="h-11 flex-1 rounded-xl border border-brand text-sm font-bold text-brand hover:bg-brand-soft">Continue</button>}
            <button disabled={!canSubmit} title={canSubmit ? "" : uploading ? "Wait for uploads to finish" : "Start the job and upload at least one graded file"} onClick={() => act(cur, "Submitted", "Submitted for Admin approval")} className="inline-flex h-11 flex-[2] items-center justify-center gap-2 rounded-xl bg-brand text-sm font-bold text-white shadow-md shadow-brand/25 hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40">
              <Send className="size-4" />Submit for Admin Approval
            </button>
          </div>
        </Panel>
      </div>
      <SlideOver open={creating} onClose={() => setCreating(false)} title="New Grading Job"
        footer={<><OutlineButton onClick={() => setCreating(false)}>Cancel</OutlineButton><PrimaryButton onClick={saveJob}>Create Job</PrimaryButton></>}>
        <Field label="Order" required>
          <Combobox error={!!errs.order} placeholder="Search files-received / new orders…" value={f.order}
            onChange={(v) => { const o = ORDERS.find((x) => x.id === v); setF({ ...f, order: v, due: o?.due ?? f.due }); }}
            options={available.map((o) => ({ value: o.id, label: o.id, sub: `${o.customer} · ${o.event}` }))} />
          {errs.order && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{errs.order}</p>}
          <span className="mt-1 block text-xs text-sub">Only Design + Printing orders in New Order / Files Received. Printing Only orders skip colour grading.</span>
        </Field>
        {picked && (
          <dl data-testid="job-autofill" className="mb-4 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-[13px]">
            <div><dt className="text-xs text-sub">Customer</dt><dd className="font-semibold">{picked.customer}</dd></div>
            <div><dt className="text-xs text-sub">Event</dt><dd className="font-semibold">{picked.event}</dd></div>
            <div><dt className="text-xs text-sub">Files</dt><dd className="font-semibold">{fileCount(picked.id)}</dd></div>
          </dl>
        )}
        <Field label="Assignee" required>
          <Combobox error={!!errs.colorist} placeholder="Pick a colorist…" value={f.colorist} onChange={(v) => setF({ ...f, colorist: v })} options={COLORISTS.map((c) => ({ value: c, label: c }))} />
          {errs.colorist && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{errs.colorist}</p>}
        </Field>
        <Field label="Priority"><div className="flex flex-wrap gap-1.5">{PRIORITIES.map((p) => <button type="button" key={p} aria-pressed={f.priority === p} onClick={() => setF({ ...f, priority: p })} className={cx("rounded-full border px-3 py-1 text-xs font-bold", f.priority === p ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{p}</button>)}</div></Field>
        <Field label="Due date" required><input type="date" className={cx(inputCls, errs.due && "border-rose-400")} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />{errs.due && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{errs.due}</p>}</Field>
        <Field label="Instructions"><textarea rows={4} className={cx(inputCls, "h-auto py-2")} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </SlideOver>
      {toast}
    </div>
  );
}

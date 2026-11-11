import { useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Palette, MessageSquareWarning, Send, CheckCircle2, Clock, Play, PenTool, Save, Image as ImageIcon } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, Avatar, SearchInput, LineTabs, Pagination, PriorityPill, SlideOver, Field, inputCls, tableCls, Th, Td, trCls, cx, type Kpi } from "../components/ui";
import { hasModule } from "../lib/access";
import { WorkFiles } from "../components/WorkFiles";
import { Elapsed, JobTimer } from "../components/JobTimer";
import { useToast } from "../components/Toast";
import { useAuth } from "../lib/auth";
import { useStore } from "../lib/store";
import { fmtDate, TODAY } from "../lib/format";
import { addFile, FILES } from "../lib/files";
import { latestProof } from "../lib/proofs";
import { fmtDT } from "../lib/production";
import { DSTATUS_TONE, designEnd, designOrders, designerOf, djob, dstatus, saveDesignNote, sendToClient, startDesign, type DStatus } from "../lib/designJobs";
import { JobProgress } from "../components/JobProgress";
import { photosGiven } from "../lib/jobProgress";
import { AlbumProgress } from "../components/AlbumProgress";
import type { Order, Priority } from "../lib/data";

// Album Designing — the designer's queue, like Colour Grading: every design job with its status, designer, files and a running timer;
// a job card with the photos to design with, the pages uploaded, the client's corrections, an internal note and the history.
type Tab = "queue" | "progress" | "client" | "corrections" | "approved";
const inTab = (s: DStatus, t: Tab) => t === "queue" ? ["New", "In Progress", "Corrections"].includes(s) : t === "progress" ? s === "In Progress" : t === "client" ? s === "With Client" : t === "corrections" ? s === "Corrections" : s === "Approved";
const pages = (id: string) => FILES.filter((f) => f.orderId === id && f.category === "Design Draft" && !f.archived && !f.pending).length;

export default function DesignJobs() {
  useStore();
  const { role } = useAuth();
  const canWork = role === "admin" || role === "designer" || hasModule("design");
  const [tab, setTab] = useState<Tab>("queue");
  const [q, setQ] = useState(""); const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [toast, show] = useToast();
  const base = designOrders();
  const st = (o: Order) => dstatus(o);
  const cnt = (s: DStatus) => base.filter((o) => st(o) === s).length;
  const overdue = base.filter((o) => st(o) !== "Approved" && new Date(o.due) < TODAY).length;
  const kpis: Kpi[] = [
    { label: "New Jobs", value: cnt("New"), icon: ClipboardList, tone: "blue" },
    { label: "In Progress", value: cnt("In Progress"), icon: Palette, tone: "violet" },
    { label: "Client Corrections", value: cnt("Corrections"), icon: MessageSquareWarning, tone: "red", invert: true },
    { label: "With Client", value: cnt("With Client"), icon: Send, tone: "indigo" },
    { label: "Approved", value: cnt("Approved"), icon: CheckCircle2, tone: "green" },
    { label: "Overdue", value: overdue, icon: Clock, tone: "red", invert: true },
  ];
  const tabs: { key: Tab; label: string }[] = [{ key: "queue", label: "My Queue" }, { key: "progress", label: "In Progress" }, { key: "client", label: "With Client" }, { key: "corrections", label: "Corrections" }, { key: "approved", label: "Approved" }];
  const term = q.trim().toLowerCase();
  const list = base.filter((o) => inTab(st(o), tab) && (!term || [o.id, o.customer, o.event, designerOf(o)].some((x) => x.toLowerCase().includes(term))));
  const PS = 10, shown = list.slice((page - 1) * PS, page * PS);
  const cur = openId ? base.find((o) => o.id === openId) ?? null : null;

  const start = async (o: Order) => { const r = await startDesign(o.id); show(r.msg); if (r.ok) setOpenId(o.id); };
  return (
    <>
      <PageHeader title="Album Designing" subtitle="Design jobs: start, work from the graded photos, upload the album pages and send the proof to the client." />
      <KpiRow items={kpis} cols={6} />
      <Panel className="mt-5" title="Design Jobs" subtitle="Click a job for the photos, pages, client corrections and history" bodyClassName="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-3">
          <LineTabs<Tab> className="!border-0" value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={tabs.map((t) => ({ ...t, count: base.filter((o) => inTab(st(o), t.key)).length }))} />
          <div className="w-64"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by order ID, customer, event..." /></div>
        </div>
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead><tr><Th>Order ID</Th><Th>Customer</Th><Th>Event</Th><Th>Pages</Th><Th>Designer</Th><Th>Priority</Th><Th>Due</Th><Th>Time</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {shown.map((o) => {
                const s = st(o), j = djob(o.id);
                return (
                  <tr key={o.id} data-testid={`djob-${o.id}`} onClick={() => setOpenId(o.id)} className={cx(trCls, "cursor-pointer", openId === o.id && "bg-brand-soft")}>
                    <Td className="font-bold">{o.id}</Td><Td>{o.customer}</Td><Td>{o.event}</Td>
                    <Td><span className="inline-flex items-center gap-1.5"><ImageIcon className="size-3.5 text-sub" />{pages(o.id)}</span></Td>
                    <Td><span className="inline-flex items-center gap-2"><Avatar name={designerOf(o)} size={24} />{designerOf(o)}</span></Td>
                    <Td><PriorityPill p={o.priority as Priority} /></Td>
                    <Td className={new Date(o.due) < TODAY && s !== "Approved" ? "font-semibold text-rose-600" : ""}>{fmtDate(o.due)}</Td>
                    <Td><Elapsed start={j?.startedAt} end={designEnd(o)} /></Td>
                    <Td><Pill tone={DSTATUS_TONE[s]} className="min-w-[90px] justify-center">{s}</Pill></Td>
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {canWork && (s === "New" || s === "Corrections") && !j?.startedAt ? <button onClick={() => void start(o)} className="h-8 rounded-lg bg-brand px-4 text-xs font-bold text-white hover:bg-brand-dark">Start</button>
                        : canWork && s === "Corrections" ? <button onClick={() => void start(o)} className="h-8 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white hover:bg-rose-700">Fix corrections</button>
                        : <Link to={`/designing/${o.id}`} className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft">{s === "In Progress" ? "Continue" : "Open"}</Link>}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={10} className="px-5 py-10 text-center text-sm text-sub">No design jobs here. Orders arrive once Colour Grading is approved.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={PS} total={list.length} onPage={setPage} noun="jobs" />
      </Panel>

      <SlideOver open={!!cur} onClose={() => setOpenId(null)} title={cur ? `Design ${cur.id}` : "Design"} width={560}>
        {cur && (() => {
          const s = st(cur), j = djob(cur.id), p = latestProof(cur.id);
          const note = notes[cur.id] ?? j?.internalNote ?? "";
          const working = canWork && cur.stage === "designing" && !!j?.startedAt;
          return (
            <div data-testid="design-panel">
              <div className="flex items-start justify-between">
                <div><h3 className="text-xl font-extrabold">{cur.id}</h3><div className="text-[13px] text-sub">{cur.customer} • {cur.event} • {cur.size} • {cur.pages} pages</div></div>
                <Pill tone={DSTATUS_TONE[s]}>{s}</Pill>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px] sm:grid-cols-5">
                <div><dt className="text-xs text-sub">Designer</dt><dd className="font-semibold">{designerOf(cur)}</dd></div>
                <div><dt className="text-xs text-sub">Due</dt><dd className="font-semibold">{fmtDate(cur.due)}</dd></div>
                <div><dt className="text-xs text-sub">Rounds sent</dt><dd className="font-semibold">{j?.rounds ?? 0}</dd></div>
                <div><dt className="text-xs text-sub">Photos given</dt><dd className="font-semibold" data-testid="photos-given">{photosGiven(cur.id) ?? "—"}</dd></div>
                <div><dt className="text-xs text-sub">Sheets</dt><dd className="font-semibold">{cur.pages}</dd></div>
              </dl>
              <JobTimer start={j?.startedAt} end={designEnd(cur)} label="Design time" paused={cur.hold ? cur.hold : undefined} />
              <JobProgress orderId={cur.id} dept="design" countLabel="Sheets designed" of={cur.pages || undefined} onDone={(m) => show(m)} />
              <div className="mt-3"><AlbumProgress o={cur} only={["design"]} onDone={(m) => show(m)} /></div>
              {s === "Corrections" && p && (
                <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700" data-testid="client-corrections">
                  <b>Client asked for corrections (v{p.version}):</b>
                  <ul className="mt-1 list-disc pl-5">{p.comments.map((c, i) => <li key={i}>Page {c.page}: {c.text}</li>)}</ul>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {canWork && cur.stage === "designing" && (!j?.startedAt || s === "Corrections") && <button onClick={() => void start(cur)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark"><Play className="size-4" />{s === "Corrections" ? "Start corrections" : "Start design"}</button>}
                {working && s !== "Corrections" && <>
                  <button type="button" onClick={() => void sendToClient(cur.id, "WhatsApp").then((x) => show(x.msg))} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"><Send className="size-4" />Send to client (WhatsApp)</button>
                  <button type="button" onClick={() => void sendToClient(cur.id, "Link").then((x) => show(x.msg))} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-bold hover:bg-brand-soft">Copy client link</button>
                </>}
                <Link to={`/designing/${cur.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-bold hover:bg-brand-soft"><PenTool className="size-4" />{working ? "Open editor & send proof" : "Open in editor"}</Link>
              </div>
              <Field label="Internal note (not visible to client)">
                <div className="flex gap-2">
                  <textarea rows={2} disabled={!canWork} className={cx(inputCls, "h-auto min-w-0 flex-1 py-2")} value={note} onChange={(e) => setNotes({ ...notes, [cur.id]: e.target.value })} placeholder="Notes for the team, e.g. the drive link to the full-size files…" />
                  {canWork && <button type="button" onClick={() => void saveDesignNote(cur.id, note).then((r) => show(r.msg))} className="inline-flex h-10 items-center gap-1 self-end rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft"><Save className="size-3.5" />Save</button>}
                </div>
              </Field>
              <WorkFiles orderId={cur.id}
                inputs={[{ category: "Graded", label: "Graded photos (from Colour Grading)" }, { category: "Source Photos", label: "Original photos (from the customer)" }]}
                output={{ category: "Design Draft", label: "Album design pages" }}
                upload={working ? (file) => {
                  if (!/\.(jpe?g|png|tiff?|pdf|psd)$/i.test(file.name)) return { ok: false, msg: `${file.name} — upload images (JPG, PNG, TIFF), PDF or PSD` };
                  const r = addFile(cur.id, "Design Draft", file.name, file.size, file);
                  return r.ok ? { ok: true, msg: `${file.name} uploading` } : { ok: false, msg: `${file.name}: ${r.error}` };
                } : undefined}
                canRemove={canWork} accept=".jpg,.jpeg,.png,.tif,.tiff,.pdf,.psd" hint="Images (JPG, PNG, TIFF) or PDF"
                onMessage={(m) => show(m)} />
              {!working && canWork && cur.stage === "designing" && <p className="mt-1 text-xs text-sub">Start the design to upload pages.</p>}
              <div className="mt-5 text-sm font-extrabold">History</div>
              <ul className="mt-2 space-y-2" data-testid="design-history">
                {(j?.events ?? []).map((e, i) => <li key={i} className="rounded-lg border border-line px-3 py-2 text-[13px]"><div className="font-semibold">{e.text}</div><div className="text-xs text-sub">{e.by} · {fmtDT(e.at)}</div></li>)}
                {!(j?.events.length) && <li className="text-xs text-sub">Nothing yet.</li>}
              </ul>
            </div>
          );
        })()}
      </SlideOver>
      {toast}
    </>
  );
}

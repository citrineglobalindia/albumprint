import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, ChevronRight, FileImage, Lock, Download, Upload, Pause, Repeat, MinusCircle, Phone, CalendarDays, User, History } from "lucide-react";
import { PageHeader, Panel, Pill, PriorityPill, PayPill, Avatar, ProgressBar, OutlineButton, PrimaryButton, LinkAction, SlideOver, Field, inputCls } from "../components/ui";
import { useToast } from "../components/Toast";
import { ORDERS, STAGES, stageLabel, stageTone } from "../lib/data";
import { fmtDate, inr } from "../lib/format";

// Stages skipped for Printing Only orders (SRS §5.2: shown as "Not Required").
const SKIPPED = ["colour_grading", "admin_approval", "designing", "client_review", "final_approval"];

const FILES = [
  { name: "source_photos.zip", cat: "Source Photos", ver: 1, by: "Priya N", at: "1 Oct 2026, 10:15 AM", size: "4.2 GB", state: "Locked" },
  { name: "graded_final.zip", cat: "Graded", ver: 2, by: "Suresh", at: "2 Oct 2026, 03:40 PM", size: "3.8 GB", state: "Approved" },
  { name: "album_design_v3.pdf", cat: "Design Draft", ver: 3, by: "Ramesh", at: "3 Oct 2026, 04:15 PM", size: "186 MB", state: "Submitted" },
  { name: "cover_artwork.psd", cat: "Cover", ver: 1, by: "Ramesh", at: "3 Oct 2026, 11:02 AM", size: "94 MB", state: "Draft" },
];
const FILE_TONE = { Locked: "violet", Approved: "green", Submitted: "amber", Draft: "slate" } as const;

export default function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const base = ORDERS.find((o) => o.id === id);
  const [workflow, setWorkflow] = useState(base?.workflow);
  const [hold, setHold] = useState(false);
  const [convert, setConvert] = useState(false);
  const [reason, setReason] = useState("");
  const [log, setLog] = useState<{ t: string; d: string; by: string; at: string }[]>([]);
  const [toast, show] = useToast();
  if (!base) return <PageHeader title="Order not found" subtitle={`No order with ID ${id}.`}><OutlineButton onClick={() => nav("/orders")}>Back to orders</OutlineButton></PageHeader>;
  const o = base;
  const printingOnly = workflow === "Printing";
  const cur = STAGES.findIndex((s) => s.key === o.stage);
  const bal = o.total - o.paid;
  const add = (t: string, d: string) => setLog((l) => [{ t, d, by: "Admin", at: "3 Oct 2026, 11:30 AM" }, ...l]);

  const history = [
    ...log,
    { t: "Order created", d: `${o.workflow} · ${o.size} · ${o.pages} pages`, by: "Priya N", at: `${fmtDate(o.pendingAt)}, 10:15 AM` },
    { t: "Files received", d: "Source photos uploaded (v1) and locked", by: "Priya N", at: `${fmtDate(o.pendingAt)}, 10:40 AM` },
    ...(cur >= 2 && !printingOnly ? [{ t: "Assigned to colour grading", d: `Assigned to ${o.assignee}`, by: "Admin", at: `${fmtDate(o.pendingAt)}, 11:05 AM` }] : []),
    ...(o.paid > 0 ? [{ t: "Payment received", d: `${inr(o.paid)} recorded`, by: "Suresh B", at: `${fmtDate(o.pendingAt)}, 12:20 PM` }] : []),
  ];

  return (
    <>
      <div className="mb-2 flex items-center gap-1.5 text-xs text-sub"><Link to="/orders" className="hover:underline">Orders</Link><ChevronRight className="size-3" /><b className="text-ink">{o.id}</b></div>
      <PageHeader title={`${o.id} · ${o.customer}`} subtitle={`${o.event} · ${workflow} · due ${fmtDate(o.due)}`}>
        <Pill tone={hold ? "pink" : stageTone(o.stage)} dot className="!px-3 !py-1.5 !text-sm">{hold ? "On Hold" : stageLabel(o.stage)}</Pill>
        <OutlineButton icon={Pause} className="!h-11" onClick={() => { setHold(!hold); add(hold ? "Order resumed" : "Order put on hold", "Status changed by admin"); show(hold ? "Order resumed" : "Order on hold"); }}>{hold ? "Resume" : "Put on hold"}</OutlineButton>
        {printingOnly && <PrimaryButton icon={Repeat} onClick={() => setConvert(true)}>Convert to Design + Printing</PrimaryButton>}
      </PageHeader>

      <Panel className="mb-5" title="Workflow" subtitle={printingOnly ? "Printing Only — design stages are not required" : "Design + Printing"}>
        <div className="scroll-thin flex items-start gap-1 overflow-x-auto pb-2">
          {STAGES.map((s, i) => {
            const skipped = printingOnly && SKIPPED.includes(s.key);
            const done = !skipped && i < cur;
            const now = i === cur;
            return (
              <div key={s.key} className="flex min-w-[104px] flex-1 flex-col items-center text-center">
                <div className="flex w-full items-center">
                  <span className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : done || now ? "bg-brand" : "bg-line"}`} />
                  <span className={`grid size-8 place-items-center rounded-full border-2 text-xs font-bold ${skipped ? "border-line bg-slate-50 text-slate-400" : done ? "border-brand bg-brand text-white" : now ? "border-brand bg-white text-brand ring-4 ring-brand/15" : "border-line bg-white text-slate-400"}`}>
                    {skipped ? <MinusCircle className="size-4" /> : done ? <Check className="size-4" /> : i + 1}
                  </span>
                  <span className={`h-0.5 flex-1 ${i === STAGES.length - 1 ? "opacity-0" : done ? "bg-brand" : "bg-line"}`} />
                </div>
                <div className={`mt-2 text-[11px] font-bold leading-tight ${now ? "text-brand" : skipped ? "text-slate-400" : "text-ink"}`}>{s.label}</div>
                {skipped && <div className="text-[10px] text-slate-400">Not Required</div>}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_1fr_340px]">
        <div className="space-y-5">
          <Panel title="Order Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[["Order ID", o.id], ["Order Type", workflow], ["Event", o.event], ["Priority", <PriorityPill key="p" p={o.priority} />], ["Order Date", fmtDate(o.pendingAt)], ["Expected Delivery", fmtDate(o.due)], ["Assigned To", <span key="a" className="inline-flex items-center gap-1.5"><Avatar name={o.assignee} size={20} />{o.assignee}</span>], ["Progress", <ProgressBar key="g" value={o.progress} className="mt-2 w-24" />]].map(([k, v]) => (
                <div key={String(k)}><dt className="text-xs text-sub">{k}</dt><dd className="font-semibold">{v}</dd></div>
              ))}
            </dl>
          </Panel>
          <Panel title="Customer">
            <div className="flex items-center gap-3"><Avatar name={o.customer} size={44} /><div><div className="font-bold">{o.customer}</div><div className="flex items-center gap-1.5 text-xs text-sub"><Phone className="size-3" />{o.mobile}</div></div></div>
            <div className="mt-3 flex gap-4 text-xs text-sub"><span className="flex items-center gap-1"><User className="size-3.5" />Studio client</span><span className="flex items-center gap-1"><CalendarDays className="size-3.5" />Since Jan 2024</span></div>
          </Panel>
          <Panel title="Print Specification">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[["Album Size", o.size], ["Pages / Sheets", `${o.pages} / ${o.pages * 2}`], ["Orientation", "Landscape"], ["Copies", "2"], ["Paper", "Sapphire Matte 300 GSM"], ["Cover", "Acrylic Photo Cover"], ["Lamination", "Matte (Both Sides)"], ["Binding", "Lay-flat"], ["Box", "Premium Magnetic Box"], ["Finishing", "Spot UV on Cover"]].map(([k, v]) => (
                <div key={k}><dt className="text-xs text-sub">{k}</dt><dd className="font-semibold">{v}</dd></div>
              ))}
            </dl>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Files & Versions" action={<LinkAction onClick={() => show("Upload dialog would open here")}><Upload className="mr-1 inline size-3" />Upload</LinkAction>} bodyClassName="space-y-2.5">
            {FILES.map((f) => (
              <div key={f.name} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand"><FileImage className="size-5" /></span>
                <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-[13px] font-bold">{f.name}</div><div className="text-[11px] text-sub">{f.cat} · v{f.ver} · {f.size}</div><div className="text-[11px] text-sub">{f.by} · {f.at}</div></div>
                <Pill tone={FILE_TONE[f.state as keyof typeof FILE_TONE]} icon={f.state === "Locked" ? Lock : undefined}>{f.state}</Pill>
                <button aria-label="Download" onClick={() => show(`Downloading ${f.name}`)} className="text-sub hover:text-ink"><Download className="size-4" /></button>
              </div>
            ))}
            {cur >= 6 && <p className="text-xs text-sub">Final print file is locked and released to Printing (SRS ALB-FR-0120).</p>}
          </Panel>
          <Panel title="Payment Summary" action={<LinkAction onClick={() => nav("/payments")}>Payments →</LinkAction>}>
            <div className="mb-3 flex items-center justify-between"><span className="text-sm text-sub">Status</span><PayPill s={o.pay} /></div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-sub">Order total</span><b>{inr(o.total)}</b></div>
              <div className="flex justify-between"><span className="text-sub">Paid</span><b className="text-emerald-600">{inr(o.paid)}</b></div>
              <div className="flex justify-between border-t border-line pt-2"><span className="text-sub">Balance</span><b className={bal > 0 ? "text-rose-600" : ""}>{inr(bal)}</b></div>
            </div>
            <ProgressBar value={Math.round((o.paid / o.total) * 100)} tone="green" className="mt-3" />
          </Panel>
        </div>

        <Panel title="Audit Trail" subtitle="Every state change" action={<History className="size-4 text-sub" />} bodyClassName="space-y-4">
          {history.map((h, i) => (
            <div key={i} className="relative border-l-2 border-line pl-4">
              <span className="absolute -left-[5px] top-1 size-2 rounded-full bg-brand" />
              <div className="text-[13px] font-bold">{h.t}</div>
              <div className="text-xs text-sub">{h.d}</div>
              <div className="text-[11px] text-slate-400">{h.by} · {h.at}</div>
            </div>
          ))}
        </Panel>
      </div>

      <SlideOver open={convert} onClose={() => setConvert(false)} title="Convert to Design + Printing" footer={<><OutlineButton className="!h-10" onClick={() => setConvert(false)}>Cancel</OutlineButton><PrimaryButton icon={Repeat} onClick={() => { if (!reason.trim()) return; setWorkflow("Design + Printing"); add("Workflow converted", `Printing Only → Design + Printing. Reason: ${reason}`); setConvert(false); setReason(""); show("Converted — revised commercial approval required"); }}>Convert</PrimaryButton></>}>
        <p className="mb-4 text-sm text-sub">Colour Grading and Designing will be added to this order. A reason and revised commercial approval are required (SRS ALB-FR-0080).</p>
        <Field label="Reason" required><textarea className={`${inputCls} h-24 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer supplied files need redesign" /></Field>
      </SlideOver>
      {toast}
    </>
  );
}

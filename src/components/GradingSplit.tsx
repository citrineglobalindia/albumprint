import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRightLeft, Plus, Trash2, Users } from "lucide-react";
import { Avatar, Pill, cx, inputCls } from "./ui";
import { useStore } from "../lib/store";
import { advanceAfter, pickFor, personLabel } from "../lib/albumFlow";
import { SHARES, addDone, addExtraPhotos, assignPhotos, canRecord, graderName, isAdmin, movePending, myStaffId, pendingOf, removeShare, sharesOf, splitTotals, type Share } from "../lib/gradingShares";

const btn = "inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold disabled:opacity-40";
type Res = { ok: boolean; msg: string };

/** Grader picker: colour graders first, then everyone else ("new person"). */
function PersonSelect({ value, onChange, exclude, label }: { value: string; onChange: (v: string) => void; exclude?: string[]; label: string }) {
  const { fit, other } = pickFor("grading");
  const ok = (id: string) => !exclude?.includes(id);
  return (
    <select aria-label={label} className={cx(inputCls, "h-8 !w-auto min-w-[180px] flex-1 text-xs")} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose person…</option>
      {fit.filter((p) => ok(p.id)).length > 0 && <optgroup label="Colour graders">{fit.filter((p) => ok(p.id)).map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}</optgroup>}
      {other.filter((p) => ok(p.id)).length > 0 && <optgroup label="Others">{other.filter((p) => ok(p.id)).map((p) => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}</optgroup>}
    </select>
  );
}

/** Colour grading split: the admin divides the photos between graders, adds extra photos and moves pending photos;
 *  each grader adds the photos they graded to their own share. */
export function GradingSplit({ orderId, onDone }: { orderId: string; onDone: (msg: string, ok: boolean) => void }) {
  useStore();
  const admin = isAdmin(), shares = sharesOf(orderId), t = splitTotals(orderId);
  const [who, setWho] = useState(""); const [n, setN] = useState("");
  const [extra, setExtra] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!admin && !shares.length) return null;
  const run = async (p: Promise<Res>, after?: () => void) => {
    setBusy(true); const r = await p; setBusy(false); onDone(r.msg, r.ok);
    if (r.ok) { after?.(); const a = advanceAfter(orderId, "grading"); if (a) onDone(a.msg, a.ok); }
  };
  return (
    <section className="mt-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3" data-testid="grading-split" aria-label="Photos divided between graders">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Users className="size-4 text-violet-700" />
        <h4 className="flex-1 text-[13px] font-extrabold">Photos divided between graders</h4>
        <span className="text-[11px] text-sub" data-testid="split-totals">{t.given ? `${t.given} given` : "photos given not entered"} · {t.assigned} assigned · {t.done} done · <b className={t.pending ? "text-amber-700" : ""}>{t.pending} pending</b>{t.unassigned ? <> · <b className="text-rose-600">{t.unassigned} not assigned</b></> : null}</span>
      </div>

      {shares.length > 0 && (
        <ul className="space-y-1.5">{shares.map((s) => <ShareRow key={s.graderId} s={s} admin={admin} busy={busy} run={run} others={shares.map((x) => x.graderId)} />)}</ul>
      )}

      {admin && (
        <div className="mt-2 rounded-lg bg-white p-2.5">
          <div className="mb-1.5 flex gap-1 text-[11px] font-bold">
            <button type="button" onClick={() => setExtra(false)} className={cx("rounded-md px-2 py-1", !extra ? "bg-violet-600 text-white" : "text-sub hover:bg-slate-100")}>Assign photos</button>
            <button type="button" onClick={() => setExtra(true)} className={cx("rounded-md px-2 py-1", extra ? "bg-violet-600 text-white" : "text-sub hover:bg-slate-100")}>Add extra photos</button>
          </div>
          <p className="mb-1.5 text-[11px] text-sub">{extra ? "New photos arrived: they are added to the photos given and given to this person." : t.unassigned ? `${t.unassigned} photos still to divide.` : t.given ? "All photos are divided — use Add extra photos for more." : "Enter the photos given on the order, or use Add extra photos."}</p>
          <div className="flex flex-wrap items-center gap-2">
            <PersonSelect label={extra ? "Extra photos for" : "Assign photos to"} value={who} onChange={setWho} />
            <input aria-label={extra ? "Extra photos" : "Photos to assign"} type="number" min={1} step={1} className={cx(inputCls, "h-8 !w-24 text-xs")} placeholder={extra ? "+ photos" : t.unassigned ? String(t.unassigned) : "photos"} value={n} onChange={(e) => setN(e.target.value)} />
            <button type="button" disabled={busy || !who || !n} onClick={() => void run(extra ? addExtraPhotos(orderId, who, Number(n)) : assignPhotos(orderId, who, Number(n)), () => { setWho(""); setN(""); })} className={cx(btn, "bg-violet-600 text-white hover:bg-violet-700")}><Plus className="size-3.5" />{extra ? "Add photos" : "Assign"}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function ShareRow({ s, admin, busy, run, others }: { s: Share; admin: boolean; busy: boolean; run: (p: Promise<Res>, after?: () => void) => Promise<void>; others: string[] }) {
  const [v, setV] = useState(""); const [moving, setMoving] = useState(false); const [to, setTo] = useState(""); const [m, setM] = useState("");
  const pend = pendingOf(s), name = graderName(s), pct = s.assigned ? Math.round((s.done / s.assigned) * 100) : 0;
  return (
    <li className="rounded-lg bg-white p-2 text-[12px]" data-testid={`share-${s.graderId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Avatar name={name} size={24} /><b className="min-w-0 flex-1 truncate">{name}</b>
        <span data-testid="share-count">{s.done}/{s.assigned} done</span>
        {pend > 0 ? <Pill tone="amber">{pend} pending</Pill> : <Pill tone="green">Done</Pill>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} /></div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {pend > 0 && canRecord(s) && <>
          <input aria-label={`Photos graded by ${name}`} type="number" min={1} step={1} value={v} onChange={(e) => setV(e.target.value)} placeholder="+ graded" className="h-8 w-20 rounded-md border border-line px-1.5 text-xs outline-none focus:border-brand" />
          <button type="button" disabled={busy || !v} onClick={() => void run(addDone(s.orderId, s.graderId, Number(v)), () => setV(""))} className={cx(btn, "bg-brand text-white hover:bg-brand-dark")}><Plus className="size-3.5" />Add</button>
        </>}
        {admin && pend > 0 && <button type="button" onClick={() => setMoving(!moving)} className={cx(btn, "border border-line hover:bg-slate-50")}><ArrowRightLeft className="size-3.5" />Move pending</button>}
        {admin && s.done === 0 && <button type="button" aria-label={`Remove ${name}`} disabled={busy} onClick={() => void run(removeShare(s.orderId, s.graderId))} className={cx(btn, "text-rose-600 hover:bg-rose-50")}><Trash2 className="size-3.5" /></button>}
      </div>
      {moving && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md bg-amber-50 p-1.5" data-testid="move-pending">
          <span className="text-[11px] font-semibold">Give</span>
          <input aria-label={`Pending photos to move from ${name}`} type="number" min={1} max={pend} step={1} value={m} placeholder={String(pend)} onChange={(e) => setM(e.target.value)} className="h-8 w-16 rounded-md border border-line px-1.5 text-xs" />
          <span className="text-[11px] font-semibold">pending to</span>
          <PersonSelect label={`Move pending photos from ${name} to`} value={to} onChange={setTo} exclude={[s.graderId]} />
          <button type="button" disabled={busy || !to} onClick={() => void run(movePending(s.orderId, s.graderId, to, m ? Number(m) : undefined), () => { setMoving(false); setTo(""); setM(""); })} className={cx(btn, "bg-amber-600 text-white hover:bg-amber-700")}>Move{others.includes(to) ? "" : " (new)"}</button>
        </div>
      )}
    </li>
  );
}

/** My Jobs: the photo shares assigned to the signed-in grader, with their own "+ graded" box. */
export function MyGradingShares({ onDone }: { onDone: (msg: string, ok: boolean) => void }) {
  useStore();
  const me = myStaffId();
  const mine = SHARES.filter((s) => s.graderId === me && me).sort((a, b) => pendingOf(b) - pendingOf(a));
  const [busy, setBusy] = useState(false);
  if (!mine.length) return null;
  const run = async (p: Promise<Res>, after?: () => void) => { setBusy(true); const r = await p; setBusy(false); onDone(r.msg, r.ok); if (r.ok) after?.(); };
  return (
    <section className="mb-4 rounded-2xl border border-violet-200 bg-white p-4" data-testid="my-shares">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-extrabold"><Users className="size-4 text-violet-700" />Photos assigned to me · {mine.reduce((a, s) => a + pendingOf(s), 0)} pending</h3>
      <ul className="space-y-1.5">{mine.map((s) => <li key={s.orderId} className="flex flex-wrap items-center gap-2 text-[12px]"><Link to={`/orders/${s.orderId}`} className="w-24 font-bold text-brand hover:underline">{s.orderId}</Link><div className="min-w-0 flex-1"><ShareRow s={s} admin={false} busy={busy} run={async (p, a) => { await run(p, a); const x = advanceAfter(s.orderId, "grading"); if (x) onDone(x.msg, x.ok); }} others={[]} /></div></li>)}</ul>
    </section>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, FileText, Pencil } from "lucide-react";
import { Field, SlideOver, cx, inputCls } from "./ui";
import { OutlineButton, PrimaryButton } from "./ui";
import { SizePicker } from "./SizePicker";
import { useAuth } from "../lib/auth";
import { notify } from "../lib/store";
import { logAudit } from "../lib/audit";
import { PRIORITIES, type Order, type Priority } from "../lib/data";
import { EVENT_TYPES } from "../lib/pricing";
import { assignees } from "../lib/staffList";
import { editOrder } from "../lib/orderEdit";
import { dbEditAlbum } from "../lib/db/workflowDb";
import { DRAFTS, pricingOf, prepareInvoice, reopenOrder, saveDraft } from "../lib/orders2";

const ORIENT = ["Landscape", "Portrait", "Square"];
type AlbumForm = { title: string; size: string; orientation: string; eventDate: string };
type Form = { couple: string; event: string; due: string; priority: Priority; assignee: string; size: string; albums: AlbumForm[] };

const formOf = (o: Order): Form => ({
  couple: o.couple ?? "", event: o.event === "—" ? "" : o.event, due: o.due, priority: o.priority, assignee: o.assignee === "—" ? "" : o.assignee,
  size: o.size === "—" ? "" : o.size,
  albums: (o.albums ?? []).map((a) => ({ title: a.title ?? "", size: a.size ?? "", orientation: a.orientation || "Landscape", eventDate: a.eventDate ?? "" })),
});

/** The builder draft is made from the order as it was invoiced; carry over album names, sizes, orientation and event
 *  dates changed here since, so they are not lost when the order is finalized again. */
async function carryAlbumEdits(o: Order, draftId: string) {
  const d = DRAFTS.find((x) => x.id === draftId); if (!d || !o.albums?.length) return;
  let changed = false;
  const albums = d.payload.albums.map((a, i) => {
    const s = o.albums![i]; if (!s) return a;
    const n = { ...a, name: s.title || a.name, size: s.size || a.size, orientation: s.orientation || a.orientation, eventDate: s.eventDate ?? a.eventDate };
    if (n.name !== a.name || n.size !== a.size || n.orientation !== a.orientation || n.eventDate !== a.eventDate) changed = true;
    return n;
  });
  if (changed) { d.payload = { ...d.payload, albums }; await saveDraft(d.id, d.payload); }
}

/** Edit an order: its details (couple, event, due date, priority, assignee), each album's name / size / orientation / event
 *  date, and — through the authorized reopen — the albums' sheets, copies, items and price. */
export function OrderEditPanel({ o, onClose, show }: { o: Order | null; onClose: () => void; show: (m: string) => void }) {
  const { role } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState<Form | null>(null);
  const [err, setErr] = useState("");
  const [reason, setReason] = useState(""); const [asking, setAsking] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { setF(o ? formOf(o) : null); setErr(""); setAsking(false); setReason(""); }, [o]);
  if (!o || !f) return <SlideOver open={false} onClose={onClose} title="">{null}</SlideOver>;

  const pr = pricingOf(o.id);
  const reopened = DRAFTS.find((d) => !d.result && (d.payload.reopenOrder === o.id || d.payload.reopenOrder === o.uid));
  const isAdmin = role === "admin";
  const setAlbum = (i: number, p: Partial<AlbumForm>) => setF({ ...f, albums: f.albums.map((a, k) => (k === i ? { ...a, ...p } : a)) });

  const save = () => {
    if (o.closed) { setErr(`${o.id} is closed and read-only — reopen it first`); return; }
    if (!f.due) { setErr("Choose the due date"); return; }
    const patch: Partial<Order> = {};
    if ((f.couple.trim() || undefined) !== (o.couple || undefined)) patch.couple = f.couple.trim() || undefined;
    if (f.event.trim() && f.event.trim() !== o.event) patch.event = f.event.trim();
    if (f.due !== o.due) patch.due = f.due;
    if (f.priority !== o.priority) patch.priority = f.priority;
    if (f.assignee && f.assignee !== o.assignee) patch.assignee = f.assignee;
    // albums: name / size / orientation / event date (sheets, copies, items and price go through the authorized edit below)
    const changed: string[] = [];
    (o.albums ?? []).forEach((a, i) => {
      const n = f.albums[i]!; const d: Partial<AlbumForm> = {};
      if (n.title.trim() !== (a.title ?? "")) d.title = n.title.trim();
      if (n.size && n.size !== a.size) d.size = n.size;
      if (n.orientation !== a.orientation) d.orientation = n.orientation;
      if (n.eventDate !== (a.eventDate ?? "")) d.eventDate = n.eventDate;
      if (!Object.keys(d).length) return;
      const before = { ...a };
      Object.assign(a, { ...(d.title !== undefined ? { title: d.title } : {}), ...(d.size ? { size: d.size } : {}), ...(d.orientation ? { orientation: d.orientation } : {}), ...(d.eventDate !== undefined ? { eventDate: d.eventDate || undefined } : {}) });
      dbEditAlbum(o.uid, i + 1, d, () => { Object.assign(a, before); notify(); });
      changed.push(`album ${i + 1}: ${Object.entries(d).map(([k, v]) => `${k}=${v || "—"}`).join(", ")}`);
    });
    if (o.albums?.length && changed.length) {
      const sz = [...new Set(o.albums.map((a) => a.size).filter(Boolean))].join(", ");
      if (sz !== o.size) { o.size = sz; }
      logAudit({ entity: "order", entityId: o.id, action: "update", detail: `Albums edited — ${changed.join("; ")}` });
      notify();
    }
    if (!o.albums?.length && f.size && f.size !== o.size) patch.size = f.size;
    if (Object.keys(patch).length) editOrder(o.id, patch, "update", Object.keys(patch).join(", "));
    if (!Object.keys(patch).length && !changed.length) { onClose(); return; }
    show(`${o.id} updated`); onClose();
  };

  const reopen = async () => {
    setBusy(true); setErr("");
    const r = await reopenOrder(o, reason);
    setBusy(false);
    if ("error" in r) { setErr(r.error); return; }
    await carryAlbumEdits(o, r.draftId);
    show(`Order ${o.id} reopened for editing`); nav(`/orders/new?draft=${r.draftId}`);
  };
  const prepare = async () => {
    setBusy(true); setErr("");
    const r = await prepareInvoice(o);
    setBusy(false);
    if ("error" in r) { setErr(r.error); return; }
    await carryAlbumEdits(o, r.draftId);
    nav(`/orders/new?draft=${r.draftId}`);
  };

  return (
    <SlideOver open onClose={onClose} title={`Edit ${o.id}`} width={520}
      footer={<><OutlineButton onClick={onClose}>Cancel</OutlineButton><PrimaryButton icon={Check} onClick={save}>Save changes</PrimaryButton></>}>
      <div data-testid="edit-order" className="space-y-1">
        {err && <div role="alert" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-600">{err}</div>}
        <div className="text-xs font-extrabold uppercase tracking-wide text-sub">Order</div>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label="Couple name" hint="e.g. Asha & Ravi"><input aria-label="Couple name" className={inputCls} maxLength={120} value={f.couple} onChange={(e) => setF({ ...f, couple: e.target.value })} /></Field>
          <Field label="Event"><input aria-label="Event" list="edit-order-events" className={inputCls} maxLength={80} value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })} placeholder="e.g. Wedding" />
            <datalist id="edit-order-events">{EVENT_TYPES.map((e) => <option key={e} value={e} />)}</datalist></Field>
          <Field label="Due date" required><input aria-label="Due date" type="date" className={inputCls} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
          <Field label="Priority"><select aria-label="Priority" className={inputCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></Field>
          <div className="sm:col-span-2"><Field label="Assigned to"><select aria-label="Assigned to" className={inputCls} value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })}><option value="">Not assigned</option>{[...new Set([...(f.assignee ? [f.assignee] : []), ...assignees()])].map((a) => <option key={a}>{a}</option>)}</select></Field></div>
        </div>

        <div className="pt-3 text-xs font-extrabold uppercase tracking-wide text-sub">{o.albums?.length ? `Albums (${o.albums.length})` : "Album"}</div>
        {o.albums?.length ? f.albums.map((a, i) => {
          const spec = o.albums![i]!;
          return (
            <div key={i} className="mb-3 rounded-xl border border-line p-3" data-testid={`edit-album-${i + 1}`}>
              <div className="mb-1 flex items-center gap-2 text-[13px] font-bold">Album {i + 1}<span className="ml-auto text-xs font-semibold text-sub">{spec.sheets} sheets · {spec.copies} cop{spec.copies === 1 ? "y" : "ies"}</span></div>
              <div className="grid gap-x-3 sm:grid-cols-2">
                <Field label="Album name"><input aria-label={`Album ${i + 1} name`} className={inputCls} maxLength={120} value={a.title} onChange={(e) => setAlbum(i, { title: e.target.value })} placeholder="e.g. Wedding album" /></Field>
                <Field label="Size"><SizePicker label={`Album ${i + 1} size`} value={a.size} onChange={(v) => setAlbum(i, { size: v })} /></Field>
                <Field label="Orientation"><select aria-label={`Album ${i + 1} orientation`} className={inputCls} value={a.orientation} onChange={(e) => setAlbum(i, { orientation: e.target.value })}>{ORIENT.map((x) => <option key={x}>{x}</option>)}</select></Field>
                <Field label="Event date"><input aria-label={`Album ${i + 1} event date`} type="date" className={inputCls} value={a.eventDate} onChange={(e) => setAlbum(i, { eventDate: e.target.value })} /></Field>
              </div>
            </div>
          );
        }) : <Field label="Album size"><SizePicker label="Album size" value={f.size} onChange={(v) => setF({ ...f, size: v })} /></Field>}

        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[13px]" data-testid="edit-pricing">
          <div className="font-bold text-amber-900">Sheets, copies, items, albums and price</div>
          {!pr ? <p className="mt-1 text-xs text-sub">This order has no invoice from the order builder, so its items can't be re-priced here.</p>
            : reopened ? (
              <button type="button" onClick={() => nav(`/orders/new?draft=${reopened.id}`)} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"><Pencil className="size-3.5" />Continue editing in the order builder</button>
            ) : pr.status === "invoice_pending" ? (
              <>
                <p className="mt-1 text-xs text-amber-900/80">The invoice isn't issued yet. Open the order builder to change albums, sheets, copies and items, then issue the invoice.</p>
                {(isAdmin || role === "reception") && <button type="button" disabled={busy} onClick={() => void prepare()} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"><FileText className="size-3.5" />Edit albums & items</button>}
              </>
            ) : !isAdmin ? <p className="mt-1 text-xs text-amber-900/80">Only the admin can change the items and price of an invoiced order.</p>
            : !asking ? (
              <>
                <p className="mt-1 text-xs text-amber-900/80">Opens the full order in the order builder. The current invoice is voided (kept on record) and a new revision is issued when you finalize; payments stay with the order.</p>
                <button type="button" onClick={() => setAsking(true)} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"><Pencil className="size-3.5" />Edit albums, items & price</button>
              </>
            ) : (
              <div className="mt-2 space-y-2">
                <textarea aria-label="Reason for editing" className={cx(inputCls, "h-16 py-2")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. customer added a second copy" />
                <div className="flex gap-2"><button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void reopen()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50">Open in order builder</button>
                  <button type="button" onClick={() => setAsking(false)} className="h-9 rounded-lg px-3 text-xs font-bold text-sub hover:bg-slate-100">Back</button></div>
              </div>
            )}
        </div>
      </div>
    </SlideOver>
  );
}

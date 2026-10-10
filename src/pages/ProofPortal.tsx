import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useParams } from "react-router-dom";
import { BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Clock, LinkIcon, MessageSquarePlus, Pencil, Trash2, ThumbsUp, PenLine, X } from "lucide-react";
import { Thumb, cx } from "../components/ui";
import { ORDERS } from "../lib/data";
import { approveProof, markViewed, proofByToken, requestCorrections, type ProofComment } from "../lib/proofs";
import { moveStage } from "../lib/workflow";
import { flushAll } from "../lib/persist";
import { fmtDate } from "../lib/format";

const STUDIO = "AlbumPro Studio";
const art = (seed: number, mirror?: boolean) => (
  <div className="relative h-full w-full overflow-hidden bg-[#fbf7f0]">
    <div className={cx("absolute inset-1.5 grid gap-1.5 sm:inset-2 sm:gap-2", mirror ? "grid-cols-[1.4fr_1fr]" : "grid-cols-1")}>
      <Thumb seed={seed} size={0} rounded="rounded-md" className="!h-full !w-full" />
      {mirror && (
        <div className="grid grid-rows-2 gap-1.5 sm:gap-2">
          <Thumb seed={seed + 2} size={0} rounded="rounded-md" className="!h-full !w-full" />
          <Thumb seed={seed + 3} size={0} rounded="rounded-md" className="!h-full !w-full" />
        </div>
      )}
    </div>
  </div>
);

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <div className="grid size-9 place-items-center rounded-xl bg-brand text-white"><BookOpen className="size-5" /></div>
          <div><div className="text-[15px] font-extrabold leading-tight">{STUDIO}</div><div className="text-[11px] text-sub">Secure album proof</div></div>
        </div>
      </header>
      {children}
      <footer className="px-4 py-6 text-center text-[11px] text-sub">Private link for the album owner - please do not share. &copy; {STUDIO}</footer>
    </div>
  );
}

function Notice({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand">{icon}</div>
        <h1 className="text-xl font-extrabold">{title}</h1>
        <div className="mt-2 text-sm text-sub">{children}</div>
      </main>
    </Shell>
  );
}

export default function ProofPortal() {
  const { token = "" } = useParams();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const proof = proofByToken(token);
  const order = proof ? ORDERS.find((o) => o.id === proof.orderId) : undefined;
  const draftKey = `albumpro.draft.${token}`;
  const [draft, setDraft] = useState<ProofComment[]>(() => { try { return JSON.parse(localStorage.getItem(draftKey) ?? "[]"); } catch { return []; } });
  const [spread, setSpread] = useState(0);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [dlg, setDlg] = useState<"approve" | "corrections" | null>(null);
  const [name, setName] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [err, setErr] = useState("");

  const live = !!proof && ["sent", "viewed"].includes(proof.status);
  useEffect(() => { if (proof && proof.status === "sent") { markViewed(proof); flushAll(); bump(); } }, [proof]);
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* ignore */ } }, [draft, draftKey]);

  const pages = proof?.pages ?? 0;
  const spreadCount = Math.ceil(pages / 2) + 1;
  const pageNo = spread === 0 ? 1 : Math.min(pages, spread * 2);
  const pageLabel = spread === 0 ? "Cover (page 1)" : `Page ${pageNo}`;
  const go = useCallback((d: number) => setSpread((s) => Math.min(spreadCount - 1, Math.max(0, s + d))), [spreadCount]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea")) return;
      if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [go]);
  const thumbs = useMemo(() => Array.from({ length: spreadCount }, (_, i) => i), [spreadCount]);

  if (!proof || !order) return <Notice icon={<LinkIcon className="size-6" />} title="This link isn't valid">We couldn't find an album proof for this link. Please ask the studio to send you a new link.</Notice>;
  if (proof.status === "revoked") return <Notice icon={<X className="size-6" />} title="This link is no longer active">The studio has replaced or withdrawn this proof link. Please ask the studio for a new link.</Notice>;
  if (proof.status === "expired") return <Notice icon={<Clock className="size-6" />} title="This link has expired">For your security, proof links expire. Please ask the studio for a new link.</Notice>;
  if (proof.status === "approved" || proof.status === "corrections") {
    const ok = proof.status === "approved";
    return (
      <Notice icon={ok ? <CheckCircle2 className="size-6" /> : <PenLine className="size-6" />} title={ok ? "Thank you - album approved!" : "Thank you - corrections sent"}>
        <p>{ok ? `${order.customer}'s ${order.event} album (${order.id}) has been approved${proof.approvedBy ? ` by ${proof.approvedBy}` : ""}. The studio will now prepare it for printing.` : `We've received ${proof.comments.length} correction${proof.comments.length === 1 ? "" : "s"} on ${order.id}. The studio will update the design and send you a new link to review.`}</p>
        {!ok && <ul className="mt-4 space-y-2 text-left">{proof.comments.map((c, i) => <li key={i} className="rounded-xl border border-line bg-white p-3 text-[13px]"><b className="text-brand">Page {c.page}</b><p className="text-ink">{c.text}</p></li>)}</ul>}
        <p className="mt-4 text-xs">Responded {fmtDate(proof.respondedAt ?? "")}. This proof can no longer be changed.</p>
      </Notice>
    );
  }

  const here = draft.map((c, i) => ({ c, i })).filter(({ c }) => c.page === pageNo);
  const saveComment = () => {
    const t = text.trim();
    if (t.length < 3) return setErr("Please describe the change (at least 3 characters).");
    if (editIdx !== null) setDraft((d) => d.map((c, i) => (i === editIdx ? { ...c, text: t } : c)));
    else setDraft((d) => [...d, { page: pageNo, text: t, at: new Date().toISOString() }]);
    setText(""); setErr(""); setAdding(false); setEditIdx(null);
  };
  const approve = () => {
    if (!name.trim()) return setErr("Please type your full name.");
    if (!reviewed) return setErr("Please confirm you have reviewed all pages.");
    approveProof(proof, name.trim()); flushAll(); setDlg(null); bump();
  };
  const sendCorrections = () => {
    if (!draft.length) return;
    requestCorrections(proof, draft.map((c) => ({ ...c })));
    moveStage(proof.orderId, "designing", { reason: "Client corrections" });
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    flushAll(); setDlg(null); bump();
  };

  return (
    <Shell>
      <main className="mx-auto max-w-5xl px-4 pb-28 pt-5 sm:pb-10">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-extrabold sm:text-2xl">{order.event} Album - {order.customer}</h1>
            <p className="text-[13px] text-sub">Order {order.id} - {order.size} - {pages} pages - Version {proof.version}</p>
          </div>
          <p className="text-xs text-sub">Link valid until {fmtDate(proof.expiresAt)}</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-label="Album viewer" className="min-w-0 rounded-2xl border border-line bg-white p-3 sm:p-4">
            <div className="relative grid place-items-center rounded-xl bg-slate-200/70 p-3 sm:p-6">
              <div data-testid="spread" className="relative flex aspect-[2/1] w-full max-w-[760px] overflow-hidden rounded shadow-2xl">
                <div className="relative flex-1 border-r border-black/10">
                  {art(spread)}
                  {spread === 0 && <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center font-serif italic text-white drop-shadow sm:bottom-6"><div className="text-lg sm:text-2xl">Our {order.event} Story</div><div className="mt-1 text-[8px] not-italic tracking-[0.25em] sm:text-[10px]">{order.customer.toUpperCase()}</div></div>}
                </div>
                <div className="relative flex-1">{art(spread + 3, true)}</div>
                {here.map(({ c, i }, k) => (
                  <button key={i} aria-label={`Correction ${i + 1} on page ${c.page}`} onClick={() => { setEditIdx(i); setText(c.text); setAdding(true); }} style={{ left: `${18 + k * 14}%`, top: `${22 + (k % 3) * 20}%` }} className="absolute grid size-7 -translate-x-1/2 place-items-center rounded-full border-2 border-white bg-rose-500 text-xs font-bold text-white shadow-lg">{i + 1}</button>
                ))}
              </div>
              <button aria-label="Previous page" onClick={() => go(-1)} disabled={spread === 0} className="absolute left-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 shadow disabled:opacity-30"><ChevronLeft className="size-5" /></button>
              <button aria-label="Next page" onClick={() => go(1)} disabled={spread >= spreadCount - 1} className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 shadow disabled:opacity-30"><ChevronRight className="size-5" /></button>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 text-sm">
              <span data-testid="page-label" className="font-semibold">{pageLabel} <span className="font-normal text-sub">- spread {spread + 1} of {spreadCount}</span></span>
              <button onClick={() => { setAdding(true); setEditIdx(null); setText(""); setErr(""); }} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-brand px-3 text-[13px] font-bold text-brand hover:bg-brand-soft"><MessageSquarePlus className="size-4" />Add correction</button>
            </div>
            {adding && (
              <div className="mt-3 rounded-xl border border-brand/40 bg-brand-soft/30 p-3">
                <label className="text-xs font-bold">{editIdx !== null ? `Edit correction (page ${draft[editIdx]?.page})` : `What should change on page ${pageNo}?`}
                  <textarea aria-label="Correction comment" autoFocus value={text} onChange={(e) => { setText(e.target.value); setErr(""); }} className="mt-1.5 h-20 w-full resize-none rounded-lg border border-line bg-white p-2.5 text-sm font-normal outline-none focus:border-brand" placeholder="e.g. Please brighten the bride's face" /></label>
                {err && !dlg && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{err}</p>}
                <div className="mt-2 flex gap-2"><button onClick={saveComment} className="h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white">{editIdx !== null ? "Save changes" : "Add comment"}</button><button onClick={() => { setAdding(false); setEditIdx(null); setErr(""); }} className="h-10 rounded-lg border border-line bg-white px-4 text-sm font-bold">Cancel</button></div>
              </div>
            )}
            <div data-testid="thumbs" className="scroll-thin mt-3 flex gap-2 overflow-x-auto pb-1">
              {thumbs.map((i) => {
                const n = draft.filter((c) => c.page === (i === 0 ? 1 : Math.min(pages, i * 2))).length;
                return (
                  <button key={i} aria-label={`Go to spread ${i + 1}`} onClick={() => setSpread(i)} className={cx("relative h-12 w-[88px] shrink-0 overflow-hidden rounded-lg border-2", spread === i ? "border-brand" : "border-transparent opacity-80")}>
                    <div className="flex h-full"><div className="flex-1">{art(i)}</div>{i > 0 && <div className="flex-1">{art(i + 3, true)}</div>}</div>
                    {n > 0 && <span className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-rose-500 text-[9px] font-bold text-white">{n}</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="min-w-0 space-y-4">
            <section className="rounded-2xl border border-line bg-white p-4" aria-label="Your corrections">
              <h2 className="text-[15px] font-extrabold">Your corrections ({draft.length})</h2>
              {!draft.length && <p className="mt-2 text-[13px] text-sub">Nothing to change? Approve the album. Otherwise browse the pages and tap "Add correction" on any page.</p>}
              <ul className="mt-2 space-y-2">
                {draft.map((c, i) => (
                  <li key={i} className="rounded-xl border border-line p-3 text-[13px]">
                    <div className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-rose-500 text-[10px] font-bold text-white">{i + 1}</span><button onClick={() => setSpread(c.page <= 1 ? 0 : Math.ceil(c.page / 2))} className="font-bold text-brand">Page {c.page}</button>
                      <span className="ml-auto flex gap-1">
                        <button aria-label={`Edit correction ${i + 1}`} onClick={() => { setSpread(c.page <= 1 ? 0 : Math.ceil(c.page / 2)); setEditIdx(i); setText(c.text); setAdding(true); }} className="grid size-8 place-items-center rounded-lg hover:bg-slate-100"><Pencil className="size-4 text-sub" /></button>
                        <button aria-label={`Remove correction ${i + 1}`} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded-lg hover:bg-slate-100"><Trash2 className="size-4 text-rose-500" /></button>
                      </span></div>
                    <p className="mt-1.5">{c.text}</p>
                  </li>
                ))}
              </ul>
            </section>
            <section className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-line bg-white p-3 lg:static lg:block lg:space-y-2 lg:rounded-2xl lg:border lg:p-4">
              <button onClick={() => { setDlg("approve"); setErr(""); }} disabled={!live} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300 lg:w-full"><ThumbsUp className="size-4" />Approve album</button>
              <button onClick={() => { if (!draft.length) { setErr("Add at least one correction first."); setAdding(true); return; } setDlg("corrections"); }} disabled={!live} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-brand text-sm font-bold text-brand hover:bg-brand-soft disabled:opacity-50 lg:w-full"><PenLine className="size-4" />Request corrections</button>
            </section>
          </aside>
        </div>
      </main>

      {dlg && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-ink/40 p-0 sm:place-items-center sm:p-4" onClick={() => setDlg(null)}>
          <div role="dialog" aria-label={dlg === "approve" ? "Approve album" : "Send corrections"} className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            {dlg === "approve" ? (
              <>
                <h3 className="text-lg font-extrabold">Approve this album?</h3>
                <p className="mt-1 text-sm text-sub">Once approved, the studio will send it to print. This cannot be undone.</p>
                <label className="mt-4 block text-[13px] font-semibold">Your full name<input aria-label="Your full name" value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} className="mt-1.5 h-11 w-full rounded-lg border border-line px-3 text-sm font-normal outline-none focus:border-brand" /></label>
                <label className="mt-3 flex items-start gap-2 text-[13px]"><input type="checkbox" checked={reviewed} onChange={(e) => { setReviewed(e.target.checked); setErr(""); }} className="mt-0.5 size-4" />I have reviewed all pages</label>
                {err && <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{err}</p>}
                <div className="mt-5 flex justify-end gap-3"><button onClick={() => setDlg(null)} className="h-11 rounded-lg px-4 text-sm font-bold hover:bg-slate-100">Cancel</button><button onClick={approve} className="h-11 rounded-lg bg-emerald-600 px-5 text-sm font-bold text-white">Confirm approval</button></div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-extrabold">Send {draft.length} correction{draft.length === 1 ? "" : "s"}?</h3>
                <p className="mt-1 text-sm text-sub">The studio will update the album and send you a new link. You can't change this response afterwards.</p>
                <div className="mt-5 flex justify-end gap-3"><button onClick={() => setDlg(null)} className="h-11 rounded-lg px-4 text-sm font-bold hover:bg-slate-100">Keep editing</button><button onClick={sendCorrections} className="h-11 rounded-lg bg-brand px-5 text-sm font-bold text-white">Send corrections</button></div>
              </>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}

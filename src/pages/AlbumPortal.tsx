import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, MessageSquarePlus, PenLine, ThumbsUp } from "lucide-react";
import { AlbumFlipbook } from "../components/AlbumFlipbook";
import { BrandWordmark, DevCredit } from "../components/BrandMark";
import { cx } from "../components/ui";
import { publicFeedback, publicGet, type PublicView } from "../lib/albumPreview";
import { fmtDate } from "../lib/format";

/** The client's album link (no login): turn the pages, request changes (on a page or in general), or approve the album. */
export default function AlbumPortal() {
  const { token = "" } = useParams();
  const [view, setView] = useState<PublicView | null | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<null | "changes" | "approve">(null);
  const [name, setName] = useState(() => { try { return localStorage.getItem("albumpro.client.name") ?? ""; } catch { return ""; } });
  const [msg, setMsg] = useState(""); const [onPage, setOnPage] = useState(true);
  const [busy, setBusy] = useState(false); const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pageNote, setPageNote] = useState<string | null>(null);
  const [pageKind, setPageKind] = useState<"Cover" | "Page" | "Spread">("Spread");
  const [side, setSide] = useState<"left" | "right" | "whole">("whole");          // which page of an open spread the note is about
  const openNote = (n?: number, k?: "Cover" | "Page" | "Spread", sd: "left" | "right" | "whole" = "whole") => {
    if (n) { setPage(n); if (k) setPageKind(k); }
    setSide(sd); setPageNote(""); setNote(null);
    window.setTimeout(() => document.getElementById("page-notes")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };
  const load = () => void publicGet(token).then(setView, () => setView(null));
  useEffect(load, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    setBusy(true);
    try { localStorage.setItem("albumpro.client.name", name); } catch { /* ignore */ }
    const r = await publicFeedback(token, { page: mode === "changes" && onPage ? page : undefined, name, message: msg, kind: mode === "approve" ? "approve" : "changes" });
    setBusy(false); setNote({ ok: r.ok, text: r.msg });
    if (r.ok) { setMode(null); setMsg(""); load(); }
  };

  const header = (
    <header className="border-b border-line bg-white"><div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3"><BrandWordmark onLight height={40} /><span className="ml-auto text-[11px] text-sub">Album preview</span></div></header>
  );
  if (view === undefined) return <div className="min-h-screen bg-page">{header}<p className="p-10 text-center text-sm text-sub">Opening your album…</p></div>;
  if (view === null) return <div className="min-h-screen bg-page">{header}<div className="mx-auto max-w-md p-10 text-center"><h1 className="text-xl font-extrabold">This album link is not available</h1><p className="mt-2 text-sm text-sub">It may have been replaced by a newer version. Please ask the studio for the latest link.</p></div></div>;
  const approved = view.status === "approved";
  return (
    <div className="min-h-screen bg-page text-ink">
      {header}
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-4">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1"><h1 className="text-xl font-extrabold sm:text-2xl">{view.title}</h1><p className="text-xs text-sub">{view.customer} · order {view.orderCode} · version {view.version}</p></div>
          {approved ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800" data-testid="client-status"><CheckCircle2 className="size-4" />Approved{view.approvedBy ? ` by ${view.approvedBy}` : ""}</span>
            : view.status === "changes" ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800" data-testid="client-status">Changes requested — the studio is on it</span> : null}
        </div>

        <AlbumFlipbook pages={view.pages} spreads={view.spreads} onPage={(n, k) => { setPage(n); setPageKind(k); }}
          noteFor={approved ? undefined : (n, k) => openNote(n, k)} noteCount={(n) => view.feedback.filter((f) => f.page === n && f.kind !== "approve").length} />

        {/* a note on the page that is open */}
        {(() => {
          const what = pageKind === "Cover" ? "the cover" : `${pageKind.toLowerCase()} ${page}`;
          const here = view.feedback.filter((f) => f.page === page && f.kind !== "approve");
          return (
            <section id="page-notes" className="mt-3 rounded-2xl border border-line bg-white p-3" data-testid="page-notes" aria-label={`Notes on ${what}`}>
              <div className="flex flex-wrap items-center gap-2">
                <MessageSquarePlus className="size-4 text-amber-700" />
                <b className="flex-1 text-sm">Notes on {what}{here.length ? ` (${here.length})` : ""}</b>
                {!approved && pageNote === null && (pageKind === "Spread" ? (
                  <span className="inline-flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => openNote(undefined, undefined, "left")} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"><PenLine className="size-3.5" />Note on left page</button>
                    <button type="button" onClick={() => openNote(undefined, undefined, "right")} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"><PenLine className="size-3.5" />Note on right page</button>
                    <button type="button" onClick={() => openNote(undefined, undefined, "whole")} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-800 hover:bg-amber-50">Whole spread</button>
                  </span>
                ) : <button type="button" onClick={() => openNote()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"><PenLine className="size-3.5" />Add a note on {what}</button>)}
              </div>
              {here.length > 0 && <ul className="mt-2 space-y-1.5">{here.map((f, i) => <li key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-sm">{f.message}<span className="block text-[11px] text-sub">{f.name ? `${f.name} · ` : ""}{fmtDate(f.at)}{f.resolved ? " · ✓ done by the studio" : ""}</span></li>)}</ul>}
              {pageNote !== null && (
                <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); void (async () => {
                  setBusy(true); try { localStorage.setItem("albumpro.client.name", name); } catch { /* ignore */ }
                  const where = pageKind === "Spread" && side !== "whole" ? `${side === "left" ? "Left" : "Right"} page` : "";
                  const r = await publicFeedback(token, { page, name, message: where ? `${where}: ${pageNote.trim()}` : pageNote, kind: "changes" });
                  setBusy(false); setNote({ ok: r.ok, text: r.ok ? `Note added on ${where ? `the ${where.toLowerCase()} of ` : ""}${what} — thank you` : r.msg }); if (r.ok) { setPageNote(null); load(); }
                })(); }}>
                  {pageKind === "Spread" && (
                    <div className="inline-flex rounded-lg border border-line p-0.5 text-xs font-bold" role="group" aria-label="Which page">
                      {(["left", "right", "whole"] as const).map((k) => <button key={k} type="button" aria-pressed={side === k} onClick={() => setSide(k)} className={cx("rounded-md px-3 py-1.5", side === k ? "bg-amber-600 text-white" : "text-sub hover:bg-slate-100")}>{k === "left" ? "Left page" : k === "right" ? "Right page" : "Whole spread"}</button>)}
                    </div>
                  )}
                  <textarea aria-label={`Note on ${what}`} rows={2} autoFocus className="w-full rounded-lg border border-line px-3 py-2 text-sm" value={pageNote} onChange={(e) => setPageNote(e.target.value)} placeholder="e.g. Use a different photo on the left / make this picture bigger" />
                  <div className="flex flex-wrap items-center gap-2">
                    <input aria-label="Your name" className="h-9 min-w-[160px] flex-1 rounded-lg border border-line px-3 text-sm" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                    <button type="submit" disabled={busy || !pageNote.trim()} className="h-9 rounded-lg bg-amber-600 px-4 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50">Save note</button>
                    <button type="button" onClick={() => setPageNote(null)} className="h-9 rounded-lg px-3 text-xs font-bold hover:bg-slate-100">Cancel</button>
                  </div>
                </form>
              )}
            </section>
          );
        })()}

        {note && <p role="status" className={cx("mt-3 rounded-xl px-4 py-2 text-sm font-semibold", note.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700")}>{note.text}</p>}

        {!approved && mode === null && (
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => { setMode("changes"); setNote(null); }} className="inline-flex h-11 items-center gap-2 rounded-xl border border-amber-300 bg-white px-5 text-sm font-bold text-amber-800 hover:bg-amber-50"><PenLine className="size-4" />Request changes</button>
            <button type="button" onClick={() => { setMode("approve"); setNote(null); }} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700"><ThumbsUp className="size-4" />Approve album</button>
          </div>
        )}
        {mode && (
          <form className="mx-auto mt-4 max-w-xl space-y-3 rounded-2xl border border-line bg-white p-4" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <h2 className="text-base font-extrabold">{mode === "approve" ? "Approve this album" : "What would you like changed?"}</h2>
            <label className="block text-xs font-semibold">Your name<input aria-label="Your name" className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm" value={name} onChange={(e) => setName(e.target.value)} /></label>
            {mode === "changes" && <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={onPage} onChange={(e) => setOnPage(e.target.checked)} />About {view.spreads ? "spread" : "page"} {page} (the one open now)</label>}
            <label className="block text-xs font-semibold">{mode === "approve" ? "Message (optional)" : "Your changes"}<textarea aria-label={mode === "approve" ? "Approval message" : "Your changes"} rows={3} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={mode === "approve" ? "Looks great!" : "e.g. Replace the photo on the right with the one from the stage"} /></label>
            <div className="flex gap-2"><button type="submit" disabled={busy} className={cx("h-10 rounded-lg px-4 text-sm font-bold text-white disabled:opacity-50", mode === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-600 hover:bg-amber-700")}>{mode === "approve" ? "Approve album" : "Send changes"}</button><button type="button" onClick={() => setMode(null)} className="h-10 rounded-lg px-4 text-sm font-bold hover:bg-slate-100">Cancel</button></div>
          </form>
        )}

        {view.feedback.length > 0 && (
          <section className="mx-auto mt-6 max-w-xl" aria-label="Your notes">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-extrabold"><MessageSquarePlus className="size-4" />Your notes</h2>
            <ul className="space-y-2">{view.feedback.map((f, i) => (
              <li key={i} className="rounded-xl border border-line bg-white p-3 text-sm">
                <div className="mb-0.5 text-[11px] text-sub">{f.kind === "approve" ? "Approval" : f.page ? `${view.spreads ? "Spread" : "Page"} ${f.page}` : "General"}{f.name ? ` · ${f.name}` : ""} · {fmtDate(f.at)}{f.resolved ? " · ✓ done by the studio" : ""}</div>{f.message}
              </li>))}</ul>
          </section>
        )}
      </main>
      <footer className="px-4 py-6 text-center text-[11px] text-sub">Private link for your album — please don't share it. <DevCredit className="mt-1" /></footer>
    </div>
  );
}

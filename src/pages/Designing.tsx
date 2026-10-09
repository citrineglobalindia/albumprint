import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Undo2, Redo2, Maximize, Minus, Plus, ChevronLeft, ChevronRight, Type, ImageIcon, LayoutGrid, Brush, Save, ChevronDown, CheckCircle2, Download, Link2, CalendarDays, MoreVertical, StickyNote, Ruler, FileText, BookOpen, Palette, User, Clock, History } from "lucide-react";
import { PageHeader, Panel, Pill, Avatar, Thumb, LineTabs, ProgressBar, OutlineButton, LinkAction, MoreButton, SlideOver, cx } from "../components/ui";
import { ORDERS } from "../lib/data";
import { fmtDate } from "../lib/format";

type DStatus = "In Designing" | "With Client" | "Corrections Requested" | "Approved";
const STATUS_PROGRESS: Record<DStatus, number> = { "In Designing": 40, "With Client": 75, "Corrections Requested": 50, Approved: 100 };
const STATUS_TONE = { "In Designing": "green", "With Client": "amber", "Corrections Requested": "red", Approved: "teal" } as const;

const TEMPLATES = ["Classic Elegance", "Modern Minimal", "Royal Heritage", "Cinematic", "Pastel Dreams", "Traditional", "Dark Luxe", "Nature Bliss"];
const TPL_TABS = ["Design Templates", "Layouts", "Backgrounds", "Stickers", "Frames", "Elements"];
const SPREAD_LABELS = ["Cover", "Spread 1", "Spread 2", "Spread 3", "Spread 4", "Spread 5", "Spread 6", "Spread 7", "Spread 8"];

interface Correction { id: string; page: number; text: string; by: string; status: "Open" | "In Progress" | "Resolved" }
const CORRECTIONS0: Correction[] = [
  { id: "COR-001", page: 12, text: "Warm up the skin tones on the right photo.", by: "Client", status: "Open" },
  { id: "COR-002", page: 5, text: "Replace the bottom-left photo with the sangeet shot.", by: "Client", status: "In Progress" },
  { id: "COR-003", page: 1, text: "Cover title font too thin - use bolder script.", by: "Admin", status: "Open" },
];
const BG_SWATCHES = ["#fbf7f0", "#ffffff", "#f3e8ff", "#fde68a", "#fecdd3", "#bae6fd", "#bbf7d0", "#1e293b"];
interface Overlay { id: number; page: number; kind: "text" | "image"; text: string; x: number; y: number }
const COMMENTS = [
  { by: "Chidanan da", when: "2 Oct 2026, 06:10 PM", page: 1, text: "Love the cover! Please add both names in gold foil." },
  { by: "Chidanan da", when: "3 Oct 2026, 09:40 AM", page: 12, text: "Skin tones look slightly dull on this page." },
];

const fill = "!h-full !w-full";
const PageArt = ({ seed, mirror }: { seed: number; mirror?: boolean }) => (
  <div className="relative h-full w-full overflow-hidden bg-[#fbf7f0]">
    <div className={cx("absolute inset-2 grid gap-2", mirror ? "grid-cols-[1.4fr_1fr]" : "grid-cols-1")}>
      <Thumb seed={seed} size={0} rounded="rounded-md" className={fill} />
      {mirror && (
        <div className="grid grid-rows-2 gap-2">
          <Thumb seed={seed + 2} size={0} rounded="rounded-md" className={fill} />
          <Thumb seed={seed + 3} size={0} rounded="rounded-md" className={fill} />
        </div>
      )}
    </div>
  </div>
);

export default function Designing() {
  const { orderId } = useParams();
  const order = ORDERS.find((o) => o.id === (orderId ?? "IDP00072")) ?? ORDERS.find((o) => o.id === "IDP00072")!;

  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(85);
  const [history, setHistory] = useState<number[]>([0]);
  const [hIdx, setHIdx] = useState(0);
  const [tplTab, setTplTab] = useState("Design Templates");
  const [tpl, setTpl] = useState(0);
  const [rTab, setRTab] = useState<"details" | "comments" | "corrections">("details");
  const [status, setStatus] = useState<DStatus>("In Designing");
  const [corrections, setCorrections] = useState(CORRECTIONS0);
  const [notes, setNotes] = useState([{ text: "Include couple name on cover and check colour tone for page 12.", by: "Admin", when: "2 hours ago" }]);
  const [noteDraft, setNoteDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [pagesAdded, setPagesAdded] = useState(0);
  const [toast, setToast] = useState("");
  const [saveMenu, setSaveMenu] = useState(false);
  const [versions, setVersions] = useState(1);
  const [bgOpen, setBgOpen] = useState(false);
  const [bg, setBg] = useState<Record<number, string>>({});
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [noteMenu, setNoteMenu] = useState<number | null>(null);
  const [editNote, setEditNote] = useState<number | null>(null);
  const [events, setEvents] = useState([
    { when: "1 Oct 2026, 10:24 AM", text: "Design started by Ramesh" },
    { when: "2 Oct 2026, 06:10 PM", text: "Client comment received on page 1" },
    { when: "3 Oct 2026, 04:15 PM", text: "Last edit saved" },
  ]);

  const spreads = Math.ceil(order.pages / 2) + 1 + pagesAdded;
  const openCorr = corrections.filter((c) => c.status !== "Resolved").length;
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2200); };
  const log = (text: string) => setEvents((e) => [...e, { when: "3 Oct 2026, " + new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }), text }]);
  const addOverlay = (kind: "text" | "image") => {
    setOverlays((o) => [...o, { id: Date.now(), page, kind, text: kind === "text" ? "Double-click to edit" : "Image placeholder", x: 12 + (o.length % 5) * 8, y: 15 + (o.length % 5) * 10 }]);
    flash(kind === "text" ? "Text box added" : "Image placeholder added");
  };
  const download = (name: string, body: string, type = "text/plain") => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  };
  const copyLink = async () => {
    const link = `https://albumpro.app/proof/${order.id}/${Math.random().toString(36).slice(2, 10)}`;
    try { await navigator.clipboard.writeText(link); } catch { /* clipboard may be unavailable */ }
    flash("Secure proof link copied: " + link);
    log("Secure proof link generated");
  };
  const saveAction = (k: "draft" | "version" | "discard") => {
    setSaveMenu(false);
    if (k === "draft") { flash("Draft saved"); log("Draft saved"); }
    else if (k === "version") { setVersions((v) => v + 1); flash(`Saved as version v${versions + 1}`); log(`Saved as version v${versions + 1}`); }
    else { setOverlays([]); setBg({}); setTpl(0); setHistory([0]); setHIdx(0); flash("Unsaved changes discarded"); }
  };

  const applyTpl = (i: number) => {
    setTpl(i);
    setHistory((h) => [...h.slice(0, hIdx + 1), i]);
    setHIdx((x) => x + 1);
  };
  const undo = () => { if (hIdx > 0) { setHIdx(hIdx - 1); setTpl(history[hIdx - 1]!); } };
  const redo = () => { if (hIdx < history.length - 1) { setHIdx(hIdx + 1); setTpl(history[hIdx + 1]!); } };

  const spreadIdxs = useMemo(() => Array.from({ length: spreads }, (_, i) => i), [spreads]);
  const pageNo = page === 0 ? 1 : page * 2;

  const canSend = status === "In Designing" || status === "Corrections Requested";
  const send = () => {
    if (!canSend) return;
    if (openCorr > 0 && status === "Corrections Requested") { flash("Resolve open corrections first"); return; }
    setStatus("With Client"); flash("Proof sent to client for review");
  };

  const tools: { I: typeof Type; l: string; run: () => void }[] = [
    { I: Type, l: "Add Text", run: () => addOverlay("text") },
    { I: ImageIcon, l: "Add Image", run: () => addOverlay("image") },
    { I: LayoutGrid, l: "Templates", run: () => { setTplTab("Design Templates"); flash("Showing design templates"); } },
    { I: Brush, l: "Background", run: () => setBgOpen((v) => !v) },
  ];
  const details = [
    { I: Ruler, l: "Album Size", v: `${order.size} (Landscape)` },
    { I: FileText, l: "Total Pages", v: String(order.pages) },
    { I: BookOpen, l: "Current Page", v: String(pageNo) },
    { I: Palette, l: "Design Style", v: TEMPLATES[tpl]! },
    { I: User, l: "Designer", v: "Ramesh" },
    { I: Clock, l: "Created On", v: "1 Oct 2026, 10:24 AM" },
    { I: History, l: "Last Updated", v: "3 Oct 2026, 04:15 PM" },
  ];

  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs text-sub">
        <Link to="/orders" className="hover:underline">Orders</Link> &gt; <span>{order.id}</span> &gt; <span className="font-semibold text-ink">Album Designing</span>
      </div>
      <PageHeader title="Album Designing" subtitle="Create beautiful stories with professional album designs">
        <div className="hidden items-center gap-6 rounded-xl border border-line bg-white px-4 py-2 text-[13px] 2xl:flex">
          {[["Order ID", order.id, true], ["Client", order.customer, false], ["Event", order.event, false], ["Size", order.size, false], ["Pages", String(order.pages), false]].map(([l, v, b]) => (
            <div key={String(l)}><div className="text-[11px] text-sub">{l}</div><div className={cx("font-semibold", b ? "text-brand" : "text-ink")}>{v}</div></div>
          ))}
        </div>
        <div className="flex">
          <button onClick={() => flash("Progress saved")} className="inline-flex h-11 items-center gap-2 rounded-l-xl bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark"><Save className="size-4" />Save Progress</button>
          <div className="relative">
            <button aria-label="Save options" onClick={() => setSaveMenu((v) => !v)} onBlur={() => setTimeout(() => setSaveMenu(false), 150)} className="grid h-11 w-10 place-items-center rounded-r-xl border-l border-white/30 bg-brand text-white hover:bg-brand-dark"><ChevronDown className="size-4" /></button>
            {saveMenu && (
              <div className="absolute right-0 top-12 z-40 w-48 rounded-xl border border-line bg-white p-1.5 shadow-xl">
                {([["Save draft", "draft"], ["Save as new version", "version"], ["Discard changes", "discard"]] as const).map(([l, k]) => <button key={k} onMouseDown={() => saveAction(k)} className="block w-full rounded-lg px-3 py-2 text-left text-[13px] font-semibold hover:bg-brand-soft">{l}</button>)}
              </div>
            )}
          </div>
        </div>
        <MoreButton />
      </PageHeader>

      {toast && <div className="fixed right-6 top-6 z-50 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-xl">{toast}</div>}

      <div className="grid grid-cols-[170px_minmax(0,1fr)_340px] gap-4">
        <Panel className="flex max-h-[760px] flex-col" bodyClassName="flex min-h-0 flex-1 flex-col p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-extrabold">Pages ({order.pages})</h3>
            <button onClick={() => { setPagesAdded((n) => n + 1); flash("Page spread added"); }} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-bold text-brand"><Plus className="size-3" />Add</button>
          </div>
          <div className="scroll-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
            {spreadIdxs.map((i) => (
              <button key={i} onClick={() => setPage(i)} className={cx("w-full rounded-xl border-2 p-1.5 text-left", page === i ? "border-brand bg-brand-soft" : "border-transparent bg-slate-50 hover:border-line")}>
                <div className="flex h-[64px] gap-0.5 overflow-hidden rounded-md">
                  <div className="flex-1"><PageArt seed={i} /></div>
                  {i > 0 && <div className="flex-1"><PageArt seed={i + 3} mirror /></div>}
                </div>
                <div className="mt-1 flex gap-2 text-[11px]"><b>{i + 1}</b><span className="text-sub">{SPREAD_LABELS[i] ?? `Spread ${i}`}</span></div>
              </button>
            ))}
          </div>
        </Panel>

        <div className="min-w-0 space-y-4">
          <Panel bodyClassName="p-3">
            <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-sub">
              <div className="flex gap-1">
                <button onClick={undo} disabled={hIdx === 0} className="grid h-12 w-12 place-items-center rounded-lg hover:bg-slate-100 disabled:opacity-35"><Undo2 className="size-4 text-ink" />Undo</button>
                <button onClick={redo} disabled={hIdx >= history.length - 1} className="grid h-12 w-12 place-items-center rounded-lg hover:bg-slate-100 disabled:opacity-35"><Redo2 className="size-4 text-ink" />Redo</button>
                <button onClick={() => setZoom(85)} className="grid h-12 w-12 place-items-center rounded-lg hover:bg-slate-100"><Maximize className="size-4 text-ink" />Fit</button>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-line p-1 text-sm font-bold text-ink">
                <button aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(40, z - 10))} className="grid size-7 place-items-center rounded hover:bg-slate-100"><Minus className="size-4" /></button>
                <span className="w-12 text-center">{zoom}%</span>
                <button aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(150, z + 10))} className="grid size-7 place-items-center rounded hover:bg-slate-100"><Plus className="size-4" /></button>
              </div>
              <div className="flex items-center gap-2 text-sm">
                Page
                <button aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)} className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-40"><ChevronLeft className="size-4" /></button>
                <span className="font-semibold text-ink">{pageNo} / {order.pages}</span>
                <button aria-label="Next page" disabled={page >= spreads - 1} onClick={() => setPage(page + 1)} className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-40"><ChevronRight className="size-4" /></button>
              </div>
              <div className="ml-auto flex gap-1">
                {tools.map(({ I, l, run }) => (
                  <button key={l} onClick={run} className={cx("grid h-12 min-w-14 place-items-center rounded-lg px-1.5 hover:bg-slate-100", l === "Background" && bgOpen && "bg-brand-soft")}><I className="size-4 text-ink" />{l}</button>
                ))}
              </div>
            </div>
            {bgOpen && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-slate-50 p-2.5 text-[12px] font-semibold">
                Spread background
                {BG_SWATCHES.map((c) => (
                  <button key={c} aria-label={`Background ${c}`} onClick={() => { setBg((b) => ({ ...b, [page]: c })); flash("Background changed"); }} className={cx("size-7 rounded-full border-2", bg[page] === c ? "border-brand" : "border-line")} style={{ background: c }} />
                ))}
                <button onClick={() => { setBg((b) => { const n = { ...b }; delete n[page]; return n; }); }} className="ml-auto text-xs font-bold text-brand">Reset</button>
              </div>
            )}
            <div className="grid h-[430px] place-items-center overflow-hidden rounded-xl bg-slate-200/70">
              <div data-testid="canvas" className="relative flex aspect-[2/1] w-[88%] max-w-[760px] origin-center overflow-hidden rounded shadow-2xl transition-transform" style={{ transform: `scale(${zoom / 85})`, background: bg[page] }}>
                <div className="relative flex-1 border-r border-black/10">
                  <PageArt seed={page + tpl} />
                  {page === 0 && (
                    <div className="absolute inset-x-0 bottom-6 text-center font-serif italic text-white drop-shadow">
                      <div className="text-2xl">Our Wedding Story</div>
                      <div className="mt-1 text-[10px] not-italic tracking-[0.25em]">{order.customer.toUpperCase()}</div>
                    </div>
                  )}
                </div>
                <div className="relative flex-1"><PageArt seed={page + tpl + 3} mirror /></div>
                {overlays.filter((o) => o.page === page).map((o) => (
                  <div key={o.id} className="absolute" style={{ left: `${o.x}%`, top: `${o.y}%` }}>
                    {o.kind === "text" ? (
                      <div className="group flex items-center gap-1 rounded border border-dashed border-brand bg-white/70 px-1.5 py-0.5">
                        <input aria-label="Text overlay" value={o.text} onChange={(e) => setOverlays((l) => l.map((x) => x.id === o.id ? { ...x, text: e.target.value } : x))} className="w-36 bg-transparent font-serif text-sm outline-none" />
                        <button aria-label="Remove overlay" onClick={() => setOverlays((l) => l.filter((x) => x.id !== o.id))} className="text-xs text-rose-600">✕</button>
                      </div>
                    ) : (
                      <div className="relative"><Thumb seed={o.id} size={64} /><button aria-label="Remove overlay" onClick={() => setOverlays((l) => l.filter((x) => x.id !== o.id))} className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-rose-500 text-[9px] text-white">✕</button></div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel bodyClassName="p-4">
            <div className="mb-3 flex items-center justify-between border-b border-line">
              <div className="flex gap-5 overflow-x-auto">
                {TPL_TABS.map((t) => (
                  <button key={t} onClick={() => setTplTab(t)} className={cx("-mb-px whitespace-nowrap border-b-2 pb-2 text-[13px] font-bold", t === tplTab ? "border-brand text-brand" : "border-transparent text-sub")}>{t}</button>
                ))}
              </div>
              <LinkAction onClick={() => { setTplTab("Design Templates"); setTpl((t) => (t + 1) % TEMPLATES.length); flash(`Browsing all ${TEMPLATES.length} templates in ${tplTab}`); }}>View All →</LinkAction>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {TEMPLATES.map((t, i) => (
                <button key={t} onClick={() => applyTpl(i)} className="w-[92px] shrink-0 text-center">
                  <div className={cx("overflow-hidden rounded-lg border-2", tpl === i ? "border-brand" : "border-transparent")}><Thumb seed={i + 1} size={0} rounded="rounded-none" className="!h-14 !w-full" /></div>
                  <div className={cx("mt-1 text-[11px] font-semibold", tpl === i ? "text-brand" : "text-sub")}>{t}</div>
                </button>
              ))}
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel bodyClassName="p-4">
            <LineTabs className="mb-4 gap-4" value={rTab} onChange={setRTab} tabs={[{ key: "details", label: "Design Details" }, { key: "comments", label: "Client Comments" }, { key: "corrections", label: `Corrections (${openCorr})` }]} />
            {rTab === "details" && (
              <div>
                <div className="mb-3 flex items-center gap-3 border-b border-line pb-3">
                  <Thumb seed={order.id} size={52} />
                  <div><div className="font-extrabold">Wedding Album - {order.customer}</div><div className="text-xs text-sub">{order.id}</div></div>
                </div>
                {details.map(({ I, l, v }) => (
                  <div key={l} className="flex items-center gap-3 py-2 text-[13px]">
                    <I className="size-4 text-sub" /><span className="w-24 text-sub">{l}</span>
                    {l === "Designer" ? <span className="flex items-center gap-2 font-semibold"><Avatar name="Ramesh" size={22} />{v}</span> : <span className="font-semibold">{v}</span>}
                  </div>
                ))}
              </div>
            )}
            {rTab === "comments" && (
              <div className="space-y-3">
                {COMMENTS.map((c, i) => (
                  <div key={i} className="rounded-xl border border-line p-3 text-[13px]">
                    <div className="flex items-center gap-2"><Avatar name={c.by} size={24} /><b>{c.by}</b><Pill tone="indigo" className="ml-auto">Page {c.page}</Pill></div>
                    <p className="mt-2">{c.text}</p><div className="mt-1 text-xs text-sub">{c.when}</div>
                  </div>
                ))}
              </div>
            )}
            {rTab === "corrections" && (
              <div className="space-y-3">
                {corrections.map((c) => (
                  <div key={c.id} className="rounded-xl border border-line p-3 text-[13px]">
                    <div className="flex items-center gap-2"><b>{c.id}</b><span className="text-xs text-sub">Page {c.page} - {c.by}</span>
                      <Pill className="ml-auto" tone={c.status === "Resolved" ? "green" : c.status === "Open" ? "red" : "amber"}>{c.status}</Pill></div>
                    <p className="mt-2">{c.text}</p>
                    {c.status !== "Resolved" && (
                      <div className="mt-2 flex gap-2">
                        {c.status === "Open" && <OutlineButton onClick={() => setCorrections((cs) => cs.map((x) => x.id === c.id ? { ...x, status: "In Progress" } : x))}>Start</OutlineButton>}
                        <OutlineButton onClick={() => setCorrections((cs) => cs.map((x) => x.id === c.id ? { ...x, status: "Resolved" } : x))}>Mark Resolved</OutlineButton>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Deadline & Status" action={<LinkAction onClick={() => setTimelineOpen(true)}>View Timeline</LinkAction>} bodyClassName="p-4">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand"><CalendarDays className="size-5" /></div>
              <div className="flex-1"><div className="text-xs text-sub">Due Date</div><div className="font-extrabold text-rose-600">{fmtDate("2026-10-10")}</div></div>
              <Pill tone={STATUS_TONE[status]}>{status}</Pill>
            </div>
            <div className="mt-3 flex items-center gap-3"><ProgressBar value={STATUS_PROGRESS[status]} tone="green" /><b className="text-xs text-emerald-600">{STATUS_PROGRESS[status]}%</b></div>
            <button onClick={send} disabled={!canSend} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand text-sm font-bold text-white hover:bg-brand-dark disabled:bg-slate-300">
              <CheckCircle2 className="size-4" />{canSend ? "Send for Client Review" : status === "With Client" ? "Awaiting Client" : status}
            </button>
            {status === "With Client" && (
              <div className="mt-2 flex gap-2">
                <OutlineButton className="flex-1 justify-center" onClick={() => setStatus("Approved")}>Client Approved</OutlineButton>
                <OutlineButton className="flex-1 justify-center" onClick={() => { setStatus("Corrections Requested"); setCorrections((c) => [...c, { id: `COR-00${c.length + 1}`, page: pageNo, text: "Client requested change on this page.", by: "Client", status: "Open" }]); setRTab("corrections"); }}>Request Correction</OutlineButton>
              </div>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <OutlineButton className="h-10 justify-center" icon={Download} onClick={() => { download(`${order.id}-proof.txt`, `Album proof\nOrder: ${order.id}\nClient: ${order.customer}\nPages: ${order.pages}\nTemplate: ${TEMPLATES[tpl]}\nStatus: ${status}\n`); flash("Proof downloaded"); log("Proof downloaded"); }}>Download Proof</OutlineButton>
              <OutlineButton className="h-10 justify-center" icon={Link2} onClick={copyLink}>Share Link</OutlineButton>
            </div>
          </Panel>

          <Panel title="Quick Notes" action={<LinkAction onClick={() => setAdding((a) => !a)}>Add Note</LinkAction>} bodyClassName="p-4">
            {adding && (
              <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!noteDraft.trim()) return; if (editNote !== null) { setNotes(notes.map((n, i) => i === editNote ? { ...n, text: noteDraft } : n)); setEditNote(null); flash("Note updated"); } else { setNotes([{ text: noteDraft, by: "Admin", when: "just now" }, ...notes]); flash("Note added"); } setNoteDraft(""); setAdding(false); }}>
                <input autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Write a note..." className="h-9 min-w-0 flex-1 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand" />
                <button className="rounded-lg bg-brand px-3 text-xs font-bold text-white">Save</button>
              </form>
            )}
            <div className="max-h-40 space-y-2 overflow-y-auto">
              {notes.map((n, i) => (
                <div key={i} className="flex gap-3 rounded-xl border border-line p-3 text-[13px]">
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600"><StickyNote className="size-4" /></div>
                  <div className="min-w-0 flex-1"><p>{n.text}</p><div className="mt-1 text-xs text-sub">By {n.by} - {n.when}</div></div>
                  <div className="relative">
                    <button aria-label="Note options" onClick={() => setNoteMenu(noteMenu === i ? null : i)} onBlur={() => setTimeout(() => setNoteMenu(null), 150)}><MoreVertical className="size-4 text-sub" /></button>
                    {noteMenu === i && (
                      <div className="absolute right-0 top-6 z-30 w-28 rounded-xl border border-line bg-white p-1 shadow-xl">
                        <button onMouseDown={() => { setEditNote(i); setNoteDraft(n.text); setAdding(true); setNoteMenu(null); }} className="block w-full rounded-lg px-3 py-1.5 text-left text-xs font-semibold hover:bg-brand-soft">Edit</button>
                        <button onMouseDown={() => { setNotes(notes.filter((_, j) => j !== i)); setNoteMenu(null); flash("Note deleted"); }} className="block w-full rounded-lg px-3 py-1.5 text-left text-xs font-semibold text-rose-600 hover:bg-brand-soft">Delete</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      <SlideOver open={timelineOpen} onClose={() => setTimelineOpen(false)} title="Status Timeline">
        <ol className="space-y-4 border-l-2 border-line pl-4">
          {[...events, { when: "Now", text: `Current status: ${status}` }].map((e, i) => (
            <li key={i} className="relative text-[13px]">
              <span className="absolute -left-[23px] top-1 size-3 rounded-full bg-brand" />
              <div className="font-semibold">{e.text}</div><div className="text-xs text-sub">{e.when}</div>
            </li>
          ))}
        </ol>
      </SlideOver>
    </div>
  );
}

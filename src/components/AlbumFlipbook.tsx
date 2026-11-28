import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Maximize2, Minimize2, RectangleVertical, RotateCcw, ScrollText, X, ZoomIn, ZoomOut } from "lucide-react";

type Sheet = { src: string; side: "left" | "right" | "full" | "blank"; img: number };

/** A real-feel album: sheets turn with a curl and shadow (page-flip). Each image is looked at on its own: a wide image is a
 *  spread and is split into its left and right sheets (the open book shows the whole spread), a portrait image (the cover,
 *  a back cover) is a single sheet. Double = the open book (two sheets side by side); Single = one sheet at a time.
 *  The book is sized to fit the space there is (width and height) and re-fits on resize / full screen. */
export function AlbumFlipbook(props: { pages: string[]; spreads?: boolean; onPage?: (image: number, kind: "Cover" | "Page" | "Spread") => void; goTo?: { image: number; n: number }; compact?: boolean }) {
  const { goTo, compact } = props;
  const key = props.pages.join("\n");
  const pages = useMemo(() => props.pages, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const onPageRef = useRef(props.onPage); onPageRef.current = props.onPage;
  const onPage = (n: number, k: "Cover" | "Page" | "Spread") => onPageRef.current?.(n, k);
  const cache = useRef<HTMLImageElement[]>([]);              // decoded images kept alive, so turning a page never re-decodes one
  const host = useRef<HTMLDivElement>(null);
  const flip = useRef<{ flipNext(): void; flipPrev(): void; flip(i: number): void; turnToPage(i: number): void; destroy(): void; getPageCount(): number } | null>(null);
  const sheetsRef = useRef<Sheet[]>([]);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [dims, setDims] = useState<{ w: number; h: number }[] | null>(null);
  const [at, setAt] = useState(0);
  const [full, setFull] = useState(false);
  const [mode, setMode] = useState<"double" | "single" | "scroll">("double");
  const [dbl, setDbl] = useState(true);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [scrollAt, setScrollAt] = useState(0);                // scroll view: the image in view
  const scroller = useRef<HTMLDivElement>(null);
  const kindOf = (i: number): "Cover" | "Page" | "Spread" => { const d = dims?.[i]; const wide = d ? d.w / d.h > 1.3 : true; return wide ? "Spread" : i === 0 ? "Cover" : "Page"; };
  const scrollTo = (i: number) => { const el = scroller.current?.querySelector<HTMLElement>(`[data-img="${i}"]`); el?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  // scroll view: follow the image in view
  useEffect(() => {
    const root = scroller.current; if (mode !== "scroll" || !root) return;
    const io = new IntersectionObserver((es) => {
      const best = es.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (best) { const i = Number((best.target as HTMLElement).dataset.img); setScrollAt(i); onPage(i + 1, kindOf(i)); }
    }, { root, threshold: [0.35, 0.6, 0.9] });
    root.querySelectorAll("[data-img]").forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [mode, key, dims]); // eslint-disable-line react-hooks/exhaustive-deps
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 1200 : window.innerWidth));
  const atRef = useRef(0);
  useEffect(() => { let t = 0; const r = () => { clearTimeout(t); t = window.setTimeout(() => setVw(window.innerWidth + window.innerHeight / 10000), 150); }; window.addEventListener("resize", r); return () => { window.removeEventListener("resize", r); clearTimeout(t); }; }, []);

  // the size of every image: wide ones are spreads, the others single sheets
  useEffect(() => {
    if (!pages.length) return;
    let alive = true;
    const imgs = pages.map((src) => { const i = new Image(); i.decoding = "async"; i.src = src; return i; });
    cache.current = imgs;
    void Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => undefined) : Promise.resolve()).then(() => ({ w: i.naturalWidth || 1000, h: i.naturalHeight || 1000 }))))
      .then((d) => { if (alive) setDims(d); });
    return () => { alive = false; };
  }, [pages]);

  useEffect(() => {
    const el = host.current; if (!el || !dims || !pages.length || mode === "scroll") return;
    let alive = true;
    void import("page-flip").then(({ PageFlip }) => {
      if (!alive) return;
      el.innerHTML = "";
      const wide = (i: number) => dims[i]!.w / dims[i]!.h > 1.3;
      const cover = !wide(0);                                                      // a single first image is the cover, shown alone
      // the sheet's shape: half of a spread (the common case), else the single images' own shape
      const shapes = pages.map((_, i) => (wide(i) ? dims[i]!.w / 2 / dims[i]!.h : dims[i]!.w / dims[i]!.h)).filter((_, i) => wide(i) || !pages.some((__, j) => wide(j)));
      const a = [...shapes].sort((x, y) => x - y)[Math.floor(shapes.length / 2)] ?? 1;
      // sheets in book order; a spread's left half must land on a left-hand page (with a cover, left pages are 1, 3, 5…)
      const isLeft = (i: number) => (cover ? i % 2 === 1 : i % 2 === 0);
      const sheets: Sheet[] = [];
      pages.forEach((src, i) => {
        if (wide(i)) { if (!isLeft(sheets.length)) sheets.push({ src: "", side: "blank", img: i }); sheets.push({ src, side: "left", img: i }, { src, side: "right", img: i }); }
        else sheets.push({ src, side: "full", img: i });
      });
      sheetsRef.current = sheets; setSheets(sheets);

      // fit the book in the space there is; never taller than the box
      const W = Math.max(200, el.clientWidth), H = Math.max(280, full ? window.innerHeight - 110 : window.innerHeight - (compact ? 190 : 230));   // as big as the screen allows
      const double = mode === "double" && W >= 520; setDbl(double);
      const ph = Math.floor(Math.min(H, double ? W / (2 * a) : W / a)), pw = Math.floor(ph * a);
      const book = document.createElement("div"); book.style.margin = "0 auto"; book.style.width = `${double ? pw * 2 : pw}px`; book.style.transition = "transform .5s ease"; book.style.boxShadow = full ? "none" : "0 18px 40px -12px rgba(20,20,40,.45)"; el.appendChild(book);
      // a sheet shown alone (the cover, a last single sheet) sits in the middle instead of on one half
      const centre = (i: number, n: number) => { book.style.transform = !double ? "" : cover && i === 0 ? `translateX(-${pw / 2}px)` : i === n - 1 && isLeft(i) ? `translateX(${pw / 2}px)` : ""; };
      const nodes = sheets.map((s, i) => {
        const d = document.createElement("div");
        d.className = "ipd-page"; d.style.backfaceVisibility = "hidden";
        d.setAttribute("data-density", s.side === "full" && (i === 0 || i === sheets.length - 1) ? "hard" : "soft");
        // page-flip rewrites the page's own style, so the picture sits on an inner layer
        const face = document.createElement("div");
        Object.assign(face.style, { position: "absolute", inset: "0", backfaceVisibility: "hidden", transform: "translateZ(0)", willChange: "transform", backgroundColor: s.side === "full" || s.side === "blank" ? (full ? "#24201c" : "#eef0f5") : "#fff",
          backgroundImage: s.src ? `url("${s.src}")` : "none", backgroundRepeat: "no-repeat",
          backgroundSize: s.side === "full" ? "contain" : "200% 100%", backgroundPosition: s.side === "left" ? "left center" : s.side === "right" ? "right center" : "center",
          boxShadow: s.side === "left" ? "inset -18px 0 24px -18px rgba(0,0,0,.35)" : s.side === "right" ? "inset 18px 0 24px -18px rgba(0,0,0,.35)" : "none" });
        face.setAttribute("data-page", String(i + 1));
        d.appendChild(face); book.appendChild(d); return d;
      });
      const pf = new PageFlip(book, { width: pw, height: ph, size: "fixed", showCover: cover, maxShadowOpacity: 0.5, mobileScrollSupport: true, usePortrait: !double, autoSize: false, drawShadow: true, flippingTime: 800 });
      pf.loadFromHTML(nodes);
      pf.on("flip", (e: { data: unknown }) => { const i = Number(e.data); atRef.current = i; setAt(i); centre(i, pf.getPageCount()); const sh = sheets[i]?.side === "blank" ? sheets[i + 1] : sheets[i]; const im = sh?.img ?? 0; onPage?.(im + 1, sh?.side === "full" ? (im === 0 ? "Cover" : "Page") : "Spread"); });
      flip.current = pf as never;
      if (atRef.current > 0) pf.turnToPage(Math.min(atRef.current, pf.getPageCount() - 1));            // re-fitted: stay on the same sheet
      setAt(atRef.current); centre(atRef.current, pf.getPageCount());
      { const sh = sheets[atRef.current]; const im = sh?.img ?? 0; onPage?.(im + 1, sh?.side === "full" ? (im === 0 ? "Cover" : "Page") : "Spread"); }
    });
    return () => { alive = false; try { flip.current?.destroy(); } catch { /* already gone */ } flip.current = null; };
  }, [pages, dims, full, vw, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // turn to an image (1-based) asked for from outside, e.g. a page thumbnail clicked
  useEffect(() => {
    if (!goTo) return;
    if (mode === "scroll") { scrollTo(goTo.image - 1); return; }
    if (!flip.current) return;
    const i = sheetsRef.current.findIndex((s) => s.img === goTo.image - 1 && s.side !== "blank");
    try { flip.current.flip(Math.max(0, i)); } catch { /* not ready yet */ }
  }, [goTo?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "ArrowRight") flip.current?.flipNext(); if (e.key === "ArrowLeft") flip.current?.flipPrev(); if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);

  if (!pages.length) return <div className="grid h-64 place-items-center rounded-2xl bg-slate-100 text-sm text-sub">No pages to show</div>;
  // where we are: the image of the sheet open on the left (or alone)
  const s = sheets[at]?.side === "blank" ? sheets[at + 1] : sheets[at] ?? sheets[at + 1];
  const img = mode === "scroll" ? scrollAt : s?.img ?? 0;
  const kind = mode === "scroll" ? kindOf(img) : s?.side === "full" ? (img === 0 ? "Cover" : "Page") : "Spread";
  const label = kind === "Cover" ? `Cover · 1 of ${pages.length}` : `${kind} ${img + 1} of ${pages.length}${!dbl && (s?.side === "left" || s?.side === "right") ? ` · ${s.side}` : ""}`;
  const seg = "inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-bold";
  return (
    <div className={full ? "fixed inset-0 z-[60] flex flex-col bg-[#1d1a17] p-3 sm:p-5" : "relative"} data-testid="flipbook">
      <div className={full ? "mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 items-center" : "mx-auto w-full"}>
        <div ref={host} className={mode === "scroll" ? "hidden" : "w-full"} aria-label="Album pages — use the arrows or swipe to turn" />
        {mode === "scroll" && (
          <div ref={scroller} data-testid="album-scroll" className="scroll-thin mx-auto w-full snap-y snap-proximity space-y-4 overflow-y-auto scroll-smooth overscroll-contain pr-1"
            style={{ maxHeight: full ? "calc(100vh - 110px)" : compact ? "calc(100vh - 190px)" : "calc(100vh - 230px)" }}>
            {pages.map((src, i) => (
              <figure key={src} data-img={i} className="mx-auto snap-start" style={{ maxWidth: kindOf(i) === "Spread" ? "100%" : "min(100%, 560px)" }}>
                <img src={src} alt={`${kindOf(i)} ${i + 1}`} loading="lazy" decoding="async" className="w-full rounded-md bg-white shadow-xl" style={{ aspectRatio: dims?.[i] ? `${dims[i]!.w} / ${dims[i]!.h}` : undefined }} />
                <figcaption className={`mt-1 text-center text-[11px] ${full ? "text-white/60" : "text-sub"}`}>{kindOf(i) === "Cover" ? "Cover" : `${kindOf(i)} ${i + 1}`}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-center"><div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-[#24201c] px-2.5 py-1.5 text-white shadow-lg">
        <button type="button" aria-label="Previous page" onClick={() => (mode === "scroll" ? scrollTo(Math.max(0, scrollAt - 1)) : flip.current?.flipPrev())} className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"><ChevronLeft className="size-5" /></button>
        <span className="min-w-[150px] text-center text-sm font-semibold" data-testid="flip-position">{label}</span>
        <button type="button" aria-label="Next page" onClick={() => (mode === "scroll" ? scrollTo(Math.min(pages.length - 1, scrollAt + 1)) : flip.current?.flipNext())} className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"><ChevronRight className="size-5" /></button>
        <div className="ml-1 inline-flex rounded-lg bg-white/10 p-0.5" role="group" aria-label="Sheets shown">
          <button type="button" aria-pressed={mode === "single"} onClick={() => setMode("single")} className={`${seg} ${mode === "single" ? "bg-white text-ink" : "text-white hover:bg-white/10"}`}><RectangleVertical className="size-3.5" />Single</button>
          <button type="button" aria-pressed={mode === "scroll"} onClick={() => { atRef.current = Math.max(0, sheets.findIndex((x) => x.img === img)); setMode("scroll"); window.setTimeout(() => scrollTo(img), 60); }} className={`${seg} ${mode === "scroll" ? "bg-white text-ink" : "text-white hover:bg-white/10"}`}><ScrollText className="size-3.5" />Scroll</button>
          <button type="button" aria-pressed={mode === "double"} onClick={() => setMode("double")} className={`${seg} ${mode === "double" ? "bg-white text-ink" : "text-white hover:bg-white/10"}`}><BookOpen className="size-3.5" />Double</button>
        </div>
        <button type="button" aria-label="Zoom" title="Zoom in on this page" onClick={() => setZoomed(pages[img] ?? null)} className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"><ZoomIn className="size-4" /></button>
        <button type="button" aria-label={full ? "Exit full screen" : "Full screen"} onClick={() => setFull(!full)} className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20">{full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</button>
      </div></div>
      {zoomed && <ZoomView src={zoomed} title={label} onClose={() => setZoomed(null)} />}
    </div>
  );
}

/** Look closely at one page / spread: + / − buttons, mouse wheel or double-click to zoom; drag to move around. */
function ZoomView({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const [z, setZ] = useState(1); const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const set = (n: number) => { const v = Math.min(5, Math.max(1, Math.round(n * 10) / 10)); setZ(v); if (v === 1) setPos({ x: 0, y: 0 }); };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "+" || e.key === "=") set(z + 0.5); if (e.key === "-") set(z - 0.5); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); });
  const b = "grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20";
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black" role="dialog" aria-label="Zoom" data-testid="zoom-view">
      <div className="flex items-center gap-2 p-3 text-white">
        <b className="flex-1 truncate text-sm">{title}</b>
        <button type="button" aria-label="Zoom out" onClick={() => set(z - 0.5)} className={b}><ZoomOut className="size-4" /></button>
        <span className="w-14 text-center text-sm font-semibold" data-testid="zoom-level">{Math.round(z * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => set(z + 0.5)} className={b}><ZoomIn className="size-4" /></button>
        <button type="button" aria-label="Reset zoom" onClick={() => set(1)} className={b}><RotateCcw className="size-4" /></button>
        <button type="button" aria-label="Close zoom" onClick={onClose} className={b}><X className="size-5" /></button>
      </div>
      <div className="relative min-h-0 flex-1 touch-none overflow-hidden" style={{ cursor: z > 1 ? (drag.current ? "grabbing" : "grab") : "zoom-in" }}
        onWheel={(e) => set(z + (e.deltaY < 0 ? 0.25 : -0.25))}
        onDoubleClick={() => set(z > 1 ? 1 : 2.5)}
        onPointerDown={(e) => { if (z <= 1) return; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) setPos({ x: d.px + (e.clientX - d.x) / z, y: d.py + (e.clientY - d.y) / z }); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <img src={src} alt={title} draggable={false} className="absolute inset-0 m-auto max-h-full max-w-full select-none object-contain transition-transform duration-100"
          style={{ transform: `scale(${z}) translate(${pos.x}px, ${pos.y}px)` }} />
      </div>
      <p className="p-2 text-center text-[11px] text-white/60">Scroll or double-click to zoom · drag to move · Esc to close</p>
    </div>
  );
}

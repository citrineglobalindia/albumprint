import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from "lucide-react";

/** A real-feel album: pages turn with a curl and shadow (page-flip). For spreads (one wide image = left + right page) each
 *  spread is split into its two halves, so the open book shows the full spread; on a phone it shows one page at a time. */
export function AlbumFlipbook({ pages, spreads, onPage, goTo, compact }: { pages: string[]; spreads: boolean; onPage?: (spread: number) => void; goTo?: { image: number; n: number }; compact?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const flip = useRef<{ flipNext(): void; flipPrev(): void; destroy(): void; getCurrentPageIndex(): number; getPageCount(): number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [at, setAt] = useState(0); const [count, setCount] = useState(0);
  const [full, setFull] = useState(false);
  const [vw, setVw] = useState(() => (typeof window === "undefined" ? 1200 : window.innerWidth));
  const atRef = useRef(0);
  const [dbl, setDbl] = useState(true);
  useEffect(() => { let t = 0; const r = () => { clearTimeout(t); t = window.setTimeout(() => setVw(window.innerWidth + window.innerHeight / 10000), 150); }; window.addEventListener("resize", r); return () => { window.removeEventListener("resize", r); clearTimeout(t); }; }, []);

  // the page size comes from the first image (a spread's half is half its width)
  useEffect(() => {
    if (!pages.length) return;
    const img = new Image();
    img.onload = () => setSize({ w: spreads ? img.naturalWidth / 2 : img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setSize({ w: 600, h: 600 });
    img.src = pages[0]!;
  }, [pages, spreads]);

  useEffect(() => {
    const el = host.current; if (!el || !size || !pages.length) return;
    let alive = true;
    void import("page-flip").then(({ PageFlip }) => {
      if (!alive) return;
      el.innerHTML = "";
      // fit the book in the space there is: two pages side by side when wide enough, else one page; never taller than the box
      const W = Math.max(200, el.clientWidth), H = Math.max(200, full ? window.innerHeight - 110 : Math.min(window.innerHeight * (compact ? 0.58 : 0.72), compact ? 560 : 760));
      const a = size.w / size.h, double = W >= 640; setDbl(double);
      const ph = Math.floor(Math.min(H, double ? W / (2 * a) : W / a)), pw = Math.floor(ph * a);
      const book = document.createElement("div"); book.style.margin = "0 auto"; book.style.width = `${double ? pw * 2 : pw}px`; book.style.transition = "transform .5s ease"; el.appendChild(book);
      // a closed book (front or back cover, single pages) sits in the middle instead of on one half
      const centre = (i: number, n: number) => { book.style.transform = !double || spreads ? "" : i === 0 ? `translateX(-${pw / 2}px)` : i >= n - 1 && n % 2 === 0 ? `translateX(${pw / 2}px)` : ""; };
      const halves = spreads ? pages.flatMap((src) => [{ src, side: "left" }, { src, side: "right" }]) : pages.map((src) => ({ src, side: "full" }));
      const nodes = halves.map(({ src, side }, i) => {
        const d = document.createElement("div");
        d.className = "ipd-page";
        d.setAttribute("data-density", spreads ? "soft" : i === 0 || i === halves.length - 1 ? "hard" : "soft");
        // page-flip rewrites the page's own style, so the picture sits on an inner layer
        const face = document.createElement("div");
        Object.assign(face.style, { position: "absolute", inset: "0", backgroundColor: "#fff", backgroundImage: `url("${src}")`, backgroundRepeat: "no-repeat",
          backgroundSize: side === "full" ? "contain" : "200% 100%", backgroundPosition: side === "left" ? "left center" : side === "right" ? "right center" : "center",
          boxShadow: side === "left" ? "inset -18px 0 24px -18px rgba(0,0,0,.35)" : side === "right" ? "inset 18px 0 24px -18px rgba(0,0,0,.35)" : "none" });
        face.setAttribute("data-page", String(i + 1));
        d.appendChild(face); book.appendChild(d); return d;
      });
      const pf = new PageFlip(book, {
        width: pw, height: ph, size: "fixed",
        showCover: !spreads, maxShadowOpacity: 0.5, mobileScrollSupport: true, usePortrait: !double, autoSize: false, drawShadow: true, flippingTime: 800,
      });
      pf.loadFromHTML(nodes);
      pf.on("flip", (e: { data: unknown }) => { const i = Number(e.data); atRef.current = i; setAt(i); centre(i, pf.getPageCount()); onPage?.(spreads ? Math.floor(i / 2) + 1 : i + 1); });
      flip.current = pf as never; setCount(pf.getPageCount());
      if (atRef.current > 0) pf.turnToPage(Math.min(atRef.current, pf.getPageCount() - 1));            // re-fitted: stay on the same page
      setAt(atRef.current); centre(atRef.current, pf.getPageCount());
    });
    return () => { alive = false; try { flip.current?.destroy(); } catch { /* already gone */ } flip.current = null; };
  }, [pages, spreads, size, full, vw]); // eslint-disable-line react-hooks/exhaustive-deps

  // turn to an image (1-based) asked for from outside, e.g. a page thumbnail clicked
  useEffect(() => {
    if (!goTo || !flip.current) return;
    const i = spreads ? (goTo.image - 1) * 2 : goTo.image - 1;
    try { (flip.current as unknown as { flip(i: number): void }).flip(Math.max(0, i)); } catch { /* not ready yet */ }
  }, [goTo?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "ArrowRight") flip.current?.flipNext(); if (e.key === "ArrowLeft") flip.current?.flipPrev(); if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);

  if (!pages.length) return <div className="grid h-64 place-items-center rounded-2xl bg-slate-100 text-sm text-sub">No pages to show</div>;
  const total = count || pages.length;
  const label = spreads ? `Spread ${Math.min(pages.length, Math.floor(at / 2) + 1)} of ${pages.length}`
    : dbl && at > 0 && at + 1 < total ? `Pages ${at + 1}–${at + 2} of ${total}` : `Page ${at + 1} of ${total}`;
  return (
    <div className={full ? "fixed inset-0 z-[60] flex flex-col bg-[#1d1a17] p-3 sm:p-6" : "rounded-2xl bg-gradient-to-b from-[#2b2622] to-[#1d1a17] p-3 sm:p-6"} data-testid="flipbook">
      <div className={full ? "mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 items-center" : "mx-auto w-full max-w-[1200px]"}>
        <div ref={host} className="w-full" aria-label="Album pages — use the arrows or swipe to turn" />
      </div>
      <div className="mt-3 flex items-center justify-center gap-3 text-white">
        <button type="button" aria-label="Previous page" onClick={() => flip.current?.flipPrev()} className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"><ChevronLeft className="size-5" /></button>
        <span className="min-w-[130px] text-center text-sm font-semibold" data-testid="flip-position">{label}</span>
        <button type="button" aria-label="Next page" onClick={() => flip.current?.flipNext()} className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20"><ChevronRight className="size-5" /></button>
        <button type="button" aria-label={full ? "Exit full screen" : "Full screen"} onClick={() => setFull(!full)} className="ml-2 grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20">{full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</button>
      </div>
    </div>
  );
}

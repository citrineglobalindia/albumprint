import { useState, type ReactNode } from "react";

/** Small fixed-position popover anchored to its trigger (escapes scrolling table wrappers). */
export function InlinePop({ trigger, title, children, label }: { trigger: ReactNode; title: string; label?: string; children: (close: () => void) => ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button type="button" aria-label={label ?? title} onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        setPos(pos ? null : { x: Math.max(8, Math.min(r.left, window.innerWidth - 256)), y: r.bottom + 280 > window.innerHeight ? Math.max(8, r.top - 150) : r.bottom + 4 });
      }} className="cursor-pointer rounded-full text-left hover:ring-2 hover:ring-brand/30">{trigger}</button>
      {pos && (
        <div className="fixed inset-0 z-[55]" onClick={(e) => { e.stopPropagation(); setPos(null); }}>
          <div role="menu" className="absolute w-60 rounded-xl border border-line bg-white p-2 text-left shadow-xl" style={{ left: pos.x, top: pos.y }} onClick={(e) => e.stopPropagation()}>
            <div className="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-sub">{title}</div>
            {children(() => setPos(null))}
          </div>
        </div>
      )}
    </>
  );
}

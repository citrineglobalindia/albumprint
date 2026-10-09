import { useState, type ReactNode } from "react";
import { MoreVertical } from "lucide-react";

export interface ActionItem { label: string; onClick: () => void; danger?: boolean; hidden?: boolean }

/** Kebab / custom-trigger dropdown that escapes overflow-x tables (fixed positioning). */
export function ActionMenu({ items, trigger, label = "More actions", width = 176 }: { items: ActionItem[]; trigger?: ReactNode; label?: string; width?: number }) {
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const visible = items.filter((i) => !i.hidden);
  return (
    <>
      <button
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const up = r.bottom + visible.length * 36 + 16 > window.innerHeight;
          setPos(pos ? null : { x: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), y: up ? r.top - 4 : r.bottom + 4, up });
        }}
        className="grid size-8 place-items-center rounded-lg text-sub hover:bg-slate-100"
      >
        {trigger ?? <MoreVertical className="size-4" />}
      </button>
      {pos && (
        <div className="fixed inset-0 z-[55]" onClick={(e) => { e.stopPropagation(); setPos(null); }}>
          <div role="menu" className="absolute rounded-xl border border-line bg-white p-1.5 text-left shadow-xl" style={{ left: pos.x, width, ...(pos.up ? { bottom: window.innerHeight - pos.y } : { top: pos.y }) }}>
            {visible.map((i) => (
              <button key={i.label} role="menuitem" onClick={(e) => { e.stopPropagation(); setPos(null); i.onClick(); }} className={`block w-full rounded-lg px-3 py-2 text-left text-[13px] font-semibold hover:bg-brand-soft ${i.danger ? "text-rose-600" : "text-ink"}`}>
                {i.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

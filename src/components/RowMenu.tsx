import { useState, type ComponentType } from "react";
import { MoreVertical } from "lucide-react";
import { cx } from "./ui";

export interface MenuItem { label: string; onClick: () => void; danger?: boolean; icon?: ComponentType<{ className?: string }> }

/** Row ⋮ action menu. Uses fixed positioning so it is never clipped by scrolling table wrappers. */
export function RowMenu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = () => setPos(null);
  return (
    <>
      <button
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const h = items.length * 36 + 12;
          setPos({ top: r.bottom + h > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4, left: Math.max(8, r.right - 192) });
        }}
        className="grid size-8 place-items-center rounded-lg text-sub hover:bg-slate-100"
      >
        <MoreVertical className="size-4" />
      </button>
      {pos && (
        <div className="fixed inset-0 z-[55]" onClick={(e) => { e.stopPropagation(); close(); }}>
          <div role="menu" className="fixed w-48 rounded-xl border border-line bg-white p-1.5 shadow-xl" style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}>
            {items.map((it) => (
              <button key={it.label} role="menuitem" onClick={() => { close(); it.onClick(); }} className={cx("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold", it.danger ? "text-rose-600 hover:bg-rose-50" : "hover:bg-brand-soft")}>
                {it.icon && <it.icon className="size-4" />}{it.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

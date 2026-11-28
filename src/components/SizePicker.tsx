import { useState } from "react";
import { cx, inputCls } from "./ui";
import { cleanSize, rememberSize, sizeOptions } from "../lib/sizes";

const CUSTOM = "__custom";

/** Album size: the size list plus "Custom…", which opens a box to type any size. A typed size is saved and offered in the
 *  list from then on, so it never needs typing again. */
export function SizePicker({ value, onChange, label = "Size", className }: { value: string; onChange: (v: string) => void; label?: string; className?: string }) {
  const opts = sizeOptions(value);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const commit = () => { const s = cleanSize(text); if (s) { rememberSize(s); onChange(s); } setTyping(false); };
  if (typing) return (
    <div className={cx("flex gap-1.5", className)}>
      <input autoFocus aria-label={`Custom ${label.toLowerCase()}`} className={inputCls} placeholder="e.g. 15x24" value={text} maxLength={40}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setTyping(false); }} />
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={commit} className="h-10 shrink-0 rounded-lg bg-brand px-3 text-xs font-bold text-white hover:bg-brand-dark">Save</button>
    </div>
  );
  return (
    <select aria-label={label} className={cx(inputCls, className)} value={value}
      onChange={(e) => { if (e.target.value === CUSTOM) { setText(""); setTyping(true); } else onChange(e.target.value); }}>
      <option value="">Select…</option>
      {opts.map((s) => <option key={s} value={s}>{s}</option>)}
      <option value={CUSTOM}>Custom size…</option>
    </select>
  );
}

import { useEffect, useState } from "react";
import { backendOn } from "../lib/supabase";
import { liveState, onLiveState, type LiveState } from "../lib/db/live";

/** Top bar: whether other people's changes are arriving live (Realtime) or by a short refresh. */
export function LiveBadge() {
  const [s, setS] = useState<LiveState>(liveState());
  useEffect(() => onLiveState(setS), []);
  if (!backendOn || s === "off") return null;
  const t = { live: ["Live", "bg-emerald-500", "Changes by others appear instantly"], connecting: ["Connecting", "bg-amber-400", "Connecting to live updates…"], polling: ["Auto-refresh", "bg-amber-500", "Live connection unavailable: refreshing every 10 seconds"] }[s];
  return (
    <span data-testid="live-badge" data-state={s} title={t[2]} className="hidden items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-bold text-sub sm:inline-flex">
      <span className={`size-2 rounded-full ${t[1]} ${s === "live" ? "animate-pulse" : ""}`} aria-hidden />{t[0]}
    </span>
  );
}

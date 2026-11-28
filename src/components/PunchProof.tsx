import { useEffect, useState } from "react";
import { Camera, MapPin } from "lucide-react";
import { mapLink, selfieUrl, type AttEvent } from "../lib/attendance";

/** The selfie and location saved with a punch, if any: a small photo (tap to open it full size) and a map link. */
export function PunchProof({ e }: { e: AttEvent }) {
  const [url, setUrl] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  useEffect(() => { let alive = true; if (e.selfie) void selfieUrl(e).then((u) => { if (alive) setUrl(u); }); return () => { alive = false; }; }, [e.selfie]); // eslint-disable-line react-hooks/exhaustive-deps
  const map = mapLink(e);
  if (!e.selfie && !map) return null;
  return (
    <span className="inline-flex items-center gap-2">
      {e.selfie && (url
        ? <button type="button" onClick={() => setBig(true)} aria-label="View selfie" className="size-7 overflow-hidden rounded-full ring-2 ring-white shadow"><img src={url} alt="" className="size-full object-cover" /></button>
        : <span className="inline-flex items-center gap-1 text-xs text-sub"><Camera className="size-3.5" />Selfie</span>)}
      {map && <a href={map} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand hover:underline" data-testid="punch-map"><MapPin className="size-3.5" />Location{e.accuracy != null ? ` (±${Math.round(e.accuracy)} m)` : ""}</a>}
      {big && url && (
        <div role="dialog" aria-label="Selfie" onClick={() => setBig(false)} className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4">
          <img src={url} alt="Selfie at punch" className="max-h-[80vh] max-w-full rounded-2xl" />
        </div>
      )}
    </span>
  );
}

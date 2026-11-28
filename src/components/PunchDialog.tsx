import { useEffect, useRef, useState } from "react";
import { Camera, MapPin, RotateCcw, X } from "lucide-react";
import { cx } from "./ui";
import type { PunchExtra } from "../lib/attendance";

type Loc = { lat: number; lng: number; accuracy: number };

/** Before a punch: an optional selfie (front camera) and the location. Neither is required — "Skip" goes ahead without a
 *  photo, and if the camera or location is refused the punch still goes through. */
export function PunchDialog({ title, action, onCancel, onPunch }: { title: string; action: string; onCancel: () => void; onPunch: (extra: PunchExtra) => Promise<void> | void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [cam, setCam] = useState<"starting" | "on" | "off">("starting");
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [locState, setLocState] = useState<"finding" | "ok" | "off">("finding");
  const [busy, setBusy] = useState(false);

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  const start = async () => {
    setCam("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera");
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
      stream.current = s;
      const v = video.current;
      if (v) {
        v.srcObject = s;
        if (!v.videoWidth) await new Promise<void>((ok) => { v.onloadedmetadata = () => ok(); setTimeout(ok, 4000); });
        await v.play().catch(() => undefined);
      }
      setCam("on");
    } catch { setCam("off"); }
  };
  useEffect(() => {
    void start();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => { setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }); setLocState("ok"); },
        () => setLocState("off"), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    } else setLocState("off");
    return () => { stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const take = () => {
    const v = video.current; if (!v || !v.videoWidth) return;
    const size = Math.min(v.videoWidth, v.videoHeight), c = document.createElement("canvas"); c.width = c.height = Math.min(640, size);
    const g = c.getContext("2d")!; g.translate(c.width, 0); g.scale(-1, 1);                  // mirror, like the preview
    g.drawImage(v, (v.videoWidth - size) / 2, (v.videoHeight - size) / 2, size, size, 0, 0, c.width, c.height);
    c.toBlob((b) => { if (b) { setShot({ blob: b, url: URL.createObjectURL(b) }); stop(); } }, "image/jpeg", 0.82);
  };
  const go = async (withPhoto: boolean) => {
    setBusy(true);
    await onPunch({ ...(withPhoto && shot ? { selfie: shot.blob } : {}), ...(loc ?? {}) });
    setBusy(false); stop();
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-3" role="dialog" aria-label={title} data-testid="punch-dialog">
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center gap-2"><h2 className="flex-1 text-base font-extrabold">{title}</h2><button type="button" aria-label="Close" onClick={() => { stop(); onCancel(); }} className="grid size-8 place-items-center rounded-full hover:bg-slate-100"><X className="size-4" /></button></div>

        <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl bg-slate-900">
          {shot ? <img src={shot.url} alt="Your selfie" className="size-full object-cover" data-testid="selfie-preview" />
            : <video ref={video} playsInline muted className={cx("size-full -scale-x-100 object-cover", cam !== "on" && "hidden")} />}
          {!shot && cam !== "on" && <div className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-white/80">{cam === "starting" ? "Opening the camera…" : "Camera not available — you can check in without a selfie."}</div>}
        </div>
        <div className="mt-2 flex justify-center gap-2">
          {!shot && <button type="button" disabled={cam !== "on"} onClick={take} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-40"><Camera className="size-4" />Take selfie</button>}
          {shot && <button type="button" onClick={() => { setShot(null); void start(); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold hover:bg-slate-50"><RotateCcw className="size-3.5" />Retake</button>}
        </div>

        <p className={cx("mt-3 flex items-center justify-center gap-1.5 text-xs", locState === "ok" ? "text-emerald-700" : "text-sub")} data-testid="punch-location">
          <MapPin className="size-3.5" />{locState === "finding" ? "Getting your location…" : locState === "ok" ? `Location added (±${loc!.accuracy} m)` : "Location not available — it is optional"}
        </p>

        <div className="mt-4 grid gap-2">
          <button type="button" disabled={busy} onClick={() => void go(true)} className="h-11 rounded-xl bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{action}{shot ? " with selfie" : ""}</button>
          {!shot && <button type="button" disabled={busy} onClick={() => void go(false)} className="h-10 rounded-xl text-xs font-bold text-sub hover:bg-slate-100">Skip selfie — {action.toLowerCase()}</button>}
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Aperture } from "lucide-react";
import { APP_NAME, DEVELOPER, LOGO_URL, LOGO_FULL_URL, LOGO_FULL_LIGHT_BG_URL } from "../lib/brand";

/** The round aperture symbol; falls back to a plain aperture icon when the file is missing or fails to load. */
export function BrandLogo({ size = 36 }: { size?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="grid shrink-0 place-items-center rounded-xl bg-brand text-white" style={{ width: size, height: size }}><Aperture style={{ width: size * 0.55, height: size * 0.55 }} aria-hidden /></span>;
  return <img src={LOGO_URL} alt="" width={size} height={size} onError={() => setBroken(true)} className="shrink-0 object-contain" style={{ width: size, height: size }} />;
}

/** The full logo ("INNOVATIVE PHOTO DESIGNERS"). `onLight` picks the version readable on a white background.
 *  Falls back to the symbol and the name in text if the image can't load. */
export function BrandWordmark({ height = 44, onLight = false, className = "" }: { height?: number; onLight?: boolean; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className={`flex items-center gap-2.5 ${className}`}><BrandLogo size={height} /><span className="text-[15px] font-extrabold leading-tight tracking-tight">{APP_NAME}</span></span>;
  return <img src={onLight ? LOGO_FULL_LIGHT_BG_URL : LOGO_FULL_URL} alt={APP_NAME} onError={() => setBroken(true)} className={`block w-auto max-w-full object-contain ${className}`} style={{ height }} />;
}

/** "Developed by: Stepstones" credit line. */
export function DevCredit({ className = "" }: { className?: string }) {
  return <p className={`text-xs ${className}`}>Developed by: <span className="font-semibold">{DEVELOPER}</span></p>;
}

import { useState } from "react";
import { Aperture } from "lucide-react";
import { APP_NAME, DEVELOPER, LOGO_URL } from "../lib/brand";

/** The business logo; falls back to the aperture mark when the logo file is missing or fails to load. */
export function BrandLogo({ size = 36 }: { size?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="grid shrink-0 place-items-center rounded-xl bg-brand text-white" style={{ width: size, height: size }}><Aperture style={{ width: size * 0.55, height: size * 0.55 }} aria-hidden /></span>;
  return <img src={LOGO_URL} alt={`${APP_NAME} logo`} width={size} height={size} onError={() => setBroken(true)} className="shrink-0 rounded-xl bg-white object-contain p-0.5" style={{ width: size, height: size }} />;
}

/** "Developed by: Stepstones" credit line. */
export function DevCredit({ className = "" }: { className?: string }) {
  return <p className={`text-xs ${className}`}>Developed by: <span className="font-semibold">{DEVELOPER}</span></p>;
}

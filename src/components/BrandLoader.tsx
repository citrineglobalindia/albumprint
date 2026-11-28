import { useState } from "react";
import { APP_NAME, LOGO_URL, LOGO_FULL_LIGHT_BG_URL } from "../lib/brand";

/** Full-screen branded loader (styles live in index.html so the very first paint, before any script, looks the same).
 *  It fades in after a short delay, so fast loads don't flash it. */
let firstOnThisPage = true;   // the first one continues the loader already on screen from index.html: no fade-in again

/** Client links (album preview, design proof) show just the studio logo while they open — not the app loader. */
const clientLink = () => typeof location !== "undefined" && /^\/(album|proof)\//.test(location.pathname);
export function BrandLoader({ text = "Loading your workspace" }: { text?: string }) {
  const [instant] = useState(() => { const v = firstOnThisPage; firstOnThisPage = false; return v; });
  const client = clientLink();
  if (client) text = location.pathname.startsWith("/album/") ? "Opening your album" : "Opening your design";
  return (
    <div className={`ipd-loader${instant ? " ipd-now" : ""}${client ? " ipd-client" : ""}`} role="status" aria-label={client ? text : `Loading ${APP_NAME}`} data-testid="brand-loader">
      <div className="ipd-stack">
        <div className="ipd-mark"><div className="ipd-glow" /><div className="ipd-track" /><div className="ipd-ring" /><div className="ipd-dot" /><img className="ipd-aperture" src={LOGO_URL} alt="" /></div>
        <img className="ipd-word" src={LOGO_FULL_LIGHT_BG_URL} alt={APP_NAME} />
        <div className="ipd-bar" />
        <div className="ipd-text">{text}</div>
      </div>
    </div>
  );
}

/** Business name and credits shown across the app (sidebar, login, page titles, PDFs). */
export const APP_NAME = "Innovative Photo Designers";
export const DEVELOPER = "Stepstones";
/** The round aperture symbol (sidebar fallback, small spaces). */
export const LOGO_URL = "/logo.png";
/** The full logo: orange "INNOVATIVE" with light-grey "PHOTO DESIGNERS", for dark backgrounds. */
export const LOGO_FULL_URL = "/logo-full.png";
/** The full logo with dark-grey "PHOTO DESIGNERS", for white backgrounds (login on phones, invoices, settings). */
export const LOGO_FULL_LIGHT_BG_URL = "/logo-full-dark-text.png";

/** The full logo as a data URL for PDFs (null when it can't be loaded). */
export async function logoDataUrl(): Promise<string | null> {
  try {
    const r = await fetch("/logo-invoice.jpg"); if (!r.ok) return null;
    const b = await r.blob();
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(null); fr.readAsDataURL(b); });
  } catch { return null; }
}

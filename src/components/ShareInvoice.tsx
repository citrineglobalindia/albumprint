import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Image as ImageIcon, MessageCircle, Share2 } from "lucide-react";
import { InvoiceView } from "./InvoiceView";
import { money } from "../lib/orderPricing";
import { downloadBlob } from "../lib/invoicePdf";
import type { InvoiceSnapshot } from "../lib/orders2";

/** Renders the invoice exactly as it appears on screen into a PNG (2× for sharp text on phones). */
export async function invoiceImage(s: InvoiceSnapshot, paid = 0): Promise<Blob> {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:820px;background:#fff;padding:16px;z-index:-1";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<InvoiceView s={s} paid={paid} />));
    await document.fonts?.ready;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const { toBlob } = await import("html-to-image");                     // the browser draws it, so every colour and font matches the screen
    const blob = await toBlob(host, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true, skipFonts: true,
      style: { position: "static", left: "0", top: "0", zIndex: "auto" } });   // drawn in place (not at the off-screen spot); web fonts from another site cannot be copied in, so text uses the standard font
    if (!blob) throw new Error("Could not create the image");
    return blob;
  } finally { root.unmount(); host.remove(); }
}

/** The message that goes with the invoice. The company name is left out when this invoice hides it. */
export function shareText(s: InvoiceSnapshot, paid = 0): string {
  const balance = Math.round((s.total - paid) * 100) / 100;
  const who = s.showBusinessName === false ? "" : s.business?.name ? `\n— ${s.business.name}` : "";
  return [`Invoice ${s.invoiceNumber ?? ""}${s.orderCode ? ` for order ${s.orderCode}` : ""}`.trim(), `Total: ${money(s.total)}`, paid > 0 ? `Paid: ${money(paid)} · Balance: ${money(balance)}` : `Amount due: ${money(balance)}`].join("\n") + who;
}
/** wa.me needs the number with the country code: a 10-digit Indian mobile gets 91 in front. */
export const waNumber = (phone?: string) => { const d = (phone ?? "").replace(/\D/g, ""); return d.length === 10 ? `91${d}` : d.length >= 11 ? d : ""; };

/** Share buttons for an issued invoice: the phone's share sheet with the invoice image (WhatsApp, mail…), a WhatsApp chat with the customer, or the image to save. */
export function ShareInvoice({ snapshot, paid = 0, compact = false }: { snapshot: () => Promise<InvoiceSnapshot>; paid?: number; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const name = (s: InvoiceSnapshot) => `${s.invoiceNumber ?? s.orderCode ?? "invoice"}.png`;
  const run = async (key: string, f: () => Promise<void>) => { setBusy(key); setMsg(""); try { await f(); } catch (e) { if ((e as Error).name !== "AbortError") setMsg((e as Error).message || "Could not share the invoice"); } finally { setBusy(null); } };

  const share = () => run("share", async () => {
    const s = await snapshot(); const img = await invoiceImage(s, paid);
    const file = new File([img], name(s), { type: "image/png" });
    const data: ShareData = { files: [file], title: `Invoice ${s.invoiceNumber ?? ""}`, text: shareText(s, paid) };
    if (navigator.canShare?.(data)) { await navigator.share(data); return; }
    downloadBlob(img, name(s));                                              // no share sheet here (most desktop browsers): save the image instead
    setMsg("This browser can't share files directly — the invoice image was downloaded. Attach it in WhatsApp or email.");
  });
  const whatsapp = () => run("wa", async () => {
    const s = await snapshot(); const img = await invoiceImage(s, paid);
    const file = new File([img], name(s), { type: "image/png" });
    const data: ShareData = { files: [file], text: shareText(s, paid) };
    if (navigator.canShare?.(data) && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) { await navigator.share(data); return; }   // phones: pick WhatsApp in the share sheet
    downloadBlob(img, name(s));
    const num = waNumber(s.customer?.phone);
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(shareText(s, paid))}`, "_blank", "noopener");
    setMsg(`WhatsApp opened${num ? ` for ${s.customer?.phone}` : ""} with the message — the invoice image was downloaded: attach it in the chat.`);
  });
  const save = () => run("img", async () => { const s = await snapshot(); downloadBlob(await invoiceImage(s, paid), name(s)); });

  const btn = compact ? "inline-flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft disabled:opacity-50"
    : "inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-bold hover:bg-brand-soft disabled:opacity-50";
  return (
    <>
      <button type="button" onClick={share} disabled={!!busy} className={btn}><Share2 className={compact ? "size-3.5" : "size-4"} />{busy === "share" ? "Preparing…" : "Share invoice"}</button>
      <button type="button" onClick={whatsapp} disabled={!!busy} className={btn + " text-[#128c4a]"}><MessageCircle className={compact ? "size-3.5" : "size-4"} />{busy === "wa" ? "Preparing…" : "WhatsApp"}</button>
      <button type="button" onClick={save} disabled={!!busy} className={btn}><ImageIcon className={compact ? "size-3.5" : "size-4"} />{busy === "img" ? "Preparing…" : "Download image"}</button>
      {msg && <p role="status" className="basis-full text-xs font-semibold text-sub" data-testid="share-msg">{msg}</p>}
    </>
  );
}

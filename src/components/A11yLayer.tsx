import { useEffect } from "react";

// App-wide accessibility behaviour that must work for every modal in the app (SlideOver, wizard, confirm/reason dialogs, palette),
// including ones owned by other modules: aria-modal, focus trap, Esc to close, focus restore, a persistent live region for toasts,
// and a fallback accessible name for icon-only buttons.
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const vis = (e: HTMLElement) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);

/** A "modal" is a role=dialog/alertdialog that lives inside a full-screen fixed overlay (popovers like the bell menu are not). */
function modals(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"]')].filter((d) => {
    const host = d.closest<HTMLElement>(".fixed.inset-0") ?? (d.classList.contains("fixed") && d.classList.contains("inset-0") ? d : null);
    return !!host && vis(d);
  });
}
const humanize = (s: string) => s.replace(/^lucide-/, "").replace(/-icon$/, "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

export default function A11yLayer() {
  useEffect(() => {
    const openers = new Map<HTMLElement, HTMLElement | null>();
    const live = document.getElementById("sr-live");
    let lastToast = "";

    const scan = () => {
      const now = new Set(modals());
      now.forEach((d) => {
        if (openers.has(d)) return;
        openers.set(d, document.activeElement as HTMLElement | null);
        d.setAttribute("aria-modal", "true");
        if (!d.contains(document.activeElement)) {
          const first = d.querySelector<HTMLElement>("[autofocus],input,textarea,select") ?? d.querySelector<HTMLElement>(FOCUSABLE);
          (first ?? d).focus?.({ preventScroll: true });
        }
      });
      openers.forEach((op, d) => {
        if (now.has(d)) return;
        openers.delete(d);
        if (op && document.contains(op)) op.focus?.({ preventScroll: true });
      });
      // toasts: mirror into the persistent live region so screen readers always announce them
      const toast = document.querySelector<HTMLElement>("div.fixed.bottom-6.z-\\[60\\]");
      if (toast) { toast.setAttribute("role", "status"); const t = toast.textContent?.trim() ?? ""; if (t && t !== lastToast && live) { lastToast = t; live.textContent = ""; window.setTimeout(() => { live.textContent = t; }, 30); } }
      else lastToast = "";
      // icon-only buttons without a name: fall back to title or the lucide icon name
      document.querySelectorAll<HTMLElement>("button:not([aria-label]):not([aria-labelledby]),a:not([aria-label]):not([aria-labelledby])").forEach((b) => {
        if ((b.textContent ?? "").trim() || b.getAttribute("title")) return;
        const svg = b.querySelector("svg"); if (!svg) return;
        const cls = [...svg.classList].find((c) => c.startsWith("lucide-") && c !== "lucide");
        if (cls) b.setAttribute("aria-label", humanize(cls));
      });
    };

    const key = (e: KeyboardEvent) => {
      const list = modals(); const top = list[list.length - 1];
      if (!top) return;
      if (e.key === "Tab") {
        const f = [...top.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(vis);
        if (!f.length) { e.preventDefault(); top.focus(); return; }
        const first = f[0]!, last = f[f.length - 1]!;
        if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      } else if (e.key === "Escape" && !e.defaultPrevented) {
        const btn = top.querySelector<HTMLElement>('[aria-label="Close"],[data-close]') ?? [...top.querySelectorAll<HTMLButtonElement>("button")].find((b) => /^(cancel|close)$/i.test((b.textContent ?? "").trim()));
        if (btn) { e.preventDefault(); e.stopPropagation(); btn.click(); }
      }
    };

    scan();
    let raf = 0;
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; scan(); }); });
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", key, true);
    return () => { mo.disconnect(); document.removeEventListener("keydown", key, true); };
  }, []);
  return <div id="sr-live" role="status" aria-live="polite" aria-atomic="true" className="sr-only" />;
}

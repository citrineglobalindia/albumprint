import { Component, type ErrorInfo, type ReactNode } from "react";

const STALE = /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i;
const reloadedOnce = () => { try { return sessionStorage.getItem("albumpro.reloaded") === "1"; } catch { return true; } };
const markReloaded = () => { try { sessionStorage.setItem("albumpro.reloaded", "1"); } catch { /* ignore */ } };

/** An update replaces the app's files; a tab opened before the update asks for files that no longer exist. Reload once to pick up the new version. */
export function installStaleReload() {
  window.addEventListener("vite:preloadError", (e) => { e.preventDefault(); if (!reloadedOnce()) { markReloaded(); location.reload(); } });
  window.addEventListener("load", () => setTimeout(() => { try { sessionStorage.removeItem("albumpro.reloaded"); } catch { /* ignore */ } }, 10_000));
}

/** Never a blank page: a render error shows a message with a reload button. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("[app]", err, info.componentStack);
    if (STALE.test(String(err?.message)) && !reloadedOnce()) { markReloaded(); location.reload(); }
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-line bg-white p-7 text-center shadow-xl">
          <h1 className="text-xl font-extrabold">Something went wrong</h1>
          <p className="mt-2 text-sm text-sub">{STALE.test(String(this.state.err.message)) ? "AlbumPro was just updated. Reload to get the latest version." : "This page could not be shown. Reloading usually fixes it."}</p>
          <button onClick={() => location.reload()} className="mt-5 h-11 rounded-xl bg-brand px-6 text-sm font-bold text-white hover:bg-brand-dark">Reload</button>
          <p className="mt-3 break-words text-[11px] text-sub/70">{String(this.state.err.message).slice(0, 160)}</p>
        </div>
      </main>
    );
  }
}

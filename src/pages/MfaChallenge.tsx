import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { inputCls } from "../components/ui";

/** Second step after the password: the 6-digit code from the authenticator app. Nothing is loaded until it is entered. */
export default function MfaChallenge() {
  const { verifyMfa, logout } = useAuth();
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!/^\d{6}$/.test(code)) { setErr("Enter the 6-digit code."); return; }
    setBusy(true); setErr("");
    const r = await verifyMfa(code);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? "That code was not accepted."); setCode(""); }
  };
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-4">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="w-full max-w-sm rounded-2xl border border-line bg-white p-7 shadow-xl" aria-label="Two-step verification">
        <div className="mb-4 grid size-12 place-items-center rounded-xl bg-brand-soft text-brand"><ShieldCheck className="size-6" /></div>
        <h1 className="text-2xl font-extrabold">Verify it&apos;s you</h1>
        <p className="mb-5 mt-1 text-sm text-sub">Open your authenticator app and enter the 6-digit code for AlbumPro.</p>
        <label className="block text-[13px] font-semibold">6-digit code
          <input aria-label="6-digit code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={`${inputCls} mt-1.5 text-center text-xl tracking-[0.5em]`} value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setErr(""); }} />
        </label>
        {err && <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{err}</p>}
        <button type="submit" disabled={busy || code.length !== 6} className="mt-5 h-11 w-full rounded-xl bg-brand text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-50">{busy ? "Checking…" : "Verify & continue"}</button>
        <button type="button" onClick={logout} className="mt-3 w-full text-center text-xs font-bold text-sub hover:underline">Use a different account</button>
      </form>
    </main>
  );
}

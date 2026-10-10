import { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/auth";
import { cx, inputCls } from "../components/ui";

const checks = (p: string) => [
  ["At least 10 characters", p.length >= 10], ["An uppercase letter", /[A-Z]/.test(p)], ["A number", /\d/.test(p)], ["A symbol", /[^A-Za-z0-9]/.test(p)],
] as const;

/** Shown once after the first sign-in with a temporary password (SRS §2: must change on first login). */
export default function ChangePassword() {
  const { user, email, finishPasswordChange, logout } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const c = checks(pw);
  const strong = c.every(([, ok]) => ok);

  const submit = async () => {
    setErr("");
    if (!strong) { setErr("Choose a stronger password."); return; }
    if (pw !== pw2) { setErr("Passwords do not match."); return; }
    setBusy(true);
    const r = await finishPasswordChange(pw);
    setBusy(false);
    if (!r.ok) setErr(r.error ?? "Could not change the password.");
  };

  return (
    <main id="main" className="grid min-h-screen place-items-center bg-page p-6">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="w-full max-w-md rounded-2xl border border-line bg-white p-8 shadow-sm">
        <span className="mb-3 grid size-12 place-items-center rounded-xl bg-brand-soft text-brand"><ShieldCheck className="size-6" /></span>
        <h1 className="text-2xl font-extrabold">Set your own password</h1>
        <p className="mb-5 mt-1 text-sm text-sub">Hello {user || email}. You signed in with a temporary password — choose a new one before continuing.</p>
        <label className="mb-4 block"><span className="mb-1.5 block text-[13px] font-semibold">New password</span>
          <span className="relative block"><Lock className="absolute left-3 top-3 size-4 text-sub" /><input autoFocus type="password" autoComplete="new-password" className={cx(inputCls, "pl-9")} value={pw} onChange={(e) => setPw(e.target.value)} /></span></label>
        <ul className="mb-4 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {c.map(([label, ok]) => <li key={label} className={ok ? "font-semibold text-emerald-600" : "text-sub"}>{ok ? "✓" : "○"} {label}</li>)}
        </ul>
        <label className="mb-4 block"><span className="mb-1.5 block text-[13px] font-semibold">Confirm new password</span>
          <input type="password" autoComplete="new-password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        {err && <p role="alert" className="mb-3 text-sm font-medium text-rose-600">{err}</p>}
        <button disabled={busy} className="h-11 w-full rounded-xl bg-brand font-bold text-white shadow-md shadow-brand/25 hover:bg-brand-dark disabled:opacity-60">{busy ? "Saving…" : "Save password and continue"}</button>
        <button type="button" onClick={logout} className="mt-3 w-full text-center text-[13px] font-bold text-sub hover:text-ink">Sign out</button>
      </form>
    </main>
  );
}

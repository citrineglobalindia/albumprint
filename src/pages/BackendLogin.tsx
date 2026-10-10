import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Aperture, Eye, EyeOff, Lock, Mail, ArrowLeft, ShieldAlert } from "lucide-react";
import { useAuth } from "../lib/auth";
import { cx, inputCls } from "../components/ui";

type Mode = "signin" | "signup" | "forgot" | "info";

/** Real sign-in against Supabase. Only emails an admin has invited become staff (see supabase/migrations/0007). */
export default function BackendLogin() {
  const { role, loading, signIn, signUp, resetPassword } = useAuth();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [noAccess, setNoAccess] = useState(false);

  if (role) return <Navigate to={from} replace />;

  const go = async () => {
    setErr(""); setNoAccess(false);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr("Enter a valid work email."); return; }
    if (mode !== "forgot" && pw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (mode === "signup" && pw !== pw2) { setErr("Passwords do not match."); return; }
    setBusy(true);
    try {
      if (mode === "signin") {
        const r = await signIn(email, pw);
        if (!r.ok) setErr(/invalid login/i.test(r.error ?? "") ? "Incorrect email or password." : r.error ?? "Sign-in failed.");
        else setNoAccess(true);                    // if the profile loads, we are redirected; if not, the account has no staff access
      } else if (mode === "signup") {
        const r = await signUp(email, pw);
        if (!r.ok) setErr(r.error ?? "Could not create the account.");
        else { setInfo(r.needsConfirmation ? `We sent a confirmation link to ${email.trim()}. Open it, then sign in here.` : "Account created."); setMode("info"); }
      } else if (mode === "forgot") {
        const r = await resetPassword(email);
        if (!r.ok) setErr(r.error ?? "Could not send the reset email.");
        else { setInfo(`If ${email.trim()} is registered, a reset link is on its way.`); setMode("info"); }
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-side p-12 text-white lg:flex">
        <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-brand"><Aperture className="size-6" /></span><span className="text-2xl font-extrabold">AlbumPro</span></div>
        <div>
          <h1 className="max-w-md text-4xl font-extrabold leading-tight">Every album, traced from order to doorstep.</h1>
          <p className="mt-4 max-w-md text-slate-300">Colour grading, design, client proofing, printing, QC and delivery — one workflow with a full audit trail.</p>
        </div>
        <p className="text-xs text-slate-400">Album Operations CRM • Confidential</p>
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-brand/30 blur-3xl" />
      </div>

      <main className="grid place-items-center bg-page p-6" id="main">
        <form className="w-full max-w-md rounded-2xl border border-line bg-white p-8 shadow-sm" onSubmit={(e) => { e.preventDefault(); void go(); }}>
          {mode === "info" ? (
            <div className="text-center">
              <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Mail className="size-6" /></span>
              <h2 className="text-xl font-extrabold">Check your email</h2>
              <p className="mb-5 mt-1 text-sm text-sub">{info}</p>
              <button type="button" onClick={() => { setMode("signin"); setPw(""); setPw2(""); }} className="h-11 w-full rounded-xl border border-line font-bold">Back to sign in</button>
            </div>
          ) : (
            <>
              {mode !== "signin" && <button type="button" onClick={() => { setMode("signin"); setErr(""); }} className="mb-3 flex items-center gap-1 text-xs font-bold text-sub"><ArrowLeft className="size-3.5" />Back to sign in</button>}
              <h2 className="text-2xl font-extrabold">{mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset password"}</h2>
              <p className="mb-5 mt-1 text-sm text-sub">{mode === "signup" ? "Use the email address your administrator invited." : mode === "forgot" ? "We'll email you a time-limited reset link." : "Use your work email and password."}</p>

              <label className="mb-4 block"><span className="mb-1.5 block text-[13px] font-semibold">Work email</span>
                <span className="relative block"><Mail className="absolute left-3 top-3 size-4 text-sub" /><input autoFocus type="email" autoComplete="username" className={cx(inputCls, "pl-9")} value={email} onChange={(e) => setEmail(e.target.value)} /></span></label>

              {mode !== "forgot" && (
                <label className="mb-4 block"><span className="mb-1.5 block text-[13px] font-semibold">Password</span>
                  <span className="relative block"><Lock className="absolute left-3 top-3 size-4 text-sub" />
                    <input type={show ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} className={cx(inputCls, "px-9")} value={pw} onChange={(e) => setPw(e.target.value)} />
                    <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-3 text-sub" aria-label="Show or hide password">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></span></label>
              )}
              {mode === "signup" && (
                <label className="mb-4 block"><span className="mb-1.5 block text-[13px] font-semibold">Confirm password</span>
                  <input type={show ? "text" : "password"} autoComplete="new-password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
              )}

              {mode === "signin" && <div className="mb-4 text-right text-[13px]"><button type="button" onClick={() => { setMode("forgot"); setErr(""); }} className="font-bold text-brand">Forgot password?</button></div>}
              {err && <p role="alert" className="mb-3 text-sm font-medium text-rose-600">{err}</p>}
              {noAccess && !err && <p role="alert" className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-[13px] font-medium text-amber-800"><ShieldAlert className="mt-0.5 size-4 shrink-0" />Signed in, but this account has no staff access. Ask an administrator to invite {email.trim()}.</p>}

              <button disabled={busy} className="h-11 w-full rounded-xl bg-brand font-bold text-white shadow-md shadow-brand/25 hover:bg-brand-dark disabled:opacity-60">
                {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
              </button>
              {mode === "signin" && <p className="mt-4 text-center text-[13px] text-sub">First time? Your administrator must invite you, then <button type="button" onClick={() => { setMode("signup"); setErr(""); }} className="font-bold text-brand">create your account</button>.</p>}
            </>
          )}
        </form>
      </main>
      {loading && <span className="sr-only" role="status">Checking session…</span>}
    </div>
  );
}

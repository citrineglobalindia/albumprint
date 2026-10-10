import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Aperture, Eye, EyeOff, Lock, Mail, ShieldCheck, ArrowLeft, Clock, ShieldAlert } from "lucide-react";
import { useAuth, ROLES, type RoleKey } from "../lib/auth";
import { cx, inputCls } from "../components/ui";
import { isUserActive } from "../lib/users";
import BackendLogin from "./BackendLogin";

type Step = "credentials" | "otp" | "forgot" | "sent";

function DemoLogin() {
  const { role, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? "/";
  const expired = !!(loc.state as { from?: string } | null)?.from || new URLSearchParams(loc.search).get("expired") === "1";
  const [step, setStep] = useState<Step>("credentials");
  const [pick, setPick] = useState<RoleKey>("admin");
  const [email, setEmail] = useState(ROLES.admin.email);
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [fails, setFails] = useState(0);
  const [human, setHuman] = useState(false);
  const [otp, setOtp] = useState("");
  const [err, setErr] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);
  // SRS §2: lock the account after 5 failed attempts for 30 seconds (simulated, survives reload).
  const [lockLeft, setLockLeft] = useState(() => { try { return Math.max(0, Math.ceil((Number(localStorage.getItem("albumpro.lockUntil")) - Date.now()) / 1000)); } catch { return 0; } });
  useEffect(() => {
    if (lockLeft <= 0) return;
    const t = window.setTimeout(() => {
      setLockLeft((c) => c - 1);
      if (lockLeft - 1 <= 0) { setFails(0); setErr(""); try { localStorage.removeItem("albumpro.lockUntil"); } catch { /* ignore */ } }
    }, 1000);
    return () => window.clearTimeout(t);
  }, [lockLeft]);
  const locked = lockLeft > 0;
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);
  const resend = () => { setResent(true); setCooldown(30); setOtp(""); };
  if (role) return <Navigate to={from} replace />;

  const choose = (r: RoleKey) => { setPick(r); setEmail(ROLES[r].email); setErr(""); };
  const submit = () => {
    // ALB-FR-0009..0012: identifier + password, risk-based CAPTCHA after repeated failures.
    if (locked) return;
    if (!email.trim() || pw.length < 6) {
      const n = fails + 1;
      setFails(n);
      if (n >= 5) { try { localStorage.setItem("albumpro.lockUntil", String(Date.now() + 30000)); } catch { /* ignore */ } setLockLeft(30); setErr(""); return; }
      setErr(`${!email.trim() ? "Enter your email or mobile." : "Incorrect password (demo: any 6+ characters)."} ${5 - n} attempt${5 - n === 1 ? "" : "s"} left before lockout.`);
      return;
    }
    if (fails >= 2 && !human) { setErr("Please confirm you are not a robot."); return; }
    if (!isUserActive(email.trim())) { setErr("This account has been deactivated. Contact your administrator."); return; }   // ALB-FR-0013: validate status before access
    setErr(""); remember ? finish() : setStep("otp");
  };
  const finish = () => { login(pick); nav(from, { replace: true }); };

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

      <div className="grid place-items-center bg-page p-6">
        <div className="w-full max-w-md rounded-2xl border border-line bg-white p-8 shadow-sm">
          {step === "credentials" && (
            <>
              <h2 className="text-2xl font-extrabold">Sign in</h2>
              <p className="mb-5 mt-1 text-sm text-sub">Use your work email or mobile number.</p>
              {expired && <div role="status" data-testid="session-banner" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] font-semibold text-amber-800"><Clock className="mt-0.5 size-4 shrink-0" />Your session has expired. Please sign in again{from !== "/" ? ` to continue to ${from}` : ""}.</div>}
              {locked && <div role="alert" data-testid="lockout-banner" className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-semibold text-rose-700"><ShieldAlert className="mt-0.5 size-4 shrink-0" />Too many failed attempts. Account locked, try again in {lockLeft}s.</div>}
              <div className="mb-4">
                <div className="mb-1.5 text-[13px] font-semibold">Demo: sign in as <span className="font-normal text-sub">(use a different role)</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(ROLES) as RoleKey[]).map((r) => (
                    <button key={r} onClick={() => choose(r)} className={cx("rounded-lg border px-3 py-1.5 text-xs font-bold", pick === r ? "border-brand bg-brand text-white" : "border-line bg-white hover:bg-brand-soft")}>{ROLES[r].label}</button>
                  ))}
                </div>
              </div>
              <label className="mb-4 block"><span className="mb-1.5 block text-[13px] font-semibold">Work Email / Mobile</span>
                <span className="relative block"><Mail className="absolute left-3 top-3 size-4 text-sub" /><input className={cx(inputCls, "pl-9")} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} aria-label="Work email or mobile" /></span></label>
              <label className="mb-3 block"><span className="mb-1.5 block text-[13px] font-semibold">Password</span>
                <span className="relative block"><Lock className="absolute left-3 top-3 size-4 text-sub" />
                  <input className={cx(inputCls, "px-9")} type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••••••" />
                  <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-3 text-sub" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></span></label>
              <div className="mb-4 flex items-center justify-between text-[13px]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember this device</label>
                <button onClick={() => setStep("forgot")} className="font-bold text-brand">Forgot password?</button>
              </div>
              {fails >= 2 && <label className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-slate-50 p-3 text-sm"><input type="checkbox" checked={human} onChange={(e) => setHuman(e.target.checked)} />I'm not a robot</label>}
              {err && <p className="mb-3 text-sm font-medium text-rose-600">{err}</p>}
              <button onClick={submit} disabled={locked} className="h-11 w-full rounded-xl bg-brand font-bold text-white shadow-md shadow-brand/25 hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50">{locked ? `Locked · ${lockLeft}s` : "Sign in"}</button>
            </>
          )}

          {step === "otp" && (
            <>
              <button onClick={() => setStep("credentials")} className="mb-3 flex items-center gap-1 text-xs font-bold text-sub"><ArrowLeft className="size-3.5" />Back</button>
              <span className="mb-3 grid size-12 place-items-center rounded-xl bg-brand-soft text-brand"><ShieldCheck className="size-6" /></span>
              <h2 className="text-2xl font-extrabold">Verify it's you</h2>
              <p className="mb-5 mt-1 text-sm text-sub">Enter the 6-digit code sent to your registered mobile. (Demo: any 6 digits.)</p>
              <input className={cx(inputCls, "mb-3 text-center text-xl font-bold tracking-[0.5em]")} inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && otp.length === 6 && finish()} placeholder="······" autoFocus />
              <button disabled={otp.length !== 6} onClick={finish} className="h-11 w-full rounded-xl bg-brand font-bold text-white disabled:opacity-50">Verify & continue</button>
              <p className="mt-3 text-center text-xs text-sub">Didn't get it? <button disabled={cooldown > 0} onClick={resend} className="font-bold text-brand disabled:text-sub">{cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}</button></p>
              {resent && <p role="status" className="mt-1 text-center text-xs font-semibold text-emerald-600">A new code has been sent to your registered mobile.</p>}
            </>
          )}

          {step === "forgot" && (
            <>
              <button onClick={() => setStep("credentials")} className="mb-3 flex items-center gap-1 text-xs font-bold text-sub"><ArrowLeft className="size-3.5" />Back to sign in</button>
              <h2 className="text-2xl font-extrabold">Reset password</h2>
              <p className="mb-5 mt-1 text-sm text-sub">We'll send a single-use, time-bound link to your registered email.</p>
              <input className={cx(inputCls, "mb-4")} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Work email" />
              <button onClick={() => setStep("sent")} className="h-11 w-full rounded-xl bg-brand font-bold text-white">Send reset link</button>
            </>
          )}

          {step === "sent" && (
            <div className="text-center">
              <span className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Mail className="size-6" /></span>
              <h2 className="text-xl font-extrabold">Check your email</h2>
              <p className="mb-5 mt-1 text-sm text-sub">If {email} is registered, a reset link is on its way. It expires in 15 minutes.</p>
              <button onClick={() => setStep("credentials")} className="h-11 w-full rounded-xl border border-line font-bold">Back to sign in</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  const { backend } = useAuth();
  return backend ? <BackendLogin /> : <DemoLogin />;
}

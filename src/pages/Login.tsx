import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Aperture, Eye, EyeOff, Lock, Mail, ShieldCheck, ArrowLeft } from "lucide-react";
import { useAuth, ROLES, type RoleKey } from "../lib/auth";
import { cx, inputCls } from "../components/ui";

type Step = "credentials" | "otp" | "forgot" | "sent";

export default function Login() {
  const { role, login } = useAuth();
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
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
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);
  const resend = () => { setResent(true); setCooldown(30); setOtp(""); };
  if (role) return <Navigate to="/" replace />;

  const choose = (r: RoleKey) => { setPick(r); setEmail(ROLES[r].email); setErr(""); };
  const submit = () => {
    // ALB-FR-0009..0012: identifier + password, risk-based CAPTCHA after repeated failures.
    if (pw.length < 6) { setFails((f) => f + 1); setErr("Enter your password (demo: any 6+ characters)."); return; }
    if (fails >= 2 && !human) { setErr("Please confirm you are not a robot."); return; }
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
              <div className="mb-4">
                <div className="mb-1.5 text-[13px] font-semibold">Demo: sign in as</div>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(ROLES) as RoleKey[]).map((r) => (
                    <button key={r} onClick={() => choose(r)} className={cx("rounded-lg border px-3 py-1.5 text-xs font-bold", pick === r ? "border-brand bg-brand text-white" : "border-line bg-white hover:bg-brand-soft")}>{ROLES[r].label}</button>
                  ))}
                </div>
              </div>
              <label className="mb-4 block"><span className="mb-1.5 block text-[13px] font-semibold">Work Email / Mobile</span>
                <span className="relative block"><Mail className="absolute left-3 top-3 size-4 text-sub" /><input className={cx(inputCls, "pl-9")} value={email} onChange={(e) => setEmail(e.target.value)} /></span></label>
              <label className="mb-3 block"><span className="mb-1.5 block text-[13px] font-semibold">Password</span>
                <span className="relative block"><Lock className="absolute left-3 top-3 size-4 text-sub" />
                  <input className={cx(inputCls, "px-9")} type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="••••••••" />
                  <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-3 text-sub" aria-label="Toggle password">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></span></label>
              <div className="mb-4 flex items-center justify-between text-[13px]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember this device</label>
                <button onClick={() => setStep("forgot")} className="font-bold text-brand">Forgot password?</button>
              </div>
              {fails >= 2 && <label className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-slate-50 p-3 text-sm"><input type="checkbox" checked={human} onChange={(e) => setHuman(e.target.checked)} />I'm not a robot</label>}
              {err && <p className="mb-3 text-sm font-medium text-rose-600">{err}</p>}
              <button onClick={submit} className="h-11 w-full rounded-xl bg-brand font-bold text-white shadow-md shadow-brand/25 hover:bg-brand-dark">Sign in</button>
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

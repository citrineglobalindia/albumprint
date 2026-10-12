import { useCallback, useEffect, useState } from "react";
import { QrCode, ShieldCheck, ShieldOff } from "lucide-react";
import { Panel, PageHeader, inputCls } from "../components/ui";
import { useAuth, ROLES } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { useToast } from "../components/Toast";

interface Factor { id: string; friendly_name?: string; status: string; created_at?: string }

/** My account: who I am, and two-step login (an authenticator app such as Google Authenticator, Microsoft Authenticator or Authy). */
export default function Account() {
  const { role, user, email, backend } = useAuth();
  const [toast, show] = useToast();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrol, setEnrol] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(((data?.totp ?? []) as Factor[]));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const on = factors.some((f) => f.status === "verified");

  const start = async () => {
    if (!supabase) return;
    setBusy(true); setErr("");
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "AlbumPro", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16).replace("T", " ")}` });
    setBusy(false);
    if (error || !data) { setErr(error?.message ?? "Could not start set-up"); return; }
    setEnrol({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret }); setCode("");
  };
  const confirm = async () => {
    if (!supabase || !enrol) return;
    if (!/^\d{6}$/.test(code)) { setErr("Enter the 6-digit code from the app."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrol.id, code });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setEnrol(null); setCode(""); await refresh(); show("Two-step login is on. You will be asked for a code at every sign-in.");
  };
  const turnOff = async () => {
    if (!supabase) return;
    setBusy(true); setErr("");
    for (const f of factors.filter((x) => x.status === "verified")) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (error) { setErr(error.message); setBusy(false); return; }
    }
    setBusy(false); await refresh(); show("Two-step login is off");
  };

  return (
    <div className="min-w-0">
      {toast}
      <PageHeader title="My account" subtitle="Your sign-in details and security" />
      <div className="grid max-w-3xl gap-5">
        <Panel title="Profile">
          <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-sub">Name</dt><dd className="font-semibold">{user || "—"}</dd></div><div><dt className="text-xs text-sub">Email</dt><dd className="font-semibold">{email || "—"}</dd></div><div><dt className="text-xs text-sub">Role</dt><dd className="font-semibold">{role ? ROLES[role].label : "—"}</dd></div></dl>
        </Panel>
        <Panel title="Two-step login" subtitle="A code from an authenticator app, on top of your password" action={on ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"><ShieldCheck className="size-3.5" />On</span> : <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-sub"><ShieldOff className="size-3.5" />Off</span>}>
          {!backend && <p className="text-sm text-sub">Two-step login is available once the app is connected to the database.</p>}
          {backend && !enrol && !on && (<><p className="mb-3 text-sm text-sub">Protect your account: even if someone learns your password, they cannot sign in without your phone. Works with Google Authenticator, Microsoft Authenticator, Authy and similar apps.</p>
            <button onClick={() => void start()} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-50"><QrCode className="size-4" />Set up two-step login</button></>)}
          {backend && enrol && (
            <div className="grid gap-5 sm:grid-cols-[180px_1fr]" data-testid="mfa-enrol">
              <img src={enrol.qr} alt="QR code to scan with your authenticator app" className="size-44 rounded-xl border border-line bg-white p-2" />
              <div>
                <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-sub"><li>Open your authenticator app and scan the QR code (or type the key below).</li><li>Enter the 6-digit code it shows, then press Turn on.</li></ol>
                <div className="mb-3 text-xs text-sub">Can&apos;t scan? Key: <code data-testid="mfa-secret" className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-ink">{enrol.secret}</code></div>
                <div className="flex gap-2"><input aria-label="Authenticator code" inputMode="numeric" maxLength={6} className={`${inputCls} w-40 text-center tracking-[0.3em]`} value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setErr(""); }} placeholder="123456" />
                  <button onClick={() => void confirm()} disabled={busy || code.length !== 6} className="h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white disabled:opacity-50">Turn on</button>
                  <button onClick={() => { setEnrol(null); setErr(""); }} className="h-10 px-3 text-sm font-bold text-sub">Cancel</button></div>
              </div>
            </div>
          )}
          {backend && on && !enrol && (<><p className="mb-3 text-sm text-sub">You are asked for a code from your authenticator app each time you sign in. If you lose your phone, ask an administrator to reset it (Users &amp; Roles).</p>
            <button onClick={() => void turnOff()} disabled={busy} className="h-10 rounded-lg border border-rose-200 px-4 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50">Turn off two-step login</button></>)}
          {err && <p role="alert" className="mt-3 text-xs font-semibold text-rose-600">{err}</p>}
        </Panel>
      </div>
    </div>
  );
}

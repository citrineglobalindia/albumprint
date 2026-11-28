import { useState } from "react";
import { History, IndianRupee, Pencil, Plus } from "lucide-react";
import { cx, inputCls } from "./ui";
import { useStore } from "../lib/store";
import { inr, fmtDate } from "../lib/format";
import { CUSTOMERS, type Customer } from "../lib/data";
import { MODES, TODAY_STR, type Mode } from "../lib/finance";
import { canReceiveOpening, canSetOpening, openingDue, openingPaymentsOf, openingReceived, receiveOpening, setOpeningBalance } from "../lib/openingBalance";

const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold disabled:opacity-40";

/** Old balance (owed before this system): enter it once, then receive payments against it until it is cleared. */
export function OldBalanceCard({ c: given, onDone }: { c: Customer; onDone: (msg: string, ok: boolean) => void }) {
  useStore();
  const c = CUSTOMERS.find((x) => x.id === given.id) ?? given;
  const [mode, setMode] = useState<null | "set" | "pay">(null);
  const [busy, setBusy] = useState(false);
  const total = c.openingBalance ?? 0, got = openingReceived(c), due = openingDue(c), pays = openingPaymentsOf(c);
  const canSet = canSetOpening(), canPay = canReceiveOpening();
  if (!total && !pays.length && !canSet) return null;

  const run = async (p: Promise<{ ok: boolean; msg: string }>) => { setBusy(true); const r = await p; setBusy(false); onDone(r.msg, r.ok); if (r.ok) setMode(null); };

  return (
    <section data-testid="old-balance" aria-label="Old balance" className={cx("mt-3 rounded-xl border p-3", due > 0 ? "border-amber-300 bg-amber-50/60" : "border-line")}>
      <div className="flex flex-wrap items-center gap-2">
        <History className="size-4 text-amber-600" />
        <div className="min-w-0 flex-1"><div className="text-[13px] font-extrabold">Old balance</div><div className="text-[11px] text-sub">Owed before this system{c.openingNote ? ` · ${c.openingNote}` : ""}</div></div>
        {total > 0 && <div className="text-right"><div className={cx("text-base font-extrabold", due > 0 ? "text-rose-600" : "text-emerald-600")} data-testid="old-balance-due">{due > 0 ? inr(due) : "Cleared"}</div><div className="text-[11px] text-sub">{due > 0 ? "still due" : `of ${inr(total)}`}</div></div>}
      </div>
      {total > 0 && <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]"><div className="rounded-lg bg-white/80 py-1.5"><div className="text-sub">Old balance</div><b className="text-[13px]">{inr(total)}</b></div><div className="rounded-lg bg-white/80 py-1.5"><div className="text-sub">Received</div><b className="text-[13px] text-emerald-700">{inr(got)}</b></div><div className="rounded-lg bg-white/80 py-1.5"><div className="text-sub">Due</div><b className={cx("text-[13px]", due > 0 && "text-rose-600")}>{inr(due)}</b></div></div>}

      {mode === null && (
        <div className="mt-2 flex flex-wrap gap-2">
          {due > 0 && canPay && <button type="button" className={cx(btn, "bg-emerald-600 text-white hover:bg-emerald-700")} onClick={() => setMode("pay")}><IndianRupee className="size-3.5" />Receive payment</button>}
          {canSet && <button type="button" className={cx(btn, "border border-line bg-white text-brand hover:bg-brand-soft")} onClick={() => setMode("set")}>{total ? <><Pencil className="size-3.5" />Change old balance</> : <><Plus className="size-3.5" />Add old balance</>}</button>}
        </div>
      )}
      {mode === "set" && <SetForm c={c} min={got} busy={busy} onCancel={() => setMode(null)} onSave={(amt, note) => void run(setOpeningBalance(c, amt, note))} />}
      {mode === "pay" && <PayForm due={due} busy={busy} onCancel={() => setMode(null)} onSave={(d) => void run(receiveOpening(c, d))} />}

      {pays.length > 0 && (
        <ul className="mt-2 divide-y divide-line rounded-lg bg-white/80 text-[12px]" aria-label="Payments against the old balance">
          {pays.map((p) => <li key={p.receipt} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5"><span className="font-mono text-[11px] text-sub">{p.receipt}</span><span className="text-sub">{fmtDate(p.date)} · {p.mode}{p.ref ? ` · ${p.ref}` : ""}</span><b className="ml-auto text-emerald-700">{inr(p.amount)}</b></li>)}
        </ul>
      )}
    </section>
  );
}

function SetForm({ c, min, busy, onCancel, onSave }: { c: Customer; min: number; busy: boolean; onCancel: () => void; onSave: (amount: number, note: string) => void }) {
  const [amt, setAmt] = useState(c.openingBalance ? String(c.openingBalance) : "");
  const [note, setNote] = useState(c.openingNote ?? "");
  return (
    <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); onSave(Number(amt || 0), note); }}>
      <label className="block text-[12px] font-semibold">Old balance amount (₹)<input aria-label="Old balance amount" className={cx(inputCls, "mt-1")} inputMode="decimal" type="number" min={0} step="0.01" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="e.g. 25000" autoFocus /></label>
      <label className="block text-[12px] font-semibold">Note (optional)<input aria-label="Old balance note" className={cx(inputCls, "mt-1")} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. as per old ledger, till Oct 2026" /></label>
      {min > 0 && <p className="text-[11px] text-sub">{inr(min)} is already received, so the balance can't be less than that.</p>}
      <div className="flex gap-2"><button type="submit" disabled={busy} className={cx(btn, "bg-brand text-white hover:bg-brand-dark")}>Save old balance</button><button type="button" onClick={onCancel} className={cx(btn, "border border-line bg-white")}>Cancel</button></div>
    </form>
  );
}

function PayForm({ due, busy, onCancel, onSave }: { due: number; busy: boolean; onCancel: () => void; onSave: (d: { amount: number; mode: Mode; ref: string; date: string; note?: string }) => void }) {
  const [amt, setAmt] = useState(String(due));
  const [mode, setMode] = useState<Mode>("Cash");
  const [ref, setRef] = useState(""); const [date, setDate] = useState(TODAY_STR);
  return (
    <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); onSave({ amount: Number(amt || 0), mode, ref, date }); }}>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[12px] font-semibold">Amount (₹)<input aria-label="Payment amount" className={cx(inputCls, "mt-1")} inputMode="decimal" type="number" min={1} step="0.01" value={amt} onChange={(e) => setAmt(e.target.value)} autoFocus /></label>
        <label className="block text-[12px] font-semibold">Mode<select aria-label="Payment mode" className={cx(inputCls, "mt-1")} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="block text-[12px] font-semibold">Reference{mode !== "Cash" && " *"}<input aria-label="Payment reference" className={cx(inputCls, "mt-1")} value={ref} onChange={(e) => setRef(e.target.value)} placeholder={mode === "Cash" ? "optional" : "UTR / cheque no."} /></label>
        <label className="block text-[12px] font-semibold">Date<input aria-label="Payment date" type="date" className={cx(inputCls, "mt-1")} value={date} max={TODAY_STR} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div className="flex gap-2"><button type="submit" disabled={busy} className={cx(btn, "bg-emerald-600 text-white hover:bg-emerald-700")}>Receive {amt ? inr(Number(amt)) : ""}</button><button type="button" onClick={onCancel} className={cx(btn, "border border-line bg-white")}>Cancel</button></div>
    </form>
  );
}

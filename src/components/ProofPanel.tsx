import { useEffect, useState } from "react";
import { Copy, ExternalLink, Eye, RefreshCw, Ban } from "lucide-react";
import { Panel, Pill, cx } from "./ui";
import { useToast } from "./Toast";
import { useConfirm } from "./ConfirmDialog";
import { PROOFS, createProof, hasLink, latestProof, proofUrl, revokeProof, setCommentState, type Proof } from "../lib/proofs";
import { backendOn } from "../lib/supabase";
import { syncProofs } from "../lib/db/proofs";
import { ORDERS } from "../lib/data";
import { notify, useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { flushAll } from "../lib/persist";
import "../lib/design";   // cross-tab sync with the public portal

const TONE = { sent: "amber", viewed: "blue", approved: "green", corrections: "red", expired: "slate", revoked: "slate" } as const;
const LABEL: Record<Proof["status"], string> = { sent: "Sent - awaiting client", viewed: "Viewed by client", approved: "Approved", corrections: "Corrections requested", expired: "Expired", revoked: "Revoked" };
const dt = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");

/** Staff-side client-proof status for one order (SRS §11). Embed anywhere: `<ProofPanel orderId={o.id} />`. */
export function ProofPanel({ orderId, className }: { orderId: string; className?: string }) {
  useStore();
  const { role } = useAuth();
  const [toast, show] = useToast();
  const [dialog, confirm] = useConfirm();
  const [openHist, setOpenHist] = useState(false);
  const [fresh, setFresh] = useState("");   // backend: the new link, shown once (the server keeps only a hash)
  useEffect(() => { if (!backendOn) return; void syncProofs(); const t = setInterval(() => void syncProofs(), 6000); return () => clearInterval(t); }, []);
  const order = ORDERS.find((o) => o.id === orderId);
  const proof = latestProof(orderId);
  const history = PROOFS.filter((p) => p.orderId === orderId && p !== proof);
  const canSend = role === "admin" || role === "designer" || role === "reception";

  const copy = async (p: Proof) => { try { await navigator.clipboard.writeText(proofUrl(p)); } catch { /* clipboard may be unavailable */ } show("Proof link copied"); };
  const resend = () => {
    if (!order) return;
    const days = proof ? Math.max(1, Math.round((new Date(proof.expiresAt).getTime() - new Date(proof.createdAt).getTime()) / 864e5)) : 7;
    const p = createProof(orderId, order.pages, proof?.sentVia ?? "Link", days); notify(); flushAll(); copy(p); if (backendOn) setFresh(proofUrl(p));
  };
  const toggle = (p: Proof, i: number) => {
    const c = p.comments[i]!; const resolved = !c.resolved;
    setCommentState(p, c, { resolved, inProgress: false }, resolved ? "correction_resolved" : "correction_reopened"); notify();
  };
  const live = proof && ["sent", "viewed"].includes(proof.status);

  return (
    <Panel title="Client proof" className={className} bodyClassName="p-4">
      {!proof ? (
        <p className="text-[13px] text-sub">No proof has been sent to the client yet. Send one from Album Designing.</p>
      ) : (
        <div className="space-y-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2"><Pill tone={TONE[proof.status]} dot>{LABEL[proof.status]}</Pill><span className="font-bold">Version {proof.version}</span></div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <div><dt className="text-xs text-sub">Sent via</dt><dd className="font-semibold">{proof.sentVia}</dd></div>
            <div><dt className="text-xs text-sub">Sent at</dt><dd className="font-semibold">{dt(proof.createdAt)}</dd></div>
            <div><dt className="text-xs text-sub">Expires</dt><dd className="font-semibold">{dt(proof.expiresAt)}</dd></div>
            <div><dt className="text-xs text-sub">Viewed</dt><dd data-testid="proof-viewed" className="flex items-center gap-1 font-semibold"><Eye className="size-3.5 text-sub" />{proof.viewedAt ? dt(proof.viewedAt) : "Not yet"}</dd></div>
            {proof.respondedAt && <div className="col-span-2"><dt className="text-xs text-sub">Client response</dt><dd className="font-semibold">{dt(proof.respondedAt)}{proof.approvedBy ? ` - approved by ${proof.approvedBy}` : ""}</dd></div>}
          </dl>
          <div className="flex flex-wrap gap-2">
            {live && hasLink(proof) && <button onClick={() => copy(proof)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold hover:bg-slate-50"><Copy className="size-3.5" />Copy link</button>}
            {live && hasLink(proof) && <a href={`/proof/${proof.token}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold hover:bg-slate-50"><ExternalLink className="size-3.5" />Open client view</a>}
            {canSend && proof.status !== "approved" && <button onClick={resend} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-brand px-3 text-xs font-bold text-brand hover:bg-brand-soft"><RefreshCw className="size-3.5" />Resend / new link</button>}
            {live && role === "admin" && <button onClick={() => confirm({ title: "Revoke this link?", message: "The client will no longer be able to open this proof.", confirmLabel: "Revoke", danger: true }, () => { revokeProof(proof); notify(); show("Proof link revoked"); })} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50"><Ban className="size-3.5" />Revoke</button>}
          </div>
          {fresh && live && <p data-testid="proof-link" className="break-all rounded-lg bg-amber-50 p-2 text-xs"><b>New link (shown once):</b> {fresh}</p>}
          {live && !hasLink(proof) && <p className="text-xs text-sub">For security the server stores only a hash of the link, so it cannot be shown again. Use Resend / new link to issue a fresh one.</p>}
          {proof.comments.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-sub">Client corrections ({proof.comments.filter((c) => !c.resolved).length} open)</h4>
              <ul className="space-y-2">
                {proof.comments.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-xl border border-line p-2.5">
                    <input type="checkbox" aria-label={`Resolve correction on page ${c.page}`} checked={!!c.resolved} onChange={() => toggle(proof, i)} className="mt-0.5 size-4" />
                    <div className="min-w-0"><b className="text-brand">Page {c.page}</b><p className={cx(c.resolved && "text-sub line-through")}>{c.text}</p></div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {history.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <button onClick={() => setOpenHist((v) => !v)} className="text-xs font-bold text-brand">{openHist ? "Hide" : "Show"} previous proofs ({history.length})</button>
          {openHist && (
            <ul className="mt-2 space-y-1.5 text-xs">
              {history.map((p) => <li key={p.id} className="flex items-center gap-2"><b>v{p.version}</b><span className="text-sub">{p.sentVia} - {dt(p.createdAt)}</span><Pill className="ml-auto" tone={TONE[p.status]}>{LABEL[p.status]}</Pill>{p.comments.length > 0 && <span className="text-sub">{p.comments.length} corr.</span>}</li>)}
            </ul>
          )}
        </div>
      )}
      {toast}{dialog}
    </Panel>
  );
}
export default ProofPanel;

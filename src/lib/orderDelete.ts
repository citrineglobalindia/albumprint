import { ORDERS } from "./data";
import { notify } from "./store";
import { backendOn } from "./supabase";
import { currentActor, logAudit } from "./audit";
import { FILES } from "./files";
import { GJOBS, PJOBS, INSPECTIONS, RTASKS, DRECS } from "./production";
import { PAYMENTS, INVOICES } from "./finance";
import { PROOFS } from "./proofs";
import { DESIGN_CORR, DESIGN_META } from "./design";

// Permanently delete an order (admin only, with a reason). Meant for test or mistaken orders; a real order is cancelled instead,
// which keeps its history. Refused when payments are recorded. Database: delete_order (migration 0051) removes the order and
// everything under it and keeps a snapshot of every row in the audit log; the stored files are then removed from Storage.
export type DeleteResult = { ok: true } | { ok: false; error: string };

const dropFor = <T extends { orderId: string }>(arr: T[], id: string) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i]!.orderId === id) arr.splice(i, 1); };

export async function deleteOrder(orderId: string, reasonIn: string): Promise<DeleteResult> {
  const reason = reasonIn.trim() || "No reason given";                   // the reason is optional; the audit log still records the delete
  const o = ORDERS.find((x) => x.id === orderId); if (!o) return { ok: false, error: "Order not found" };
  if (currentActor().role !== "admin") return { ok: false, error: "Only an admin can delete an order" };
  if (!backendOn && PAYMENTS.some((p) => p.orderId === orderId)) return { ok: false, error: `${orderId} has recorded payments and cannot be deleted: record a refund and cancel the order instead` };

  if (backendOn) {
    if (!o.uid) return { ok: false, error: "Order not found" };
    const { sb, rehydrate } = await import("./db/core");
    const { BUCKET } = await import("./db/files");
    const { data, error } = await sb().rpc("delete_order", { p_order: o.uid, p_reason: reason.trim() });
    if (error) return { ok: false, error: error.message };
    const paths = ((data ?? []) as { storage_path: string }[]).map((r) => r.storage_path).filter(Boolean);
    for (let i = 0; i < paths.length; i += 100) {                       // the stored bytes (the rows are already gone)
      const { error: e } = await sb().storage.from(BUCKET).remove(paths.slice(i, i + 100));
      if (e) console.warn("[db] Removing files of a deleted order:", e.message);
    }
    const i = ORDERS.indexOf(o); if (i >= 0) ORDERS.splice(i, 1);
    dropFor(FILES, orderId); notify();
    void rehydrate(["customers and orders", "production", "files", "proofs and design", "payments and invoices"]);
    return { ok: true };
  }

  const i = ORDERS.indexOf(o); if (i >= 0) ORDERS.splice(i, 1);
  for (const a of [FILES, GJOBS, PJOBS, INSPECTIONS, RTASKS, DRECS, INVOICES, PROOFS, DESIGN_CORR, DESIGN_META] as { orderId: string }[][]) dropFor(a, orderId);
  logAudit({ entity: "order", entityId: orderId, action: "delete", reason: reason.trim(), detail: `${o.customer} · ${o.event} · ${o.workflow}` });
  notify();
  return { ok: true };
}

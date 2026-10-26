import { notifStore } from "./notifStore";
import { backendOn } from "./supabase";
import { stageLabel, type Order, type StageKey } from "./data";

// Demo-mode counterpart of the database's event notifications (supabase/migrations/0035): who is told when an order is created, moves between
// stages, is paid for, or fails QC. With the database on these come from triggers, so nothing happens here.
const ORDER_OF: StageKey[] = ["new_order", "files_received", "colour_grading", "admin_approval", "designing", "client_review", "final_approval", "printing", "qc", "ready_for_delivery", "delivered"];
const actorRole = () => { try { return localStorage.getItem("albumpro.role") ?? ""; } catch { return ""; } };

function tell(roles: string[], title: string, body: string, to: string) {
  if (backendOn) return;
  const who = roles.filter((r) => r !== actorRole());                 // you are not told about your own action
  if (who.length) notifStore.push({ title, body, time: "just now", to, roles: who });
}
const what = (o: Pick<Order, "id" | "customer">) => `${o.id} · ${o.customer}`;
const link = (o: Pick<Order, "id">) => `/orders/${o.id}`;
/** A page the receiving department can open. */
const stageLink = (o: Pick<Order, "id">, to: StageKey) => ({ colour_grading: "/colour-grading", designing: `/designing/${o.id}`, design_review: `/designing/${o.id}`, printing: "/printing", qc: "/qc" } as Partial<Record<StageKey, string>>)[to] ?? link(o);

export function notifyOrderCreated(o: Order) { tell(["admin", "reception"], "Order created", `${what(o)} · ${o.event}`, link(o)); }

export function notifyStage(o: Order, from: StageKey, to: StageKey) {
  const t = what(o), l = stageLink(o, to), back = ORDER_OF.indexOf(to) < ORDER_OF.indexOf(from);
  if (from === "client_review" && to === "designing") return tell(["admin", "designer"], "Corrections requested", t, l);
  if (from === "client_review" && to === "final_approval") return tell(["admin"], "Client approved the proof — final approval needed", t, l);
  if (back) return tell(["admin", { colour_grading: "colour", designing: "designer", printing: "printing", qc: "qc" }[to as string] ?? "reception"], `Sent back to ${stageLabel(to)}`, t, l);
  const m: Partial<Record<StageKey, [string[], string]>> = {
    colour_grading: [["colour"], "Colour grading assigned"], admin_approval: [["admin"], "Grading submitted — approval needed"], designing: [["designer"], "Design assigned"],
    client_review: [["admin", "reception"], "Proof ready to send to the client"], final_approval: [["admin"], "Final approval needed"], printing: [["printing"], "Released to printing"],
    qc: [["qc"], "Printing completed — QC needed"], ready_for_delivery: [["admin", "reception"], "QC passed — ready for delivery"], delivered: [["admin", "reception"], "Delivered"],
  };
  const e = m[to]; if (e) tell(e[0], e[1], t, l);
}

export function notifyPayment(o: Order, amount: number, kind: "payment" | "refund" = "payment") {
  tell(["admin", "accounts"], kind === "refund" ? "Refund issued" : "Payment received", `₹${amount.toLocaleString("en-IN")} · ${what(o)}`, "/payments");
}
export function notifyQcFailed(o: Order, defects: string[]) { tell(["admin", "printing"], "QC failed", `${o.id} · ${defects.join(", ")}`, "/qc"); }

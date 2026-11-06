import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

// "New order" everywhere in the app opens the order builder (src/pages/OrderBuilder.tsx):
// Order type → Customer → Event & dates → Albums & items → Invoice → Finalize, with drafts.
export type NewOrderType = "design_printing" | "printing_only";
interface Ctx { open: (opts?: { customerId?: string; type?: NewOrderType }) => void }
const NewOrderCtx = createContext<Ctx>({ open: () => {} });
export const useNewOrder = () => useContext(NewOrderCtx);

export function NewOrderProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const open = useCallback((o?: { customerId?: string; type?: NewOrderType }) => {
    const q = new URLSearchParams();
    if (o?.customerId) q.set("customer", o.customerId);
    if (o?.type) q.set("type", o.type);                                   // the builder starts with this order type chosen
    nav(q.toString() ? `/orders/new?${q}` : "/orders/new");
  }, [nav]);
  return <NewOrderCtx.Provider value={{ open }}>{children}</NewOrderCtx.Provider>;
}

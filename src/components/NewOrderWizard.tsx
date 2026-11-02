import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

// "New order" everywhere in the app opens the order builder (src/pages/OrderBuilder.tsx):
// Order type → Customer → Event & dates → Albums & items → Invoice → Finalize, with drafts.
interface Ctx { open: (opts?: { customerId?: string }) => void }
const NewOrderCtx = createContext<Ctx>({ open: () => {} });
export const useNewOrder = () => useContext(NewOrderCtx);

export function NewOrderProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const open = useCallback((o?: { customerId?: string }) => nav(o?.customerId ? `/orders/new?customer=${encodeURIComponent(o.customerId)}` : "/orders/new"), [nav]);
  return <NewOrderCtx.Provider value={{ open }}>{children}</NewOrderCtx.Provider>;
}

import { supabase, backendOn } from "../supabase";

// Shared plumbing for the database-backed data layer. Everything here is a no-op when the backend is off (demo mode).
export { backendOn };
export const sb = () => { if (!supabase) throw new Error("Backend is not configured"); return supabase; };

/** Errors from background writes (the UI is optimistic) are surfaced through this bus; Shell shows them as toasts. */
type Sub = (message: string) => void;
const errSubs = new Set<Sub>();
export const onDbError = (f: Sub) => { errSubs.add(f); return () => { errSubs.delete(f); }; };
export const reportDbError = (what: string, e: unknown) => {
  const msg = typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  console.error(`[db] ${what}:`, e);
  errSubs.forEach((f) => f(`${what}: ${msg}`));
};

/** Unwrap a PostgREST response; report and return null on error. */
export async function q<T>(what: string, p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) { reportDbError(what, error); return null; }
  return data;
}

/** Hydrators fill the shared in-memory arrays from the database after sign-in. Domain modules register themselves. */
const hydrators: { name: string; fn: () => Promise<void> }[] = [];
export const registerHydrator = (name: string, fn: () => Promise<void>) => { hydrators.push({ name, fn }); };
export async function hydrateAll() {
  for (const h of hydrators) { try { await h.fn(); } catch (e) { reportDbError(`Loading ${h.name}`, e); } }
}

/** Run a database write in the background after an optimistic local change; `revert` undoes the local change on failure. */
export function writeThrough(what: string, op: () => PromiseLike<{ error: { message: string } | null }>, revert?: () => void) {
  if (!backendOn) return;
  void Promise.resolve(op()).then(({ error }) => { if (error) { reportDbError(what, error); revert?.(); } }, (e) => { reportDbError(what, e); revert?.(); });
}

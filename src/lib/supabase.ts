import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Backend is opt-in: with VITE_USE_SUPABASE=true (and URL + publishable key) the app signs in with Supabase and reads
// permissions from the database. Otherwise it runs in demo mode on browser storage (used by the automated tests).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const backendOn = import.meta.env.VITE_USE_SUPABASE === "true" && !!url && !!key;
export const supabase: SupabaseClient | null = backendOn ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

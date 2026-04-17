import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createSupabaseClient(supabaseUrl, supabaseAnonKey)
    : null;

/** Server-side only — bypasses RLS for SQL execution in API routes */
export const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createSupabaseClient(supabaseUrl, supabaseServiceKey)
    : null;

export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const supabaseUrl = window.SUPABASE_URL || window.__ENV?.SUPABASE_URL;
export const supabaseAnonKey = window.SUPABASE_ANON_KEY || window.__ENV?.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase public configuration is missing. Set SUPABASE_URL and SUPABASE_ANON_KEY in js/core/env.js.");
}
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

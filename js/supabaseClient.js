import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl =
  window.SUPABASE_URL || "https://kvfssjjryzwjgulqjvws.supabase.co";
const supabaseAnonKey =
  window.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2ZnNzampyeXp3amd1bHFqdndzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1ODg3NTEsImV4cCI6MjEwMzE2NDc1MX0.cmRR-RKwejeC1cSteJCUcpcSJxvIt0lZ6a7eqrZa9TY";
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

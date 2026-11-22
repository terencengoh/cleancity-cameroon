import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
export const isConfigured = SUPABASE_URL.startsWith("http") && ANON.length > 20;

// Only the public anon key: admins sign in with their phone (OTP) and RLS/RPCs check profiles.role = 'admin'.
export const supabase = createClient(isConfigured ? SUPABASE_URL : "http://localhost:54321", isConfigured ? ANON : "public-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true },
});

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "./crypto.ts";
import { HttpError, requireEnv } from "./http.ts";

/** Service-role client. Bypasses RLS: only use after authorising the caller yourself. */
export function adminClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolves the signed-in user from the request's Authorization header. */
export async function requireUser(req: Request, admin: SupabaseClient): Promise<{ id: string; phone?: string }> {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "missing Authorization header");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "invalid session");
  return { id: data.user.id, phone: data.user.phone ?? undefined };
}

/** Client acting as the caller (their JWT): RLS and auth.uid() apply, e.g. for admin RPCs that audit the admin. */
export function userClient(req: Request): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Signed-in user whose profile role is admin. */
export async function requireAdmin(req: Request, admin: SupabaseClient): Promise<{ id: string }> {
  const user = await requireUser(req, admin);
  const { data } = await admin.from("profiles").select("role,suspended").eq("id", user.id).single();
  if (!data || data.role !== "admin" || data.suspended) throw new HttpError(403, "admin only");
  return { id: user.id };
}

/** Rejects suspended accounts. */
export async function requireActiveUser(req: Request, admin: SupabaseClient): Promise<{ id: string; phone?: string }> {
  const user = await requireUser(req, admin);
  const { data } = await admin.from("profiles").select("suspended").eq("id", user.id).single();
  if (data?.suspended) throw new HttpError(403, "account suspended, contact support", "suspended");
  return user;
}

/** True when the request carries the service-role key (cron / internal calls). */
export function isServiceRequest(req: Request): boolean {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return !!key && timingSafeEqual(bearer, key);
}

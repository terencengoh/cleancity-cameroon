// Payout providers for worker payments (MTN MoMo / Orange Money). Keys come from Supabase secrets only.
import { CamPayProvider } from "./campay.ts";
import { NotchPayProvider } from "./notchpay.ts";
import type { PaymentProvider } from "./types.ts";

export type ProviderName = "campay" | "notchpay";
export const PROVIDERS: ProviderName[] = ["campay", "notchpay"];

type Env = (name: string) => string | undefined;

function need(env: Env, name: string): string {
  const v = env(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

/** Builds a provider from environment variables (see supabase/functions/.env.example). */
export function getProvider(name?: string, env: Env = (k) => Deno.env.get(k)): PaymentProvider {
  const chosen = (name ?? env("PAYOUT_PROVIDER") ?? "campay") as ProviderName;
  switch (chosen) {
    case "campay":
      return new CamPayProvider({
        baseUrl: env("CAMPAY_BASE_URL") ?? "https://demo.campay.net/api",
        username: need(env, "CAMPAY_USERNAME"),
        password: need(env, "CAMPAY_PASSWORD"),
        webhookKey: need(env, "CAMPAY_WEBHOOK_KEY"),
      });
    case "notchpay":
      return new NotchPayProvider({
        baseUrl: env("NOTCHPAY_BASE_URL") ?? "https://api.notchpay.co",
        publicKey: need(env, "NOTCHPAY_PUBLIC_KEY"),
        webhookHashKey: need(env, "NOTCHPAY_WEBHOOK_HASH"),
        privateKey: env("NOTCHPAY_PRIVATE_KEY"),
      });
    default:
      throw new Error(`unknown payout provider ${chosen}`);
  }
}

export * from "./types.ts";

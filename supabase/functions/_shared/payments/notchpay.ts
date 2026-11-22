// Notch Pay adapter (Cameroon MTN MoMo "cm.mtn" + Orange Money "cm.orange", XAF).
// Docs: https://developer.notchpay.co/accept-payments/mobile-money
//   POST https://api.notchpay.co/payments            Authorization: <public key>
//        { amount, currency: "XAF", customer: { phone }, description, reference }   -> payment reference
//   POST https://api.notchpay.co/payments/{reference} { channel: "cm.mtn" | "cm.orange", data: { phone } }
//        -> the customer gets a push prompt to confirm on their phone
// Webhooks: https://developer.notchpay.co/get-started/webhooks/verify
//   Header x-notch-signature = hex(HMAC-SHA256(raw body, webhook hash key)); verify against the RAW body.
//   Event: { id, type: "payment.complete" | "payment.failed" | "payment.canceled" | "payment.expired" | ..., data: { id, reference, amount, status } }
//   (https://developer.notchpay.co/api-reference/webhooks)
// Transfers (payouts/refunds): https://developer.notchpay.co/api-reference/transfers
//   POST https://api.notchpay.co/transfers   Authorization: <public key>, X-Grant: <private key>
//        { amount, currency: "XAF", beneficiary_data: { name, phone }, channel: "cm.mtn" | "cm.orange", description, reference }
//        -> { transfer: { id, reference, status: pending | processing | complete | failed | canceled } }
//   GET  https://api.notchpay.co/transfers/{reference}  -> { transfer: { ... status } }
//   Webhook events transfer.complete / transfer.failed. Transfers only work from IP addresses whitelisted in
//   the Notch Pay dashboard -> Supabase Edge Functions (no fixed IP) need a static-IP egress proxy for payouts.
import { hmacSha256Hex, timingSafeEqual } from "../crypto.ts";
import {
  type FetchFn,
  type InitiateInput,
  type InitiateResult,
  type NormalizedEvent,
  type PaymentProvider,
  type PayoutInput,
  type PayoutResult,
  ProviderError,
  type WebhookRequest,
  WebhookVerificationError,
} from "./types.ts";

export interface NotchPayConfig {
  baseUrl: string; // https://api.notchpay.co
  publicKey: string;
  webhookHashKey: string;
  /** Private key, sent as X-Grant; only needed for transfers. */
  privateKey?: string;
}

const CHANNEL = { mtn: "cm.mtn", orange: "cm.orange" } as const;

export class NotchPayProvider implements PaymentProvider {
  readonly name = "notchpay";
  constructor(private cfg: NotchPayConfig, private fetchFn: FetchFn = fetch) {}

  private async call(path: string, body: unknown) {
    const res = await this.fetchFn(`${this.cfg.baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: this.cfg.publicKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(`Notch Pay ${path} failed (${res.status})`, json);
    return json;
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const phone = `+${input.phone}`;
    const created = await this.call("/payments", {
      amount: input.amountXaf,
      currency: "XAF",
      customer: { phone },
      description: input.description,
      reference: input.paymentId,
    });
    const reference: string | undefined = created?.transaction?.reference ?? created?.payment?.reference ?? created?.reference;
    if (!reference) throw new ProviderError("Notch Pay did not return a payment reference", created);
    const processed = await this.call(`/payments/${encodeURIComponent(reference)}`, {
      channel: CHANNEL[input.method],
      data: { phone },
    });
    return { providerRef: reference, status: "pending", raw: { created, processed } };
  }

  async verifyWebhook(req: WebhookRequest): Promise<NormalizedEvent> {
    const received = req.headers.get("x-notch-signature") ?? "";
    if (!received) throw new WebhookVerificationError("missing x-notch-signature");
    const expected = await hmacSha256Hex(this.cfg.webhookHashKey, req.rawBody);
    if (!timingSafeEqual(expected, received.toLowerCase())) throw new WebhookVerificationError("invalid Notch Pay signature");
    let evt: { id?: string; type?: string; data?: Record<string, unknown> };
    try {
      evt = JSON.parse(req.rawBody);
    } catch {
      throw new WebhookVerificationError("invalid JSON");
    }
    const data = evt.data ?? {};
    const type = String(evt.type ?? evt["event" as keyof typeof evt] ?? "");
    if (type.startsWith("transfer.")) {
      const ref = (data.reference ?? data.merchant_reference) as string | undefined;
      return {
        kind: "transfer",
        reference: ref ?? null,
        eventId: String(evt.id ?? `${ref}:${type}`),
        paymentId: null,
        providerRef: (data.id as string | undefined) ?? ref ?? null,
        status: type === "transfer.complete" ? "successful" : ["transfer.failed", "transfer.canceled"].includes(type) ? "failed" : "ignored",
        amountXaf: data.amount != null ? Math.round(Number(data.amount)) : null,
        raw: evt,
      };
    }
    const status = type === "payment.complete" ? "successful"
      : ["payment.failed", "payment.canceled", "payment.expired"].includes(type) ? "failed"
      : "ignored";
    const merchantRef = (data.merchant_reference ?? data.reference) as string | undefined;
    const providerRef = (data.reference ?? data.id) as string | undefined;
    return {
      eventId: String(evt.id ?? `${providerRef}:${type}`),
      paymentId: merchantRef ?? null,
      providerRef: providerRef ?? null,
      status,
      amountXaf: data.amount != null ? Math.round(Number(data.amount)) : null,
      raw: evt,
    };
  }

  private transferHeaders(): Record<string, string> {
    if (!this.cfg.privateKey) throw new ProviderError("NOTCHPAY_PRIVATE_KEY is required for transfers", null, true);
    return { Authorization: this.cfg.publicKey, "X-Grant": this.cfg.privateKey, "Content-Type": "application/json", Accept: "application/json" };
  }

  async payout(input: PayoutInput): Promise<PayoutResult> {
    const headers = this.transferHeaders();
    const res = await this.fetchFn(`${this.cfg.baseUrl}/transfers`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        amount: input.amountXaf,
        currency: "XAF",
        beneficiary_data: { name: input.name.slice(0, 80) || "CleanCity worker", phone: `+${input.phone}` },
        channel: CHANNEL[input.method],
        description: input.description.slice(0, 100),
        reference: input.reference,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(`Notch Pay transfer failed (${res.status})`, body, res.status >= 400 && res.status < 500 && res.status !== 409);
    const t = body?.transfer ?? body;
    return { providerRef: t?.id ? String(t.id) : null, ...mapTransfer(t?.status), raw: body };
  }

  async payoutStatus(reference: string, _providerRef: string | null): Promise<PayoutResult> {
    const res = await this.fetchFn(`${this.cfg.baseUrl}/transfers/${encodeURIComponent(reference)}`, { headers: this.transferHeaders() });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(`Notch Pay transfer status failed (${res.status})`, body);
    const t = body?.transfer ?? body;
    return { providerRef: t?.id ? String(t.id) : null, ...mapTransfer(t?.status), raw: body };
  }
}

function mapTransfer(s: unknown): { status: PayoutResult["status"]; failureReason?: string } {
  const v = String(s ?? "pending").toLowerCase();
  if (v === "complete" || v === "completed") return { status: "successful" };
  if (v === "failed" || v === "canceled" || v === "cancelled") return { status: "failed", failureReason: `notchpay_${v}` };
  return { status: "pending" };
}

// CamPay adapter (Cameroon only: MTN Mobile Money + Orange Money, XAF).
// API reference (Postman docs): https://documenter.getpostman.com/view/2391374/T1LV8PVA
//   POST {base}/token/    { username, password }            -> { token, expires_in }
//   POST {base}/collect/  Authorization: Token <token>
//        { amount: "<integer>", currency: "XAF", from: "2376XXXXXXXX", description, external_reference }
//        -> { reference, ussd_code, operator }   (status starts PENDING; idempotent on external_reference)
//   GET  {base}/transaction/<reference>/ -> status PENDING | SUCCESSFUL | FAILED
//   Callback (GET query or POST JSON, configured per app): status, reference, amount, currency, operator,
//        code, operator_reference, external_reference, signature (JWT signed HS256 with the app's webhook key).
//        "Callbacks are sent one time and not retried" -> also poll /transaction/ for stuck payments.
//   POST {base}/withdraw/ Authorization: Token <token>
//        { amount, to: "2376XXXXXXXX", description, external_reference } -> { reference, status? }
//        Withdrawals must be enabled for the app in the CamPay dashboard and the balance funded.
//   Sandbox test numbers: 237677777777 (MTN success), 237677777770 (MTN fail), 237699999999 (Orange success),
//   237699999990 (Orange fail).
// Base URLs: sandbox https://demo.campay.net/api , live https://www.campay.net/api
// The operator is chosen by CamPay from the payer's number, so MTN and Orange use the same call.
import { verifyHs256Jwt } from "../crypto.ts";
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

export interface CamPayConfig {
  baseUrl: string;
  username: string;
  password: string;
  webhookKey: string;
}

export class CamPayProvider implements PaymentProvider {
  readonly name = "campay";
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private cfg: CamPayConfig, private fetchFn: FetchFn = fetch) {}

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const res = await this.fetchFn(`${this.cfg.baseUrl}/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.cfg.username, password: this.cfg.password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token) throw new ProviderError("CamPay token request failed", body);
    this.token = { value: body.token, expiresAt: Date.now() + Number(body.expires_in ?? 3000) * 1000 };
    return body.token;
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    if (!Number.isInteger(input.amountXaf) || input.amountXaf <= 0) throw new ProviderError("amount must be a positive integer");
    const token = await this.getToken();
    const res = await this.fetchFn(`${this.cfg.baseUrl}/collect/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
      body: JSON.stringify({
        amount: String(input.amountXaf),
        currency: "XAF",
        from: input.phone,
        description: input.description.slice(0, 100),
        external_reference: input.paymentId,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.reference) throw new ProviderError(`CamPay collect failed (${res.status})`, body);
    return { providerRef: String(body.reference), status: "pending", ussdCode: body.ussd_code, raw: body };
  }

  async verifyWebhook(req: WebhookRequest): Promise<NormalizedEvent> {
    let params: Record<string, string> = {};
    if (req.method === "GET") {
      params = Object.fromEntries(new URL(req.url).searchParams.entries());
    } else {
      try {
        params = JSON.parse(req.rawBody);
      } catch {
        params = Object.fromEntries(new URLSearchParams(req.rawBody).entries());
      }
    }
    const signature = params.signature;
    if (!signature) throw new WebhookVerificationError("missing signature");
    try {
      await verifyHs256Jwt(signature, this.cfg.webhookKey);
    } catch (e) {
      throw new WebhookVerificationError(`invalid CamPay signature: ${(e as Error).message}`);
    }
    const status = String(params.status ?? "").toUpperCase();
    const reference = params.reference ? String(params.reference) : null;
    if (!reference) throw new WebhookVerificationError("missing reference");
    const ext = params.external_reference ? String(params.external_reference) : null;
    const isTransfer = !!ext && /^cc-/.test(ext); // callbacks for our withdrawals (worker payouts, reference "cc-<assignment uuid>")
    return {
      kind: isTransfer ? "transfer" : "payment",
      reference: isTransfer ? ext : null,
      eventId: `${reference}:${status}`,
      paymentId: isTransfer ? null : ext,
      providerRef: reference,
      status: status === "SUCCESSFUL" ? "successful" : status === "FAILED" ? "failed" : "ignored",
      amountXaf: params.amount != null ? Math.round(Number(params.amount)) : null,
      raw: { ...params, signature: "[redacted]" },
    };
  }

  async payout(input: PayoutInput): Promise<PayoutResult> {
    if (!Number.isInteger(input.amountXaf) || input.amountXaf <= 0) throw new ProviderError("amount must be a positive integer", null, true);
    const token = await this.getToken();
    const res = await this.fetchFn(`${this.cfg.baseUrl}/withdraw/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
      body: JSON.stringify({
        amount: String(input.amountXaf),
        to: input.phone,
        description: input.description.slice(0, 100),
        external_reference: input.reference,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.reference) {
      // 4xx = CamPay refused the request (validation, balance, withdrawals disabled): nothing was sent.
      throw new ProviderError(`CamPay withdraw failed (${res.status})`, body, res.status >= 400 && res.status < 500);
    }
    return { providerRef: String(body.reference), ...mapStatus(body.status), raw: body };
  }

  async payoutStatus(_reference: string, providerRef: string | null): Promise<PayoutResult> {
    if (!providerRef) throw new ProviderError("CamPay status needs the CamPay reference");
    const token = await this.getToken();
    const res = await this.fetchFn(`${this.cfg.baseUrl}/transaction/${encodeURIComponent(providerRef)}/`, {
      headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(`CamPay status failed (${res.status})`, body);
    return { providerRef, ...mapStatus(body.status), raw: body };
  }
}

function mapStatus(s: unknown): { status: PayoutResult["status"]; failureReason?: string } {
  const v = String(s ?? "PENDING").toUpperCase();
  if (v === "SUCCESSFUL") return { status: "successful" };
  if (v === "FAILED") return { status: "failed", failureReason: "provider_reported_failure" };
  return { status: "pending" };
}

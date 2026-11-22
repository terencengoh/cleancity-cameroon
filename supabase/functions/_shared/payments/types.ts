// Provider-agnostic payment types. Amounts are integer FCFA (XAF).

export type MobileMoneyMethod = "mtn" | "orange";

export interface InitiateInput {
  /** Our payments.id (UUID). Sent to the provider as the merchant/external reference. */
  paymentId: string;
  amountXaf: number;
  /** Normalised "2376XXXXXXXX". */
  phone: string;
  method: MobileMoneyMethod;
  description: string;
}

export interface InitiateResult {
  providerRef: string | null;
  status: "pending" | "successful" | "failed";
  /** Code the customer can dial if the push prompt does not arrive (e.g. *126# for MTN). */
  ussdCode?: string;
  /** Hosted checkout page (CinetPay): the app opens it in a browser. */
  checkoutUrl?: string;
  raw: unknown;
}

/** Money sent from our merchant balance to a mobile money wallet (payouts and refunds). */
export interface PayoutInput {
  /** Our idempotent reference: "po-<payout uuid>" or "rf-<refund uuid>". */
  reference: string;
  amountXaf: number;
  /** Normalised "2376XXXXXXXX". */
  phone: string;
  method: MobileMoneyMethod;
  /** Beneficiary name (some providers require it). */
  name: string;
  description: string;
}

export interface PayoutResult {
  providerRef: string | null;
  status: "pending" | "successful" | "failed";
  failureReason?: string;
  raw: unknown;
}

export interface WebhookRequest {
  method: string;
  url: string;
  headers: Headers;
  rawBody: string;
}

export interface NormalizedEvent {
  /** "payment" (default) = customer collection; "transfer" = payout/refund we sent. */
  kind?: "payment" | "transfer";
  /** For transfers: our reference ("po-<uuid>" / "rf-<uuid>"). */
  reference?: string | null;
  /** Stable id for idempotency (unique per provider). */
  eventId: string;
  /** Our payments.id when the provider echoes it back. */
  paymentId: string | null;
  providerRef: string | null;
  status: "successful" | "failed" | "ignored";
  amountXaf: number | null;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  /** Verifies authenticity (signature) and normalises the event. Throws WebhookVerificationError. */
  verifyWebhook(req: WebhookRequest): Promise<NormalizedEvent>;
  /** Sends money to a mobile money wallet. Idempotent on input.reference where the provider supports it. */
  payout(input: PayoutInput): Promise<PayoutResult>;
  /** Current status of a transfer created by payout(). */
  payoutStatus(reference: string, providerRef: string | null): Promise<PayoutResult>;
}

export class WebhookVerificationError extends Error {}
export class ProviderError extends Error {
  /** definitive=true: the provider clearly refused (no money moved), so the request can be marked failed. */
  constructor(message: string, public details?: unknown, public definitive = false) {
    super(message);
  }
}

export type FetchFn = typeof fetch;

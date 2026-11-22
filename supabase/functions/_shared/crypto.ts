// Small WebCrypto helpers (no dependencies): HMAC-SHA256 and HS256 JWT verification.

const enc = new TextEncoder();

async function hmacKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}

export function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Verifies an HS256 JWT and returns its payload. Throws on bad format, alg, signature or expiry. */
export async function verifyHs256Jwt(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed JWT");
  const [h, p, sig] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  if (header.alg !== "HS256") throw new Error("unexpected JWT alg");
  const key = await hmacKey(secret, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), enc.encode(`${h}.${p}`));
  if (!ok) throw new Error("bad JWT signature");
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  if (typeof payload.exp === "number" && payload.exp < nowSec) throw new Error("JWT expired");
  return payload;
}

/** Test helper: sign an HS256 JWT. */
export async function signHs256Jwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const h = bytesToB64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const p = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${h}.${p}`)));
  return `${h}.${p}.${bytesToB64url(sig)}`;
}

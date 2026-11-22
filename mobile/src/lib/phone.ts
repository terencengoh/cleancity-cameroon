// Mirror of supabase/functions/_shared/phone.ts (client-side hints only; the server re-validates).
export type Operator = "mtn" | "orange";

export function normalizeCmPhone(input: string): string | null {
  let digits = (input ?? "").replace(/\D/g, "");
  if (digits.startsWith("00237")) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith("237")) digits = digits.slice(3);
  if (!/^6\d{8}$/.test(digits)) return null;
  return "237" + digits;
}

export function detectOperator(normalized: string): Operator | null {
  const n = normalized.startsWith("237") ? normalized.slice(3) : normalized;
  const p2 = Number(n.slice(0, 2));
  const p3 = Number(n.slice(0, 3));
  if (p2 === 67 || (p3 >= 650 && p3 <= 654) || (p3 >= 680 && p3 <= 689)) return "mtn";
  if (p2 === 69 || (p3 >= 655 && p3 <= 659)) return "orange";
  return null;
}

export const toE164 = (normalized: string) => `+${normalized}`;

// Cameroon mobile numbers: +237 6XX XXX XXX (9 national digits).
// Operator prefixes (approximate; operators add ranges over time):
//   MTN:    67X, 650-654, 680-689   Orange: 69X, 655-659
// Source for the ranges used by a payment aggregator: https://docs.cinetpay.com/api/1.0-fr/transfert/annexe

export type Operator = "mtn" | "orange";

/** Returns the 12-digit international form "2376XXXXXXXX" or null when invalid. */
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

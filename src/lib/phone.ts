/**
 * WhatsApp identifies people by "wa_id": digits only, with the country code (e.g. "26771234567").
 * We store staff phones as E.164 ("+26771234567").
 */

const BOTSWANA = "267";

/** Normalises user-typed or WhatsApp numbers to E.164. Local 8-digit Botswana numbers get +267. */
export function toE164(input: string, defaultCountry = BOTSWANA): string | null {
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.length === 8) digits = defaultCountry + digits; // local Botswana number
  if (!/^\d{8,15}$/.test(digits)) return null;
  return `+${digits}`;
}

/** "+26771234567" → "26771234567" */
export function toWaId(e164: string): string {
  return e164.replace(/^\+/, "");
}

// WhatsApp deep-link helper for Centre Ennajd.
//
// One constant, one file — changing the destination number later is a
// one-line edit. `buildWhatsAppLink` already accepts an optional phone
// argument, so per-student sending (each student's `whatsappPhone` from the
// base) can be added later without redesign.
//
// Note: WhatsApp cannot auto-send via wa.me — the link only pre-fills the
// chat text; the final "send" tap happens inside WhatsApp itself.

/** Default destination number (international format, no "+"). */
export const WHATSAPP_DEFAULT_PHONE = "212754494897";

/**
 * Normalize a phone number to digits-only, international format.
 * Accepts "+212 7 54 49 48 97", "212754494897", and the Moroccan local
 * form "0754494897" (re-anchored on the 212 country code).
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // Moroccan local format: 10 digits starting with "0".
  if (digits.length === 10 && digits.startsWith("0")) {
    return `212${digits.slice(1)}`;
  }
  return digits;
}

/**
 * Build a `wa.me` deep link with the message text pre-filled. Multi-line
 * text is fine — `encodeURIComponent` preserves the newlines.
 */
export function buildWhatsAppLink(
  text: string,
  phone: string = WHATSAPP_DEFAULT_PHONE,
): string {
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;
}

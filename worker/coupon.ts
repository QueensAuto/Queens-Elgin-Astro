/**
 * Booking coupon codes, e.g. "7KQ4MX". Display-only: the code appears in the shop's
 * lead email (the record of issued codes), the customer's confirmation and the
 * on-page thank-you.
 *
 * 32 characters with look-alikes removed (no 0/O, 1/I), so a code is easy to read
 * out at the counter. 32^6 ≈ 1.07 billion possible codes. 256 is a multiple of 32,
 * so `byte % 32` picks every character with equal probability.
 */
export const COUPON_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCoupon(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = "";
  for (const b of bytes) code += COUPON_ALPHABET[b % COUPON_ALPHABET.length];
  return code;
}

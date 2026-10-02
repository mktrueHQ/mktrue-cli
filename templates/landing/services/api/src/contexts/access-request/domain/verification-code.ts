import { createHash, timingSafeEqual } from "node:crypto";

/**
 * A six-digit code, and only its **hash** ever travels in the token — a token carrying the
 * code itself would let anyone who intercepts it verify without reading the mail, which is the one
 * thing the code exists to prove.
 *
 * SHA-256 without a salt is correct here and would not be for a password: the input space is six
 * digits either way, so a salt buys nothing against an offline attacker, while the token's HMAC
 * already stops the hash being swapped. What actually bounds guessing is the rate limit on the
 * verify route.
 */
export class VerificationCode {
  private constructor(readonly value: string) {}

  /** Wraps an already-generated six-digit string. Throws if it is not one. */
  static of(value: string): VerificationCode {
    if (!/^\d{6}$/.test(value)) throw new Error("a verification code is exactly six digits");
    return new VerificationCode(value);
  }

  hash(): string {
    return createHash("sha256").update(this.value).digest("hex");
  }

  /**
   * Constant-time comparison against a stored hash. A plain `===` on hex strings leaks how many
   * leading characters matched through timing — small, but free to avoid, and this is the check
   * standing between a stranger and a verified request.
   */
  matches(expectedHash: string): boolean {
    const actual = Buffer.from(this.hash(), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
}

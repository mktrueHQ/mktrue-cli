/**
 * A six-digit code. It has no hash of its own: six digits are a million values, so only a MAC keyed
 * with the server's secret may stand for it in a token (`TokenSigner.sealCode`).
 */
export class VerificationCode {
  private constructor(readonly value: string) {}

  /** Wraps an already-generated six-digit string. Throws if it is not one. */
  static of(value: string): VerificationCode {
    if (!/^\d{6}$/.test(value)) throw new Error("a verification code is exactly six digits");
    return new VerificationCode(value);
  }
}

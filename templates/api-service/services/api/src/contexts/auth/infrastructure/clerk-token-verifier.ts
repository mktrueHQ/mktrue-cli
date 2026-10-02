import { verifyToken } from "@clerk/backend";
import { TokenVerificationError, TokenVerificationErrorReason } from "@clerk/backend/errors";

import { AuthUnavailableError, InvalidTokenError } from "../application/errors";
import type { AuthenticatedUser, TokenVerifier } from "../application/ports";

export interface ClerkVerifierConfig {
  readonly secretKey: string;
  readonly issuer: string;
}

export class ClerkTokenVerifier implements TokenVerifier {
  constructor(private readonly clerk: ClerkVerifierConfig) {
    if (!clerk.secretKey || !clerk.issuer) {
      throw new Error("ClerkTokenVerifier requires both secretKey and issuer");
    }
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    const payload = await this.verifyWithProvider(token);

    if (payload.iss !== this.clerk.issuer) {
      throw new InvalidTokenError("issued by a different instance");
    }
    if (!payload.sub) {
      throw new InvalidTokenError("verified token carries no subject");
    }

    return { userId: payload.sub };
  }

  private async verifyWithProvider(
    token: string,
  ): Promise<Awaited<ReturnType<typeof verifyToken>>> {
    try {
      return await verifyToken(token, { secretKey: this.clerk.secretKey });
    } catch (error: unknown) {
      throw classifyFailure(error);
    }
  }
}

const UNDECIDABLE_REASONS: ReadonlySet<string> = new Set([
  TokenVerificationErrorReason.RemoteJWKFailedToLoad,
  TokenVerificationErrorReason.RemoteJWKInvalid,
  TokenVerificationErrorReason.LocalJWKMissing,
  TokenVerificationErrorReason.JWKFailedToResolve,
  TokenVerificationErrorReason.InvalidSecretKey,
]);

function classifyFailure(error: unknown): Error {
  if (error instanceof TokenVerificationError) {
    return UNDECIDABLE_REASONS.has(error.reason)
      ? new AuthUnavailableError(`the provider could not verify: ${error.reason}`)
      : new InvalidTokenError(error.reason);
  }

  return new AuthUnavailableError("verification failed unexpectedly");
}

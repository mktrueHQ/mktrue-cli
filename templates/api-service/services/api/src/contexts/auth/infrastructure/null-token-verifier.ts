import { AuthNotConfiguredError } from "../application/errors";
import type { AuthenticatedUser, TokenVerifier } from "../application/ports";

export class NullTokenVerifier implements TokenVerifier {
  verify(): Promise<AuthenticatedUser> {
    return Promise.reject(new AuthNotConfiguredError("no token verifier is configured"));
  }
}

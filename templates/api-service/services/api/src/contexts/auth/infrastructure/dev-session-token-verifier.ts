import { InvalidTokenError } from "../application/errors";
import type { AuthenticatedUser, TokenVerifier } from "../application/ports";

export class DevSessionTokenVerifier implements TokenVerifier {
  private readonly userId: string;

  constructor(session: { readonly userId: string }) {
    if (!session.userId) throw new Error("DevSessionTokenVerifier requires a user id");
    this.userId = session.userId;
  }

  verify(token: string): Promise<AuthenticatedUser> {
    return token === this.userId
      ? Promise.resolve({ userId: this.userId })
      : Promise.reject(new InvalidTokenError("not the dev session's token"));
  }
}

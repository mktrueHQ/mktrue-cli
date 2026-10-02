import { InvalidTokenError } from "@api/contexts/auth/application/errors";
import type { AuthenticatedUser, TokenVerifier } from "@api/contexts/auth/application/ports";

export class FakeTokenVerifier implements TokenVerifier {
  timesCalled = 0;

  private constructor(
    private readonly outcome:
      { user: AuthenticatedUser } | { byToken: ReadonlyMap<string, string> } | { error: Error },
  ) {}

  static verifyingAs(userId: string): FakeTokenVerifier {
    return new FakeTokenVerifier({ user: { userId } });
  }

  static verifyingTokens(byToken: Readonly<Record<string, string>>): FakeTokenVerifier {
    return new FakeTokenVerifier({ byToken: new Map(Object.entries(byToken)) });
  }

  static rejectingEveryToken(): FakeTokenVerifier {
    return new FakeTokenVerifier({ error: new InvalidTokenError("rejected by test fake") });
  }

  verify(token: string): Promise<AuthenticatedUser> {
    this.timesCalled += 1;
    if ("user" in this.outcome) return Promise.resolve(this.outcome.user);
    if ("error" in this.outcome) return Promise.reject(this.outcome.error);

    const userId = this.outcome.byToken.get(token);
    return userId === undefined
      ? Promise.reject(new InvalidTokenError("no principal for this token in the test fake"))
      : Promise.resolve({ userId });
  }
}

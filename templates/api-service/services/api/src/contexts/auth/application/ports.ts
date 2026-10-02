export interface AuthenticatedUser {
  readonly userId: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthenticatedUser>;
}

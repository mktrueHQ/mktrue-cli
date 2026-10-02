export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(`token rejected: ${reason}`);
    this.name = "InvalidTokenError";
  }
}

export class NotAdmittedError extends Error {
  constructor() {
    super("the authenticated principal is not admitted");
    this.name = "NotAdmittedError";
  }
}

export class AuthUnavailableError extends Error {
  constructor(reason: string) {
    super(`authentication unavailable: ${reason}`);
    this.name = "AuthUnavailableError";
  }
}

export class AuthNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`authentication is not configured: ${reason}`);
    this.name = "AuthNotConfiguredError";
  }
}

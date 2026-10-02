import { isSupportedTimeZone } from "../../shared/domain/civil-date";

export const LOCALES = [__MKTRUE_LOCALES__] as const;

export type Locale = (typeof LOCALES)[number];

export type ProfileValidationIssue =
  | { readonly field: "locale"; readonly reason: "unsupported_locale" }
  | { readonly field: "timeZone"; readonly reason: "unsupported_time_zone" };

export class InvalidProfileError extends Error {
  readonly issues: readonly ProfileValidationIssue[];

  constructor(issues: readonly ProfileValidationIssue[]) {
    super(
      `invalid user profile: ${issues.map((issue) => `${issue.field}/${issue.reason}`).join(", ")}`,
    );
    this.name = "InvalidProfileError";
    this.issues = issues;
  }
}

export interface UserProfileProps {
  readonly locale?: Locale;
  readonly timeZone?: string;
}

export interface UserProfileInput {
  readonly locale?: string;
  readonly timeZone?: string;
}

export class UserProfile {
  private constructor(private readonly props: UserProfileProps) {}

  static create(input: UserProfileInput): UserProfile {
    return new UserProfile({
      ...(input.locale === undefined ? {} : { locale: toLocale(input.locale) }),
      ...(input.timeZone === undefined ? {} : { timeZone: toTimeZone(input.timeZone) }),
    });
  }

  get locale(): Locale | undefined {
    return this.props.locale;
  }

  get timeZone(): string | undefined {
    return this.props.timeZone;
  }

  toJSON(): UserProfileProps {
    return { ...this.props };
  }
}

export function toLocale(value: string): Locale {
  const found = LOCALES.find((locale) => locale === value);
  if (found === undefined) {
    throw new InvalidProfileError([{ field: "locale", reason: "unsupported_locale" }]);
  }
  return found;
}

export function toTimeZone(value: string): string {
  if (!isSupportedTimeZone(value)) {
    throw new InvalidProfileError([{ field: "timeZone", reason: "unsupported_time_zone" }]);
  }
  return value;
}

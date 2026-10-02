import type {
  AccessRequestRepository,
  SendBudget,
  Clock,
  CodeGenerator,
  Logger,
  Mailer,
  StoredAccessRequest,
} from "../../src/contexts/access-request/application/ports";
import { VerificationCode } from "../../src/contexts/access-request/domain/verification-code";
import type { AccessRequest } from "../../src/contexts/access-request/domain/access-request";

export interface SentMail {
  readonly kind: "code" | "delivery";
  readonly to: string;
  readonly code?: string;
  readonly email?: string;
}

export function fakeMailer() {
  const sent: SentMail[] = [];
  const mailer: Mailer = {
    async sendVerificationCode({ to, code }) {
      sent.push({ kind: "code", to, code });
    },
    async deliverAccessRequest({ request, to }) {
      sent.push({ kind: "delivery", to, email: request.email });
    },
  };
  return { mailer, sent };
}

export function refusingMailer(error: Error): Mailer {
  return {
    async sendVerificationCode() {
      throw error;
    },
    async deliverAccessRequest() {
      throw error;
    },
  };
}

export function fixedClock(at: Date): Clock & { set(next: Date): void } {
  let now = at;
  return { now: () => now, set: (next) => (now = next) };
}

export function fixedCodeGenerator(code: string): CodeGenerator {
  return { generate: () => VerificationCode.of(code) };
}

/** An in-memory mailbox with the same claim-on-address rule as the Mongo adapter. */
export function fakeRepository() {
  const rows = new Map<string, StoredAccessRequest>();
  // Beside the rows rather than on them, because a digest is an internal replay marker and reaches
  // no DTO — which is exactly how the Mongo adapter treats it.
  const digests = new Map<string, readonly string[]>();
  const repository: AccessRequestRepository = {
    /**
     * **Atomic, and the way it is atomic is the point.** Everything here runs before the first
     * `await`, so an interleaved caller cannot observe the row between the check and the push —
     * which is what the Mongo adapter buys with one `findOneAndUpdate`. Written any other way, this
     * fake would pass a test that the real thing fails.
     */
    async claimVerification(
      request: AccessRequest,
      requestedAt: Date,
      tokenDigest: string,
      keepDigests: number,
    ) {
      const held = digests.get(request.email) ?? [];
      if (held.includes(tokenDigest)) return { claimed: false, createdRow: false };

      const existing = rows.get(request.email);
      digests.set(request.email, [...held, tokenDigest].slice(-keepDigests));
      rows.set(request.email, {
        id: existing?.id ?? String(rows.size + 1),
        email: request.email,
        ...(request.note === undefined ? {} : { note: request.note }),
        requestedAt,
        status: existing?.status ?? "new",
      });
      return { claimed: true, createdRow: existing === undefined };
    },
    async releaseVerification(email: string, tokenDigest: string, createdRow: boolean) {
      const held = (digests.get(email) ?? []).filter((digest) => digest !== tokenDigest);
      digests.set(email, held);
      // Only while nothing else holds the row: a concurrent verification of another token may have
      // delivered successfully in the meantime.
      if (createdRow && held.length === 0) {
        rows.delete(email);
        digests.delete(email);
      }
    },
    async list() {
      return [...rows.values()];
    },
  };
  return { repository, rows };
}

/**
 * A mailbox that is simply not there: every call rejects, as a dropped connection would.
 *
 * The error is a parameter so a test can inject a realistic one — a driver error quotes the filter
 * it failed on, which is how an address and a digest get near a log line in the first place.
 */
export function unavailableRepository(
  error: Error = new Error("mongo is down"),
): AccessRequestRepository {
  return {
    claimVerification: () => Promise.reject(error),
    releaseVerification: () => Promise.reject(error),
    list: () => Promise.resolve([]),
  };
}

export function recordingLogger() {
  const lines: { code: string; error: unknown }[] = [];
  const logger: Logger = { error: (code, error) => lines.push({ code, error }) };
  return { logger, lines };
}

/** An in-memory budget that reports what it counted, so a test can assert on the ceiling itself. */
export function fakeSendBudget() {
  const days = new Map<string, number>();
  const budget: SendBudget = {
    async reserve(day, limit, cost) {
      const next = (days.get(day) ?? 0) + cost;
      days.set(day, next);
      return next <= limit;
    },
  };
  return { budget, days };
}

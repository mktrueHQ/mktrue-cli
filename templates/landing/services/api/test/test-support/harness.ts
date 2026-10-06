import { startAccessRequest } from "../../src/contexts/access-request/application/start-access-request";
import { verifyAccessRequest } from "../../src/contexts/access-request/application/verify-access-request";
import type {
  AccessRequestRepository,
  Mailer,
} from "../../src/contexts/access-request/application/ports";
import { createHmacTokenSigner } from "../../src/contexts/access-request/infrastructure/hmac-token-signer";
import { createInMemoryWrongCodeCounter } from "../../src/contexts/access-request/infrastructure/in-memory-wrong-code-counter";
import {
  fakeMailer,
  fakeRepository,
  fakeSendBudget,
  fixedClock,
  fixedCodeGenerator,
  recordingLogger,
} from "./fakes";

export const AT = new Date("2026-09-09T21:04:00.000Z");
export const CODE = "040722";
export const EMAIL = "marta@example.com";
// prettier-ignore
export const DESTINATION = "__MKTRUE_OWNER__@example.com";

/** Four units, and a start costs two, so the ceiling is two starts a day. */
const DAILY_SEND_LIMIT = 4;

/**
 * `dailySendLimit + 1`, exactly as `config.ts` derives it — so a test that crosses midnight UTC
 * exercises the real arithmetic rather than a number chosen to make the suite comfortable.
 */
const VERIFICATION_MEMORY = DAILY_SEND_LIMIT + 1;

export interface HarnessOverrides {
  readonly repository?: AccessRequestRepository;
  /** When set, the delivery to __MKTRUE_OWNER__ rejects with this while the code mail still sends. */
  readonly deliveryFails?: Error;
  /** How many tokens the wrong-code counter holds. The replay memory's size, when left out. */
  readonly countedTokens?: number;
}

/** The whole flow against fakes: one address, one code, one clock a test can move. */
export function harness(overrides: HarnessOverrides = {}) {
  const base = fakeMailer();
  const failure = overrides.deliveryFails;
  const mailer: Mailer =
    failure === undefined
      ? base.mailer
      : {
          sendVerificationCode: (input) => base.mailer.sendVerificationCode(input),
          deliverAccessRequest: () => Promise.reject(failure),
        };

  const mailbox = fakeRepository();
  const { logger, lines } = recordingLogger();
  const clock = fixedClock(AT);
  const tokenSigner = createHmacTokenSigner("test-secret");
  const { budget, days } = fakeSendBudget();
  const wrongCodes = createInMemoryWrongCodeCounter(overrides.countedTokens ?? VERIFICATION_MEMORY);

  return {
    sent: base.sent,
    rows: mailbox.rows,
    lines,
    clock,
    tokenSigner,
    days,
    /** Deliveries only — the mail a replay must not send twice. */
    delivered: () => base.sent.filter((mail) => mail.kind === "delivery"),
    start: () =>
      startAccessRequest(
        { email: EMAIL, note: "I want to see the undo log." },
        {
          mailer,
          tokenSigner,
          clock,
          codeGenerator: fixedCodeGenerator(CODE),
          sendBudget: budget,
          dailySendLimit: DAILY_SEND_LIMIT,
        },
      ),
    verify: (token: string, code: string) =>
      verifyAccessRequest(
        { token, code },
        {
          mailer,
          tokenSigner,
          clock,
          repository: overrides.repository ?? mailbox.repository,
          logger,
          destinationEmail: DESTINATION,
          verificationMemory: VERIFICATION_MEMORY,
          wrongCodes,
        },
      ),
  };
}

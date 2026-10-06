import { AccessRequest } from "../domain/access-request";
import { DailySendLimitReached } from "../domain/errors";

import type { Clock, CodeGenerator, Mailer, SendBudget, TokenSigner } from "./ports";

/** How long a code and its token stay valid. Same fifteen minutes as the portfolio's contact flow. */
export const CODE_VALIDITY_MS = 15 * 60 * 1000;

/**
 * What one start costs the day's budget: the code mail it sends now, **and the delivery mail it
 * commits to** if the requester comes back with the code.
 *
 * Buying both here is what makes `DAILY_SEND_LIMIT` a count of mails rather than of code mails, and
 * it is what lets `verify` consult no budget at all — nobody who has just proved they own an
 * address is turned away for a mail that was paid for fifteen minutes ago.
 */
export const MAILS_PER_REQUEST = 2;

/**
 * The ceiling a clone gets when `DAILY_SEND_LIMIT` is unset: 40 mails a day, against a Resend free
 * tier of 100 shared with the portfolio's contact form.
 *
 * **It lives here, beside the cost, rather than in `config.ts`** because three places need it — the
 * config default, the config's minimum check, and the mailbox adapter's last-resort memory size —
 * and an adapter reaching outward into the composition root to read a constant would bend the
 * dependency arrow (CLAUDE.md §3). Everything that needs it now imports inward.
 */
export const DEFAULT_DAILY_SEND_LIMIT = 40;

export interface StartAccessRequestInput {
  readonly email: string;
  readonly note?: string;
}

export interface StartAccessRequestDeps {
  readonly mailer: Mailer;
  readonly tokenSigner: TokenSigner;
  readonly clock: Clock;
  readonly codeGenerator: CodeGenerator;
  readonly sendBudget: SendBudget;
  /** Instance-wide ceiling on mails sent per UTC day. */
  readonly dailySendLimit: number;
}

/**
 * Step 1: validate, mail a code to **the address in the request** to prove the requester
 * owns it, and return a signed token that *is* the pending state.
 *
 * Nothing is persisted here, and that is the anti-spam design rather than an optimisation: an
 * unverified request costs one email and zero rows, so the floor for reaching the mailbox is "can
 * receive mail at that address" instead of "can POST".
 *
 * The code goes only to `request.email`. There is no parameter by which a caller could redirect it
 * elsewhere — that shape is what keeps this from being an open relay.
 */
export async function startAccessRequest(
  input: StartAccessRequestInput,
  deps: StartAccessRequestDeps,
): Promise<string> {
  const request = AccessRequest.create(input);

  // **Before the mail, not after.** The budget exists to stop the send, so a check that runs
  // afterwards is a counter, not a cap. The UTC day key matches the backup archives' — a key that
  // means the same thing everywhere beats one that tracks a local clock.
  const day = deps.clock.now().toISOString().slice(0, 10);
  if (!(await deps.sendBudget.reserve(day, deps.dailySendLimit, MAILS_PER_REQUEST))) {
    throw new DailySendLimitReached(deps.dailySendLimit);
  }

  const code = deps.codeGenerator.generate();

  await deps.mailer.sendVerificationCode({ to: request.email, code: code.value });

  const fields = request.toJSON();
  const exp = deps.clock.now().getTime() + CODE_VALIDITY_MS;

  return deps.tokenSigner.sign({
    request: fields,
    codeMac: deps.tokenSigner.sealCode(code.value, fields, exp),
    exp,
  });
}

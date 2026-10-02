import { z } from "zod";

/**
 * Body for `POST /access-request/verify` — step 2. The token is the pending state; the
 * code proves the requester can receive mail at the address inside it.
 *
 * Exactly six digits, enforced here so a malformed code is a 400 at the edge and never reaches the
 * constant-time comparison as a surprise shape.
 */
export const verifyAccessRequestBodySchema = z.object({
  token: z.string().min(1).max(4096),
  code: z.string().regex(/^\d{6}$/, "the code is six digits"),
});

export type VerifyAccessRequestBody = z.infer<typeof verifyAccessRequestBodySchema>;

/**
 * Response for step 2.
 *
 * `verified` means the requester owns the address — **it does not mean approved**.
 * Approval is __MKTRUE_OWNER__ editing __MKTRUE_TITLE__'s whitelist env by hand, later, or never. The literal is
 * spelled `verified` and not `ok`/`accepted` precisely so no caller can read success as access.
 */
export const verifyAccessRequestResponseSchema = z.object({
  status: z.literal("verified"),
});

export type VerifyAccessRequestResponse = z.infer<typeof verifyAccessRequestResponseSchema>;

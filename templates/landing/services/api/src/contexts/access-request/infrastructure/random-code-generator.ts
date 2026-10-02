import { randomInt } from "node:crypto";

import { VerificationCode } from "../domain/verification-code";
import type { CodeGenerator } from "../application/ports";

/**
 * `crypto.randomInt`, never `Math.random` — the latter is seeded from a predictable source and a
 * guessable code is the whole flow defeated. `randomInt` is uniform over the range and rejects
 * modulo bias internally, which is why the range is expressed directly rather than as `% 1000000`.
 */
export const randomCodeGenerator: CodeGenerator = {
  generate: () => VerificationCode.of(String(randomInt(0, 1_000_000)).padStart(6, "0")),
};

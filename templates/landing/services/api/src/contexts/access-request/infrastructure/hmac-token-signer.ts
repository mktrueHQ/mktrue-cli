import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { AccessRequestTokenPayload, TokenSigner } from "../application/ports";
import type { AccessRequestFields } from "../domain/access-request";

/** Names this MAC's use and version, so another MAC over a JSON array under the same key is not it. */
const CODE_MAC_LABEL = "access-request.code.v1";

/**
 * The pending request, signed rather than stored.
 *
 * Format is `<base64url(json)>.<base64url(hmac)>` — deliberately not a JWT. A JWT carries its own
 * algorithm in a header the verifier is expected to read, which is the origin of the `alg: none`
 * family of bugs. Here the algorithm is not negotiable because it is not transmitted: this file
 * decides it, both sides of the process are the same process, and nothing a client sends can
 * change it.
 *
 * The MAC covers the entire encoded payload, so any edit — a different address, a later expiry, a
 * swapped code MAC — invalidates it.
 */
export function createHmacTokenSigner(secret: string): TokenSigner {
  if (secret.length === 0) throw new Error("the access-request token secret must not be blank");

  const mac = (encodedPayload: string) =>
    createHmac("sha256", secret).update(encodedPayload).digest("base64url");

  // The two MACs share a key and must not answer for each other: this one is over a JSON array,
  // which opens with `[`, and a token's is over base64url, which has no `[`. A note that is absent
  // is `null`, so it can never equal one that was typed.
  const codeMac = (code: string, request: AccessRequestFields, exp: number) =>
    mac(JSON.stringify([CODE_MAC_LABEL, code, exp, request.email, request.note ?? null]));

  return {
    sealCode: codeMac,

    codeMatches(code, payload) {
      const expected = Buffer.from(codeMac(code, payload.request, payload.exp));
      const actual = Buffer.from(String(payload.codeMac));
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    },

    sign(payload) {
      const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      return `${encoded}.${mac(encoded)}`;
    },

    verify(token) {
      const parts = token.split(".");
      if (parts.length !== 2) return null;

      const [encoded, signature] = parts;
      if (encoded === undefined || signature === undefined) return null;

      const expected = Buffer.from(mac(encoded));
      const actual = Buffer.from(signature);
      if (expected.length !== actual.length) return null;
      if (!timingSafeEqual(expected, actual)) return null;

      // Only reached once the MAC proves we produced this payload — so a parse failure here means
      // a bug on our side rather than an attack, and `null` (indistinguishable from a tampered
      // token) is still the right answer to send outward.
      try {
        return JSON.parse(
          Buffer.from(encoded, "base64url").toString("utf8"),
        ) as AccessRequestTokenPayload;
      } catch {
        return null;
      }
    },

    // Over the whole token, signature included, so it identifies this one verification and nothing
    // else. The port says why it is neither made from the code nor the token itself.
    digest(token) {
      return createHash("sha256").update(token).digest("hex");
    },
  };
}

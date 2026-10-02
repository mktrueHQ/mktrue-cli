import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { AccessRequestTokenPayload, TokenSigner } from "../application/ports";

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
 * swapped code hash — invalidates it.
 */
export function createHmacTokenSigner(secret: string): TokenSigner {
  if (secret.length === 0) throw new Error("the access-request token secret must not be blank");

  const mac = (encodedPayload: string) =>
    createHmac("sha256", secret).update(encodedPayload).digest("base64url");

  return {
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
    // else. The port says why it is neither `codeHash` nor the token itself.
    digest(token) {
      return createHash("sha256").update(token).digest("hex");
    },
  };
}

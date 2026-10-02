import type { FastifyInstance } from "fastify";

import { buildServer, type ServerOverrides } from "@api/app/server";

import { FakeTokenVerifier } from "./fake-token-verifier";

export const OWNER = "user_owner_1";
export const OWNER_TOKEN = "eyJhbGciOiJSUzI1NiJ9.owner.signature";
export const AUTHORIZED = { authorization: `Bearer ${OWNER_TOKEN}` };

export const OTHER_USER = "user_other_2";
export const OTHER_USER_TOKEN = "eyJhbGciOiJSUzI1NiJ9.other.signature";
export const AUTHORIZED_AS_OTHER = { authorization: `Bearer ${OTHER_USER_TOKEN}` };

export const OUTSIDER = "user_intruder_9";
export const OUTSIDER_TOKEN = "eyJhbGciOiJSUzI1NiJ9.intruder.signature";

export const FIXED_ZONE = "Europe/Madrid";

export function serverAsOwner(overrides: ServerOverrides = {}): FastifyInstance {
  return buildServer({
    tokenVerifier: FakeTokenVerifier.verifyingAs(OWNER),
    ownerUserId: OWNER,
    defaultTimeZone: FIXED_ZONE,
    ...overrides,
  });
}

export function serverAdmittingBoth(overrides: ServerOverrides = {}): FastifyInstance {
  return buildServer({
    tokenVerifier: FakeTokenVerifier.verifyingTokens({
      [OWNER_TOKEN]: OWNER,
      [OTHER_USER_TOKEN]: OTHER_USER,
    }),
    ownerUserId: OWNER,
    allowedUserIds: new Set([OTHER_USER]),
    defaultTimeZone: FIXED_ZONE,
    ...overrides,
  });
}

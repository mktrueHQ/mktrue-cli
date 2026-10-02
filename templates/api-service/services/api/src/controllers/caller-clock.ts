import type { FastifyRequest } from "fastify";

import { resolveTimeZone } from "../contexts/profile/application/resolve-time-zone";
import { toIsoDate } from "../contexts/shared/domain/civil-date";

import { callerId } from "./caller-id";
import type { ExampleRouteDeps } from "./deps";

export interface CallerClock {
  readonly timeZone: string;
  readonly today: string;
}

export async function callerClock(
  request: FastifyRequest,
  deps: Pick<ExampleRouteDeps, "userProfileRepository" | "defaultTimeZone">,
): Promise<CallerClock> {
  const timeZone = await resolveTimeZone(
    { userId: callerId(request), fallback: deps.defaultTimeZone },
    { userProfileRepository: deps.userProfileRepository },
  );
  return { timeZone, today: toIsoDate(new Date(), timeZone) };
}

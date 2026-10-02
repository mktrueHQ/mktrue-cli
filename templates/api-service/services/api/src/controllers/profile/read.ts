import type { ProfileDto } from "@__MKTRUE_NAME__/contracts";
import type { FastifyInstance } from "fastify";

import { getProfile } from "../../contexts/profile/application/get-profile";
import { callerId } from "../caller-id";
import type { ProfileRouteDeps } from "../deps";
import { mapProfileError } from "../map-profile-error";

import { toProfileDto } from "./to-profile-dto";

export function registerReadProfileRoute(server: FastifyInstance, deps: ProfileRouteDeps): void {
  server.get("/profile", async (request, reply) => {
    try {
      const profile = await getProfile(
        { userId: callerId(request) },
        { userProfileRepository: deps.userProfileRepository },
      );
      const body: ProfileDto = toProfileDto(profile);
      return reply.status(200).send(body);
    } catch (error) {
      return mapProfileError(error, request, reply);
    }
  });
}

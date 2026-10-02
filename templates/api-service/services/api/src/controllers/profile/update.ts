import { updateProfileBodySchema, type ProfileDto } from "@__MKTRUE_NAME__/contracts";
import type { FastifyInstance } from "fastify";

import { updateProfile } from "../../contexts/profile/application/update-profile";
import { callerId } from "../caller-id";
import type { ProfileRouteDeps } from "../deps";
import { mapProfileError } from "../map-profile-error";
import { rejectInvalidRequest } from "../reject-invalid-request";

import { toProfileDto } from "./to-profile-dto";

export function registerUpdateProfileRoute(server: FastifyInstance, deps: ProfileRouteDeps): void {
  server.patch("/profile", async (request, reply) => {
    const parsed = updateProfileBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return rejectInvalidRequest(request, reply, parsed.error, "that is not a profile change");
    }

    try {
      const profile = await updateProfile(
        { userId: callerId(request), ...parsed.data },
        { userProfileRepository: deps.userProfileRepository },
      );
      const body: ProfileDto = toProfileDto(profile);
      return reply.status(200).send(body);
    } catch (error) {
      return mapProfileError(error, request, reply);
    }
  });
}

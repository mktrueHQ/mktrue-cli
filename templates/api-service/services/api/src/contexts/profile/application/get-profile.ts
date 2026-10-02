import { UserProfile } from "../domain/user-profile";

import type { UserProfileRepository } from "./ports";

export interface GetProfileInput {
  readonly userId: string;
}

export interface GetProfileDeps {
  readonly userProfileRepository: Pick<UserProfileRepository, "find">;
}

export async function getProfile(
  input: GetProfileInput,
  deps: GetProfileDeps,
): Promise<UserProfile> {
  return (await deps.userProfileRepository.find(input.userId)) ?? UserProfile.create({});
}

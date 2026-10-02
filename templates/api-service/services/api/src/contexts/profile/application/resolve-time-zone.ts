import type { UserProfileRepository } from "./ports";

export interface ResolveTimeZoneInput {
  readonly userId: string;
  readonly fallback: string;
}

export interface ResolveTimeZoneDeps {
  readonly userProfileRepository: Pick<UserProfileRepository, "find">;
}

export async function resolveTimeZone(
  input: ResolveTimeZoneInput,
  deps: ResolveTimeZoneDeps,
): Promise<string> {
  const profile = await deps.userProfileRepository.find(input.userId);
  return profile?.timeZone ?? input.fallback;
}

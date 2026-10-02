import { toLocale, toTimeZone, type UserProfile } from "../domain/user-profile";

import { getProfile } from "./get-profile";
import type { UserProfileRepository } from "./ports";

export interface UpdateProfileInput {
  readonly userId: string;
  readonly locale?: string;
  readonly timeZone?: string;
}

export interface UpdateProfileDeps {
  readonly userProfileRepository: Pick<UserProfileRepository, "find" | "setLocale" | "setTimeZone">;
}

export async function updateProfile(
  input: UpdateProfileInput,
  deps: UpdateProfileDeps,
): Promise<UserProfile> {
  const locale = input.locale === undefined ? undefined : toLocale(input.locale);
  const timeZone = input.timeZone === undefined ? undefined : toTimeZone(input.timeZone);

  let stored: UserProfile | undefined;
  if (locale !== undefined) {
    stored = await deps.userProfileRepository.setLocale(input.userId, locale);
  }
  if (timeZone !== undefined) {
    stored = await deps.userProfileRepository.setTimeZone(input.userId, timeZone);
  }
  return stored ?? getProfile({ userId: input.userId }, deps);
}

import type { ProfileDto } from "@__MKTRUE_NAME__/contracts";

import type { UserProfile } from "../../contexts/profile/domain/user-profile";

export function toProfileDto(profile: UserProfile): ProfileDto {
  return {
    ...(profile.locale === undefined ? {} : { locale: profile.locale }),
    ...(profile.timeZone === undefined ? {} : { timeZone: profile.timeZone }),
  };
}

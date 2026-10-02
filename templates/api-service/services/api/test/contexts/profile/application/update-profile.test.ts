import { describe, expect, it } from "vitest";

import type { UserProfileRepository } from "@api/contexts/profile/application/ports";
import { getProfile } from "@api/contexts/profile/application/get-profile";
import { updateProfile } from "@api/contexts/profile/application/update-profile";
import {
  InvalidProfileError,
  LOCALES,
  UserProfile,
  type Locale,
} from "@api/contexts/profile/domain/user-profile";

interface Row {
  locale?: Locale;
  timeZone?: string;
}

function inMemoryProfiles(): UserProfileRepository & { writes: number } {
  const rows = new Map<string, Row>();
  const write = (userId: string, change: Row) => {
    const row = { ...rows.get(userId), ...change };
    rows.set(userId, row);
    return Promise.resolve(UserProfile.create(row));
  };
  return {
    writes: 0,
    find(userId) {
      const row = rows.get(userId);
      return Promise.resolve(row === undefined ? null : UserProfile.create(row));
    },
    setLocale(userId, locale) {
      this.writes += 1;
      return write(userId, { locale });
    },
    setTimeZone(userId, timeZone) {
      this.writes += 1;
      return write(userId, { timeZone });
    },
  };
}

const HIM = "user_owner_1";
const FIRST = LOCALES[0];

describe("the profile's use cases", () => {
  it("answers an empty profile for a user who never chose", async () => {
    const profile = await getProfile(
      { userId: HIM },
      { userProfileRepository: inMemoryProfiles() },
    );

    expect(profile.locale).toBeUndefined();
    expect(profile.toJSON()).toEqual({});
  });

  it("stores a supported locale and reads it back", async () => {
    const repository = inMemoryProfiles();

    await updateProfile({ userId: HIM, locale: FIRST }, { userProfileRepository: repository });

    expect((await getProfile({ userId: HIM }, { userProfileRepository: repository })).locale).toBe(
      FIRST,
    );
  });

  it("refuses an unsupported locale without writing", async () => {
    const repository = inMemoryProfiles();

    await expect(
      updateProfile(
        { userId: HIM, locale: "xx-not-a-locale" },
        { userProfileRepository: repository },
      ),
    ).rejects.toBeInstanceOf(InvalidProfileError);
    expect(repository.writes).toBe(0);
  });

  it("refuses an unknown zone without writing the locale beside it", async () => {
    const repository = inMemoryProfiles();

    await expect(
      updateProfile(
        { userId: HIM, locale: FIRST, timeZone: "Europe/Atlantis" },
        { userProfileRepository: repository },
      ),
    ).rejects.toBeInstanceOf(InvalidProfileError);
    expect(repository.writes).toBe(0);
  });

  it("stores a locale and a zone together, and answers both", async () => {
    const profile = await updateProfile(
      { userId: HIM, locale: FIRST, timeZone: "Pacific/Kiritimati" },
      { userProfileRepository: inMemoryProfiles() },
    );

    expect(profile.toJSON()).toEqual({ locale: FIRST, timeZone: "Pacific/Kiritimati" });
  });
});

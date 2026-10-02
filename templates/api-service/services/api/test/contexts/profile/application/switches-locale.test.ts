import { describe, expect, it } from "vitest";

import type { UserProfileRepository } from "@api/contexts/profile/application/ports";
import { updateProfile } from "@api/contexts/profile/application/update-profile";
import { LOCALES, UserProfile, type Locale } from "@api/contexts/profile/domain/user-profile";

function inMemoryProfiles(): UserProfileRepository {
  const rows = new Map<string, Locale>();
  return {
    find(userId) {
      const locale = rows.get(userId);
      return Promise.resolve(locale === undefined ? null : UserProfile.create({ locale }));
    },
    setLocale(userId, locale) {
      rows.set(userId, locale);
      return Promise.resolve(UserProfile.create({ locale }));
    },
    setTimeZone() {
      return Promise.reject(new Error("switching language never writes a zone"));
    },
  };
}

describe("switching language", () => {
  it("replaces the first choice with the second, and back", async () => {
    const [first, second] = LOCALES as readonly string[];
    const repository = inMemoryProfiles();
    const deps = { userProfileRepository: repository };

    expect(second).toBeDefined();
    await updateProfile({ userId: "user_owner_1", locale: first ?? "" }, deps);
    expect(
      (await updateProfile({ userId: "user_owner_1", locale: second ?? "" }, deps)).locale,
    ).toBe(second);
    expect(
      (await updateProfile({ userId: "user_owner_1", locale: first ?? "" }, deps)).locale,
    ).toBe(first);
  });
});

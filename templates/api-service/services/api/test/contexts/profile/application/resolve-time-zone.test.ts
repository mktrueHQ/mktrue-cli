import { describe, expect, it } from "vitest";

import type { UserProfileRepository } from "@api/contexts/profile/application/ports";
import { resolveTimeZone } from "@api/contexts/profile/application/resolve-time-zone";
import { UserProfile } from "@api/contexts/profile/domain/user-profile";

const HIM = "user_owner_1";
const HER = "user_other_2";
const DEFAULT_ZONE = "Europe/Madrid";

const profiles: Pick<UserProfileRepository, "find"> = {
  find: (userId) =>
    Promise.resolve(userId === HIM ? UserProfile.create({ timeZone: "Pacific/Kiritimati" }) : null),
};

describe("whose clock a user's today is read from", () => {
  it("answers each user's own zone, and the default for one who never chose", async () => {
    const deps = { userProfileRepository: profiles };

    expect(await resolveTimeZone({ userId: HIM, fallback: DEFAULT_ZONE }, deps)).toBe(
      "Pacific/Kiritimati",
    );
    expect(await resolveTimeZone({ userId: HER, fallback: DEFAULT_ZONE }, deps)).toBe(DEFAULT_ZONE);
  });

  it("lets a storage failure through rather than answering the default", async () => {
    const failing: Pick<UserProfileRepository, "find"> = {
      find: () => Promise.reject(new Error("storage went away")),
    };

    await expect(
      resolveTimeZone({ userId: HIM, fallback: DEFAULT_ZONE }, { userProfileRepository: failing }),
    ).rejects.toThrow("storage went away");
  });
});

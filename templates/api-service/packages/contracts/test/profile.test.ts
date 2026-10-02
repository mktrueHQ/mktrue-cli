import { describe, expect, it } from "vitest";

import { LOCALES, profileDtoSchema, updateProfileBodySchema } from "../src/profile";

describe("the profile contract", () => {
  it("reads an empty profile as never chosen rather than as a default", () => {
    expect(profileDtoSchema.parse({})).toEqual({});
  });

  it("refuses a locale outside the closed list", () => {
    expect(updateProfileBodySchema.safeParse({ locale: "qq" }).success).toBe(false);
  });

  it("takes a time zone the runtime knows, and refuses one it does not", () => {
    expect(updateProfileBodySchema.parse({ timeZone: "Pacific/Kiritimati" })).toEqual({
      timeZone: "Pacific/Kiritimati",
    });
    expect(updateProfileBodySchema.safeParse({ timeZone: "Europe/Atlantis" }).success).toBe(false);
  });

  it("refuses a body that names no preference", () => {
    expect(updateProfileBodySchema.safeParse({}).success).toBe(false);
  });

  it("strips a userId a caller smuggles into the body", () => {
    const first = LOCALES[0];
    expect(updateProfileBodySchema.parse({ locale: first, userId: "user_someone" })).toEqual({
      locale: first,
    });
  });
});

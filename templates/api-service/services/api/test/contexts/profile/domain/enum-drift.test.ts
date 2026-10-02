import { LOCALES as CONTRACT_LOCALES } from "@__MKTRUE_NAME__/contracts";
import { describe, expect, it } from "vitest";

import { LOCALES as DOMAIN_LOCALES } from "@api/contexts/profile/domain/user-profile";

describe("the profile's locales", () => {
  it("are the same list in the contract and in the domain", () => {
    expect([...DOMAIN_LOCALES]).toEqual([...CONTRACT_LOCALES]);
  });
});

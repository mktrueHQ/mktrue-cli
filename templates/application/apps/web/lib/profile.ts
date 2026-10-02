import "server-only";

import { profileDtoSchema, type Locale, type ProfileDto } from "@__MKTRUE_NAME__/contracts";
import { cache } from "react";

import { apiGet, apiSend, type ApiResult } from "./api";

export const PROFILE_READ_TIMEOUT_MS = 1500;

const readProfile = cache(async (): Promise<ProfileDto | undefined> => {
  try {
    const result = await apiGet({
      path: "/profile",
      expect: profileDtoSchema,
      signal: AbortSignal.timeout(PROFILE_READ_TIMEOUT_MS),
    });
    return result.status === "ok" ? result.data : undefined;
  } catch {
    return undefined;
  }
});

export const readProfileLocale = cache(
  async (): Promise<Locale | undefined> => (await readProfile())?.locale,
);

export const profileIsReadable = cache(
  async (): Promise<boolean> => (await readProfile()) !== undefined,
);

export async function sendLocale(locale: Locale): Promise<ApiResult<ProfileDto>> {
  return await apiSend({
    method: "PATCH",
    path: "/profile",
    body: { locale },
    expect: profileDtoSchema,
  });
}

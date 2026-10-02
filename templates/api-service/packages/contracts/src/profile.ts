import { z } from "zod";

export const LOCALES = [__MKTRUE_LOCALES__] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((timeZone) => {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone });
      return true;
    } catch {
      return false;
    }
  }, "expected an IANA time zone");

export const profileDtoSchema = z.object({
  locale: localeSchema.optional(),
  timeZone: timeZoneSchema.optional(),
});
export type ProfileDto = z.infer<typeof profileDtoSchema>;

export const updateProfileBodySchema = z
  .object({ locale: localeSchema.optional(), timeZone: timeZoneSchema.optional() })
  .refine(
    (body) => body.locale !== undefined || body.timeZone !== undefined,
    "expected a locale, a time zone, or both",
  );
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

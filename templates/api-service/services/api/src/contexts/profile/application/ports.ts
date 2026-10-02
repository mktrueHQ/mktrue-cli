import type { Locale, UserProfile } from "../domain/user-profile";

export interface UserProfileRepository {
  find(userId: string): Promise<UserProfile | null>;
  setLocale(userId: string, locale: Locale): Promise<UserProfile>;
  setTimeZone(userId: string, timeZone: string): Promise<UserProfile>;
}

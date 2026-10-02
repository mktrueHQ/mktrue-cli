import mongoose, { type UpdateQuery } from "mongoose";

import type { UserScoped } from "../../shared/infrastructure/user-scoped-schema";
import { ProfileStorageUnavailableError } from "../application/errors";
import type { UserProfileRepository } from "../application/ports";
import { UserProfile, type Locale } from "../domain/user-profile";

import { UserProfileModel, type StoredUserProfile } from "./user-profile-model";

const DUPLICATE_KEY = 11_000;

const PROFILE_KEY_FIELDS = ["userId"] as const;

const VALUE_MARKER = "dup key:";

export class MongooseUserProfileRepository implements UserProfileRepository {
  async find(userId: string): Promise<UserProfile | null> {
    assertConnected();

    const row = await readStored(userId);
    return row ? toProfile(row) : null;
  }

  async setLocale(userId: string, locale: Locale): Promise<UserProfile> {
    assertConnected();

    await upsertOnce(userId, { $set: { locale }, $setOnInsert: { userId } });

    const row = await readStored(userId);
    if (!row) {
      throw new ProfileStorageUnavailableError();
    }
    return toProfile(row);
  }

  async setTimeZone(userId: string, timeZone: string): Promise<UserProfile> {
    assertConnected();

    await upsertOnce(userId, { $set: { timeZone }, $setOnInsert: { userId } });

    const row = await readStored(userId);
    if (!row) {
      throw new ProfileStorageUnavailableError();
    }
    return toProfile(row);
  }
}

// A module function, not a method: owner-first-ports counts an adapter's own prototype methods.
async function upsertOnce(
  userId: string,
  update: UpdateQuery<UserScoped<StoredUserProfile>>,
): Promise<void> {
  try {
    await UserProfileModel.updateOne({ userId }, update, { upsert: true });
  } catch (error) {
    if (!isOwnerDuplicateKey(error)) {
      throw narrowed(error);
    }
    try {
      await UserProfileModel.updateOne({ userId }, update, { upsert: true });
    } catch (retryError) {
      throw narrowed(retryError);
    }
  }
}

function readStored(userId: string): Promise<StoredUserProfile | null> {
  return UserProfileModel.findOne({ userId })
    .select("locale timeZone")
    .lean<StoredUserProfile | null>()
    .exec();
}

function assertConnected(): void {
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected) {
    throw new ProfileStorageUnavailableError();
  }
}

function toProfile(row: StoredUserProfile): UserProfile {
  return UserProfile.create({
    ...(typeof row.locale === "string" ? { locale: row.locale } : {}),
    ...(typeof row.timeZone === "string" ? { timeZone: row.timeZone } : {}),
  });
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

function isOwnerDuplicateKey(error: unknown): boolean {
  if (!isDuplicateKey(error)) {
    return false;
  }
  const { keyPattern } = error as { keyPattern?: unknown };
  if (typeof keyPattern !== "object" || keyPattern === null) {
    return false;
  }
  return Object.keys(keyPattern).toSorted().join(",") === PROFILE_KEY_FIELDS.join(",");
}

function narrowed(error: unknown): unknown {
  if (!isDuplicateKey(error)) {
    return error;
  }
  const message = (error as { message?: unknown }).message;
  const text = typeof message === "string" ? message : "";
  const marker = text.indexOf(VALUE_MARKER);
  return new ProfileDuplicateKeyError(
    marker === -1 ? "E11000 duplicate key error" : text.slice(0, marker + VALUE_MARKER.length),
  );
}

class ProfileDuplicateKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileDuplicateKeyError";
  }
}

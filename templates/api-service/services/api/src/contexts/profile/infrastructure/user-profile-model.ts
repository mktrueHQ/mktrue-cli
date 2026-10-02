import mongoose, { Schema, type Model } from "mongoose";

import { userScopedSchema, type UserScoped } from "../../shared/infrastructure/user-scoped-schema";

export interface StoredUserProfile {
  readonly locale?: string;
  readonly timeZone?: string;
}

const userProfileSchema = new Schema<UserScoped<StoredUserProfile>>(
  {
    // No enum, maxlength or match: Mongoose would copy the rejected value into the error it logs.
    locale: { type: String },
    timeZone: { type: String },
  },
  { timestamps: true, collection: "user-profiles" },
);

userProfileSchema.plugin(userScopedSchema);

userProfileSchema.index({ userId: 1 }, { unique: true });

export const UserProfileModel: Model<UserScoped<StoredUserProfile>> =
  (mongoose.models.UserProfile as Model<UserScoped<StoredUserProfile>> | undefined) ??
  mongoose.model<UserScoped<StoredUserProfile>>("UserProfile", userProfileSchema);

import mongoose, { Schema, type Model } from "mongoose";

import { userScopedSchema, type UserScoped } from "../../shared/infrastructure/user-scoped-schema";

export interface StoredExampleItem {
  readonly _id: mongoose.Types.ObjectId;
  readonly title: string;
  readonly status: string;
  readonly createdOn: string;
}

const exampleItemSchema = new Schema<UserScoped<StoredExampleItem>>(
  {
    title: { type: String, required: true },
    status: { type: String, required: true },
    createdOn: { type: String, required: true },
  },
  { timestamps: true, collection: "example-items" },
);

exampleItemSchema.plugin(userScopedSchema);

exampleItemSchema.index({ userId: 1, status: 1, createdOn: -1 });

export const ExampleItemModel: Model<UserScoped<StoredExampleItem>> =
  (mongoose.models.ExampleItem as Model<UserScoped<StoredExampleItem>> | undefined) ??
  mongoose.model<UserScoped<StoredExampleItem>>("ExampleItem", exampleItemSchema);

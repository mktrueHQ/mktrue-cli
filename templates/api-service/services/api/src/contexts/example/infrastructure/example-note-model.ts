import mongoose, { Schema, type Model } from "mongoose";

import { userScopedSchema, type UserScoped } from "../../shared/infrastructure/user-scoped-schema";

export interface StoredExampleNote {
  readonly _id: mongoose.Types.ObjectId;
  readonly itemId: mongoose.Types.ObjectId;
  readonly text: string;
  readonly writtenOn: string;
}

const exampleNoteSchema = new Schema<UserScoped<StoredExampleNote>>(
  {
    itemId: { type: Schema.Types.ObjectId, required: true },
    text: { type: String, required: true },
    writtenOn: { type: String, required: true },
  },
  { timestamps: true, collection: "example-notes" },
);

exampleNoteSchema.plugin(userScopedSchema);

exampleNoteSchema.index({ userId: 1, itemId: 1, writtenOn: 1 });

export const ExampleNoteModel: Model<UserScoped<StoredExampleNote>> =
  (mongoose.models.ExampleNote as Model<UserScoped<StoredExampleNote>> | undefined) ??
  mongoose.model<UserScoped<StoredExampleNote>>("ExampleNote", exampleNoteSchema);

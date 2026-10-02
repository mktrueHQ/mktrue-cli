import mongoose, { type InferSchemaType, type Model } from "mongoose";

// Destructured off the default export: mongoose ships CommonJS, and named ESM imports from it
// type-check and then throw `Named export not found` under plain Node. Same reason as
// `access-request-model.ts`.
const { model, models, Schema } = mongoose;

/**
 * One document per UTC day, holding how much mail the instance has sent.
 *
 * **This is not an access request and holds no PII** — a date and an integer. It lives in the same
 * database only because that is where this service already has a connection; nothing about a
 * requester is recorded here, so an earlier decision's "an unverified request costs zero rows" still holds in the
 * sense that matters: no row is created *about the person*.
 */
const sendBudgetSchema = new Schema(
  {
    /** `YYYY-MM-DD`, UTC. The `_id` would do, but a named field reads better in a shell. */
    day: { type: String, required: true, unique: true, index: true },
    count: { type: Number, required: true, default: 0 },
  },
  {
    collection: "send_budget",
    versionKey: false,
    // Same reason as the mailbox's: with no database configured, mongoose buffers for ten seconds
    // before failing, and this reservation sits in front of the code mail.
    bufferTimeoutMS: 2_000,
  },
);

export type SendBudgetDocument = InferSchemaType<typeof sendBudgetSchema>;

export const SendBudgetModel =
  (models.SendBudget as Model<SendBudgetDocument> | undefined) ??
  model<SendBudgetDocument>("SendBudget", sendBudgetSchema);

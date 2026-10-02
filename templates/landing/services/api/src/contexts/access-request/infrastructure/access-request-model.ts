import mongoose, { type InferSchemaType, type Model } from "mongoose";

/**
 * Destructured off the default export rather than imported by name.
 *
 * Mongoose ships CommonJS. Node's ESM loader cannot statically resolve named exports from it, so
 * `import { model } from "mongoose"` compiles, type-checks, and passes every test — then throws
 * `SyntaxError: Named export 'models' not found` the moment the bundled `dist/main.js` runs under
 * plain Node. Vitest's transform hides the difference; only running the container finds it. Types
 * are still imported by name above, because those are erased before Node ever sees them.
 */
const { model, models, Schema } = mongoose;

/**
 * The mailbox collection. Written only after verification.
 *
 * `email` is uniquely indexed, which is what keeps the mailbox one row per person: a second
 * request from the same address updates that row rather than inserting a duplicate. It also means
 * the row count is a count of *people*, which is the number __MKTRUE_OWNER__ would actually want.
 */
const accessRequestSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    note: { type: String, required: false },
    /** When the request was **verified** — not when it was started. */
    requestedAt: { type: Date, required: true, index: true },
    /** A record of what __MKTRUE_OWNER__ did by hand. Nothing here reads it to grant anything. */
    status: {
      type: String,
      required: true,
      enum: ["new", "approved", "declined"],
      default: "new",
    },
    /**
     * SHA-256 digests of the tokens whose verifications this row has recorded — **never the tokens
     * themselves**, which are bearer credentials until they expire. This is what makes a replayed
     * verification a no-op.
     *
     * **A list rather than one value, capped rather than growing.** One digest is defeated by
     * holding two live tokens for an address and alternating them: each looks new to the other's
     * marker. The cap is applied by the `$slice` on push, sized from the day's mail ceiling, so the
     * array cannot outgrow the number of tokens that can exist — and there is nothing to sweep.
     *
     * It must be declared here: mongoose strips unknown paths on write, so digests pushed without a
     * schema entry are dropped silently and every replay check answers false. Optional, because
     * every row written before an earlier decision has none; such a row matches no replay, which degrades to the
     * old behaviour rather than to an error.
     */
    tokenDigests: { type: [String], required: false, default: undefined },
  },
  {
    collection: "access_requests",
    versionKey: false,
    // Ten seconds is mongoose's default, and it is the wrong one here: `MONGO_URI` is deliberately
    // absent from the production gate, so "no database" is a supported mode, and the claim now sits
    // in front of the mail. Buffering for ten seconds would add that to every verify in a degraded
    // deployment before failing open.
    bufferTimeoutMS: 2_000,
  },
);

export type AccessRequestDocument = InferSchemaType<typeof accessRequestSchema>;

/**
 * `models.AccessRequest ??` guards against mongoose's OverwriteModelError when the module is
 * re-imported — which happens in tests far more than in production.
 */
export const AccessRequestModel =
  (models.AccessRequest as Model<AccessRequestDocument> | undefined) ??
  model<AccessRequestDocument>("AccessRequest", accessRequestSchema);

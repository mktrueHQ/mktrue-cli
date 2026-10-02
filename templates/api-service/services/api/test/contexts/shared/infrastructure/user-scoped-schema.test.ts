import { createRequire } from "node:module";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { Schema } from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { connectMongo, disconnectMongo } from "@api/contexts/shared/infrastructure/mongo";
import {
  UNGUARDED_MODEL_OPS,
  USER_SCOPED_MODEL_OPS,
  USER_SCOPED_QUERY_OPS,
  UnscopedQueryError,
  userScopedSchema,
  type UserScoped,
} from "@api/contexts/shared/infrastructure/user-scoped-schema";

const require = createRequire(import.meta.url);

function mongooseOperations(constant: "queryOperations" | "modelMiddlewareFunctions"): string[] {
  const constants = require("mongoose/lib/constants.js") as Record<string, unknown>;
  const operations = constants[constant];
  if (!Array.isArray(operations) || !operations.every((op) => typeof op === "string")) {
    throw new Error(`mongoose/lib/constants.js no longer exports a ${constant} string array`);
  }
  return operations as string[];
}

const HIS = "user_owner_1";
const HERS = "user_other_2";

interface StoredThing {
  readonly label: string;
}

const thingSchema = new Schema<UserScoped<StoredThing>>(
  { label: { type: String, required: true } },
  { collection: "guarded-things" },
);
thingSchema.plugin(userScopedSchema);

const ThingModel =
  (mongoose.models.GuardedThing as mongoose.Model<UserScoped<StoredThing>> | undefined) ??
  mongoose.model<UserScoped<StoredThing>>("GuardedThing", thingSchema);

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await connectMongo({ uri: replSet.getUri(), dbName: "user-scoped-schema" });
});

afterEach(async () => {
  await ThingModel.collection.deleteMany({});
});

afterAll(async () => {
  await disconnectMongo();
  await replSet.stop();
});

async function everyStoredLabel(): Promise<string[]> {
  const rows = await ThingModel.collection.find({}).toArray();
  return rows.map((row) => `${String(row.userId)}:${String(row.label)}`).toSorted();
}

async function seedBoth(): Promise<void> {
  await ThingModel.create({ userId: HIS, label: "his" });
  await ThingModel.create({ userId: HERS, label: "hers" });
}

describe("the enumerations the guard is registered from", () => {
  it("covers every operation Mongoose runs query middleware for", () => {
    expect([...USER_SCOPED_QUERY_OPS].toSorted()).toEqual(
      mongooseOperations("queryOperations").toSorted(),
    );
  });

  it("accounts for every model middleware function, guarded or argued", () => {
    expect([...USER_SCOPED_MODEL_OPS, ...UNGUARDED_MODEL_OPS].toSorted()).toEqual(
      mongooseOperations("modelMiddlewareFunctions").toSorted(),
    );
  });
});

describe("a query that names its user", () => {
  it("reads only that user's rows, with the other's present", async () => {
    await seedBoth();

    const mine = await ThingModel.find({ userId: HIS }).lean().exec();

    expect(mine.map((row) => row.label)).toEqual(["his"]);
  });

  it("refuses an owner-less insert at validation", async () => {
    await expect(ThingModel.create({ label: "nobody's" })).rejects.toThrow();
    expect(await everyStoredLabel()).toEqual([]);
  });
});

describe("a query that does not name its user", () => {
  it.each([
    ["find", () => ThingModel.find({}).exec()],
    ["findOne", () => ThingModel.findOne({ label: "his" }).exec()],
    ["countDocuments", () => ThingModel.countDocuments({}).exec()],
    ["updateMany", () => ThingModel.updateMany({}, { $set: { label: "taken" } }).exec()],
    ["deleteMany", () => ThingModel.deleteMany({}).exec()],
    [
      "findOneAndUpdate",
      () => ThingModel.findOneAndUpdate({ label: "his" }, { $set: { label: "taken" } }).exec(),
    ],
    [
      "an $or of two owners",
      () => ThingModel.find({ $or: [{ userId: HIS }, { userId: HERS }] }).exec(),
    ],
    ["an operator in place of the owner", () => ThingModel.find({ userId: { $ne: HIS } }).exec()],
  ])("refuses %s", async (_case, run) => {
    await seedBoth();

    await expect(run()).rejects.toBeInstanceOf(UnscopedQueryError);
    expect(await everyStoredLabel()).toEqual([`${HERS}:hers`, `${HIS}:his`]);
  });

  it("refuses an upsert whose update names no owner", async () => {
    await expect(
      ThingModel.updateOne(
        { userId: HIS, label: "new" },
        { $set: { label: "new" } },
        { upsert: true },
      ).exec(),
    ).rejects.toBeInstanceOf(UnscopedQueryError);
    expect(await everyStoredLabel()).toEqual([]);
  });

  it("refuses an aggregation that does not open with the owner", async () => {
    await seedBoth();

    await expect(
      ThingModel.aggregate([{ $group: { _id: "$label" } }]).exec(),
    ).rejects.toBeInstanceOf(UnscopedQueryError);
  });

  it("refuses a scoped pipeline that writes, and leaves both tenants' rows", async () => {
    await seedBoth();

    await expect(
      ThingModel.aggregate([{ $match: { userId: HIS } }, { $out: "guarded-things" }]).exec(),
    ).rejects.toBeInstanceOf(UnscopedQueryError);
    expect(await everyStoredLabel()).toEqual([`${HERS}:hers`, `${HIS}:his`]);
  });

  it("refuses a scoped pipeline whose join carries no scope of its own", async () => {
    await seedBoth();

    await expect(
      ThingModel.aggregate([{ $match: { userId: HIS } }, { $unionWith: "guarded-things" }]).exec(),
    ).rejects.toBeInstanceOf(UnscopedQueryError);
  });

  it("refuses a join scoped to a different owner than the pipeline", async () => {
    await seedBoth();

    await expect(
      ThingModel.aggregate([
        { $match: { userId: HIS } },
        { $unionWith: { coll: "guarded-things", pipeline: [{ $match: { userId: HERS } }] } },
      ]).exec(),
    ).rejects.toBeInstanceOf(UnscopedQueryError);
  });

  it("admits a join that re-scopes to the same owner", async () => {
    await seedBoth();

    const rows = await ThingModel.aggregate<{ label: string }>([
      { $match: { userId: HIS } },
      { $unionWith: { coll: "guarded-things", pipeline: [{ $match: { userId: HIS } }] } },
      { $project: { _id: 0, label: 1 } },
    ]).exec();

    expect(rows.map((row) => row.label)).toEqual(["his", "his"]);
  });

  it("refuses a bulk write any operation of which names no owner", async () => {
    await seedBoth();

    await expect(
      ThingModel.bulkWrite([
        { updateOne: { filter: { userId: HIS }, update: { $set: { label: "fine" } } } },
        { deleteMany: { filter: {} } },
      ]),
    ).rejects.toBeInstanceOf(UnscopedQueryError);
    expect(await everyStoredLabel()).toEqual([`${HERS}:hers`, `${HIS}:his`]);
  });

  it("says what was refused without quoting the query", async () => {
    await seedBoth();

    const error = await ThingModel.find({ label: "his-secret-label" })
      .exec()
      .catch((caught: unknown) => caught as Error);

    expect(error).toBeInstanceOf(UnscopedQueryError);
    expect((error as Error).message).toContain("find");
    expect((error as Error).message).not.toContain("his-secret-label");
  });
});

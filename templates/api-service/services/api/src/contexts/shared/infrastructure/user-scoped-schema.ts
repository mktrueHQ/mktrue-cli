import type { Aggregate, MongooseQueryMiddleware, Schema } from "mongoose";

export class UnscopedQueryError extends Error {
  constructor(operation: string) {
    super(`refused an unscoped ${operation}: every query on an owned collection names its user`);
    this.name = "UnscopedQueryError";
  }
}

export type UserScoped<T> = T & { userId: string };

export const USER_SCOPED_QUERY_OPS = [
  "countDocuments",
  "deleteMany",
  "deleteOne",
  "distinct",
  "estimatedDocumentCount",
  "find",
  "findOne",
  "findOneAndDelete",
  "findOneAndReplace",
  "findOneAndUpdate",
  "replaceOne",
  "updateMany",
  "updateOne",
] as const satisfies readonly MongooseQueryMiddleware[];

export const USER_SCOPED_MODEL_OPS = ["bulkWrite"] as const;

export const UNGUARDED_MODEL_OPS = ["createCollection", "insertMany"] as const;

const MODEL_OP_GUARD: Record<
  (typeof USER_SCOPED_MODEL_OPS)[number],
  (operation: string, payload: readonly unknown[]) => void
> = {
  bulkWrite: (operation, ops) => {
    assertEveryBulkOperationNamesUser(operation, ops);
  },
};

const BULK_VERBS = [
  "insertOne",
  "replaceOne",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
] as const;

const PIPELINE_WRITE_STAGES = ["$out", "$merge"] as const;

export const PIPELINE_JOIN_STAGES = ["$lookup", "$graphLookup", "$unionWith"] as const;

type UncoveredQueryOp = Exclude<MongooseQueryMiddleware, (typeof USER_SCOPED_QUERY_OPS)[number]>;
type AssertNever<T extends never> = T;

export type NoQueryOpLeftUncovered = AssertNever<UncoveredQueryOp>;

interface GuardedQuery {
  readonly op?: string;
  getFilter(): Record<string, unknown>;
  getUpdate(): Record<string, unknown> | null;
  getOptions(): Record<string, unknown>;
}

export function userScopedSchema(schema: Schema): void {
  schema.add({ userId: { type: String, required: true } });

  schema.pre<GuardedQuery>(
    [...USER_SCOPED_QUERY_OPS],
    { document: false, query: true },
    function () {
      assertFilterNamesUser(this);
    },
  );

  schema.pre<Aggregate<unknown[]>>("aggregate", function () {
    assertPipelineOpensWithUser(this.pipeline());
  });

  for (const operation of USER_SCOPED_MODEL_OPS) {
    const guard = MODEL_OP_GUARD[operation];
    schema.pre(operation, function (ops) {
      guard(operation, ops);
    });
  }
}

function assertFilterNamesUser(query: GuardedQuery): void {
  const operation = namedOperation(query.op);

  if (!isUserId(query.getFilter().userId)) {
    throw new UnscopedQueryError(operation);
  }

  if (query.getOptions().upsert && !insertNamesUser(query.getUpdate())) {
    throw new UnscopedQueryError(`${operation} upsert`);
  }
}

function assertPipelineOpensWithUser(pipeline: readonly unknown[]): void {
  const [first] = pipeline;
  const owner = asRecord(asRecord(first)?.$match)?.userId;

  if (!isUserId(owner)) {
    throw new UnscopedQueryError("aggregate");
  }

  assertPipelineWritesNothing(pipeline);
  assertPipelineJoinsAreScoped(pipeline, owner);
}

function assertPipelineJoinsAreScoped(pipeline: readonly unknown[], owner: string): void {
  for (const stage of pipeline) {
    const named = asRecord(stage);
    if (!named) continue;

    for (const join of PIPELINE_JOIN_STAGES.filter((candidate) => candidate in named)) {
      assertJoinCarriesItsOwnScope(join, named[join], owner);
    }

    const facet = asRecord(named.$facet);
    if (!facet) continue;

    for (const branch of Object.values(facet)) {
      if (!Array.isArray(branch)) continue;
      assertPipelineWritesNothing(branch);
      assertPipelineJoinsAreScoped(branch, owner);
    }
  }
}

function assertJoinCarriesItsOwnScope(
  stage: (typeof PIPELINE_JOIN_STAGES)[number],
  body: unknown,
  owner: string,
): void {
  const named = asRecord(body);
  if (!named) {
    throw new UnscopedQueryError(`aggregate ${stage}`);
  }

  if (stage === "$graphLookup") {
    if (!scopedTo(owner, own(named, "restrictSearchWithMatch"))) {
      throw new UnscopedQueryError(`aggregate ${stage}`);
    }
    return;
  }

  const sub = own(named, "pipeline");
  if (!Array.isArray(sub) || !scopedTo(owner, asRecord(sub[0])?.$match)) {
    throw new UnscopedQueryError(`aggregate ${stage}`);
  }

  assertPipelineWritesNothing(sub);
  assertPipelineJoinsAreScoped(sub, owner);
}

function scopedTo(owner: string, match: unknown): boolean {
  return asRecord(match)?.userId === owner;
}

// `in` detects a join, which fails closed; reading what admits one must ignore inherited keys.
function own(named: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(named, key) ? named[key] : undefined;
}

function assertPipelineWritesNothing(pipeline: readonly unknown[]): void {
  for (const stage of pipeline) {
    const named = asRecord(stage);
    const write = named && PIPELINE_WRITE_STAGES.find((forbidden) => forbidden in named);

    if (write) {
      throw new UnscopedQueryError(`aggregate ${write}`);
    }
  }
}

function assertEveryBulkOperationNamesUser(op: string, ops: readonly unknown[]): void {
  for (const operation of ops) {
    if (!bulkOperationNamesUser(operation)) {
      throw new UnscopedQueryError(op);
    }
  }
}

function bulkOperationNamesUser(operation: unknown): boolean {
  const named = asRecord(operation);
  if (!named) return false;

  const verbs = BULK_VERBS.filter((verb) => verb in named);
  const [verb] = verbs;
  if (Object.keys(named).length !== 1 || verbs.length !== 1 || verb === undefined) return false;

  const payload = asRecord(named[verb]);
  if (!payload) return false;

  if (verb === "insertOne") {
    return isUserId(asRecord(payload.document)?.userId);
  }

  if (!isUserId(asRecord(payload.filter)?.userId)) return false;

  return (
    !payload.upsert || insertNamesUser(asRecord(payload.replacement ?? payload.update) ?? null)
  );
}

function insertNamesUser(update: Record<string, unknown> | null): boolean {
  if (!update) return false;

  return (
    isUserId(update.userId) ||
    isUserId(asRecord(update.$setOnInsert)?.userId) ||
    isUserId(asRecord(update.$set)?.userId)
  );
}

function isUserId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function namedOperation(op: string | undefined): string {
  const known: readonly string[] = USER_SCOPED_QUERY_OPS;
  return op !== undefined && known.includes(op) ? op : "query";
}

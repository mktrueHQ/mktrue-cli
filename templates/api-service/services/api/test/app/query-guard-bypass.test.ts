import { describe, expect, it } from "vitest";

import { PIPELINE_JOIN_STAGES } from "@api/contexts/shared/infrastructure/user-scoped-schema";

import { readSource, sweep, withoutComments, type SweptFile } from "../test-support/source-sweep";

const WHOLE_SERVICE = ".";

const BYPASSES = [
  [".collection", /\.collection\b/],
  ["db.aggregate(", /\bdb\.aggregate\(/],
  ["db.command(", /\bdb\.(?:run)?[Cc]ommand\(/],
  [".bulkWrite(", /\.bulkWrite\(/],
  [".bulkSave(", /\.bulkSave\(/],
  [".insertMany(", /\.insertMany\(/],
  [".hydrate(", /\.hydrate\(/],
  [".watch(", /\.watch\(/],
  ["middleware:", /\bmiddleware\s*:/],
  ["lean: true", /\blean:\s*true\b/],
  ["validateBeforeSave", /\bvalidateBeforeSave\b/],
] as const satisfies readonly (readonly [string, RegExp])[];

const bypassesNamed = (source: string) =>
  BYPASSES.filter(([, needle]) => needle.test(source)).map(([label]) => label);

const MAY_BYPASS: string[] = [];

const JOIN_STAGES = PIPELINE_JOIN_STAGES;

const PIPELINE_WRITE_STAGES = ["$out", "$merge"] as const;

const MAY_WRITE_FROM_A_PIPELINE = ["contexts/shared/infrastructure/user-scoped-schema.ts"];

const MAY_JOIN: string[] = [];

const MAY_NAME_A_JOIN_STAGE = ["contexts/shared/infrastructure/user-scoped-schema.ts"];

const filesCallingABypass = (files: readonly SweptFile[]) =>
  files
    .filter((file) => bypassesNamed(file.code).length > 0)
    .map((file) => file.path)
    .toSorted();

function stageBody(code: string, after: number): string {
  let at = after;
  while (/[\s:]/.test(code[at] ?? "")) at += 1;
  if (code[at] !== "{") return "";

  let depth = 0;
  for (let end = at; end < code.length; end += 1) {
    if (code[end] === "{") depth += 1;
    else if (code[end] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(at, end + 1);
    }
  }
  return "";
}

function unscopedJoinsIn(code: string): string[] {
  return JOIN_STAGES.flatMap((stage) => {
    const unscoped: string[] = [];
    for (let at = code.indexOf(stage); at !== -1; at = code.indexOf(stage, at + stage.length)) {
      if (!/\buserId\b/.test(stageBody(code, at + stage.length))) unscoped.push(stage);
    }
    return unscoped;
  });
}

const RESCOPED_LOOKUP = `
  { $match: { userId } },
  {
    $lookup: {
      from: "example-notes",
      let: { owner: "$userId" },
      pipeline: [{ $match: { $expr: { $eq: ["$userId", "$$owner"] } } }],
      as: "notes",
    },
  },
`;

const BARE_LOOKUP = `
  { $match: { userId } },
  { $lookup: { from: "example-notes", localField: "_id", foreignField: "itemId", as: "notes" } },
`;

const OUTER_SCOPED_GRAPH_LOOKUP = `
  { $match: { userId } },
  { $graphLookup: { from: "example-items", startWith: "$_id", connectFromField: "_id", connectToField: "parentId", as: "tree" } },
`;

const SHORTHAND_UNION_WITH = `
  const pipeline = [{ $match: { userId } }, { $unionWith: "archivedItems" }];
  async function countForUser(userId) { return ExampleItemModel.countDocuments({ userId }); }
`;

const SHORTHAND_LOOKUP = `
  const pipeline = [{ $match: { userId } }, { $lookup: NOTE_JOIN }];
`;

const filesWithAJoin = (files: readonly SweptFile[]) =>
  files
    .filter((file) => JOIN_STAGES.some((stage) => file.code.includes(stage)))
    .map((file) => file.path)
    .toSorted();

const filesWritingFromAPipeline = (files: readonly SweptFile[]) =>
  files
    .filter((file) => PIPELINE_WRITE_STAGES.some((stage) => file.code.includes(stage)))
    .map((file) => file.path)
    .toSorted();

describe("the ways past the user-scope guard", () => {
  it("walks the whole service rather than an empty directory", async () => {
    const paths = (await sweep(WHOLE_SERVICE)).map((file) => file.path);

    expect(paths.length).toBeGreaterThan(20);
    expect(paths).toContain("contexts/example/infrastructure/mongoose-example-item-repository.ts");
    expect(paths).toContain("app/server.ts");
  });

  it("is called from exactly the files argued onto the list", async () => {
    expect(filesCallingABypass(await sweep(WHOLE_SERVICE))).toEqual(MAY_BYPASS);
  });

  it("reaches past the guard nowhere at all in a fresh template", () => {
    expect(MAY_BYPASS).toEqual([]);
  });

  it.each([
    ["const raw = ExampleItemModel.collection;", [".collection"]],
    ['mongoose.connection.db.collection("example-items").find({});', [".collection"]],
    ["db.aggregate([{ $documents: [] }]);", ["db.aggregate("]],
    ['db.command({ update: "example-items", updates: [] });', ["db.command("]],
    ['db.runCommand({ find: "example-items" });', ["db.command("]],
    ["Model.find({}, null, { middleware: false });", ["middleware:"]],
    ["Model.find({}, null, { middleware: { pre: false } });", ["middleware:"]],
    ["Model.deleteMany({}).setOptions({ middleware: { pre: false } });", ["middleware:"]],
    ["const SKIP = false; Model.find({}, null, { middleware: SKIP });", ["middleware:"]],
    ["Model.find({}, null, { middleware : false });", ["middleware:"]],
    ["await Model.bulkWrite(ops);", [".bulkWrite("]],
    ["await Model.bulkSave(docs);", [".bulkSave("]],
    ["await Model.insertMany(rows, { lean: true });", [".insertMany(", "lean: true"]],
    ["Model.hydrate(row);", [".hydrate("]],
    ["Model.watch();", [".watch("]],
    ["await doc.save({ validateBeforeSave: false });", ["validateBeforeSave"]],
    ['import { registerApiErrorHandlers } from "../middlewares/api-errors";', []],
    ['import type { MongooseQueryMiddleware } from "mongoose";', []],
  ])("sees %s as %s", (code, labels) => {
    expect(bypassesNamed(code)).toEqual(labels);
  });

  it("strips a comment's mention and keeps a call", async () => {
    const documented = [
      "/** Never pass `{ middleware: false }` or reach for `.collection`. */",
      "await Model.bulkWrite(ops); // not `.watch(`",
    ].join("\n");

    expect(bypassesNamed(documented)).toEqual([
      ".collection",
      ".bulkWrite(",
      ".watch(",
      "middleware:",
    ]);
    expect(bypassesNamed(withoutComments(documented))).toEqual([".bulkWrite("]);

    const plugin = await readSource("contexts/shared/infrastructure/user-scoped-schema.ts");
    expect(withoutComments(plugin)).toContain("export function userScopedSchema");
  });
});

describe("the join stage, which no guard can scope from the outside", () => {
  it("walks the whole service, including the file with the aggregation pipeline", async () => {
    const files = await sweep(WHOLE_SERVICE);

    expect(files.length).toBeGreaterThan(20);
    const adapter = files.find((file) => file.path.endsWith("mongoose-example-item-repository.ts"));
    expect(adapter?.code).toContain("ExampleItemModel.aggregate<");
  });

  it("joins another collection in exactly the files argued onto MAY_JOIN", async () => {
    const files = await sweep(WHOLE_SERVICE);

    expect(filesWithAJoin(files)).toEqual([...MAY_JOIN, ...MAY_NAME_A_JOIN_STAGE].toSorted());

    for (const path of MAY_NAME_A_JOIN_STAGE) {
      const exempt = files.find((file) => file.path === path);
      expect(exempt?.code).not.toContain(".aggregate(");
      expect(exempt?.code).toContain("PIPELINE_JOIN_STAGES");
    }

    expect(MAY_JOIN).toEqual([]);
  });

  it("names a pipeline write stage only in the file that refuses them", async () => {
    const files = await sweep(WHOLE_SERVICE);

    expect(filesWritingFromAPipeline(files)).toEqual(MAY_WRITE_FROM_A_PIPELINE);

    const plugin = files.find((file) => file.path === MAY_WRITE_FROM_A_PIPELINE[0]);
    expect(plugin?.code).not.toContain(".aggregate(");
    expect(plugin?.code).toContain("PIPELINE_WRITE_STAGES");
  });

  it.each(MAY_JOIN)("re-scopes every join stage inside %s", async (path) => {
    const file = (await sweep(WHOLE_SERVICE)).find((swept) => swept.path === path);

    expect(file, `${path} is on MAY_JOIN but not in the walk`).toBeDefined();
    expect(unscopedJoinsIn(file?.code ?? "")).toEqual([]);
  });

  it("allows no joins at all, so the walk above is empty on purpose", () => {
    expect(MAY_JOIN).toEqual([]);
  });

  it.each([
    ["a $lookup whose pipeline re-scopes", RESCOPED_LOOKUP, []],
    ["a $lookup whose pipeline does not", BARE_LOOKUP, ["$lookup"]],
    [
      "a $graphLookup scoped only by the stage before it",
      OUTER_SCOPED_GRAPH_LOOKUP,
      ["$graphLookup"],
    ],
    ["a $unionWith naming a collection as a string", SHORTHAND_UNION_WITH, ["$unionWith"]],
    ["a $lookup whose stage is an identifier", SHORTHAND_LOOKUP, ["$lookup"]],
  ])("reads %s", (_case, source, unscoped) => {
    expect(unscopedJoinsIn(source)).toEqual(unscoped);
  });

  it("flags a stage whose body never closes, however much userId is in the tail", () => {
    expect(unscopedJoinsIn("{ $lookup: { from: 'notes'")).toEqual(["$lookup"]);
    expect(
      unscopedJoinsIn("{ $lookup: { from: 'notes', pipeline: [{ $match: { userId } }]"),
    ).toEqual(["$lookup"]);
    expect(
      unscopedJoinsIn("{ $lookup: { from: 'notes', pipeline: [{ $match: { userId } }] } }"),
    ).toEqual([]);
  });
});

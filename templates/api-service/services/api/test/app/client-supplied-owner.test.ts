import { describe, expect, it } from "vitest";

import { sweep, withoutComments, type SweptFile } from "../test-support/source-sweep";

const WHOLE_SERVICE = ".";

const REQUEST_HANDLING = /\brequest\b/;

const THE_SEAM = /userId:\s*callerId\(request\)/g;

const RAW_HEADER = /\.headers\b/;

const MAY_OBTAIN_AN_OWNER = ["controllers/caller-id.ts", "middlewares/require-user.ts"];

const READS_ONLY_ITS_NAMED_HEADERS: Readonly<Record<string, readonly string[]>> = {
  "middlewares/require-loopback-host.ts": ["request.headers.host"],
  "middlewares/require-user.ts": ["request.headers.authorization"],
};

const REQUEST_READS_OF_THE_OWNER_FILES: Readonly<Record<string, readonly string[]>> = {
  "controllers/caller-id.ts": ["request", "request.user", "request.user.userId"],
  "middlewares/require-user.ts": [
    "request",
    "request",
    "request.headers.authorization",
    "request.log.warn",
    "request.user",
    "request",
    "request",
    "request.routeOptions.url",
  ],
};

const withoutStrings = (code: string) =>
  code.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');

const requestReads = (file: SweptFile) =>
  [...withoutStrings(file.code).matchAll(/\brequest\b(?:\??\.\w+|\[[^\]]*\])*/g)].map(
    (match) => match[0],
  );

const requestHandling = (files: readonly SweptFile[]) =>
  files.filter((file) => REQUEST_HANDLING.test(file.code));

const beyondTheSeam = (file: SweptFile) => file.code.replace(THE_SEAM, "");

const headerReads = (file: SweptFile) =>
  [...file.code.matchAll(/[\w.\]]*\.headers\b[\w.]*/g)].map((match) => match[0]);

const readsOnlyItsNamedHeaders = (file: SweptFile) => {
  const named = READS_ONLY_ITS_NAMED_HEADERS[file.path];
  return named !== undefined && JSON.stringify(headerReads(file)) === JSON.stringify(named);
};

const filesObtainingAnOwner = (files: readonly SweptFile[]) =>
  requestHandling(files)
    .filter(
      (file) =>
        /\buserId\b/.test(beyondTheSeam(file)) ||
        (RAW_HEADER.test(file.code) && !readsOnlyItsNamedHeaders(file)),
    )
    .map((file) => file.path)
    .toSorted();

describe("where a request handler can learn whose rows to read", () => {
  it("walks every file in the service that touches a request", async () => {
    const all = await sweep(WHOLE_SERVICE);
    const handling = requestHandling(all).map((file) => file.path);

    expect(handling.length).toBeGreaterThan(8);
    expect(handling).toContain("controllers/example-items/notes.ts");
    expect(handling).toContain("controllers/stats/example-items.ts");
    expect(handling).toContain("middlewares/require-user.ts");
    expect(handling).toContain("controllers/profile/update.ts");
    expect(handling).not.toContain("contexts/example/application/list-example-items.ts");
    expect(handling.length).toBeLessThan(all.length);
  });

  it("is obtained in exactly two files, and both read the gate's own property", async () => {
    expect(filesObtainingAnOwner(await sweep(WHOLE_SERVICE))).toEqual(MAY_OBTAIN_AN_OWNER);
  });

  it.each([
    ["controllers/caller-id.ts", ["request.user.userId"]],
    ["middlewares/require-user.ts", ["user.userId"]],
  ])("obtains it in %s from the verified principal and nowhere else", async (path, reads) => {
    const file = (await sweep(WHOLE_SERVICE)).find((swept) => swept.path === path);

    expect(file, `${path} is on the equality but not in the walk`).toBeDefined();
    expect(
      [...(file?.code ?? "").matchAll(/[\w.\]]*\.userId\b/g)].map((match) => match[0]),
    ).toEqual(reads);
  });

  it.each(Object.entries(REQUEST_READS_OF_THE_OWNER_FILES))(
    "lets %s read nothing on the request but what it is named for",
    async (path, reads) => {
      const file = (await sweep(WHOLE_SERVICE)).find((swept) => swept.path === path);

      expect(file, `${path} may obtain an owner but is not in the walk`).toBeDefined();
      expect(requestReads(file ?? { path: "", code: "" })).toEqual(reads);
    },
  );

  it("names every exempt file in the request pin, and only those", () => {
    expect(Object.keys(REQUEST_READS_OF_THE_OWNER_FILES).toSorted()).toEqual(MAY_OBTAIN_AN_OWNER);
  });

  it.each([
    [
      "the query string, read before the principal",
      "return (request.query as Q).as ?? request.user.userId;",
      ["request.query", "request.user.userId"],
    ],
    ["the body", "return request.body.owner;", ["request.body.owner"]],
    ["a route parameter", "return request.params.owner;", ["request.params.owner"]],
    ["a bracketed read", 'return request["query"].as;', ['request[""].as']],
    ["a destructure", "const { query } = request;", ["request"]],
    ["an alias", "const incoming = request; return incoming.query.as;", ["request"]],
    ["prose in a string", 'sendApiError(reply, 401, "the request carried no token");', []],
  ])("collects %s", (_case, code, reads) => {
    expect(requestReads({ path: "planted.ts", code })).toEqual(reads);
  });

  it.each(Object.entries(READS_ONLY_ITS_NAMED_HEADERS))(
    "lets %s read only the headers it is named for",
    async (path, reads) => {
      const file = (await sweep(WHOLE_SERVICE)).find((swept) => swept.path === path);

      expect(file, `${path} is exempt but not in the walk`).toBeDefined();
      expect(headerReads(file ?? { path: "", code: "" })).toEqual(reads);
    },
  );

  it.each([
    ["the Host read alone", "request.headers.host;", false],
    ["a second header beside it", "request.headers.host; request.headers.authorization;", true],
    ["a bracketed read in its place", 'request.headers["x-user-id"];', true],
    ["the headers destructured", "const { host } = request.headers;", true],
  ])("holds the exempt file to its one read — %s", (_case, code, caught) => {
    const file: SweptFile = { path: "middlewares/require-loopback-host.ts", code };

    expect(filesObtainingAnOwner([file])).toEqual(
      caught ? ["middlewares/require-loopback-host.ts"] : [],
    );
  });

  it("mentions an owner only after getting it from callerId(request)", async () => {
    const scoping = requestHandling(await sweep(WHOLE_SERVICE))
      .filter((file) => /\buserId\b/.test(file.code))
      .filter((file) => !MAY_OBTAIN_AN_OWNER.includes(file.path));

    expect(scoping.length).toBeGreaterThan(5);
    expect(scoping.map((file) => file.path)).toContain("controllers/me.ts");
    expect(
      scoping.filter((file) => !file.code.includes("callerId(request)")).map((file) => file.path),
    ).toEqual([]);
  });

  it.each([
    ["const scope = request.query.userId;", true],
    ["const scope = request.params.userId;", true],
    ["server.post('/x', async (request) => { const { userId } = parsed.data; });", true],
    ['const scope = request.body["userId"];', true],
    ["const scope = request.headers['x-user-id'];", true],
    [
      "export const scopeFor = (request: FastifyRequest): string => (request.query as { userId?: string }).userId ?? request.user.userId;",
      true,
    ],
    ["const userId = scopeFor(request);", true],
    ["listExampleItems({ userId: callerId(request) }, deps);", false],
    ["server.get('/x', async (request, reply) => ({ userId: callerId(request) }));", false],
  ])("sees %s as an owner obtained outside the seam: %s", (code, caught) => {
    const file: SweptFile = { path: "planted.ts", code };

    expect(filesObtainingAnOwner([file])).toEqual(caught ? ["planted.ts"] : []);
  });

  it("sweeps a file that names a request and skips one that does not", () => {
    expect(
      filesObtainingAnOwner([{ path: "use-case.ts", code: "const { userId } = input;" }]),
    ).toEqual([]);
    expect(
      filesObtainingAnOwner([
        { path: "handler.ts", code: "const { userId } = request.query as Q;" },
      ]),
    ).toEqual(["handler.ts"]);
  });

  it("strips a docblock's mention of an owner and keeps the code around it", async () => {
    const files = await sweep(WHOLE_SERVICE);
    const mapper = files.find((file) => file.path === "controllers/map-example-error.ts");

    expect(mapper?.code).not.toContain("userId");
    expect(mapper?.code).toContain("export function mapExampleError");
    expect(withoutComments("/** a `userId` beside it would be */ const kept = 1;")).toBe(
      " const kept = 1;",
    );
  });
});

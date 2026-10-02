import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import type {
  ExampleItemRepository,
  ExampleNoteRepository,
} from "@api/contexts/example/application/ports";
import type { UserProfileRepository } from "@api/contexts/profile/application/ports";

import {
  declaredMembers,
  firstParameterName,
  methodsOf,
  type AssertNever,
  type UnscopedMethods,
} from "../test-support/owner-first-ports";
import { readSource, SOURCE_ROOT, withoutComments } from "../test-support/source-sweep";

const OWNED_PORTS: Readonly<Record<string, number>> = {
  "example/ExampleItemRepository": 5,
  "example/ExampleNoteRepository": 3,
  "profile/UserProfileRepository": 3,
};

const NOT_A_STORAGE_PORT = [
  "auth/AuthenticatedUser",
  "auth/TokenVerifier",
  "shared/SerializeByUser",
  "example/CreateExampleItem",
  "example/CreateExampleNote",
  "example/ExampleItemChanges",
  "example/ExampleItemFilter",
  "example/ExampleItemStatusCount",
];

export type ExampleItemPortScoped = AssertNever<UnscopedMethods<ExampleItemRepository>>;
export type ExampleNotePortScoped = AssertNever<UnscopedMethods<ExampleNoteRepository>>;
export type UserProfilePortScoped = AssertNever<UnscopedMethods<UserProfileRepository>>;

async function portsFilesIn(context: string): Promise<string[]> {
  const entries = await readdir(join(SOURCE_ROOT, "contexts", context, "application"), {
    withFileTypes: true,
  }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith("ports.ts"))
    .map((entry) => `contexts/${context}/application/${entry.name}`);
}

async function everyDeclaredPortInterface(): Promise<string[]> {
  const contexts = await readdir(join(SOURCE_ROOT, "contexts"), { withFileTypes: true });
  const perContext = await Promise.all(
    contexts
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const paths = await portsFilesIn(entry.name);
        const sources = await Promise.all(paths.map(async (path) => readSource(path)));

        return sources.flatMap((source) =>
          [...withoutComments(source).matchAll(/^export (?:interface|type) (\w+)/gm)].map(
            (match) => `${entry.name}/${match[1] ?? ""}`,
          ),
        );
      }),
  );
  return perContext.flat();
}

async function portsSourceDeclaring(qualifiedPort: string): Promise<string> {
  const [context = "", port = ""] = qualifiedPort.split("/");
  const sources = await Promise.all(
    (await portsFilesIn(context)).map(async (path) => withoutComments(await readSource(path))),
  );
  const declaring = sources.find((source) => declaredMembers(source, port).length > 0);

  if (declaring === undefined) {
    throw new Error(`${qualifiedPort} is declared in no ports file of its context`);
  }
  return declaring;
}

const ownAssertions = async () =>
  withoutComments(await readFile(fileURLToPath(import.meta.url), "utf8"));

const adapterFileFor = (port: string) =>
  `mongoose-${port.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;

async function adapterFor(qualifiedPort: string): Promise<{ prototype: object }> {
  const [context = "", port = ""] = qualifiedPort.split("/");
  const path = join(
    SOURCE_ROOT,
    "contexts",
    context,
    "infrastructure",
    `${adapterFileFor(port)}.ts`,
  );
  const module = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const adapter = module[`Mongoose${port}`];

  if (typeof adapter !== "function") {
    throw new Error(
      `${qualifiedPort} has no exported Mongoose${port} at ${adapterFileFor(port)}.ts`,
    );
  }
  return adapter as { prototype: object };
}

describe("the owner is the first parameter of every port method in the service", () => {
  it("accounts for every interface any context declares as a port, in one list or the other", async () => {
    expect([...Object.keys(OWNED_PORTS), ...NOT_A_STORAGE_PORT].toSorted()).toEqual(
      (await everyDeclaredPortInterface()).toSorted(),
    );
  });

  it("walks ports files that actually declare this service's ports", async () => {
    const declared = await everyDeclaredPortInterface();

    expect(declared).toContain("example/ExampleItemRepository");
    expect(declared).toContain("profile/UserProfileRepository");
    expect(await portsFilesIn("example")).toContain("contexts/example/application/ports.ts");
    expect(declared).not.toContain("example/CreateExampleItemInput");
  });

  it("carries a compile-time assertion for every owned port", async () => {
    const own = await ownAssertions();
    const unasserted = Object.keys(OWNED_PORTS).filter(
      (port) => !own.includes(`UnscopedMethods<${port.split("/")[1] ?? ""}>`),
    );

    expect(unasserted).toEqual([]);
  });

  it("names a port with no compile-time assertion, rather than passing over it", async () => {
    const own = await ownAssertions();
    const unasserted = ["example/InventedRepository", "example/ExampleItemRepository"].filter(
      (port) => !own.includes(`UnscopedMethods<${port.split("/")[1] ?? ""}>`),
    );

    expect(unasserted).toEqual(["example/InventedRepository"]);
  });

  describe.each(Object.entries(OWNED_PORTS))("%s", (port, methodCount) => {
    it("declares userId first on every method of the port", async () => {
      const members = declaredMembers(await portsSourceDeclaring(port), port.split("/")[1] ?? "");

      expect(members.map(([name]) => name)).toHaveLength(methodCount);
      expect(members.filter(([, first]) => first !== "userId").map(([name]) => name)).toEqual([]);
    });

    it("takes userId first on every method its adapter implements", async () => {
      const methods = methodsOf((await adapterFor(port)).prototype);

      expect(methods.map(([name]) => name)).toHaveLength(methodCount);
      expect(
        methods.filter(([, fn]) => firstParameterName(fn) !== "userId").map(([name]) => name),
      ).toEqual([]);
    });
  });

  it("walks every adapter and every port method", async () => {
    const adapters = await Promise.all(Object.keys(OWNED_PORTS).map(adapterFor));
    const methods = adapters.flatMap((adapter) => methodsOf(adapter.prototype));

    expect(adapters).toHaveLength(Object.keys(OWNED_PORTS).length);
    expect(methods).toHaveLength(
      Object.values(OWNED_PORTS).reduce((total, count) => total + count, 0),
    );
  });

  it("fails by name when a port has no adapter where its name says it should", async () => {
    await expect(adapterFor("example/InventedRepository")).rejects.toThrow(
      "mongoose-invented-repository",
    );
  });

  it("reads a port's declared first parameters, and only that port's", () => {
    const source = [
      "export interface Swapped {",
      "  findById(id: string, userId: string): Promise<X | null>;",
      "  readonly list: (userId: string) => Promise<X[]>;",
      "  count<T>(userId?: string): Promise<T>;",
      "}",
      "",
      "export interface After {",
      "  other(userId: string): Promise<void>;",
      "}",
    ].join("\n");

    expect(declaredMembers(source, "Swapped")).toEqual([
      ["findById", "id"],
      ["list", "userId"],
      ["count", "userId"],
    ]);
    expect(declaredMembers(source, "Missing")).toEqual([]);
  });

  it("reads a first parameter that is not the owner", () => {
    expect(firstParameterName((id: string, userId: string) => `${id}${userId}`)).toBe("id");
    expect(firstParameterName(() => undefined)).toBe("");
    expect(firstParameterName((userId = "fallback") => userId)).toBe("userId");
  });

  it("counts an assertion written as code, never one a comment names", async () => {
    const source = [
      "// AssertNever<UnscopedMethods<Mentioned>>",
      "export type Asserted = AssertNever<UnscopedMethods<Real>>;",
    ].join("\n");

    expect(withoutComments(source)).not.toContain("UnscopedMethods<Mentioned>");
    expect(withoutComments(source)).toContain("UnscopedMethods<Real>");
    expect(await ownAssertions()).toContain("UnscopedMethods<ExampleItemRepository>");
    expect(await ownAssertions()).toContain("const OWNED_PORTS");
  });
});

import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

import { EXAMPLE_ITEM_STATUSES } from "@__MKTRUE_NAME__/contracts";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { statusKey } from "@/lib/example-item-status";

const WEB = join(import.meta.dirname, "..", "..");
const CONTRACTS = realpathSync(
  dirname(createRequire(join(WEB, "package.json")).resolve("@__MKTRUE_NAME__/contracts")),
);
const STATUSES = join(CONTRACTS, "example-item.ts");
const ERROR_CODES = join(CONTRACTS, "api-error.ts");

const NOT_ALL_PATHS_RETURN = 2366;

function widen(path: string, list: string, added: string): string {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let insertAt: number | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === list &&
      node.initializer !== undefined
    ) {
      insertAt = arrayLiteralIn(node.initializer)?.elements.at(-1)?.end;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (insertAt === undefined) throw new Error(`${list} is not a non-empty array literal`);
  return `${source.slice(0, insertAt)}, ${JSON.stringify(added)}${source.slice(insertAt)}`;
}

function arrayLiteralIn(expression: ts.Expression): ts.ArrayLiteralExpression | undefined {
  if (ts.isArrayLiteralExpression(expression)) return expression;
  if (ts.isAsExpression(expression)) return arrayLiteralIn(expression.expression);
  const [first] = ts.isCallExpression(expression) ? expression.arguments : [];
  return first === undefined ? undefined : arrayLiteralIn(first);
}

function typecheckWeb(replaced: ReadonlyMap<string, string>): readonly ts.Diagnostic[] {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(WEB, "tsconfig.json"),
    { noEmit: true, incremental: false },
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (parsed === undefined) throw new Error("apps/web/tsconfig.json did not parse");

  const host = ts.createCompilerHost(parsed.options);
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => replaced.get(realpathOrSelf(fileName)) ?? readFile(fileName);

  return ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, parsed.options, host));
}

function realpathOrSelf(fileName: string): string {
  try {
    return realpathSync(fileName);
  } catch {
    return fileName;
  }
}

const inTheWebTier = (diagnostics: readonly ts.Diagnostic[]) =>
  diagnostics
    .filter((diagnostic) => diagnostic.file !== undefined)
    .map((diagnostic) => ({
      file: relative(WEB, realpathOrSelf(diagnostic.file?.fileName ?? "")),
      code: diagnostic.code,
    }))
    .filter(({ file }) => !file.startsWith(".."));

describe("the web tier's tie to the lists it shares with the contract", () => {
  it("typechecks as it stands", () => {
    expect(
      typecheckWeb(new Map()).map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
    ).toEqual([]);
  });

  it("fails to typecheck when the contract gains a status the web tier does not handle", () => {
    const widened = widen(STATUSES, "EXAMPLE_ITEM_STATUSES", "archived");

    expect(inTheWebTier(typecheckWeb(new Map([[STATUSES, widened]])))).toEqual([
      { file: "lib/example-item-status.ts", code: NOT_ALL_PATHS_RETURN },
    ]);
  });

  it("fails to typecheck when the contract gains an error code the web tier does not handle", () => {
    const widened = widen(ERROR_CODES, "apiErrorCodeSchema", "rate_limited");

    expect(inTheWebTier(typecheckWeb(new Map([[ERROR_CODES, widened]])))).toEqual([
      { file: "lib/api.ts", code: NOT_ALL_PATHS_RETURN },
    ]);
  });

  it("names every status the contract defines with a key of its own", () => {
    const keys = EXAMPLE_ITEM_STATUSES.map(statusKey);

    expect(new Set(keys).size).toBe(EXAMPLE_ITEM_STATUSES.length);
  });
});

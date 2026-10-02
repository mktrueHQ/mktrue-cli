import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ApiFailure } from "@/lib/api";
import { apiFailureCopy, isNoAccess } from "@/lib/api-failure";

const MESSAGES = join(import.meta.dirname, "..", "..", "messages");

const FAILURES: readonly ApiFailure[] = [
  { status: "forbidden" },
  { status: "unauthenticated" },
  { status: "notFound" },
  { status: "invalid" },
  { status: "conflict" },
  { status: "unavailable", reason: "auth" },
  { status: "unavailable", reason: "storage" },
  { status: "unavailable", reason: "api" },
];

function sentence(catalogue: unknown, key: string): unknown {
  return `shell.failure.${key}`
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      catalogue,
    );
}

describe("what a refusal says", () => {
  it.each(readdirSync(MESSAGES))("has a title and a detail for every failure in %s", (file) => {
    const catalogue: unknown = JSON.parse(readFileSync(join(MESSAGES, file), "utf8"));

    const missing = FAILURES.flatMap((failure) => {
      const copy = apiFailureCopy(failure);
      return [copy.title, copy.detail].filter(
        (key) => typeof sentence(catalogue, key) !== "string",
      );
    });
    expect(missing).toEqual([]);
  });

  it("offers a different session only where a different session is the fix", () => {
    expect(
      FAILURES.filter((failure) => apiFailureCopy(failure).needsDifferentSession).map(
        (failure) => failure.status,
      ),
    ).toEqual(["forbidden", "unauthenticated"]);
  });

  it("sends the account to /no-access only when the API refused the account itself", () => {
    expect(FAILURES.filter(isNoAccess)).toEqual([{ status: "forbidden" }]);
  });
});

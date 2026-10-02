import { describe, expect, it } from "vitest";

import { apiErrorCodeSchema, apiErrorSchema } from "../src/api-error";

describe("the API error envelope", () => {
  it("parses the shape every refusal in this service sends", () => {
    expect(
      apiErrorSchema.parse({ error: { code: "not_found", message: "no route matched" } }),
    ).toEqual({ error: { code: "not_found", message: "no route matched" } });
  });

  it("refuses a code nobody declared, so a call site cannot invent one", () => {
    expect(apiErrorSchema.safeParse({ error: { code: "oops", message: "x" } }).success).toBe(false);
  });

  it("refuses an empty message, because a refusal with nothing to read is not one", () => {
    expect(apiErrorSchema.safeParse({ error: { code: "internal", message: "" } }).success).toBe(
      false,
    );
  });

  it("is exactly the eight failures this API has", () => {
    expect([...apiErrorCodeSchema.options].toSorted()).toEqual([
      "auth_unavailable",
      "conflict",
      "forbidden",
      "internal",
      "invalid_request",
      "not_found",
      "storage_unavailable",
      "unauthenticated",
    ]);
  });
});

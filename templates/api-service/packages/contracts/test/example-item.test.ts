import { describe, expect, it } from "vitest";

import {
  createExampleItemBodySchema,
  exampleItemDtoSchema,
  exampleItemParamsSchema,
  updateExampleItemBodySchema,
  EXAMPLE_ITEM_TITLE_MAX_LENGTH,
} from "../src/example-item";

const ID = "0123456789abcdef01234567";

describe("the exemplar's contract", () => {
  it("answers a row with no owner on it, because an owner is a tenancy key and not a field", () => {
    const dto = exampleItemDtoSchema.parse({
      id: ID,
      title: "a thing",
      status: "open",
      createdOn: "2026-09-21",
    });

    expect(Object.keys(dto).toSorted()).toEqual(["createdOn", "id", "status", "title"]);
  });

  it("refuses a title past the declared ceiling", () => {
    expect(
      createExampleItemBodySchema.safeParse({
        title: "x".repeat(EXAMPLE_ITEM_TITLE_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("refuses a patch that changes nothing", () => {
    expect(updateExampleItemBodySchema.safeParse({}).success).toBe(false);
    expect(updateExampleItemBodySchema.safeParse({ status: "done" }).success).toBe(true);
  });

  it("refuses an id that is not 24 hexadecimal characters", () => {
    expect(exampleItemParamsSchema.safeParse({ id: "nope" }).success).toBe(false);
    expect(exampleItemParamsSchema.safeParse({ id: ID }).success).toBe(true);
  });
});

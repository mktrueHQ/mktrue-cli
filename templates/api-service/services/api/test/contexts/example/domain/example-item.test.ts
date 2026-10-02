import { describe, expect, it } from "vitest";

import {
  EXAMPLE_ITEM_TITLE_MAX_LENGTH,
  ExampleItem,
  InvalidExampleItemError,
} from "@api/contexts/example/domain/example-item";

const VALID = {
  id: "65a000000000000000000001",
  title: "an item",
  status: "open",
  createdOn: "2026-01-05",
};

describe("ExampleItem", () => {
  it("trims a title and keeps what it was given otherwise", () => {
    expect(ExampleItem.create({ ...VALID, title: "  an item  " }).toJSON()).toEqual(VALID);
  });

  it.each([
    ["an empty title", { title: "   " }, "title/empty"],
    [
      "an overlong title",
      { title: "x".repeat(EXAMPLE_ITEM_TITLE_MAX_LENGTH + 1) },
      "title/too_long",
    ],
    ["an unknown status", { status: "archived" }, "status/unsupported_status"],
    ["a day that does not exist", { createdOn: "2026-02-30" }, "createdOn/not_a_civil_date"],
  ])("refuses %s, naming the field and not the value", (_case, change, named) => {
    const input = { ...VALID, ...change };

    expect(() => ExampleItem.create(input)).toThrow(InvalidExampleItemError);
    expect(() => ExampleItem.create(input)).toThrow(named);
    try {
      ExampleItem.create(input);
    } catch (error) {
      expect((error as Error).message).not.toContain("archived");
    }
  });
});

import { apiErrorSchema } from "@__MKTRUE_NAME__/contracts";
import { describe, expect, it } from "vitest";

import type { ExampleItemRepository } from "@api/contexts/example/application/ports";
import { UnscopedQueryError } from "@api/contexts/shared/infrastructure/user-scoped-schema";

import { inMemoryExample } from "../test-support/in-memory-example";
import { AUTHORIZED, serverAsOwner } from "../test-support/owner-server";

describe("an unscoped read reaching the example routes", () => {
  it("answers 500 with a body that names nothing, never an empty 200", async () => {
    const store = inMemoryExample();
    const unscoped: ExampleItemRepository = {
      ...store.repositories.exampleItemRepository,
      list: () => Promise.reject(new UnscopedQueryError("find")),
    };
    const server = serverAsOwner({ ...store.repositories, exampleItemRepository: unscoped });

    const response = await server.inject({
      method: "GET",
      url: "/example-items",
      headers: AUTHORIZED,
    });

    expect(response.statusCode).toBe(500);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe("internal");
    expect(response.body).not.toContain("unscoped");
    await server.close();
  });
});

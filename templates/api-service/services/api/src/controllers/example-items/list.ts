// prettier-ignore
import { listExampleItemsQuerySchema, type ExampleItemDto } from "@__MKTRUE_NAME__/contracts";
import type { FastifyInstance } from "fastify";

import { listExampleItems } from "../../contexts/example/application/list-example-items";
import { callerId } from "../caller-id";
import type { ExampleRouteDeps } from "../deps";
import { mapExampleError } from "../map-example-error";
import { rejectInvalidRequest } from "../reject-invalid-request";

import { toExampleItemDto } from "./to-dto";

export function registerListExampleItemsRoute(
  server: FastifyInstance,
  deps: ExampleRouteDeps,
): void {
  server.get("/example-items", async (request, reply) => {
    const parsed = listExampleItemsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return rejectInvalidRequest(request, reply, parsed.error, "that is not a list filter");
    }

    try {
      const items = await listExampleItems(
        {
          userId: callerId(request),
          ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        },
        { exampleItemRepository: deps.exampleItemRepository },
      );
      const body: ExampleItemDto[] = items.map(toExampleItemDto);
      return reply.status(200).send(body);
    } catch (error) {
      return mapExampleError(error, request, reply);
    }
  });
}

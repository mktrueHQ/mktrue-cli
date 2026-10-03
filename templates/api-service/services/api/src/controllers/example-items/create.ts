// prettier-ignore
import { createExampleItemBodySchema, type ExampleItemDto } from "@__MKTRUE_NAME__/contracts";
import type { FastifyInstance } from "fastify";

import { createExampleItem } from "../../contexts/example/application/create-example-item";
import { callerClock } from "../caller-clock";
import { callerId } from "../caller-id";
import type { ExampleRouteDeps } from "../deps";
import { mapExampleError } from "../map-example-error";
import { rejectInvalidRequest } from "../reject-invalid-request";

import { toExampleItemDto } from "./to-dto";

export function registerCreateExampleItemRoute(
  server: FastifyInstance,
  deps: ExampleRouteDeps,
): void {
  server.post("/example-items", async (request, reply) => {
    const parsed = createExampleItemBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return rejectInvalidRequest(request, reply, parsed.error, "that is not an example item");
    }

    try {
      const item = await createExampleItem(
        {
          userId: callerId(request),
          title: parsed.data.title,
          today: (await callerClock(request, deps)).today,
        },
        { exampleItemRepository: deps.exampleItemRepository },
      );
      const body: ExampleItemDto = toExampleItemDto(item);
      return reply.status(201).send(body);
    } catch (error) {
      return mapExampleError(error, request, reply);
    }
  });
}

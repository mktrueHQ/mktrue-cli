import {
  exampleItemParamsSchema,
  updateExampleItemBodySchema,
  type ExampleItemDto,
} from "@__MKTRUE_NAME__/contracts";
import type { FastifyInstance } from "fastify";

import { updateExampleItem } from "../../contexts/example/application/update-example-item";
import { callerId } from "../caller-id";
import type { ExampleRouteDeps } from "../deps";
import { mapExampleError } from "../map-example-error";
import { rejectInvalidRequest } from "../reject-invalid-request";

import { toExampleItemDto } from "./to-dto";

export function registerUpdateExampleItemRoute(
  server: FastifyInstance,
  deps: ExampleRouteDeps,
): void {
  server.patch("/example-items/:id", async (request, reply) => {
    const params = exampleItemParamsSchema.safeParse(request.params);
    if (!params.success) {
      return rejectInvalidRequest(request, reply, params.error, "that is not an example item id");
    }

    const parsed = updateExampleItemBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return rejectInvalidRequest(
        request,
        reply,
        parsed.error,
        "that is not a change this accepts",
      );
    }

    try {
      const item = await updateExampleItem(
        {
          userId: callerId(request),
          id: params.data.id,
          ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
          ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        },
        { exampleItemRepository: deps.exampleItemRepository },
      );
      const body: ExampleItemDto = toExampleItemDto(item);
      return reply.status(200).send(body);
    } catch (error) {
      return mapExampleError(error, request, reply);
    }
  });
}

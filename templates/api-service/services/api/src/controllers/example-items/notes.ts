import {
  createExampleNoteBodySchema,
  exampleItemParamsSchema,
  type ExampleNoteDto,
} from "@__MKTRUE_NAME__/contracts";
import type { FastifyInstance } from "fastify";

import { addExampleNote } from "../../contexts/example/application/add-example-note";
import { listExampleNotes } from "../../contexts/example/application/list-example-notes";
import { callerClock } from "../caller-clock";
import { callerId } from "../caller-id";
import type { ExampleRouteDeps } from "../deps";
import { mapExampleError } from "../map-example-error";
import { rejectInvalidRequest } from "../reject-invalid-request";

import { toExampleNoteDto } from "./to-dto";

export function registerExampleNoteRoutes(server: FastifyInstance, deps: ExampleRouteDeps): void {
  server.get("/example-items/:id/notes", async (request, reply) => {
    const params = exampleItemParamsSchema.safeParse(request.params);
    if (!params.success) {
      return rejectInvalidRequest(request, reply, params.error, "that is not an example item id");
    }

    try {
      const notes = await listExampleNotes(
        { userId: callerId(request), itemId: params.data.id },
        {
          exampleItemRepository: deps.exampleItemRepository,
          exampleNoteRepository: deps.exampleNoteRepository,
        },
      );
      const body: ExampleNoteDto[] = notes.map(toExampleNoteDto);
      return reply.status(200).send(body);
    } catch (error) {
      return mapExampleError(error, request, reply);
    }
  });

  server.post("/example-items/:id/notes", async (request, reply) => {
    const params = exampleItemParamsSchema.safeParse(request.params);
    if (!params.success) {
      return rejectInvalidRequest(request, reply, params.error, "that is not an example item id");
    }

    const parsed = createExampleNoteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return rejectInvalidRequest(request, reply, parsed.error, "that is not an example note");
    }

    try {
      const note = await addExampleNote(
        {
          userId: callerId(request),
          itemId: params.data.id,
          text: parsed.data.text,
          today: (await callerClock(request, deps)).today,
        },
        {
          exampleItemRepository: deps.exampleItemRepository,
          exampleNoteRepository: deps.exampleNoteRepository,
          serialize: deps.serialize,
        },
      );
      const body: ExampleNoteDto = toExampleNoteDto(note);
      return reply.status(201).send(body);
    } catch (error) {
      return mapExampleError(error, request, reply);
    }
  });
}

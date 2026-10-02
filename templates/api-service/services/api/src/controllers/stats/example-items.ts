import type { ExampleStatsDto } from "@__MKTRUE_NAME__/contracts";
import type { FastifyInstance } from "fastify";

import {
  countExampleItemsByStatus,
  type ExampleStatsSummary,
} from "../../contexts/example/application/count-example-items-by-status";
import { callerClock } from "../caller-clock";
import { callerId } from "../caller-id";
import type { ExampleRouteDeps } from "../deps";
import { mapExampleError } from "../map-example-error";

import type { FastifyReply } from "fastify";

export function registerExampleStatsRoute(server: FastifyInstance, deps: ExampleRouteDeps): void {
  server.get("/stats/example-items", async (request, reply): Promise<FastifyReply> => {
    try {
      const clock = await callerClock(request, deps);
      const summary = await countExampleItemsByStatus(
        {
          userId: callerId(request),
          today: clock.today,
          timeZone: clock.timeZone,
        },
        { exampleItemRepository: deps.exampleItemRepository },
      );
      const body: ExampleStatsDto = toExampleStatsDto(summary);
      return reply.status(200).send(body);
    } catch (error) {
      return mapExampleError(error, request, reply);
    }
  });
}

function toExampleStatsDto(summary: ExampleStatsSummary): ExampleStatsDto {
  return {
    timezone: summary.timezone,
    today: summary.today,
    byStatus: summary.byStatus.map((entry) => ({ status: entry.status, count: entry.count })),
  };
}

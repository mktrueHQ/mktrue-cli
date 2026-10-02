import { EXAMPLE_ITEM_STATUSES, type ExampleItemStatus } from "../domain/example-item";

import type { ExampleItemRepository, ExampleItemStatusCount } from "./ports";

export interface CountExampleItemsByStatusInput {
  readonly userId: string;
  readonly today: string;
  readonly timeZone: string;
}

export interface CountExampleItemsByStatusDeps {
  readonly exampleItemRepository: Pick<ExampleItemRepository, "countByStatus">;
}

export interface ExampleStatsSummary {
  readonly timezone: string;
  readonly today: string;
  readonly byStatus: readonly ExampleItemStatusCount[];
}

export async function countExampleItemsByStatus(
  input: CountExampleItemsByStatusInput,
  deps: CountExampleItemsByStatusDeps,
): Promise<ExampleStatsSummary> {
  const counted = await deps.exampleItemRepository.countByStatus(input.userId);
  const byName = new Map<ExampleItemStatus, number>(
    counted.map((entry) => [entry.status, entry.count]),
  );

  return {
    timezone: input.timeZone,
    today: input.today,
    byStatus: EXAMPLE_ITEM_STATUSES.map((status) => ({
      status,
      count: byName.get(status) ?? 0,
    })),
  };
}

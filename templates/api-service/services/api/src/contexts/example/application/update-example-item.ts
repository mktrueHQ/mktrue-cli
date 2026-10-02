import type { ExampleItem, ExampleItemStatus } from "../domain/example-item";

import { ExampleItemNotFoundError } from "./errors";
import type { ExampleItemRepository } from "./ports";

export interface UpdateExampleItemInput {
  readonly userId: string;
  readonly id: string;
  readonly title?: string;
  readonly status?: ExampleItemStatus;
}

export interface UpdateExampleItemDeps {
  readonly exampleItemRepository: Pick<ExampleItemRepository, "update">;
}

export async function updateExampleItem(
  input: UpdateExampleItemInput,
  deps: UpdateExampleItemDeps,
): Promise<ExampleItem> {
  const updated = await deps.exampleItemRepository.update(input.userId, input.id, {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.status === undefined ? {} : { status: input.status }),
  });

  if (updated === null) {
    throw new ExampleItemNotFoundError();
  }
  return updated;
}

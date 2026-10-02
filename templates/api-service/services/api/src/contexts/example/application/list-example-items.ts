import type { ExampleItem, ExampleItemStatus } from "../domain/example-item";

import type { ExampleItemRepository, ExampleItemFilter } from "./ports";

export const EXAMPLE_ITEM_LIST_LIMIT = 100;

export interface ListExampleItemsInput {
  readonly userId: string;
  readonly status?: ExampleItemStatus;
}

export interface ListExampleItemsDeps {
  readonly exampleItemRepository: Pick<ExampleItemRepository, "list">;
}

export async function listExampleItems(
  input: ListExampleItemsInput,
  deps: ListExampleItemsDeps,
): Promise<readonly ExampleItem[]> {
  const filter: ExampleItemFilter = {
    ...(input.status === undefined ? {} : { status: input.status }),
    limit: EXAMPLE_ITEM_LIST_LIMIT,
  };
  return deps.exampleItemRepository.list(input.userId, filter);
}

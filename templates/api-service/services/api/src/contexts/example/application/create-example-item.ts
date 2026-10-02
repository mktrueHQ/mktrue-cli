import type { ExampleItem } from "../domain/example-item";

import type { ExampleItemRepository } from "./ports";

export interface CreateExampleItemInput {
  readonly userId: string;
  readonly title: string;
  readonly today: string;
}

export interface CreateExampleItemDeps {
  readonly exampleItemRepository: Pick<ExampleItemRepository, "create">;
}

export async function createExampleItem(
  input: CreateExampleItemInput,
  deps: CreateExampleItemDeps,
): Promise<ExampleItem> {
  return deps.exampleItemRepository.create(input.userId, {
    title: input.title,
    createdOn: input.today,
  });
}

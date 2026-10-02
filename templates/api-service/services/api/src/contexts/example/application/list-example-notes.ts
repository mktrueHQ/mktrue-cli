import type { ExampleNote } from "../domain/example-note";

import { ExampleItemNotFoundError } from "./errors";
import type { ExampleItemRepository, ExampleNoteRepository } from "./ports";

export interface ListExampleNotesInput {
  readonly userId: string;
  readonly itemId: string;
}

export interface ListExampleNotesDeps {
  readonly exampleItemRepository: Pick<ExampleItemRepository, "findById">;
  readonly exampleNoteRepository: Pick<ExampleNoteRepository, "listForItem">;
}

export async function listExampleNotes(
  input: ListExampleNotesInput,
  deps: ListExampleNotesDeps,
): Promise<readonly ExampleNote[]> {
  const item = await deps.exampleItemRepository.findById(input.userId, input.itemId);
  if (item === null) {
    throw new ExampleItemNotFoundError();
  }

  return deps.exampleNoteRepository.listForItem(input.userId, input.itemId);
}

import type { SerializeByUser } from "../../shared/application/ports";
import type { ExampleNote } from "../domain/example-note";

import { ExampleItemNotFoundError, TooManyExampleNotesError } from "./errors";
import type { ExampleItemRepository, ExampleNoteRepository } from "./ports";

export const EXAMPLE_NOTES_MAX = 50;

export interface AddExampleNoteInput {
  readonly userId: string;
  readonly itemId: string;
  readonly text: string;
  readonly today: string;
}

export interface AddExampleNoteDeps {
  readonly exampleItemRepository: Pick<ExampleItemRepository, "findById">;
  readonly exampleNoteRepository: Pick<ExampleNoteRepository, "create" | "countForItem">;
  readonly serialize: SerializeByUser;
}

export async function addExampleNote(
  input: AddExampleNoteInput,
  deps: AddExampleNoteDeps,
): Promise<ExampleNote> {
  return deps.serialize(input.userId, async () => {
    const item = await deps.exampleItemRepository.findById(input.userId, input.itemId);
    if (item === null) {
      throw new ExampleItemNotFoundError();
    }

    const held = await deps.exampleNoteRepository.countForItem(input.userId, input.itemId);
    if (held >= EXAMPLE_NOTES_MAX) {
      throw new TooManyExampleNotesError();
    }

    return deps.exampleNoteRepository.create(input.userId, {
      itemId: input.itemId,
      text: input.text,
      writtenOn: input.today,
    });
  });
}

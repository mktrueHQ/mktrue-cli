import { describe, expect, it } from "vitest";

import { serializeByUser } from "@api/app/serialize-by-user";
import {
  addExampleNote,
  EXAMPLE_NOTES_MAX,
} from "@api/contexts/example/application/add-example-note";
import {
  ExampleItemNotFoundError,
  TooManyExampleNotesError,
} from "@api/contexts/example/application/errors";
import type {
  ExampleItemRepository,
  ExampleNoteRepository,
} from "@api/contexts/example/application/ports";
import { ExampleItem } from "@api/contexts/example/domain/example-item";
import { ExampleNote } from "@api/contexts/example/domain/example-note";

const HIM = "user_owner_1";
const HER = "user_other_2";
const ITEM_ID = "65a000000000000000000001";
const TODAY = "2026-01-05";

function itemsOwnedBy(owner: string): Pick<ExampleItemRepository, "findById"> {
  const item = ExampleItem.create({
    id: ITEM_ID,
    title: "an item",
    status: "open",
    createdOn: TODAY,
  });
  return {
    findById: (userId, id) => Promise.resolve(userId === owner && id === ITEM_ID ? item : null),
  };
}

function notesInMemory(): Pick<ExampleNoteRepository, "create" | "countForItem"> & {
  readonly stored: { userId: string; itemId: string }[];
} {
  const stored: { userId: string; itemId: string }[] = [];
  return {
    stored,
    async countForItem(userId, itemId) {
      const held = stored.filter((row) => row.userId === userId && row.itemId === itemId).length;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return held;
    },
    create(userId, input) {
      stored.push({ userId, itemId: input.itemId });
      return Promise.resolve(
        ExampleNote.create({
          id: `65b0000000000000000000${String(stored.length).padStart(2, "0")}`,
          itemId: input.itemId,
          text: input.text,
          writtenOn: input.writtenOn,
        }),
      );
    },
  };
}

describe("addExampleNote", () => {
  it("files a note against the caller's own item", async () => {
    const notes = notesInMemory();

    const note = await addExampleNote(
      { userId: HIM, itemId: ITEM_ID, text: "a note", today: TODAY },
      {
        exampleItemRepository: itemsOwnedBy(HIM),
        exampleNoteRepository: notes,
        serialize: serializeByUser(),
      },
    );

    expect(note.itemId).toBe(ITEM_ID);
    expect(notes.stored).toEqual([{ userId: HIM, itemId: ITEM_ID }]);
  });

  it("refuses an item that is not the caller's, and writes nothing", async () => {
    const notes = notesInMemory();

    await expect(
      addExampleNote(
        { userId: HER, itemId: ITEM_ID, text: "a note", today: TODAY },
        {
          exampleItemRepository: itemsOwnedBy(HIM),
          exampleNoteRepository: notes,
          serialize: serializeByUser(),
        },
      ),
    ).rejects.toBeInstanceOf(ExampleItemNotFoundError);
    expect(notes.stored).toEqual([]);
  });

  it("never exceeds the ceiling, however many writes arrive at once", async () => {
    const notes = notesInMemory();
    const deps = {
      exampleItemRepository: itemsOwnedBy(HIM),
      exampleNoteRepository: notes,
      serialize: serializeByUser(),
    };

    const outcomes = await Promise.allSettled(
      Array.from({ length: EXAMPLE_NOTES_MAX + 5 }, () =>
        addExampleNote({ userId: HIM, itemId: ITEM_ID, text: "a note", today: TODAY }, deps),
      ),
    );

    expect(notes.stored).toHaveLength(EXAMPLE_NOTES_MAX);
    expect(
      outcomes.filter(
        (outcome) =>
          outcome.status === "rejected" && outcome.reason instanceof TooManyExampleNotesError,
      ),
    ).toHaveLength(5);
  });
});

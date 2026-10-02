import type {
  ExampleItemRepository,
  ExampleNoteRepository,
} from "@api/contexts/example/application/ports";
import { ExampleItem } from "@api/contexts/example/domain/example-item";
import { ExampleNote } from "@api/contexts/example/domain/example-note";
import type { UserProfileRepository } from "@api/contexts/profile/application/ports";

const COUNT_WINDOW_MS = 25;

interface StoredItem {
  readonly userId: string;
  readonly item: ExampleItem;
}

interface StoredNote {
  readonly userId: string;
  readonly note: ExampleNote;
}

const objectId = (serial: number) => serial.toString(16).padStart(24, "0");

export function inMemoryExample() {
  const items: StoredItem[] = [];
  const notes: StoredNote[] = [];
  let serial = 0;

  const exampleItemRepository: ExampleItemRepository = {
    create(userId, input) {
      const item = ExampleItem.create({ id: objectId((serial += 1)), status: "open", ...input });
      items.push({ userId, item });
      return Promise.resolve(item);
    },
    findById(userId, id) {
      const found = items.find((row) => row.userId === userId && row.item.id === id);
      return Promise.resolve(found?.item ?? null);
    },
    list(userId, filter) {
      return Promise.resolve(
        items
          .filter((row) => row.userId === userId)
          .filter((row) => filter.status === undefined || row.item.status === filter.status)
          .slice(0, filter.limit)
          .map((row) => row.item),
      );
    },
    update() {
      return Promise.reject(new Error("not used by the route tests"));
    },
    countByStatus() {
      return Promise.reject(new Error("not used by the route tests"));
    },
  };

  const exampleNoteRepository: ExampleNoteRepository = {
    create(userId, input) {
      const note = ExampleNote.create({ id: objectId((serial += 1)), ...input });
      notes.push({ userId, note });
      return Promise.resolve(note);
    },
    listForItem(userId, itemId) {
      return Promise.resolve(
        notes
          .filter((row) => row.userId === userId && row.note.itemId === itemId)
          .map((row) => row.note),
      );
    },
    async countForItem(userId, itemId) {
      const held = notes.filter(
        (row) => row.userId === userId && row.note.itemId === itemId,
      ).length;
      await new Promise((resolve) => setTimeout(resolve, COUNT_WINDOW_MS));
      return held;
    },
  };

  const userProfileRepository: UserProfileRepository = {
    find: () => Promise.resolve(null),
    setLocale: () => Promise.reject(new Error("not used by the route tests")),
    setTimeZone: () => Promise.reject(new Error("not used by the route tests")),
  };

  return {
    repositories: { exampleItemRepository, exampleNoteRepository, userProfileRepository },
    async seedItem(userId: string): Promise<string> {
      const item = await exampleItemRepository.create(userId, {
        title: "an item",
        createdOn: "2026-01-05",
      });
      return item.id;
    },
    async seedNotes(userId: string, itemId: string, count: number): Promise<void> {
      for (let at = 0; at < count; at += 1) {
        await exampleNoteRepository.create(userId, {
          itemId,
          text: `note ${String(at)}`,
          writtenOn: "2026-01-05",
        });
      }
    },
    notesHeld: (userId: string, itemId: string) =>
      notes.filter((row) => row.userId === userId && row.note.itemId === itemId).length,
  };
}

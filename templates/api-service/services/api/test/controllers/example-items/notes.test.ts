import { describe, expect, it } from "vitest";

import {
  addExampleNote,
  EXAMPLE_NOTES_MAX,
} from "@api/contexts/example/application/add-example-note";
import type { SerializeByUser } from "@api/contexts/shared/application/ports";

import { inMemoryExample } from "../../test-support/in-memory-example";
import { AUTHORIZED, OWNER, serverAsOwner } from "../../test-support/owner-server";

describe("POST /example-items/:id/notes, as the server is composed", () => {
  it("files exactly one of two notes racing for the last place under the ceiling", async () => {
    const store = inMemoryExample();
    const itemId = await store.seedItem(OWNER);
    await store.seedNotes(OWNER, itemId, EXAMPLE_NOTES_MAX - 1);
    const server = serverAsOwner(store.repositories);

    const post = () =>
      server.inject({
        method: "POST",
        url: `/example-items/${itemId}/notes`,
        payload: { text: "the last place" },
        headers: AUTHORIZED,
      });
    const answers = await Promise.all([post(), post()]);

    expect(answers.map((answer) => answer.statusCode).toSorted()).toEqual([201, 409]);
    expect(store.notesHeld(OWNER, itemId)).toBe(EXAMPLE_NOTES_MAX);
    await server.close();
  });

  it("lets both land when the same two writes are not serialized", async () => {
    const store = inMemoryExample();
    const itemId = await store.seedItem(OWNER);
    await store.seedNotes(OWNER, itemId, EXAMPLE_NOTES_MAX - 1);
    const passThrough: SerializeByUser = async (_owner, run) => run();
    const deps = { ...store.repositories, serialize: passThrough };

    const write = () =>
      addExampleNote({ userId: OWNER, itemId, text: "the last place", today: "2026-01-05" }, deps);
    await Promise.all([write(), write()]);

    expect(store.notesHeld(OWNER, itemId)).toBe(EXAMPLE_NOTES_MAX + 1);
  });
});

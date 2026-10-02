import mongoose from "mongoose";

import { isObjectIdString } from "../../shared/infrastructure/object-id";
import { ExampleStorageUnavailableError } from "../application/errors";
import type { CreateExampleNote, ExampleNoteRepository } from "../application/ports";
import { ExampleNote } from "../domain/example-note";

import { ExampleNoteModel, type StoredExampleNote } from "./example-note-model";

export class MongooseExampleNoteRepository implements ExampleNoteRepository {
  async create(userId: string, input: CreateExampleNote): Promise<ExampleNote> {
    assertConnected();

    const created = await ExampleNoteModel.create({
      userId,
      itemId: input.itemId,
      text: input.text,
      writtenOn: input.writtenOn,
    });
    return toNote(created.toObject<StoredExampleNote>());
  }

  async listForItem(userId: string, itemId: string): Promise<readonly ExampleNote[]> {
    assertConnected();
    if (!isObjectIdString(itemId)) return [];

    const rows = await ExampleNoteModel.find({ userId, itemId })
      .sort({ writtenOn: 1, _id: 1 })
      .lean<StoredExampleNote[]>()
      .exec();
    return rows.map(toNote);
  }

  async countForItem(userId: string, itemId: string): Promise<number> {
    assertConnected();
    if (!isObjectIdString(itemId)) return 0;

    return ExampleNoteModel.countDocuments({ userId, itemId }).exec();
  }
}

function assertConnected(): void {
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected) {
    throw new ExampleStorageUnavailableError();
  }
}

function toNote(row: StoredExampleNote): ExampleNote {
  return ExampleNote.create({
    id: String(row._id),
    itemId: String(row.itemId),
    text: row.text,
    writtenOn: row.writtenOn,
  });
}

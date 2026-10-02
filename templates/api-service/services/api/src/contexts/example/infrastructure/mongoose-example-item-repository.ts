import mongoose from "mongoose";

import { isObjectIdString } from "../../shared/infrastructure/object-id";
import { ExampleStorageUnavailableError } from "../application/errors";
import type {
  CreateExampleItem,
  ExampleItemChanges,
  ExampleItemFilter,
  ExampleItemRepository,
  ExampleItemStatusCount,
} from "../application/ports";
import { ExampleItem, type ExampleItemStatus } from "../domain/example-item";

import { ExampleItemModel, type StoredExampleItem } from "./example-item-model";

export class MongooseExampleItemRepository implements ExampleItemRepository {
  async create(userId: string, input: CreateExampleItem): Promise<ExampleItem> {
    assertConnected();

    const created = await ExampleItemModel.create({
      userId,
      title: input.title,
      status: "open",
      createdOn: input.createdOn,
    });
    return toItem(created.toObject<StoredExampleItem>());
  }

  async findById(userId: string, id: string): Promise<ExampleItem | null> {
    assertConnected();
    if (!isObjectIdString(id)) return null;

    const row = await ExampleItemModel.findOne({ userId, _id: id })
      .lean<StoredExampleItem | null>()
      .exec();
    return row ? toItem(row) : null;
  }

  async list(userId: string, filter: ExampleItemFilter): Promise<readonly ExampleItem[]> {
    assertConnected();

    const rows = await ExampleItemModel.find({
      userId,
      ...(filter.status === undefined ? {} : { status: filter.status }),
    })
      .sort({ createdOn: -1, _id: -1 })
      .limit(filter.limit)
      .lean<StoredExampleItem[]>()
      .exec();
    return rows.map(toItem);
  }

  async update(
    userId: string,
    id: string,
    changes: ExampleItemChanges,
  ): Promise<ExampleItem | null> {
    assertConnected();
    if (!isObjectIdString(id)) return null;

    const row = await ExampleItemModel.findOneAndUpdate(
      { userId, _id: id },
      { $set: changes },
      {
        new: true,
      },
    )
      .lean<StoredExampleItem | null>()
      .exec();
    return row ? toItem(row) : null;
  }

  async countByStatus(userId: string): Promise<readonly ExampleItemStatusCount[]> {
    assertConnected();

    const rows = await ExampleItemModel.aggregate<{ _id: string; count: number }>([
      { $match: { userId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]).exec();

    return rows.map((row) => ({ status: row._id as ExampleItemStatus, count: row.count }));
  }
}

function assertConnected(): void {
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected) {
    throw new ExampleStorageUnavailableError();
  }
}

function toItem(row: StoredExampleItem): ExampleItem {
  return ExampleItem.create({
    id: String(row._id),
    title: row.title,
    status: row.status,
    createdOn: row.createdOn,
  });
}

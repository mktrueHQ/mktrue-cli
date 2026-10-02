import type { ExampleItem, ExampleItemStatus } from "../domain/example-item";
import type { ExampleNote } from "../domain/example-note";

export interface ExampleItemRepository {
  create(userId: string, input: CreateExampleItem): Promise<ExampleItem>;
  findById(userId: string, id: string): Promise<ExampleItem | null>;
  list(userId: string, filter: ExampleItemFilter): Promise<readonly ExampleItem[]>;
  update(userId: string, id: string, changes: ExampleItemChanges): Promise<ExampleItem | null>;
  countByStatus(userId: string): Promise<readonly ExampleItemStatusCount[]>;
}

export interface ExampleNoteRepository {
  create(userId: string, input: CreateExampleNote): Promise<ExampleNote>;
  listForItem(userId: string, itemId: string): Promise<readonly ExampleNote[]>;
  countForItem(userId: string, itemId: string): Promise<number>;
}

export interface CreateExampleItem {
  readonly title: string;
  readonly createdOn: string;
}

export interface CreateExampleNote {
  readonly itemId: string;
  readonly text: string;
  readonly writtenOn: string;
}

export interface ExampleItemChanges {
  readonly title?: string;
  readonly status?: ExampleItemStatus;
}

export interface ExampleItemFilter {
  readonly status?: ExampleItemStatus;
  readonly limit: number;
}

export interface ExampleItemStatusCount {
  readonly status: ExampleItemStatus;
  readonly count: number;
}

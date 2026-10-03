// prettier-ignore
import type { ExampleItemDto, ExampleNoteDto } from "@__MKTRUE_NAME__/contracts";

import type { ExampleItem } from "../../contexts/example/domain/example-item";
import type { ExampleNote } from "../../contexts/example/domain/example-note";

export function toExampleItemDto(item: ExampleItem): ExampleItemDto {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    createdOn: item.createdOn,
  };
}

export function toExampleNoteDto(note: ExampleNote): ExampleNoteDto {
  return {
    id: note.id,
    itemId: note.itemId,
    text: note.text,
    writtenOn: note.writtenOn,
  };
}

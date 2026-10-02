import { z } from "zod";

import { isoDateSchema } from "./civil-date";
import { objectIdSchema } from "./object-id";

export const EXAMPLE_ITEM_STATUSES = ["open", "done"] as const;
export const exampleItemStatusSchema = z.enum(EXAMPLE_ITEM_STATUSES);
export type ExampleItemStatus = z.infer<typeof exampleItemStatusSchema>;

export const EXAMPLE_ITEM_TITLE_MAX_LENGTH = 200;
export const EXAMPLE_NOTE_TEXT_MAX_LENGTH = 2000;

export const EXAMPLE_ITEM_LIST_LIMIT = 100;

export const EXAMPLE_NOTES_MAX = 50;

export const exampleItemDtoSchema = z.object({
  id: objectIdSchema,
  title: z.string().min(1).max(EXAMPLE_ITEM_TITLE_MAX_LENGTH),
  status: exampleItemStatusSchema,
  createdOn: isoDateSchema,
});
export type ExampleItemDto = z.infer<typeof exampleItemDtoSchema>;

export const exampleNoteDtoSchema = z.object({
  id: objectIdSchema,
  itemId: objectIdSchema,
  text: z.string().min(1).max(EXAMPLE_NOTE_TEXT_MAX_LENGTH),
  writtenOn: isoDateSchema,
});
export type ExampleNoteDto = z.infer<typeof exampleNoteDtoSchema>;

export const createExampleItemBodySchema = z.object({
  title: z.string().min(1).max(EXAMPLE_ITEM_TITLE_MAX_LENGTH),
});
export type CreateExampleItemBody = z.infer<typeof createExampleItemBodySchema>;

export const updateExampleItemBodySchema = z
  .object({
    title: z.string().min(1).max(EXAMPLE_ITEM_TITLE_MAX_LENGTH).optional(),
    status: exampleItemStatusSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "name at least one field to change");
export type UpdateExampleItemBody = z.infer<typeof updateExampleItemBodySchema>;

export const createExampleNoteBodySchema = z.object({
  text: z.string().min(1).max(EXAMPLE_NOTE_TEXT_MAX_LENGTH),
});
export type CreateExampleNoteBody = z.infer<typeof createExampleNoteBodySchema>;

export const exampleItemParamsSchema = z.object({ id: objectIdSchema });
export type ExampleItemParams = z.infer<typeof exampleItemParamsSchema>;

export const listExampleItemsQuerySchema = z.object({
  status: exampleItemStatusSchema.optional(),
});
export type ListExampleItemsQuery = z.infer<typeof listExampleItemsQuerySchema>;

import { z } from "zod";

import { isoDateSchema } from "./civil-date";
import { exampleItemStatusSchema } from "./example-item";

export const exampleStatsDtoSchema = z.object({
  timezone: z.string().min(1),
  today: isoDateSchema,
  byStatus: z.array(
    z.object({ status: exampleItemStatusSchema, count: z.number().int().nonnegative() }),
  ),
});
export type ExampleStatsDto = z.infer<typeof exampleStatsDtoSchema>;

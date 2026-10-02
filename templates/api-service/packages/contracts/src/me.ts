import { z } from "zod";

export const meResponseSchema = z.object({
  userId: z.string().min(1),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

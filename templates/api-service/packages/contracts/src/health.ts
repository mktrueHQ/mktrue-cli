import { z } from "zod";

export const MONGO_HEALTH_STATES = ["connected", "disconnected"] as const;

export const healthStatusSchema = z.object({
  status: z.literal("ok"),
  version: z.string().min(1),
  commitSha: z.string().min(1).optional(),
  mongo: z.enum(MONGO_HEALTH_STATES),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;

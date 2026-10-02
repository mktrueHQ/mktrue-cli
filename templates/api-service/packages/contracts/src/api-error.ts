import { z } from "zod";

export const apiErrorCodeSchema = z.enum([
  "unauthenticated",
  "forbidden",
  "auth_unavailable",
  "storage_unavailable",
  "not_found",
  "invalid_request",
  "conflict",
  "internal",
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

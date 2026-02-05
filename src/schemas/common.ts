import { z } from "zod";
import { MAX_URL_LENGTH_FOR_VALIDATION } from "#veryfront/utils/constants/index.ts";

/**
 * Common validation schemas used across multiple modules.
 * These schemas provide consistent validation for frequently-used data types.
 */
export const CommonSchemas = {
  email: z.string().email().max(255),
  uuid: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(100),
  url: z.string().url().max(MAX_URL_LENGTH_FOR_VALIDATION),
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/),

  pagination: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),
    sort: z.string().optional(),
    order: z.enum(["asc", "desc"]).optional(),
  }),

  dateRange: z
    .object({
      from: z.string().datetime(),
      to: z.string().datetime(),
    })
    .refine(({ from, to }) => new Date(from) <= new Date(to), {
      message: "From date must be before or equal to To date",
    }),

  strongPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
};

// Export inferred types for convenience
export type Email = z.infer<typeof CommonSchemas.email>;
export type Uuid = z.infer<typeof CommonSchemas.uuid>;
export type Slug = z.infer<typeof CommonSchemas.slug>;
export type Url = z.infer<typeof CommonSchemas.url>;
export type PhoneNumber = z.infer<typeof CommonSchemas.phoneNumber>;
export type Pagination = z.infer<typeof CommonSchemas.pagination>;
export type DateRange = z.infer<typeof CommonSchemas.dateRange>;
export type StrongPassword = z.infer<typeof CommonSchemas.strongPassword>;

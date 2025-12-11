
import { z } from "zod";
import { MAX_URL_LENGTH_FOR_VALIDATION } from "@veryfront/core/constants/index.ts";

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

  dateRange: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }).refine((data) => new Date(data.from) <= new Date(data.to), {
    message: "From date must be before or equal to To date",
  }),

  strongPassword: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
};

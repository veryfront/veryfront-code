/**
 * Common Validation Schemas
 * Reusable Zod schemas for common validation patterns
 */

import { z } from "zod";
import { MAX_URL_LENGTH_FOR_VALIDATION } from "#veryfront/utils/constants/index.ts";

/**
 * Collection of commonly used validation schemas
 */
export const CommonSchemas = {
  /**
   * Valid email address (RFC-compliant, max 255 chars)
   */
  email: z.string().email().max(255),

  /**
   * Valid UUID v4 identifier
   */
  uuid: z.string().uuid(),

  /**
   * URL-safe slug (lowercase alphanumeric with hyphens)
   */
  slug: z.string().regex(/^[a-z0-9-]+$/).min(1).max(100),

  /**
   * Valid HTTP/HTTPS URL (max 2048 chars)
   */
  url: z.string().url().max(MAX_URL_LENGTH_FOR_VALIDATION),

  /**
   * International phone number (E.164 format)
   */
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/),

  /**
   * Pagination parameters with defaults
   */
  pagination: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),
    sort: z.string().optional(),
    order: z.enum(["asc", "desc"]).optional(),
  }),

  /**
   * Date range with validation
   */
  dateRange: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }).refine((data) => new Date(data.from) <= new Date(data.to), {
    message: "From date must be before or equal to To date",
  }),

  /**
   * Strong password requirements
   * - Minimum 8 characters
   * - At least one uppercase letter
   * - At least one lowercase letter
   * - At least one number
   * - At least one special character
   */
  strongPassword: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
};

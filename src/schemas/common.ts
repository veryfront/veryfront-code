/**
 * Common reusable schemas (email, slug, URL, UUID, pagination, …) expressed
 * against the `SchemaValidator` contract via `defineSchema`.
 *
 * Each schema is a lazy getter. The `CommonSchemas` object exposes them via
 * property accessors to preserve the existing call shape
 * (`CommonSchemas.email.parse(x)` continues to work).
 *
 * @module schemas/common
 */

import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { MAX_URL_LENGTH_FOR_VALIDATION } from "#veryfront/utils/constants/index.ts";
import { defineSchema } from "./define.ts";
import { getTimestampSchema } from "./primitives.ts";

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const E164_PHONE_NUMBER_PATTERN = /^\+?[1-9]\d{1,14}$/;
const MAX_EMAIL_LENGTH = 255;
const MAX_SLUG_LENGTH = 100;
const DEFAULT_PAGE_NUMBER = 1;
const DEFAULT_PAGE_LIMIT = 10;
const MAX_PAGE_LIMIT = 100;
const STRONG_PASSWORD_MIN_LENGTH = 8;

export const getEmailSchema = defineSchema((v) => v.string().email().max(MAX_EMAIL_LENGTH));
export const getUuidSchema = defineSchema((v) => v.string().uuid());
export const getSlugSchema = defineSchema((v) =>
  v.string().regex(SLUG_PATTERN).min(1).max(MAX_SLUG_LENGTH)
);
export const getUrlSchema = defineSchema((v) =>
  v.string().url().max(MAX_URL_LENGTH_FOR_VALIDATION)
);
export const getPhoneNumberSchema = defineSchema((v) =>
  v.string().regex(E164_PHONE_NUMBER_PATTERN)
);

export const getPaginationSchema = defineSchema((v) => {
  const numericQueryParameter = () =>
    v.union([v.string(), v.number()]).transform((value) => Number(value));

  return v.object({
    page: numericQueryParameter().pipe(v.number().int().positive()).default(DEFAULT_PAGE_NUMBER),
    limit: numericQueryParameter().pipe(v.number().int().positive().max(MAX_PAGE_LIMIT)).default(
      DEFAULT_PAGE_LIMIT,
    ),
    sort: v.string().optional(),
    order: v.enum(["asc", "desc"]).optional(),
  });
});

export const getDateRangeSchema = defineSchema((v) =>
  v
    .object({
      from: getTimestampSchema(),
      to: getTimestampSchema(),
    })
    .refine(({ from, to }: { from: string; to: string }) => new Date(from) <= new Date(to), {
      message: "From date must be before or equal to To date",
    })
);

export const getStrongPasswordSchema = defineSchema((v) =>
  v
    .string()
    .min(
      STRONG_PASSWORD_MIN_LENGTH,
      `Password must be at least ${STRONG_PASSWORD_MIN_LENGTH} characters`,
    )
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character")
);

/**
 * Lazy-getter object that preserves the `CommonSchemas.email` call shape.
 * Each access returns the cached `Schema<T>` (memoized inside `defineSchema`),
 * so chained calls like `CommonSchemas.email.parse(x)` work as before.
 */
export const CommonSchemas = {
  get email(): Schema<string> {
    return getEmailSchema();
  },
  get uuid(): Schema<string> {
    return getUuidSchema();
  },
  get slug(): Schema<string> {
    return getSlugSchema();
  },
  get url(): Schema<string> {
    return getUrlSchema();
  },
  get phoneNumber(): Schema<string> {
    return getPhoneNumberSchema();
  },
  get pagination(): ReturnType<typeof getPaginationSchema> {
    return getPaginationSchema();
  },
  get dateRange(): ReturnType<typeof getDateRangeSchema> {
    return getDateRangeSchema();
  },
  get strongPassword(): Schema<string> {
    return getStrongPasswordSchema();
  },
};

export type Email = InferSchema<ReturnType<typeof getEmailSchema>>;
export type Uuid = InferSchema<ReturnType<typeof getUuidSchema>>;
export type Slug = InferSchema<ReturnType<typeof getSlugSchema>>;
export type Url = InferSchema<ReturnType<typeof getUrlSchema>>;
export type PhoneNumber = InferSchema<ReturnType<typeof getPhoneNumberSchema>>;
export type Pagination = InferSchema<ReturnType<typeof getPaginationSchema>>;
export type DateRange = InferSchema<ReturnType<typeof getDateRangeSchema>>;
export type StrongPassword = InferSchema<ReturnType<typeof getStrongPasswordSchema>>;

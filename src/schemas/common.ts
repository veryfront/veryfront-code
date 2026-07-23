/**
 * Common reusable schemas (email, slug, URL, UUID, and pagination) expressed
 * against the `SchemaValidator` contract via `defineSchema`.
 *
 * Each schema is a lazy getter. The `CommonSchemas` object exposes them via
 * property accessors to preserve the existing call shape
 * (`CommonSchemas.email.parse(x)` continues to work).
 *
 * @module schemas/common
 */

import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { MAX_URL_LENGTH_FOR_VALIDATION } from "#veryfront/utils/constants/limits.ts";
import { defineSchema } from "./define.ts";
import { getTimestampSchema } from "./primitives.ts";

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const E164_PHONE_NUMBER_PATTERN = /^\+?[1-9]\d{1,14}$/;
const POSITIVE_DECIMAL_INTEGER_PATTERN = /^[1-9]\d*$/;
const DEFAULT_PAGINATION_LIMIT = 10;
const DEFAULT_PAGINATION_PAGE = 1;
const MAX_EMAIL_LENGTH = 255;
const MAX_PHONE_NUMBER_LENGTH = 16;
const MAX_PAGINATION_LIMIT = 100;
const MAX_SAFE_INTEGER_DIGITS = String(Number.MAX_SAFE_INTEGER).length;
const MAX_PAGINATION_SORT_LENGTH = 128;
const MAX_PASSWORD_LENGTH = 1_024;
const MAX_SLUG_LENGTH = 100;
const MIN_PASSWORD_LENGTH = 8;

/** Return the shared email schema. */
export const getEmailSchema: () => Schema<string> = defineSchema((v) =>
  v.string().max(MAX_EMAIL_LENGTH).email()
);
/** Return the shared UUID schema. */
export const getUuidSchema: () => Schema<string> = defineSchema((v) => v.string().uuid());
/** Return the shared lowercase slug schema. */
export const getSlugSchema: () => Schema<string> = defineSchema((v) =>
  v.string().min(1).max(MAX_SLUG_LENGTH).regex(SLUG_PATTERN)
);
/** Return the shared bounded URL schema. */
export const getUrlSchema: () => Schema<string> = defineSchema((v) =>
  v.string().max(MAX_URL_LENGTH_FOR_VALIDATION).url()
);
/** Return the shared E.164-compatible phone-number schema. */
export const getPhoneNumberSchema: () => Schema<string> = defineSchema((v) =>
  v.string().max(MAX_PHONE_NUMBER_LENGTH).regex(E164_PHONE_NUMBER_PATTERN)
);

/** Return the shared positive-safe-integer pagination-query schema. */
export const getPaginationSchema: () => Schema<{
  page: number;
  limit: number;
  sort?: string;
  order?: "asc" | "desc";
}> = defineSchema((v) => {
  const positiveIntegerInput = () =>
    v.union([
      v.number(),
      v.string().max(MAX_SAFE_INTEGER_DIGITS).regex(POSITIVE_DECIMAL_INTEGER_PATTERN),
    ]);

  const positiveSafeInteger = (maximum?: number) => {
    let integerSchema = v.coerce.number().int().positive();
    if (maximum !== undefined) integerSchema = integerSchema.max(maximum);
    return positiveIntegerInput().pipe(
      integerSchema.refine(
        Number.isSafeInteger,
        "Pagination values must be safe integers",
      ),
    );
  };

  return v.object({
    page: positiveSafeInteger().default(DEFAULT_PAGINATION_PAGE),
    limit: positiveSafeInteger(MAX_PAGINATION_LIMIT).default(DEFAULT_PAGINATION_LIMIT),
    sort: v.string().min(1).max(MAX_PAGINATION_SORT_LENGTH).optional(),
    order: v.enum(["asc", "desc"] as const).optional(),
  });
});

/** Return the shared inclusive date-range schema. */
export const getDateRangeSchema: () => Schema<{ from: string; to: string }> = defineSchema((v) =>
  v
    .object({
      from: getTimestampSchema(),
      to: getTimestampSchema(),
    })
    .refine(({ from, to }: { from: string; to: string }) => new Date(from) <= new Date(to), {
      message: "From date must be before or equal to To date",
    })
);

/** Return the shared bounded password-strength schema. */
export const getStrongPasswordSchema: () => Schema<string> = defineSchema((v) =>
  v
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`)
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character")
);

/** Validated email address. */
export type Email = InferSchema<ReturnType<typeof getEmailSchema>>;
/** Validated UUID string. */
export type Uuid = InferSchema<ReturnType<typeof getUuidSchema>>;
/** Validated lowercase slug. */
export type Slug = InferSchema<ReturnType<typeof getSlugSchema>>;
/** Validated absolute URL string. */
export type Url = InferSchema<ReturnType<typeof getUrlSchema>>;
/** Validated E.164-compatible phone number. */
export type PhoneNumber = InferSchema<ReturnType<typeof getPhoneNumberSchema>>;
/** Parsed pagination query. */
export type Pagination = InferSchema<ReturnType<typeof getPaginationSchema>>;
/** Validated inclusive date range. */
export type DateRange = InferSchema<ReturnType<typeof getDateRangeSchema>>;
/** Validated password string. */
export type StrongPassword = InferSchema<ReturnType<typeof getStrongPasswordSchema>>;

/** Named shared schemas available through `CommonSchemas`. */
export interface CommonSchemaRegistry {
  /** Email-address schema. */
  readonly email: Schema<Email>;
  /** UUID schema. */
  readonly uuid: Schema<Uuid>;
  /** Lowercase slug schema. */
  readonly slug: Schema<Slug>;
  /** Absolute URL schema. */
  readonly url: Schema<Url>;
  /** E.164-compatible phone-number schema. */
  readonly phoneNumber: Schema<PhoneNumber>;
  /** Pagination-query schema. */
  readonly pagination: Schema<Pagination>;
  /** Inclusive date-range schema. */
  readonly dateRange: Schema<DateRange>;
  /** Password-strength schema. */
  readonly strongPassword: Schema<StrongPassword>;
}

/**
 * Lazy-getter object that preserves the `CommonSchemas.email` call shape.
 * Each access returns the cached `Schema<T>` (memoized inside `defineSchema`),
 * so chained calls like `CommonSchemas.email.parse(x)` work as before.
 */
export const CommonSchemas: Readonly<CommonSchemaRegistry> = Object.freeze({
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
});

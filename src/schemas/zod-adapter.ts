/**
 * Zod-backed `SchemaValidator` adapter.
 *
 * This is the default (core-provided) implementation of the
 * `SchemaValidator` contract. It thinly wraps zod so that core modules can
 * declare schemas through the extension-neutral DSL while still getting zod's
 * runtime behavior.
 *
 * The entire zod surface used by the contract is confined to this file; when
 * `@veryfront/ext-zod` takes over in Phase B this file will be deleted and
 * the `"zod"` import map entry removed.
 *
 * @module schemas/zod-adapter
 */

import { z } from "zod";
import { register } from "#veryfront/extensions/contracts.ts";
import type {
  InferShape,
  Schema,
  SchemaValidator,
  SchemaValidatorCoerce,
  ValidationIssue,
  ValidationResult,
} from "#veryfront/extensions/interfaces/index.ts";

// deno-lint-ignore no-explicit-any -- zod's chainable APIs return parametric types
type AnyZodSchema = z.ZodType<any, any, any>;

/** Unwrap our opaque Schema<T> back to the underlying zod schema. */
function toZod<T>(schema: Schema<T>): AnyZodSchema {
  return (schema as unknown as { __zod: AnyZodSchema }).__zod;
}

/** Wrap a zod schema as an opaque Schema<T> with chainables routed through zod. */
function wrap<T>(zs: AnyZodSchema): Schema<T> {
  // The wrapper fakes the full Schema<T> surface; unsupported chainables on
  // unsuitable kinds (e.g. calling `.email()` on a number) throw at runtime
  // just like zod would.
  // deno-lint-ignore no-explicit-any -- safe within this adapter
  const anyZs = zs as any;
  const s: Schema<T> = {
    _output: undefined as unknown as T,
    optional: () => wrap<T | undefined>(zs.optional()),
    nullable: () => wrap<T | null>(zs.nullable()),
    nullish: () => wrap<T | null | undefined>(zs.nullish()),
    default: (value: T | (() => T)) => wrap<T>(anyZs.default(value)),
    describe: (description: string) => wrap<T>(zs.describe(description)),
    refine: (
      check: (value: T) => boolean,
      message?: string | { message?: string },
    ) => wrap<T>(zs.refine(check as (v: unknown) => boolean, message as never)),
    transform: <U>(fn: (value: T) => U) => wrap<U>(zs.transform(fn as never)),
    strict: () => wrap<T>(anyZs.strict()),
    passthrough: () => wrap<T>(anyZs.passthrough()),
    partial: () => wrap<Partial<T>>(anyZs.partial()),
    extend: <U extends Record<string, Schema<unknown>>>(shape: U) => {
      const zodShape = toZodShape(shape);
      return wrap<T & { [K in keyof U]: U[K] extends Schema<infer V> ? V : never }>(
        anyZs.extend(zodShape),
      );
    },
    merge: <U>(other: Schema<U>) => wrap<T & U>(anyZs.merge(toZod(other))),
    min: (value: number, message?: string) => wrap<T>(anyZs.min(value, message)),
    max: (value: number, message?: string) => wrap<T>(anyZs.max(value, message)),
    int: (message?: string) => wrap<T>(anyZs.int(message)),
    positive: (message?: string) => wrap<T>(anyZs.positive(message)),
    nonnegative: (message?: string) => wrap<T>(anyZs.nonnegative(message)),
    regex: (pattern: RegExp, message?: string) => wrap<T>(anyZs.regex(pattern, message)),
    email: (message?: string) => wrap<T>(anyZs.email(message)),
    url: (message?: string) => wrap<T>(anyZs.url(message)),
    uuid: (message?: string) => wrap<T>(anyZs.uuid(message)),
    datetime: (message?: string) => wrap<T>(anyZs.datetime(message)),
    parse: (data: unknown): T => zs.parse(data) as T,
    safeParse: (data: unknown): ValidationResult<T> => {
      const res = zs.safeParse(data);
      if (res.success) return { success: true, data: res.data as T };
      const issues: ValidationIssue[] = res.error.issues.map((issue) => ({
        path: issue.path as (string | number)[],
        message: issue.message,
        code: issue.code,
      }));
      return { success: false, issues, error: res.error };
    },
  };
  // Attach the underlying zod schema for adapter round-trips without
  // widening the public Schema<T> surface.
  (s as unknown as { __zod: AnyZodSchema }).__zod = zs;
  return s;
}

function toZodShape(
  shape: Record<string, Schema<unknown>>,
): Record<string, AnyZodSchema> {
  const out: Record<string, AnyZodSchema> = {};
  for (const [key, value] of Object.entries(shape)) {
    out[key] = toZod(value);
  }
  return out;
}

const coerce: SchemaValidatorCoerce = {
  string: (): Schema<string> => wrap(z.coerce.string()),
  number: (): Schema<number> => wrap(z.coerce.number()),
  boolean: (): Schema<boolean> => wrap(z.coerce.boolean()),
  date: (): Schema<Date> => wrap(z.coerce.date()),
};

/** The zod-backed `SchemaValidator` singleton registered by `registerZodAdapter`. */
export const zodAdapter: SchemaValidator = {
  string: (): Schema<string> => wrap(z.string()),
  number: (): Schema<number> => wrap(z.number()),
  boolean: (): Schema<boolean> => wrap(z.boolean()),
  date: (): Schema<Date> => wrap(z.date()),
  null: (): Schema<null> => wrap(z.null()),
  unknown: (): Schema<unknown> => wrap(z.unknown()),
  // deno-lint-ignore no-explicit-any -- contract mirrors zod's `any` constructor
  any: (): Schema<any> => wrap(z.any()),

  object: <S extends Record<string, Schema<unknown>>>(shape: S): Schema<InferShape<S>> =>
    wrap(z.object(toZodShape(shape))),

  array: <T>(element: Schema<T>): Schema<T[]> => wrap(z.array(toZod(element))),

  record: <K extends string | number | symbol, V>(
    keys: Schema<K>,
    values: Schema<V>,
  ): Schema<Record<K, V>> => wrap(z.record(toZod(keys) as unknown as z.ZodString, toZod(values))),

  union: <T extends readonly [Schema<unknown>, ...Schema<unknown>[]]>(
    schemas: T,
  ): Schema<T[number] extends Schema<infer U> ? U : never> => {
    const zodSchemas = schemas.map((s: Schema<unknown>) => toZod(s)) as unknown as [
      AnyZodSchema,
      AnyZodSchema,
      ...AnyZodSchema[],
    ];
    return wrap(z.union(zodSchemas));
  },

  discriminatedUnion: <
    K extends string,
    T extends readonly [Schema<unknown>, ...Schema<unknown>[]],
  >(
    discriminator: K,
    schemas: T,
  ): Schema<T[number] extends Schema<infer U> ? U : never> => {
    const zodSchemas = schemas.map((s: Schema<unknown>) => toZod(s)) as unknown as [
      // deno-lint-ignore no-explicit-any -- discriminated-union variants widen here
      z.ZodObject<any>,
      // deno-lint-ignore no-explicit-any -- discriminated-union variants widen here
      z.ZodObject<any>,
      // deno-lint-ignore no-explicit-any -- discriminated-union variants widen here
      ...z.ZodObject<any>[],
    ];
    return wrap(z.discriminatedUnion(discriminator, zodSchemas));
  },

  literal: <T extends string | number | boolean | null>(value: T): Schema<T> =>
    wrap(z.literal(value as never)),

  enum: <T extends readonly [string, ...string[]]>(values: T): Schema<T[number]> =>
    wrap(
      (z.enum as unknown as (v: readonly [string, ...string[]]) => AnyZodSchema)(values),
    ),

  coerce,

  validate: <T>(schema: Schema<T>, data: unknown): ValidationResult<T> => schema.safeParse(data),
};

/**
 * Register the zod adapter as the default `SchemaValidator` implementation.
 *
 * Called once at core bootstrap (`src/schemas/index.ts` side-effect import).
 * Phase B will delete this function when `@veryfront/ext-zod` takes over.
 */
export function registerZodAdapter(): void {
  register<SchemaValidator>("SchemaValidator", zodAdapter);
}

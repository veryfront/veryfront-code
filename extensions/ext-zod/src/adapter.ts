/**
 * Zod-backed `SchemaValidator` adapter.
 *
 * The default implementation of the `SchemaValidator` contract. It thinly
 * wraps zod so that core modules can declare schemas through the
 * extension-neutral DSL while still getting zod's runtime behavior.
 *
 * The entire zod surface used by the contract is confined to this file.
 *
 * @module extensions/ext-zod/adapter
 */

import { z } from "zod";
import type {
  InferShape,
  JsonSchema,
  RefinementCtx,
  Schema,
  SchemaValidator,
  SchemaValidatorCoerce,
  ValidationIssue,
  ValidationResult,
} from "veryfront/extensions/schema";
import { isOptionalSchema, zodToJsonSchema } from "./json-schema.ts";

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
    default: (value: Exclude<T, undefined> | (() => Exclude<T, undefined>)) =>
      wrap<Exclude<T, undefined>>(anyZs.default(value)),
    describe: (description: string) => wrap<T>(zs.describe(description)),
    refine: (
      check: (value: T) => boolean,
      message?: string | { message?: string },
    ) => wrap<T>(zs.refine(check as (v: unknown) => boolean, message as never)),
    superRefine: (check: (value: T, ctx: RefinementCtx) => void) =>
      wrap<T>(
        // zod v4's `RefinementCtx` extends `ParsePayload` (`{ value, issues }`)
        // and exposes `addIssue(string | $ZodSuperRefineIssue)`. We bridge to
        // our path-aware `RefinementCtx` shape: we don't have a stable `path`
        // from the zod side here (path tracking is per-issue, not per-ctx),
        // so we emit `[]` and let callers pass their own `path` through
        // `addIssue({ path })`.
        anyZs.superRefine((value: T, zodCtx: { addIssue: (arg: unknown) => void }) => {
          const ctx: RefinementCtx = {
            path: [],
            addIssue: (issue) =>
              zodCtx.addIssue({
                // String literal "custom" replaces the deprecated
                // z.ZodIssueCode.custom enum (zod v4 prefers raw codes).
                code: issue.code ?? "custom",
                message: issue.message,
                path: issue.path,
              }),
          };
          check(value, ctx);
        }),
      ),
    transform: <U>(fn: (value: T) => U) => wrap<U>(zs.transform(fn as never)),
    strict: () => wrap<T>(anyZs.strict()),
    strip: () => wrap<T>(anyZs.strip()),
    passthrough: () => wrap<T & Record<string, unknown>>(anyZs.passthrough()),
    partial: () => wrap<Partial<T>>(anyZs.partial()),
    extend: <U extends Record<string, Schema<unknown>>>(shape: U) => {
      const zodShape = toZodShape(shape);
      return wrap<T & { [K in keyof U]: U[K] extends Schema<infer V> ? V : never }>(
        anyZs.extend(zodShape),
      );
    },
    merge: <U>(other: Schema<U>) => wrap<T & U>(anyZs.merge(toZod(other))),
    omit: <K extends keyof T>(keys: { [P in K]?: true }) => wrap<Omit<T, K>>(anyZs.omit(keys)),
    pick: <K extends keyof T>(keys: { [P in K]?: true }) => wrap<Pick<T, K>>(anyZs.pick(keys)),
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
    pipe: <U>(next: Schema<U>): Schema<U> => wrap<U>(zs.pipe(toZod(next))),
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

/**
 * Build a zod-backed `SchemaValidator` instance.
 *
 * Stateless — safe to call once at extension setup and pass the returned
 * value to `ctx.provide("SchemaValidator", …)`. Tests that need to register
 * the validator without going through full extension bootstrap can call this
 * factory directly.
 */
export function createZodAdapter(): SchemaValidator {
  return {
    string: (): Schema<string> => wrap(z.string()),
    number: (): Schema<number> => wrap(z.number()),
    boolean: (): Schema<boolean> => wrap(z.boolean()),
    date: (): Schema<Date> => wrap(z.date()),
    null: (): Schema<null> => wrap(z.null()),
    unknown: (): Schema<unknown> => wrap(z.unknown()),
    bigint: (): Schema<bigint> => wrap(z.bigint()),
    // deno-lint-ignore no-explicit-any -- contract mirrors zod's `any` constructor
    any: (): Schema<any> => wrap(z.any()),
    function: (): Schema<(...args: unknown[]) => unknown> =>
      // zod 4's z.function() is callable without args/returns and produces a
      // schema accepting any function. We wrap it as Schema<AnyFunction>.
      wrap(z.function() as unknown as AnyZodSchema),

    object: <S extends Record<string, Schema<unknown>>>(shape: S): Schema<InferShape<S>> =>
      wrap(z.object(toZodShape(shape))),

    array: <T>(element: Schema<T>): Schema<T[]> => wrap(z.array(toZod(element))),

    tuple: <T extends readonly Schema<unknown>[]>(
      items: T,
    ): Schema<{ [K in keyof T]: T[K] extends Schema<infer U> ? U : never }> => {
      const zodItems = items.map((s) => toZod(s)) as unknown as [
        AnyZodSchema,
        ...AnyZodSchema[],
      ];
      return wrap(z.tuple(zodItems));
    },

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

    lazy: <T>(factory: () => Schema<T>): Schema<T> => wrap<T>(z.lazy(() => toZod(factory()))),

    instanceof: <T>(ctor: new (...args: never[]) => T): Schema<T> =>
      // zod 4's z.instanceof expects `typeof Class` (z.core.util.Class). Our
      // contract uses a slimmer `new`-able shape; bridge with a single cast
      // through unknown.
      wrap<T>(
        (z.instanceof as unknown as (c: unknown) => AnyZodSchema)(ctor),
      ),

    custom: <T>(check?: (value: unknown) => boolean, message?: string): Schema<T> =>
      wrap<T>(z.custom<T>(check as (v: unknown) => boolean, message)),

    coerce,

    validate: <T>(schema: Schema<T>, data: unknown): ValidationResult<T> => schema.safeParse(data),

    toJsonSchema: (schema: Schema<unknown>): JsonSchema => zodToJsonSchema(toZod(schema)),

    isOptional: (schema: Schema<unknown>): boolean => isOptionalSchema(toZod(schema)),
  };
}

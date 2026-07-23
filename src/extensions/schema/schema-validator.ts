/**
 * Contract interface for schema validation.
 *
 * Default implementation: `@veryfront/ext-schema-zod`
 *
 * The interface exposes a small DSL (inspired by zod) that lets core modules
 * declare validation schemas without importing zod directly. Schemas are
 * constructed lazily via `defineSchema()` so that an extension-provided
 * implementation can be registered before any schema is materialized.
 *
 * @module extensions/schema/schema-validator
 */

import type { JsonSchema } from "./json-schema.ts";

/**
 * An opaque schema definition that validates and infers type `T`.
 *
 * Implementations may use this as a nominal wrapper around a native validator
 * (e.g. a zod schema). Core code only calls the methods defined here.
 */
export interface Schema<T = unknown> {
  /** Brand field for nominal typing. It is not used at runtime. */
  readonly _output: T;

  /** Permit `undefined` in addition to the current output type. */
  optional(): Schema<T | undefined>;
  /** Permit `null` in addition to the current output type. */
  nullable(): Schema<T | null>;
  /** Permit both `null` and `undefined` in addition to the current output type. */
  nullish(): Schema<T | null | undefined>;
  /** Supply a value when the input is `undefined`. */
  default(
    value: Exclude<T, undefined> | (() => Exclude<T, undefined>),
  ): Schema<Exclude<T, undefined>>;
  /** Attach a human-readable description to this schema. */
  describe(description: string): Schema<T>;
  /** Require `check` to accept the parsed value. */
  refine(check: (value: T) => boolean, message?: string | { message?: string }): Schema<T>;
  /**
   * Multi-issue refinement. The callback receives the parsed value and a
   * `RefinementCtx` it can use to emit one or more issues via `addIssue`.
   * Mirrors zod's `.superRefine`.
   */
  superRefine(check: (value: T, ctx: RefinementCtx) => void): Schema<T>;
  /** Transform the parsed value into another output type. */
  transform<U>(fn: (value: T) => U): Schema<U>;

  /** Reject unknown keys on object inputs. */
  strict(): Schema<T>;
  /**
   * Strip unknown keys from object inputs (zod's default behavior). Exposed
   * for parity with `.strict()` / `.passthrough()` so call sites can be
   * explicit about their intent.
   */
  strip(): Schema<T>;
  /** Preserve unknown keys on object inputs. */
  passthrough(): Schema<T & Record<string, unknown>>;
  /** Make every property optional on object inputs. */
  partial(): Schema<Partial<T>>;
  /** Add properties to an object schema. */
  extend<U extends Record<string, Schema<unknown>>>(
    shape: U,
  ): Schema<T & InferShape<U>>;
  /** Combine this object schema with another schema. */
  merge<U>(other: Schema<U>): Schema<T & U>;
  /** Drop the listed keys from an object schema. Mirrors zod's `.omit({k: true})`. */
  omit<K extends keyof T>(keys: { [P in K]?: true }): Schema<Omit<T, K>>;
  /** Keep only the listed keys from an object schema. Mirrors zod's `.pick({k: true})`. */
  pick<K extends keyof T>(keys: { [P in K]?: true }): Schema<Pick<T, K>>;

  /** Require a minimum string, array, or numeric value. */
  min(value: number, message?: string): Schema<T>;
  /** Require a maximum string, array, or numeric value. */
  max(value: number, message?: string): Schema<T>;
  /** Require an integer number. */
  int(message?: string): Schema<T>;
  /** Require a positive number. */
  positive(message?: string): Schema<T>;
  /** Require a nonnegative number. */
  nonnegative(message?: string): Schema<T>;
  /** Require a string that matches `pattern`. */
  regex(pattern: RegExp, message?: string): Schema<T>;
  /** Require an email-address string. */
  email(message?: string): Schema<T>;
  /** Require an absolute URL string. */
  url(message?: string): Schema<T>;
  /** Require a UUID string. */
  uuid(message?: string): Schema<T>;
  /** Require an ISO date-time string. */
  datetime(message?: string): Schema<T>;

  /**
   * Feed parsed output into another schema for further validation/refinement.
   * Mirrors zod's `.pipe(otherSchema)`.
   */
  pipe<U>(next: Schema<U>): Schema<U>;

  /** Parse input or throw a validator-owned error. */
  parse(data: unknown): T;
  /** Parse input and return a discriminated result. */
  safeParse(data: unknown): ValidationResult<T>;
}

/**
 * Context passed to a `superRefine` callback. Provides `addIssue` to emit
 * one or more validation issues and `path` to locate the current value.
 *
 * Mirrors the subset of zod's `RefinementCtx` we actually use.
 */
export interface RefinementCtx {
  /** Emit a validation issue against the parsed value. */
  addIssue(issue: { code?: string; message: string; path?: (string | number)[] }): void;
  /** Path to the current value within its parent, used when emitting issues. */
  readonly path: (string | number)[];
}

/** Extracts the inferred output type `T` from a `Schema<T>`. */
export type InferSchema<S> = S extends Schema<infer T> ? T : never;

/**
 * Extracts the inferred *input* type from a `Schema<T>`.
 *
 * Today the contract DSL does not formally model input/output divergence
 * (zod's `.transform()` is the canonical case where they differ), so this
 * is an alias of `InferSchema`. Reserved as a separate type for forward
 * compatibility. Callers migrating from `z.input<typeof S>` should use
 * this name.
 */
export type InferInput<S> = InferSchema<S>;

/** Maps a raw object shape to its inferred object type, preserving optionality. */
export type InferShape<S extends Record<string, Schema<unknown>>> =
  & {
    [K in keyof S as undefined extends InferSchema<S[K]> ? never : K]: InferSchema<S[K]>;
  }
  & {
    [K in keyof S as undefined extends InferSchema<S[K]> ? K : never]?: InferSchema<S[K]>;
  };

/** A single validation issue with location context. */
export interface ValidationIssue {
  /** Dot-path to the offending field (e.g. `"user.email"`). */
  path: (string | number)[];
  /** Human-readable error message. */
  message: string;
  /** Machine-readable error code. */
  code?: string;
}

/** Successful validation outcome. */
export interface ValidationSuccess<T> {
  /** Success discriminator. */
  success: true;
  /** Parsed and validated data. */
  data: T;
}

/** Failed validation outcome. */
export interface ValidationFailure {
  /** Failure discriminator. */
  success: false;
  /** List of issues found during validation. */
  issues: ValidationIssue[];
  /** Native error thrown by the underlying validator (if any). */
  error?: unknown;
}

/** Discriminated union of validation outcomes. */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Namespace for `coerce.*` constructors. It accepts input in any form and
 * coerces to the target type before validation.
 */
export interface SchemaValidatorCoerce {
  /** Coerce input to a string. */
  string(): Schema<string>;
  /** Coerce input to a number. */
  number(): Schema<number>;
  /** Coerce input to a boolean. */
  boolean(): Schema<boolean>;
  /** Coerce input to a date. */
  date(): Schema<Date>;
}

/**
 * SchemaValidator contract interface.
 *
 * Exposes a zod-inspired DSL. The `object(shape)`, `array(schema)`, etc.
 * constructors produce opaque `Schema<T>` instances that can be further
 * refined via chainables and finally validated with `.parse` / `.safeParse`.
 */
export interface SchemaValidator {
  /** Create a string schema. */
  string(): Schema<string>;
  /** Create a number schema. */
  number(): Schema<number>;
  /** Create a boolean schema. */
  boolean(): Schema<boolean>;
  /** Create a date schema. */
  date(): Schema<Date>;
  /** Create a null schema. */
  null(): Schema<null>;
  /** Create a schema that accepts any value without widening to `any`. */
  unknown(): Schema<unknown>;
  /** Create a bigint schema. */
  bigint(): Schema<bigint>;
  /** Create an intentionally untyped schema. */
  // deno-lint-ignore no-explicit-any -- `any` constructor intentionally mirrors zod
  any(): Schema<any>;
  /** Create a function schema. */
  function(): Schema<(...args: unknown[]) => unknown>;

  /** Create an object schema from a property schema map. */
  object<S extends Record<string, Schema<unknown>>>(shape: S): Schema<InferShape<S>>;
  /** Create an array schema. */
  array<T>(element: Schema<T>): Schema<T[]>;
  /** Create a fixed-length tuple schema. */
  tuple<T extends readonly Schema<unknown>[]>(
    items: T,
  ): Schema<{ [K in keyof T]: T[K] extends Schema<infer U> ? U : never }>;
  /** Create a record schema with validated keys and values. */
  record<K extends string | number | symbol, V>(
    keys: Schema<K>,
    values: Schema<V>,
  ): Schema<Record<K, V>>;
  /** Create a schema that accepts any member schema. */
  union<T extends readonly [Schema<unknown>, ...Schema<unknown>[]]>(
    schemas: T,
  ): Schema<InferSchema<T[number]>>;
  /** Create a union selected by an object discriminator field. */
  discriminatedUnion<
    K extends string,
    T extends readonly [Schema<unknown>, ...Schema<unknown>[]],
  >(
    discriminator: K,
    schemas: T,
  ): Schema<InferSchema<T[number]>>;
  /** Create a schema for one literal value. */
  literal<T extends string | number | boolean | null>(value: T): Schema<T>;
  /** Create a schema for one of the supplied string values. */
  enum<T extends readonly [string, ...string[]]>(values: T): Schema<T[number]>;

  /**
   * Defer schema construction for recursive shapes. The thunk is
   * called on first access; the result is cached. Mirrors `z.lazy`.
   */
  lazy<T>(factory: () => Schema<T>): Schema<T>;

  /**
   * Validates that input is an instance of the given constructor. Mirrors
   * `z.instanceof`.
   */
  instanceof<T>(ctor: new (...args: never[]) => T): Schema<T>;

  /**
   * Loosely-typed escape hatch: accept input when `check` returns `true`.
   * The runtime contract is the predicate; the type parameter `T` is purely
   * structural and is trusted from the call site. Mirrors `z.custom<T>`.
   */
  custom<T>(check?: (value: unknown) => boolean, message?: string): Schema<T>;

  /** Coercing constructors accept any input and coerce to the target. */
  coerce: SchemaValidatorCoerce;

  /**
   * Convenience that runs validation on an already-constructed schema.
   * Equivalent to `schema.safeParse(data)`; kept for ergonomic parity with
   * earlier revisions of this contract.
   */
  validate<T>(schema: Schema<T>, data: unknown): ValidationResult<T>;

  /**
   * Convert an opaque `Schema<T>` to a JSON Schema document.
   *
   * Used by the tool/MCP layer to expose tool input schemas to AI providers
   * and MCP clients. Implementations unwrap the contract `Schema<T>` back to
   * their native validator (e.g. zod) and emit a JSON Schema representation.
   *
   * Returns a permissive `{type: "object"}` for kinds the implementation
   * cannot represent.
   */
  toJsonSchema(schema: Schema<unknown>): JsonSchema;

  /**
   * Returns `true` when the schema permits `undefined` (i.e. was constructed
   * via `.optional()`/`.nullish()`). Used by tool input-schema introspection
   * to mark JSON Schema properties as not required.
   */
  isOptional(schema: Schema<unknown>): boolean;
}

export type { JsonSchema };

/** Factory type accepted by `defineSchema`. */
export type SchemaFactory<T> = (v: SchemaValidator) => Schema<T>;

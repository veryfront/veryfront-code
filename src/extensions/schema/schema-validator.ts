/**
 * Contract interface for schema validation.
 *
 * Default implementation: `@veryfront/ext-zod`
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
  /** Brand field for nominal typing — not used at runtime. */
  readonly _output: T;

  // Refinement / modifier chainables
  optional(): Schema<T | undefined>;
  nullable(): Schema<T | null>;
  nullish(): Schema<T | null | undefined>;
  default(value: T | (() => T)): Schema<T>;
  describe(description: string): Schema<T>;
  refine(check: (value: T) => boolean, message?: string | { message?: string }): Schema<T>;
  transform<U>(fn: (value: T) => U): Schema<U>;

  // Object-level chainables (no-op / type-preserving on non-object schemas;
  // implementations should only call these on object schemas).
  strict(): Schema<T>;
  passthrough(): Schema<T>;
  partial(): Schema<Partial<T>>;
  extend<U extends Record<string, Schema<unknown>>>(
    shape: U,
  ): Schema<T & { [K in keyof U]: InferSchema<U[K]> }>;
  merge<U>(other: Schema<U>): Schema<T & U>;

  // String-level chainables
  min(value: number, message?: string): Schema<T>;
  max(value: number, message?: string): Schema<T>;
  int(message?: string): Schema<T>;
  positive(message?: string): Schema<T>;
  nonnegative(message?: string): Schema<T>;
  regex(pattern: RegExp, message?: string): Schema<T>;
  email(message?: string): Schema<T>;
  url(message?: string): Schema<T>;
  uuid(message?: string): Schema<T>;
  datetime(message?: string): Schema<T>;

  /**
   * Feed parsed output into another schema for further validation/refinement.
   * Mirrors zod's `.pipe(otherSchema)`.
   */
  pipe<U>(next: Schema<U>): Schema<U>;

  // Validation
  parse(data: unknown): T;
  safeParse(data: unknown): ValidationResult<T>;
}

/** Extracts the inferred output type `T` from a `Schema<T>`. */
export type InferSchema<S> = S extends Schema<infer T> ? T : never;

/**
 * Extracts the inferred *input* type from a `Schema<T>`.
 *
 * Today the contract DSL does not formally model input/output divergence
 * (zod's `.transform()` is the canonical case where they differ), so this
 * is an alias of `InferSchema`. Reserved as a separate type for forward
 * compatibility — callers migrating from `z.input<typeof S>` should use
 * this name.
 */
export type InferInput<S> = InferSchema<S>;

/** Maps a raw object shape to its inferred object type. */
export type InferShape<S extends Record<string, Schema<unknown>>> = {
  [K in keyof S]: InferSchema<S[K]>;
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
  success: true;
  /** Parsed and validated data. */
  data: T;
}

/** Failed validation outcome. */
export interface ValidationFailure {
  success: false;
  /** List of issues found during validation. */
  issues: ValidationIssue[];
  /** Native error thrown by the underlying validator (if any). */
  error?: unknown;
}

/** Discriminated union of validation outcomes. */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Namespace for `coerce.*` constructors — accepts input in any form and
 * coerces to the target type before validation.
 */
export interface SchemaValidatorCoerce {
  string(): Schema<string>;
  number(): Schema<number>;
  boolean(): Schema<boolean>;
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
  // Primitive constructors
  string(): Schema<string>;
  number(): Schema<number>;
  boolean(): Schema<boolean>;
  date(): Schema<Date>;
  null(): Schema<null>;
  unknown(): Schema<unknown>;
  bigint(): Schema<bigint>;
  // deno-lint-ignore no-explicit-any -- `any` constructor intentionally mirrors zod
  any(): Schema<any>;
  // deno-lint-ignore ban-types -- intentionally accepts any callable; mirrors zod
  function(): Schema<(...args: unknown[]) => unknown>;

  // Composite constructors
  object<S extends Record<string, Schema<unknown>>>(shape: S): Schema<InferShape<S>>;
  array<T>(element: Schema<T>): Schema<T[]>;
  tuple<T extends readonly Schema<unknown>[]>(
    items: T,
  ): Schema<{ [K in keyof T]: T[K] extends Schema<infer U> ? U : never }>;
  record<K extends string | number | symbol, V>(
    keys: Schema<K>,
    values: Schema<V>,
  ): Schema<Record<K, V>>;
  union<T extends readonly [Schema<unknown>, ...Schema<unknown>[]]>(
    schemas: T,
  ): Schema<InferSchema<T[number]>>;
  discriminatedUnion<
    K extends string,
    T extends readonly [Schema<unknown>, ...Schema<unknown>[]],
  >(
    discriminator: K,
    schemas: T,
  ): Schema<InferSchema<T[number]>>;
  literal<T extends string | number | boolean | null>(value: T): Schema<T>;
  enum<T extends readonly [string, ...string[]]>(values: T): Schema<T[number]>;

  /**
   * Defer schema construction — used for recursive shapes. The thunk is
   * called on first access; the result is cached. Mirrors `z.lazy`.
   */
  lazy<T>(factory: () => Schema<T>): Schema<T>;

  /**
   * Validates that input is an instance of the given constructor. Mirrors
   * `z.instanceof`.
   */
  instanceof<T>(ctor: new (...args: never[]) => T): Schema<T>;

  /** Coercing constructors — accept any input and coerce to the target. */
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

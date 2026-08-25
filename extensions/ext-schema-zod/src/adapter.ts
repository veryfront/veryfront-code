/**
 * Zod-backed `SchemaValidator` adapter.
 *
 * The default implementation of the `SchemaValidator` contract. It thinly
 * wraps zod so that core modules can declare schemas through the
 * extension-neutral DSL while still getting zod's runtime behavior.
 *
 * The entire zod surface used by the contract is confined to this file.
 *
 * @module extensions/ext-schema-zod/adapter
 */

import { Ajv as AjvDraft7, type AnySchema, type ErrorObject, type ValidateFunction } from "ajv";
import { Ajv2019 } from "ajv/dist/2019.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { z } from "zod";
import type {
  InferShape,
  JsonSchema,
  JsonSchemaValidationFailure,
  JsonSchemaValidationFunction,
  JsonSchemaValidationIssue,
  JsonSchemaValidationSuccess,
  RefinementCtx,
  Schema,
  SchemaValidator,
  SchemaValidatorCoerce,
  ValidationIssue,
  ValidationResult,
} from "veryfront/extensions/schema";
import { isOptionalSchema, recordStaticJsonSchemaDefault, zodToJsonSchema } from "./json-schema.ts";

// Deno exposes the CommonJS default as a callable value at runtime while the
// package declaration describes the imported value as a module namespace.
const addFormats = addFormatsModule as unknown as (
  compiler: JsonSchemaCompiler,
) => JsonSchemaCompiler;

// deno-lint-ignore no-explicit-any -- zod's chainable APIs return parametric types
type AnyZodSchema = z.ZodType<any, any, any>;

/** A wrapped Schema<T> carrying its backing zod schema for adapter round-trips. */
type ZodBackedSchema<T> = Schema<T> & { __zod: AnyZodSchema };

/** Unwrap our opaque Schema<T> back to the underlying zod schema. */
function toZod<T>(schema: Schema<T>): AnyZodSchema {
  return (schema as ZodBackedSchema<T>).__zod;
}

/** Wrap a zod schema as an opaque Schema<T> with chainables routed through zod. */
function wrap<T>(zs: AnyZodSchema): Schema<T> {
  // The wrapper fakes the full Schema<T> surface; unsupported chainables on
  // unsuitable kinds (e.g. calling `.email()` on a number) throw at runtime
  // just like zod would.
  // deno-lint-ignore no-explicit-any -- safe within this adapter
  const anyZs = zs as any;
  const s: Schema<T> = {
    _output: undefined as T,
    optional: () => wrap<T | undefined>(zs.optional()),
    nullable: () => wrap<T | null>(zs.nullable()),
    nullish: () => wrap<T | null | undefined>(zs.nullish()),
    default: (value: Exclude<T, undefined> | (() => Exclude<T, undefined>)) => {
      const defaulted = anyZs.default(value);
      if (typeof value !== "function") {
        recordStaticJsonSchemaDefault(defaulted, value);
      }
      return wrap<Exclude<T, undefined>>(defaulted);
    },
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
  (s as ZodBackedSchema<T>).__zod = zs;
  return s;
}

function toZodShape(
  shape: Record<string, Schema<unknown>>,
): Record<string, AnyZodSchema> {
  const out: Record<string, AnyZodSchema> = {};
  for (const [key, value] of Object.entries(shape)) {
    defineOwnDataProperty(out, key, toZod(value));
  }
  return out;
}

function defineOwnDataProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  // A data descriptor preserves keys such as `__proto__` as ordinary data
  // without invoking inherited setters in runtimes that expose them.
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

const coerce: SchemaValidatorCoerce = {
  string: (): Schema<string> => wrap(z.coerce.string()),
  number: (): Schema<number> => wrap(z.coerce.number()),
  boolean: (): Schema<boolean> => wrap(z.coerce.boolean()),
  date: (): Schema<Date> => wrap(z.coerce.date()),
};

const JSON_SCHEMA_VALIDATOR_CACHE_SIZE = 128;
const JSON_SCHEMA_VALIDATOR_CACHE_MAX_WEIGHT = 2 * 1024 * 1024;

// Raw schemas can originate in extensions and tool metadata, so snapshot them
// through a deliberately bounded JSON boundary before handing them to Ajv.
// These ceilings are comfortably above practical tool schemas while keeping a
// single compilation from consuming unbounded stack, CPU, or memory.
const JSON_SCHEMA_MAX_DEPTH = 64;
const JSON_SCHEMA_MAX_NODES = 8_192;
const JSON_SCHEMA_MAX_SERIALIZED_BYTES = 512 * 1024;
const JSON_SCHEMA_MAX_STRING_BYTES = 256 * 1024;
const JSON_SCHEMA_MAX_KEY_BYTES = 4 * 1024;
const JSON_SCHEMA_MAX_COMBINATOR_FANOUT = 256;
const JSON_SCHEMA_MAX_COMPILATION_WORK = 24_000;
const JSON_INSTANCE_MAX_DEPTH = 128;
const JSON_INSTANCE_MAX_NODES = 100_000;
const JSON_INSTANCE_MAX_SERIALIZED_BYTES = 4 * 1024 * 1024;
const JSON_INSTANCE_MAX_STRING_BYTES = 1024 * 1024;
const JSON_INSTANCE_MAX_KEY_BYTES = 16 * 1024;
const JSON_UTF8_ENCODER = new TextEncoder();

interface CanonicalizationLimits {
  maxDepth: number;
  maxNodes: number;
  maxSerializedBytes: number;
  maxStringBytes: number;
  maxKeyBytes: number;
}

interface CanonicalJsonSnapshot {
  value: unknown;
  nodeCount: number;
  serializedBytes: number;
}

const JSON_SCHEMA_LIMITS: CanonicalizationLimits = {
  maxDepth: JSON_SCHEMA_MAX_DEPTH,
  maxNodes: JSON_SCHEMA_MAX_NODES,
  maxSerializedBytes: JSON_SCHEMA_MAX_SERIALIZED_BYTES,
  maxStringBytes: JSON_SCHEMA_MAX_STRING_BYTES,
  maxKeyBytes: JSON_SCHEMA_MAX_KEY_BYTES,
};

const JSON_INSTANCE_LIMITS: CanonicalizationLimits = {
  maxDepth: JSON_INSTANCE_MAX_DEPTH,
  maxNodes: JSON_INSTANCE_MAX_NODES,
  maxSerializedBytes: JSON_INSTANCE_MAX_SERIALIZED_BYTES,
  maxStringBytes: JSON_INSTANCE_MAX_STRING_BYTES,
  maxKeyBytes: JSON_INSTANCE_MAX_KEY_BYTES,
};

type JsonSchemaCompiler = {
  compile(schema: AnySchema): ValidateFunction<unknown>;
};

const JSON_SCHEMA_COMPILER_OPTIONS = {
  strict: true,
  allErrors: true,
  addUsedSchema: false,
  allowUnionTypes: true,
  coerceTypes: false,
  ownProperties: true,
  useDefaults: false,
  removeAdditional: false,
} as const;

const DRAFT_7_META_SCHEMA_URI = "https://json-schema.org/draft-07/schema";
const AJV_DRAFT_7_META_SCHEMA_URI = "http://json-schema.org/draft-07/schema#";

function normalizeMetaSchemaUri(uri: string): string {
  return uri.trim().replace(/#$/, "").replace(/^http:/, "https:");
}

function createJsonSchemaCompiler(schema: JsonSchema): JsonSchemaCompiler {
  const declaredDraft = typeof schema.$schema === "string"
    ? normalizeMetaSchemaUri(schema.$schema)
    : "https://json-schema.org/draft/2020-12/schema";
  const compiler = declaredDraft === DRAFT_7_META_SCHEMA_URI
    ? new AjvDraft7(JSON_SCHEMA_COMPILER_OPTIONS)
    : declaredDraft === "https://json-schema.org/draft/2019-09/schema"
    ? new Ajv2019(JSON_SCHEMA_COMPILER_OPTIONS)
    : declaredDraft === "https://json-schema.org/draft/2020-12/schema"
    ? new Ajv2020(JSON_SCHEMA_COMPILER_OPTIONS)
    : undefined;

  if (!compiler) {
    throw new Error(`Unsupported JSON Schema draft: ${schema.$schema}`);
  }
  addFormats(compiler);
  return compiler;
}

function schemaForCompilation(schema: JsonSchema): AnySchema {
  if (
    typeof schema.$schema !== "string" ||
    normalizeMetaSchemaUri(schema.$schema) !== DRAFT_7_META_SCHEMA_URI
  ) {
    return schema as AnySchema;
  }

  // Ajv's Draft 7 compiler registers the canonical HTTP identifier. Compile
  // an isolated root snapshot using that identifier while leaving the
  // caller-owned and cache-key snapshots unchanged.
  return {
    ...schema,
    $schema: AJV_DRAFT_7_META_SCHEMA_URI,
  } as AnySchema;
}

type CanonicalJsonContainer = unknown[] | Record<string, unknown>;

type CanonicalizationFrame =
  | {
    kind: "visit";
    value: unknown;
    depth: number;
    parent?: CanonicalJsonContainer;
    key?: string | number;
  }
  | { kind: "exit"; value: object };

type CanonicalizationVisitFrame = Extract<CanonicalizationFrame, { kind: "visit" }>;

function boundedUtf8Length(value: string, limit: number, label: "key" | "string"): number {
  // Every UTF-16 code unit contributes at least one UTF-8 byte. This cheap
  // guard avoids allocating an encoded copy once the value is already known
  // to exceed the byte ceiling.
  if (value.length > limit) {
    throw new TypeError(`JSON Schema ${label} exceeds the ${limit}-byte limit`);
  }
  const byteLength = JSON_UTF8_ENCODER.encode(value).byteLength;
  if (byteLength > limit) {
    throw new TypeError(`JSON Schema ${label} exceeds the ${limit}-byte limit`);
  }
  return byteLength;
}

function serializedJsonTokenByteLength(value: string | number | boolean | null): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("JSON Schema must contain only JSON values");
  }
  return JSON_UTF8_ENCODER.encode(serialized).byteLength;
}

class JsonSchemaCanonicalizer {
  private readonly activeAncestors = new Set<object>();
  private readonly stack: CanonicalizationFrame[] = [];
  private canonicalRoot: unknown;
  private rootAssigned = false;
  private nodeCount = 0;
  private serializedBytes = 0;

  constructor(private readonly limits: CanonicalizationLimits) {}

  canonicalize(value: unknown): CanonicalJsonSnapshot {
    this.stack.push({ kind: "visit", value, depth: 0 });
    while (this.stack.length > 0) {
      const frame = this.stack.pop();
      if (!frame) break;
      if (frame.kind === "exit") {
        this.activeAncestors.delete(frame.value);
      } else {
        this.visit(frame);
      }
    }

    if (!this.rootAssigned) {
      throw new TypeError("JSON Schema must contain a JSON value");
    }
    return {
      value: this.canonicalRoot,
      nodeCount: this.nodeCount,
      serializedBytes: this.serializedBytes,
    };
  }

  private visit(frame: CanonicalizationVisitFrame): void {
    this.consumeNode(frame.depth);
    if (this.visitScalar(frame)) return;

    const current = frame.value;
    if (typeof current !== "object" || current === null) {
      throw new TypeError("JSON Schema must contain only JSON values");
    }
    if (this.activeAncestors.has(current)) {
      throw new TypeError("JSON Schema must not contain cycles");
    }
    if (Array.isArray(current)) {
      this.visitArray(frame, current);
    } else {
      this.visitObject(frame, current);
    }
  }

  private visitScalar(frame: CanonicalizationVisitFrame): boolean {
    const current = frame.value;
    if (current === null || typeof current === "boolean") {
      this.assign(frame, current);
      this.addSerializedBytes(serializedJsonTokenByteLength(current));
      return true;
    }
    if (typeof current === "string") {
      boundedUtf8Length(current, this.limits.maxStringBytes, "string");
      this.assign(frame, current);
      this.addSerializedBytes(serializedJsonTokenByteLength(current));
      return true;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError("JSON Schema numbers must be finite");
      }
      this.assign(frame, current);
      this.addSerializedBytes(serializedJsonTokenByteLength(current));
      return true;
    }
    if (typeof current !== "object") {
      throw new TypeError("JSON Schema must contain only JSON values");
    }
    return false;
  }

  private visitArray(frame: CanonicalizationVisitFrame, current: unknown[]): void {
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(current, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0
    ) {
      throw new TypeError("JSON Schema arrays must have a non-negative integer data length");
    }
    if (length > this.limits.maxNodes) {
      throw new TypeError(
        `JSON Schema exceeds the maximum node count of ${this.limits.maxNodes}`,
      );
    }
    const ownKeys = Reflect.ownKeys(current);
    if (
      ownKeys.some((key) => typeof key === "symbol") ||
      ownKeys.length !== length + 1 ||
      !ownKeys.includes("length")
    ) {
      throw new TypeError("JSON Schema arrays must be dense JSON arrays without extra properties");
    }
    this.addSerializedBytes(2 + Math.max(0, length - 1));

    const descriptors: PropertyDescriptor[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Reflect.getOwnPropertyDescriptor(current, String(index));
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
        throw new TypeError(
          "JSON Schema arrays must be dense data-only JSON arrays without accessors",
        );
      }
      descriptors.push(descriptor);
    }

    const canonical: unknown[] = new Array(length);
    this.assign(frame, canonical);
    this.activeAncestors.add(current);
    this.stack.push({ kind: "exit", value: current });
    for (let index = descriptors.length - 1; index >= 0; index--) {
      const descriptor = descriptors[index];
      if (!descriptor) {
        throw new TypeError("JSON Schema array snapshot is internally inconsistent");
      }
      this.stack.push({
        kind: "visit",
        value: descriptor.value,
        depth: frame.depth + 1,
        parent: canonical,
        key: index,
      });
    }
  }

  private visitObject(frame: CanonicalizationVisitFrame, current: object): void {
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("JSON Schema objects must be plain JSON objects");
    }
    const ownKeys = Reflect.ownKeys(current);
    if (ownKeys.length > this.limits.maxNodes) {
      throw new TypeError(
        `JSON Schema exceeds the maximum node count of ${this.limits.maxNodes}`,
      );
    }
    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw new TypeError("JSON Schema objects must not contain symbol keys");
    }
    this.addSerializedBytes(2 + Math.max(0, ownKeys.length - 1));

    const entries = (ownKeys as string[]).map((key) => {
      boundedUtf8Length(key, this.limits.maxKeyBytes, "key");
      this.addSerializedBytes(serializedJsonTokenByteLength(key) + 1);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) {
        throw new TypeError("JSON Schema objects must be data-only and must not contain accessors");
      }
      if (descriptor.enumerable !== true) {
        throw new TypeError("JSON Schema objects must not contain non-enumerable properties");
      }
      return { key, value: descriptor.value };
    }).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);

    const canonical: Record<string, unknown> = {};
    this.assign(frame, canonical);
    this.activeAncestors.add(current);
    this.stack.push({ kind: "exit", value: current });
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (!entry) {
        throw new TypeError("JSON Schema object snapshot is internally inconsistent");
      }
      this.stack.push({
        kind: "visit",
        value: entry.value,
        depth: frame.depth + 1,
        parent: canonical,
        key: entry.key,
      });
    }
  }

  private consumeNode(depth: number): void {
    if (depth > this.limits.maxDepth) {
      throw new TypeError(`JSON Schema exceeds the maximum depth of ${this.limits.maxDepth}`);
    }
    this.nodeCount++;
    if (this.nodeCount > this.limits.maxNodes) {
      throw new TypeError(
        `JSON Schema exceeds the maximum node count of ${this.limits.maxNodes}`,
      );
    }
  }

  private addSerializedBytes(amount: number): void {
    this.serializedBytes += amount;
    if (this.serializedBytes > this.limits.maxSerializedBytes) {
      throw new TypeError(
        `JSON Schema exceeds the ${this.limits.maxSerializedBytes}-byte serialized limit`,
      );
    }
  }

  private assign(frame: CanonicalizationVisitFrame, canonical: unknown): void {
    if (frame.parent === undefined) {
      this.canonicalRoot = canonical;
      this.rootAssigned = true;
      return;
    }
    if (Array.isArray(frame.parent)) {
      frame.parent[frame.key as number] = canonical;
      return;
    }
    defineOwnDataProperty(frame.parent, frame.key as string, canonical);
  }
}

function canonicalizeJsonValue(
  value: unknown,
  limits: CanonicalizationLimits,
): CanonicalJsonSnapshot {
  return new JsonSchemaCanonicalizer(limits).canonicalize(value);
}

interface JsonSchemaSnapshot {
  key: string;
  schema: JsonSchema;
  nodeCount: number;
  serializedBytes: number;
  compilationWork: number;
  cacheWeight: number;
}

const COMBINATOR_KEYWORDS = new Set(["allOf", "anyOf", "oneOf"]);
const CODE_GENERATING_MAP_KEYWORDS = new Map<string, number>([
  ["properties", 4],
  ["patternProperties", 8],
  ["dependencies", 4],
  ["dependentRequired", 4],
  ["dependentSchemas", 4],
]);
const RETAINED_SCHEMA_MAP_KEYWORDS = new Set(["$defs", "definitions"]);

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Estimate generated-validator work before Ajv sees a schema. Node and byte
 * limits alone do not capture wide combinators, large enums, or property maps,
 * all of which expand generated code and retained compiler state.
 */
function estimateCompilationWork(schema: JsonSchema): number {
  const stack: unknown[] = [schema];
  let work = 0;
  const addWork = (amount: number): void => {
    work += amount;
    if (work > JSON_SCHEMA_MAX_COMPILATION_WORK) {
      throw new TypeError(
        `JSON Schema exceeds the compilation work limit of ${JSON_SCHEMA_MAX_COMPILATION_WORK}`,
      );
    }
  };
  const addBoundedCollectionWork = (
    keyword: string,
    length: number,
    multiplier: number,
  ): void => {
    if (length > JSON_SCHEMA_MAX_COMBINATOR_FANOUT) {
      throw new TypeError(
        `JSON Schema ${keyword} exceeds the code-generation collection limit of ${JSON_SCHEMA_MAX_COMBINATOR_FANOUT}`,
      );
    }
    addWork(length * multiplier);
  };

  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index--) stack.push(value[index]);
      continue;
    }

    const schemaObject = value as Record<string, unknown>;
    const propertyCount = isJsonObject(schemaObject.properties)
      ? Object.keys(schemaObject.properties).length
      : 0;
    const patternPropertyCount = isJsonObject(schemaObject.patternProperties)
      ? Object.keys(schemaObject.patternProperties).length
      : 0;
    if (propertyCount > 0 && patternPropertyCount > 0) {
      // In Ajv strict mode every pattern is checked against every named
      // property during compilation, so account for the cross-product.
      addWork(propertyCount * patternPropertyCount);
    }

    for (const [keyword, keywordValue] of Object.entries(schemaObject)) {
      addWork(1);
      if (COMBINATOR_KEYWORDS.has(keyword) && Array.isArray(keywordValue)) {
        addBoundedCollectionWork(keyword, keywordValue.length, 8);
      } else if (
        (keyword === "prefixItems" || keyword === "items") && Array.isArray(keywordValue)
      ) {
        addBoundedCollectionWork(keyword, keywordValue.length, 2);
      } else if (
        (keyword === "enum" || keyword === "required" || keyword === "type") &&
        Array.isArray(keywordValue)
      ) {
        addBoundedCollectionWork(keyword, keywordValue.length, keyword === "required" ? 4 : 2);
      } else if (isJsonObject(keywordValue) && CODE_GENERATING_MAP_KEYWORDS.has(keyword)) {
        const entryCount = Object.keys(keywordValue).length;
        addBoundedCollectionWork(
          keyword,
          entryCount,
          CODE_GENERATING_MAP_KEYWORDS.get(keyword)!,
        );
        if (keyword === "dependentRequired" || keyword === "dependencies") {
          for (const dependencyValue of Object.values(keywordValue)) {
            if (Array.isArray(dependencyValue)) {
              addBoundedCollectionWork(`${keyword} entry`, dependencyValue.length, 4);
            }
          }
        }
      } else if (isJsonObject(keywordValue) && RETAINED_SCHEMA_MAP_KEYWORDS.has(keyword)) {
        addWork(Object.keys(keywordValue).length * 2);
      } else if (keyword === "pattern" && typeof keywordValue === "string") {
        addWork(Math.ceil(keywordValue.length / 8));
      }
      stack.push(keywordValue);
    }
  }

  return work;
}

function snapshotJsonSchema(schema: JsonSchema): JsonSchemaSnapshot {
  const snapshot = canonicalizeJsonValue(schema, JSON_SCHEMA_LIMITS);
  const canonical = snapshot.value;
  if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical)) {
    throw new TypeError("JSON Schema root must be a plain object");
  }
  const key = JSON.stringify(canonical);
  if (key === undefined) throw new TypeError("JSON Schema must be JSON serializable");
  const compilationWork = estimateCompilationWork(canonical as JsonSchema);
  const cacheWeight = snapshot.serializedBytes + snapshot.nodeCount * 64 + compilationWork * 32;
  return {
    key,
    schema: canonical as JsonSchema,
    nodeCount: snapshot.nodeCount,
    serializedBytes: snapshot.serializedBytes,
    compilationWork,
    cacheWeight,
  };
}

function copyValidationIssue(error: ErrorObject): JsonSchemaValidationIssue {
  let params: Record<string, unknown>;
  try {
    params = structuredClone(error.params) as Record<string, unknown>;
  } catch {
    params = { ...error.params };
  }

  return {
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    params,
    ...(error.message === undefined ? {} : { message: error.message }),
  };
}

function validationFailure(
  errors: ErrorObject[] | null | undefined,
): JsonSchemaValidationFailure {
  return {
    success: false,
    errors: (errors ?? []).map(copyValidationIssue),
  };
}

function validationSuccess<T>(input: unknown): JsonSchemaValidationSuccess<T> {
  return { success: true, value: input as T };
}

const DATA_ONLY_INPUT_FAILURE: JsonSchemaValidationFailure = Object.freeze({
  success: false,
  errors: Object.freeze([
    Object.freeze({
      instancePath: "",
      schemaPath: "",
      keyword: "veryfrontDataOnly",
      params: Object.freeze({}),
      message: "Input must be a bounded, data-only JSON value",
    }),
  ]),
});

function snapshotJsonInstance(input: unknown): CanonicalJsonSnapshot | undefined {
  try {
    return canonicalizeJsonValue(input, JSON_INSTANCE_LIMITS);
  } catch {
    // Accessors, throwing/revoked Proxies, cycles, custom prototypes, and
    // oversized inputs are ordinary validation failures at this boundary.
    return undefined;
  }
}

function errorObjectsFromUnknown(error: unknown): ErrorObject[] | undefined {
  if (!error || typeof error !== "object" || !("errors" in error)) {
    return undefined;
  }
  return Array.isArray(error.errors) ? error.errors as ErrorObject[] : undefined;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function";
}

function compileJsonSchemaValidator<T>(schema: JsonSchema): JsonSchemaValidationFunction<T> {
  const validate = createJsonSchemaCompiler(schema).compile(schemaForCompilation(schema));

  return (input) => {
    const inputSnapshot = snapshotJsonInstance(input);
    if (!inputSnapshot) return DATA_ONLY_INPUT_FAILURE;
    const acceptedInput = inputSnapshot.value;
    const outcome = validate(acceptedInput);
    if (isPromiseLike(outcome)) {
      return Promise.resolve(outcome).then(
        () => validationSuccess<T>(acceptedInput),
        (error: unknown) => {
          const errors = errorObjectsFromUnknown(error);
          if (errors) return validationFailure(errors);
          throw error;
        },
      );
    }

    return outcome ? validationSuccess<T>(acceptedInput) : validationFailure(validate.errors);
  };
}

function createJsonSchemaCompilationCache(): SchemaValidator["compileJsonSchema"] {
  interface CacheEntry {
    validator: JsonSchemaValidationFunction;
    weight: number;
  }
  const cache = new Map<string, CacheEntry>();
  let cacheWeight = 0;

  return <T>(schema: JsonSchema): JsonSchemaValidationFunction<T> => {
    const snapshot = snapshotJsonSchema(schema);
    const cached = cache.get(snapshot.key);
    if (cached) {
      cache.delete(snapshot.key);
      cache.set(snapshot.key, cached);
      return cached.validator as JsonSchemaValidationFunction<T>;
    }

    const compiled = compileJsonSchemaValidator<T>(snapshot.schema);
    while (
      cache.size >= JSON_SCHEMA_VALIDATOR_CACHE_SIZE ||
      cacheWeight + snapshot.cacheWeight > JSON_SCHEMA_VALIDATOR_CACHE_MAX_WEIGHT
    ) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = cache.get(oldestKey);
      cache.delete(oldestKey);
      if (oldest) cacheWeight -= oldest.weight;
    }
    cache.set(snapshot.key, { validator: compiled, weight: snapshot.cacheWeight });
    cacheWeight += snapshot.cacheWeight;
    return compiled;
  };
}

/**
 * Build a zod-backed `SchemaValidator` instance.
 *
 * Adapter instances snapshot schemas into plain JSON and retain validators in
 * an entry- and weight-bounded LRU cache. Each unique validator owns an isolated
 * Ajv compiler, so unrelated `$id` values cannot collide or accumulate in a
 * process-wide registry. It is therefore safe to call this once at extension setup and pass the returned value to
 * `ctx.provide("SchemaValidator", …)`. Tests that need to register the
 * validator without full extension bootstrap can call this factory directly.
 */
export function createZodAdapter(): SchemaValidator {
  const compileJsonSchema = createJsonSchemaCompilationCache();
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
      wrap(z.function() as AnyZodSchema),

    object: <S extends Record<string, Schema<unknown>>>(shape: S): Schema<InferShape<S>> =>
      wrap(z.object(toZodShape(shape))),

    array: <T>(element: Schema<T>): Schema<T[]> => wrap(z.array(toZod(element))),

    tuple: <T extends readonly Schema<unknown>[]>(
      items: T,
    ): Schema<{ [K in keyof T]: T[K] extends Schema<infer U> ? U : never }> => {
      const zodItems = items.map((s) => toZod(s)) as [
        AnyZodSchema,
        ...AnyZodSchema[],
      ];
      return wrap(z.tuple(zodItems));
    },

    record: <K extends string | number | symbol, V>(
      keys: Schema<K>,
      values: Schema<V>,
    ): Schema<Record<K, V>> => wrap(z.record(toZod(keys) as z.ZodString, toZod(values))),

    union: <T extends readonly [Schema<unknown>, ...Schema<unknown>[]]>(
      schemas: T,
    ): Schema<T[number] extends Schema<infer U> ? U : never> => {
      const zodSchemas = schemas.map((s: Schema<unknown>) => toZod(s)) as [
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
      const zodSchemas = schemas.map((s: Schema<unknown>) => toZod(s)) as [
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

    enum: <const T extends readonly [string, ...string[]]>(values: T): Schema<T[number]> =>
      wrap(
        (z.enum as (v: readonly [string, ...string[]]) => AnyZodSchema)(values),
      ),

    lazy: <T>(factory: () => Schema<T>): Schema<T> => wrap<T>(z.lazy(() => toZod(factory()))),

    instanceof: <T>(ctor: new (...args: never[]) => T): Schema<T> =>
      // zod 4's z.instanceof expects `typeof Class` (z.core.util.Class). Our
      // contract uses a slimmer `new`-able shape; bridge with a single cast
      // through unknown.
      wrap<T>(
        (z.instanceof as (c: unknown) => AnyZodSchema)(ctor),
      ),

    custom: <T>(check?: (value: unknown) => boolean, message?: string): Schema<T> =>
      wrap<T>(z.custom<T>(check as (v: unknown) => boolean, message)),

    coerce,

    validate: <T>(schema: Schema<T>, data: unknown): ValidationResult<T> => schema.safeParse(data),

    compileJsonSchema,

    toJsonSchema: (schema: Schema<unknown>): JsonSchema => zodToJsonSchema(toZod(schema)),

    isOptional: (schema: Schema<unknown>): boolean => isOptionalSchema(toZod(schema)),
  };
}

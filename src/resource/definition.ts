import { INVALID_ARGUMENT } from "#veryfront/errors";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import type { CachePolicy, McpConfig } from "./schemas/index.ts";
import { CACHE_POLICY_VALUES } from "./schemas/resource.schema.ts";
import type { Resource, ResourceLoadContext, ResourceParamsSchema } from "./types.ts";
import { assertResourceId, compileResourcePattern } from "./pattern.ts";

const MAX_RESOURCE_DESCRIPTION_LENGTH = 4_096;
const MAX_RESOURCE_TITLE_LENGTH = 512;
const CACHE_POLICIES: ReadonlySet<CachePolicy> = new Set(CACHE_POLICY_VALUES);
const capturedSchemaParsers = new WeakMap<object, (input: unknown) => unknown>();
const EMPTY_RESOURCE_LOAD_CONTEXT = Object.freeze({}) as ResourceLoadContext;

function invalidDefinition(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function readProperty(value: object, key: PropertyKey): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    invalidDefinition("Resource definition properties must be readable");
  }
}

function assertText(
  value: unknown,
  label: string,
  maximumLength: number,
  optional = false,
): string | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
    invalidDefinition(`${label} must be a non-empty bounded string`);
  }
  if (hasUnsafeControlCharacters(value, true) || value.includes("\u061c")) {
    invalidDefinition(`${label} must not contain unsafe control characters`);
  }
  return value;
}

function readOwnKeys(value: object, label: string): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    invalidDefinition(`${label} properties must be readable`);
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (value === null || typeof value !== "object") return false;
  try {
    return typeof Reflect.get(value, "aborted") === "boolean" &&
      typeof Reflect.get(value, "addEventListener") === "function" &&
      typeof Reflect.get(value, "removeEventListener") === "function";
  } catch {
    return false;
  }
}

/** Validate and freeze one resource load context at an invocation boundary. */
export function snapshotResourceLoadContext(value: unknown): ResourceLoadContext {
  if (value === undefined) return EMPTY_RESOURCE_LOAD_CONTEXT;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidDefinition("Resource load context must be an object");
  }
  const keys = readOwnKeys(value, "Resource load context");
  for (const key of keys) {
    if (key !== "signal") {
      invalidDefinition("Resource load context contains an unsupported property");
    }
  }
  const signal = keys.includes("signal") ? readProperty(value, "signal") : undefined;
  if (signal !== undefined && !isAbortSignal(signal)) {
    invalidDefinition("Resource load signal must be an AbortSignal");
  }
  return signal === undefined ? EMPTY_RESOURCE_LOAD_CONTEXT : Object.freeze({ signal });
}

/** Throw a stable cancellation error if a resource read has been aborted. */
export function throwIfResourceLoadAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Resource loading was aborted", "AbortError");
  }
}

function snapshotMcpConfig(value: unknown): Readonly<McpConfig> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidDefinition("Resource MCP configuration must be an object");
  }

  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    invalidDefinition("Resource MCP configuration properties must be readable");
  }
  for (const key of keys) {
    if (key !== "enabled" && key !== "cachePolicy") {
      invalidDefinition("Resource MCP configuration contains an unsupported property");
    }
  }

  const enabled = keys.includes("enabled") ? readProperty(value, "enabled") : undefined;
  const cachePolicy = keys.includes("cachePolicy") ? readProperty(value, "cachePolicy") : undefined;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    invalidDefinition("Resource MCP enabled must be a boolean");
  }
  if (
    cachePolicy !== undefined &&
    (typeof cachePolicy !== "string" || !CACHE_POLICIES.has(cachePolicy as CachePolicy))
  ) {
    invalidDefinition("Resource MCP cache policy is invalid");
  }

  return Object.freeze({
    ...(enabled === undefined ? {} : { enabled }),
    ...(cachePolicy === undefined ? {} : { cachePolicy: cachePolicy as McpConfig["cachePolicy"] }),
  });
}

function assertSchema(value: unknown): ResourceParamsSchema<unknown> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    invalidDefinition("Resource params schema must expose parse()");
  }
  const schema = value as object;
  if (!capturedSchemaParsers.has(schema)) {
    const parse = readProperty(schema, "parse");
    if (typeof parse !== "function") {
      invalidDefinition("Resource params schema must expose parse()");
    }
    capturedSchemaParsers.set(
      schema,
      (input: unknown) => Reflect.apply(parse, value, [input]),
    );
  }
  return value as ResourceParamsSchema<unknown>;
}

/** Read and freeze one resource definition at a trust boundary. */
export function snapshotResourceDefinition<TParams = unknown, TData = unknown>(
  value: unknown,
  expectedId?: string,
): Readonly<Resource<TParams, TData>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalidDefinition("Resource definition must be an object");
  }

  const id = assertResourceId(readProperty(value, "id"));
  if (expectedId !== undefined && id !== assertResourceId(expectedId)) {
    invalidDefinition("Resource registry id must match the resource definition id");
  }
  const pattern = readProperty(value, "pattern");
  compileResourcePattern(pattern);
  const description = assertText(
    readProperty(value, "description"),
    "Resource description",
    MAX_RESOURCE_DESCRIPTION_LENGTH,
  ) as string;
  const title = assertText(
    readProperty(value, "title"),
    "Resource title",
    MAX_RESOURCE_TITLE_LENGTH,
    true,
  );
  const paramsSchema = assertSchema(
    readProperty(value, "paramsSchema"),
  ) as ResourceParamsSchema<TParams>;
  const load = readProperty(value, "load");
  const subscribe = readProperty(value, "subscribe");
  const mcp = readProperty(value, "mcp");
  if (typeof load !== "function") invalidDefinition("Resource load must be a function");
  if (subscribe !== undefined && typeof subscribe !== "function") {
    invalidDefinition("Resource subscribe must be a function");
  }

  return Object.freeze({
    id,
    pattern: pattern as string,
    description,
    ...(title === undefined ? {} : { title }),
    paramsSchema,
    load: load as Resource<TParams, TData>["load"],
    ...(subscribe === undefined
      ? {}
      : { subscribe: subscribe as Resource<TParams, TData>["subscribe"] }),
    ...(mcp === undefined ? {} : { mcp: snapshotMcpConfig(mcp) }),
  });
}

/** Capture the schema parser once so later mutation cannot change validation behavior. */
export function captureResourceParser<T>(
  schema: ResourceParamsSchema<T>,
): (input: unknown) => T {
  assertSchema(schema);
  const parse = capturedSchemaParsers.get(schema as object);
  if (!parse) invalidDefinition("Resource params schema must expose parse()");
  return (input: unknown) => parse(input) as T;
}

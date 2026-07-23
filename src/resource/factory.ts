/**
 * Resource Factory
 *
 * Create MCP resources with data loading and subscription capabilities.
 *
 * @module veryfront/resource
 */

import type { Resource, ResourceConfig, ResourceLoadContext } from "./types.ts";
import { INPUT_VALIDATION_FAILED, INVALID_ARGUMENT } from "#veryfront/errors";
import {
  captureResourceParser,
  snapshotResourceDefinition,
  snapshotResourceLoadContext,
  throwIfResourceLoadAborted,
} from "./definition.ts";
import { assertResourceId, compileResourcePattern, GENERATED_RESOURCE_PATTERN } from "./pattern.ts";

const RESOURCE_CONFIG_KEYS = new Set<PropertyKey>([
  "id",
  "pattern",
  "description",
  "title",
  "paramsSchema",
  "load",
  "subscribe",
  "mcp",
]);

function invalidConfig(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function readConfigKeys(config: object): ReadonlySet<PropertyKey> {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(config);
  } catch {
    invalidConfig("Resource configuration properties must be readable");
  }
  for (const key of keys) {
    if (!RESOURCE_CONFIG_KEYS.has(key)) {
      invalidConfig("Resource configuration contains an unsupported property");
    }
  }
  return new Set(keys);
}

function readConfigProperty(
  config: object,
  keys: ReadonlySet<PropertyKey>,
  key: PropertyKey,
): unknown {
  if (!keys.has(key)) return undefined;
  try {
    return Reflect.get(config, key);
  } catch {
    invalidConfig("Resource configuration properties must be readable");
  }
}

async function readIteratorResult<T>(
  method: (...args: unknown[]) => unknown,
  iterator: object,
  args: unknown[],
): Promise<IteratorResult<T>> {
  const result = await Reflect.apply(method, iterator, args);
  if (result === null || typeof result !== "object") {
    invalidConfig("Resource subscription iterator must return an object");
  }

  let done: unknown;
  let value: unknown;
  try {
    done = Reflect.get(result, "done");
    value = Reflect.get(result, "value");
  } catch {
    invalidConfig("Resource subscription iterator results must be readable");
  }
  if (done !== undefined && typeof done !== "boolean") {
    invalidConfig("Resource subscription iterator done must be a boolean");
  }
  return done === true ? { done: true, value: value as T } : { done: false, value: value as T };
}

function captureAsyncIterable<T>(
  value: unknown,
  signal: AbortSignal | undefined,
): AsyncIterable<T> {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    invalidConfig("Resource subscribe must return an AsyncIterable");
  }

  let iteratorFactory: unknown;
  try {
    iteratorFactory = Reflect.get(value, Symbol.asyncIterator);
  } catch {
    invalidConfig("Resource subscribe must return a readable AsyncIterable");
  }
  if (typeof iteratorFactory !== "function") {
    invalidConfig("Resource subscribe must return an AsyncIterable");
  }

  let iterator: unknown;
  try {
    iterator = Reflect.apply(iteratorFactory, value, []);
  } catch {
    invalidConfig("Resource subscribe must return a readable AsyncIterable");
  }
  if (iterator === null || typeof iterator !== "object") {
    invalidConfig("Resource subscribe must return a valid async iterator");
  }

  let next: unknown;
  let returnMethod: unknown;
  let throwMethod: unknown;
  try {
    next = Reflect.get(iterator, "next");
    returnMethod = Reflect.get(iterator, "return");
    throwMethod = Reflect.get(iterator, "throw");
  } catch {
    invalidConfig("Resource subscription iterator methods must be readable");
  }
  if (typeof next !== "function") {
    invalidConfig("Resource subscribe must return a valid async iterator");
  }
  if (returnMethod !== undefined && typeof returnMethod !== "function") {
    invalidConfig("Resource subscription iterator return must be a function");
  }
  if (throwMethod !== undefined && typeof throwMethod !== "function") {
    invalidConfig("Resource subscription iterator throw must be a function");
  }
  const nextFunction = next as (...args: unknown[]) => unknown;
  const returnFunction = returnMethod as ((...args: unknown[]) => unknown) | undefined;
  const throwFunction = throwMethod as ((...args: unknown[]) => unknown) | undefined;
  let closed = false;

  const close = async (result?: unknown): Promise<IteratorResult<T>> => {
    if (closed) return { done: true, value: result as T };
    closed = true;
    return returnFunction === undefined
      ? { done: true, value: result as T }
      : await readIteratorResult<T>(returnFunction, iterator, [result]);
  };

  const captured: AsyncIterator<T> & AsyncIterable<T> = {
    next: async () => {
      if (signal?.aborted) {
        try {
          await close();
        } finally {
          throwIfResourceLoadAborted(signal);
        }
      }
      let result: IteratorResult<T>;
      try {
        result = await readIteratorResult<T>(nextFunction, iterator, []);
      } catch (error) {
        try {
          await close();
        } catch {
          // Preserve the iteration failure as the primary protocol error.
        }
        throw error;
      }
      if (result.done) closed = true;
      if (signal?.aborted) {
        try {
          await close();
        } finally {
          throwIfResourceLoadAborted(signal);
        }
      }
      return result;
    },
    return: close,
    throw: async (error?: unknown) => {
      if (closed) throw error;
      if (throwFunction === undefined) {
        await close();
        throw error;
      }
      const result = await readIteratorResult<T>(throwFunction, iterator, [error]);
      if (result.done) closed = true;
      return result;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  return captured;
}

function invocationResourceId(receiver: unknown, fallbackId: string): string {
  if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) {
    return fallbackId;
  }
  try {
    const value = Reflect.get(receiver, "id");
    return typeof value === "string" ? assertResourceId(value) : fallbackId;
  } catch {
    return fallbackId;
  }
}

/** Create a typed resource definition. */
export function resource<TParams = unknown, TData = unknown>(
  config: ResourceConfig<TParams, TData>,
): Resource<TParams, TData> {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    invalidConfig("Resource configuration must be an object");
  }

  const configKeys = readConfigKeys(config);
  const patternValue = readConfigProperty(config, configKeys, "pattern");
  const usesGeneratedPattern = patternValue === undefined;
  const pattern = usesGeneratedPattern ? generateResourcePattern() : patternValue;
  compileResourcePattern(pattern);
  const configuredId = readConfigProperty(config, configKeys, "id");
  const id = configuredId === undefined
    ? resourcePatternToId(pattern as string)
    : assertResourceId(configuredId);

  const snapshot = snapshotResourceDefinition<TParams, TData>({
    id,
    pattern,
    description: readConfigProperty(config, configKeys, "description"),
    title: readConfigProperty(config, configKeys, "title"),
    paramsSchema: readConfigProperty(config, configKeys, "paramsSchema"),
    load: readConfigProperty(config, configKeys, "load"),
    subscribe: readConfigProperty(config, configKeys, "subscribe"),
    mcp: readConfigProperty(config, configKeys, "mcp"),
  });
  const parseParams = captureResourceParser(snapshot.paramsSchema);
  const load = snapshot.load;
  const subscribe = snapshot.subscribe;

  return Object.freeze({
    ...(usesGeneratedPattern ? { [GENERATED_RESOURCE_PATTERN]: pattern } : {}),
    id,
    pattern: snapshot.pattern,
    description: snapshot.description,
    ...(snapshot.title === undefined ? {} : { title: snapshot.title }),
    paramsSchema: snapshot.paramsSchema,
    load: async function (
      this: Resource<TParams, TData> | undefined,
      params: TParams,
      context?: ResourceLoadContext,
    ): Promise<TData> {
      const contextSnapshot = snapshotResourceLoadContext(context);
      throwIfResourceLoadAborted(contextSnapshot.signal);
      let parsed: TParams;
      try {
        parsed = parseParams(params);
      } catch (cause) {
        throw createParamsValidationError(invocationResourceId(this, id), cause);
      }

      const result = await load(parsed, contextSnapshot);
      throwIfResourceLoadAborted(contextSnapshot.signal);
      return result;
    },
    ...(subscribe === undefined ? {} : {
      subscribe: async function* (
        this: Resource<TParams, TData> | undefined,
        params: TParams,
        context?: ResourceLoadContext,
      ): AsyncIterable<TData> {
        const contextSnapshot = snapshotResourceLoadContext(context);
        throwIfResourceLoadAborted(contextSnapshot.signal);
        let parsed: TParams;
        try {
          parsed = parseParams(params);
        } catch (cause) {
          throw createParamsValidationError(invocationResourceId(this, id), cause);
        }

        const iterable = subscribe(parsed, contextSnapshot);
        for await (
          const value of captureAsyncIterable<TData>(iterable, contextSnapshot.signal)
        ) {
          yield value;
        }
      },
    }),
    ...(snapshot.mcp === undefined ? {} : { mcp: snapshot.mcp }),
  });
}

/**
 * Generate an identity for a resource discovered before its source path is known.
 * Resources registered directly should explicitly define their pattern.
 * Auto-discovery is handled by the discovery module which scans
 * the filesystem and extracts patterns from resource definitions.
 */
function generateResourcePattern(): string {
  return `/resource_${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * Convert path pattern to ID
 * Example: "/users/:userId/profile" -> "users_userId_profile"
 */
function resourcePatternToId(pattern: string): string {
  return assertResourceId(pattern.replace(/^\//, "").replace(/\//g, "_").replace(/:/g, ""));
}

function createParamsValidationError(resourceId: string, cause: unknown): Error {
  const detail = `Resource "${resourceId}" params validation failed`;
  return INPUT_VALIDATION_FAILED.create({
    message: detail,
    detail,
    cause,
    context: { resourceId },
  });
}

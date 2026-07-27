import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { McpConfig, McpContentConfig } from "./schemas/index.ts";
import type { Resource, ResourceConfig, ResourceDefinition, ResourceLoadContext } from "./types.ts";
import { ResourceParamsValidationError } from "./errors.ts";
import { isValidResourceMimeType } from "./mime-type.ts";

const ArrayIsArray = Array.isArray;
const ObjectFreeze = Object.freeze;
const ObjectIsFrozen = Object.isFrozen;
const ReflectApply = Reflect.apply;

interface ResourceDefinitionState<TParams, TData> {
  readonly paramsSchema: Schema<TParams>;
  readonly load: ResourceConfig<TParams, TData>["load"];
  readonly subscribe: ResourceConfig<TParams, TData>["subscribe"];
}

const resourceDefinitionStates = new WeakMap<
  object,
  ResourceDefinitionState<unknown, unknown>
>();

interface CreateResourceDefinitionOptions<TParams, TData> {
  readonly id: string;
  readonly pattern: string;
  readonly generatedPattern?: string;
  readonly config: ResourceConfig<TParams, TData>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !ArrayIsArray(value);
}

function assertOptionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }
}

function assertMimeType(value: unknown): asserts value is string {
  if (!isValidResourceMimeType(value)) {
    throw new TypeError("Resource MCP content mimeType must be a valid media type");
  }
}

/** Assert MCP resource metadata without requiring schema-extension bootstrap. */
export function assertResourceMCPConfig(
  value: unknown,
): asserts value is McpConfig {
  if (!isObjectRecord(value)) {
    throw new TypeError("Resource MCP configuration must be an object");
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new TypeError("Resource MCP enabled must be a boolean");
  }
  if (
    value.cachePolicy !== undefined &&
    value.cachePolicy !== "no-cache" &&
    value.cachePolicy !== "cache" &&
    value.cachePolicy !== "cache-first"
  ) {
    throw new TypeError("Resource MCP cachePolicy is invalid");
  }
  if (value.content === undefined) return;
  if (!isObjectRecord(value.content)) {
    throw new TypeError("Resource MCP content configuration must be an object");
  }

  const type = value.content.type;
  if (type === "json") {
    if (value.content.mimeType !== undefined) {
      throw new TypeError("JSON resource content always uses application/json");
    }
    return;
  }
  if (type !== "text" && type !== "blob") {
    throw new TypeError('Resource MCP content type must be "json", "text", or "blob"');
  }
  assertMimeType(value.content.mimeType);
}

/** Snapshot metadata so caller mutation cannot change an advertised contract. */
export function snapshotResourceMCPConfig(
  config: McpConfig | undefined,
): McpConfig | undefined {
  if (config === undefined) return undefined;
  assertResourceMCPConfig(config);

  if (
    ObjectIsFrozen(config) &&
    (config.content === undefined || ObjectIsFrozen(config.content))
  ) {
    return config;
  }

  const content = config.content === undefined
    ? undefined
    : snapshotMCPContentConfig(config.content);
  const snapshot: McpConfig = {};
  if (config.enabled !== undefined) snapshot.enabled = config.enabled;
  if (config.cachePolicy !== undefined) {
    snapshot.cachePolicy = config.cachePolicy;
  }
  if (content !== undefined) snapshot.content = content;
  return ObjectFreeze(snapshot);
}

function snapshotMCPContentConfig(
  content: McpContentConfig,
): McpContentConfig {
  if (ObjectIsFrozen(content)) return content;
  return content.type === "json" ? ObjectFreeze({ type: "json" as const }) : ObjectFreeze({
    type: content.type,
    mimeType: content.mimeType,
  });
}

/** Validate the construction boundary before capturing its functions. */
export function assertResourceConfig<TParams, TData>(
  value: ResourceConfig<TParams, TData>,
): void;
export function assertResourceConfig(
  value: unknown,
): asserts value is ResourceConfig<unknown, unknown>;
export function assertResourceConfig(value: unknown): void {
  if (!isObjectRecord(value)) {
    throw new TypeError("Resource configuration must be an object");
  }
  assertOptionalString(value.pattern, "Resource pattern");
  if (typeof value.description !== "string") {
    throw new TypeError("Resource description must be a string");
  }
  assertOptionalString(value.title, "Resource title");
  if (
    !isObjectRecord(value.paramsSchema) ||
    typeof value.paramsSchema.parse !== "function"
  ) {
    throw new TypeError("Resource paramsSchema.parse must be a function");
  }
  if (typeof value.load !== "function") {
    throw new TypeError("Resource load must be a function");
  }
  if (value.subscribe !== undefined && typeof value.subscribe !== "function") {
    throw new TypeError("Resource subscribe must be a function");
  }
  if (value.mcp !== undefined) assertResourceMCPConfig(value.mcp);
}

/** Build a resource while capturing validation, loaders, and metadata. */
export function createResourceDefinition<TParams, TData>(
  options: CreateResourceDefinitionOptions<TParams, TData>,
): Resource<TParams, TData> {
  assertResourceConfig(options.config);
  const state = ObjectFreeze({
    paramsSchema: options.config.paramsSchema,
    load: options.config.load,
    subscribe: options.config.subscribe,
  });
  return buildResourceDefinition({
    id: options.id,
    pattern: options.pattern,
    generatedPattern: options.generatedPattern,
    description: options.config.description,
    title: options.config.title,
    mcp: snapshotResourceMCPConfig(options.config.mcp),
    state,
  });
}

/**
 * Replace discovery-derived identity without wrapping an already validated
 * loader. The captured callbacks remain private to this module.
 */
export function replaceResourceDefinitionMetadata<TParams, TData>(
  value: ResourceConfig<TParams, TData>,
  id: string,
  pattern: string,
): Resource<TParams, TData> {
  // Discovery also accepts literal ResourceConfig-shaped exports that do not
  // yet have an id or pattern. The derived metadata completes that boundary.
  assertResourceConfig(value);
  const state = getResourceDefinitionState<TParams, TData>(value) ??
    ObjectFreeze({
      paramsSchema: value.paramsSchema,
      load: value.load,
      subscribe: value.subscribe,
    });

  return buildResourceDefinition({
    id,
    pattern,
    description: value.description,
    title: value.title,
    mcp: snapshotResourceMCPConfig(value.mcp),
    state,
  });
}

/**
 * Validate, detach, and freeze a resource before it enters a registry.
 *
 * Factory-created definitions retain their captured raw callbacks in a private
 * weak map, so registry normalization never validates transformed parameters
 * twice.
 */
export function normalizeResourceDefinition<TParams, TData>(
  value: ResourceDefinition<TParams, TData>,
): Resource<TParams, TData> {
  assertResourceDefinition(value);
  if (isNormalizedResourceDefinition(value)) {
    return value;
  }
  const capturedState = getResourceDefinitionState<TParams, TData>(value);
  const state = capturedState ?? ObjectFreeze({
    paramsSchema: value.paramsSchema,
    load: value.load,
    subscribe: value.subscribe,
  });

  return buildResourceDefinition({
    id: value.id,
    pattern: value.pattern,
    generatedPattern: value.__veryfrontGeneratedPattern,
    description: value.description,
    title: value.title,
    mcp: snapshotResourceMCPConfig(value.mcp),
    state,
  });
}

function isNormalizedResourceDefinition<TParams, TData>(
  value: ResourceDefinition<TParams, TData>,
): value is Resource<TParams, TData> {
  return ObjectIsFrozen(value) && resourceDefinitionStates.has(value);
}

function getResourceDefinitionState<TParams, TData>(
  value: object,
): ResourceDefinitionState<TParams, TData> | undefined {
  return resourceDefinitionStates.get(value) as
    | ResourceDefinitionState<TParams, TData>
    | undefined;
}

function assertResourceDefinition<TParams, TData>(
  value: ResourceDefinition<TParams, TData>,
): void;
function assertResourceDefinition(
  value: unknown,
): asserts value is ResourceDefinition<unknown, unknown>;
function assertResourceDefinition(value: unknown): void {
  if (!isObjectRecord(value)) {
    throw new TypeError("Resource definition must be an object");
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new TypeError("Resource definition id must be a non-empty string");
  }
  if (typeof value.pattern !== "string" || value.pattern.length === 0) {
    throw new TypeError("Resource definition pattern must be a non-empty string");
  }
  if (typeof value.description !== "string") {
    throw new TypeError("Resource description must be a string");
  }
  assertOptionalString(value.title, "Resource title");
  if (
    !isObjectRecord(value.paramsSchema) ||
    typeof value.paramsSchema.parse !== "function"
  ) {
    throw new TypeError("Resource paramsSchema.parse must be a function");
  }
  if (typeof value.load !== "function") {
    throw new TypeError("Resource load must be a function");
  }
  if (value.subscribe !== undefined && typeof value.subscribe !== "function") {
    throw new TypeError("Resource subscribe must be a function");
  }
  if (value.mcp !== undefined) assertResourceMCPConfig(value.mcp);
}

function buildResourceDefinition<TParams, TData>(
  options: {
    readonly id: string;
    readonly pattern: string;
    readonly generatedPattern?: string;
    readonly description: string;
    readonly title?: string;
    readonly mcp?: McpConfig;
    readonly state: ResourceDefinitionState<TParams, TData>;
  },
): Resource<TParams, TData> {
  const validateParams = (params: TParams): TParams => {
    try {
      return ReflectApply(
        options.state.paramsSchema.parse,
        options.state.paramsSchema,
        [params],
      ) as TParams;
    } catch (error) {
      throw new ResourceParamsValidationError(options.id, error);
    }
  };

  const created: Resource<TParams, TData> = {
    id: options.id,
    pattern: options.pattern,
    description: options.description,
    title: options.title,
    paramsSchema: options.state.paramsSchema,
    load: async (params, context) =>
      runResourceLoader(
        options.state.load,
        () => validateParams(params),
        context,
      ),
    subscribe: options.state.subscribe === undefined ? undefined : (params) => {
      const iterable = ReflectApply(
        options.state.subscribe!,
        undefined,
        [validateParams(params)],
      ) as AsyncIterable<TData>;
      if (
        iterable === null ||
        typeof iterable !== "object" ||
        typeof iterable[Symbol.asyncIterator] !== "function"
      ) {
        throw new TypeError(
          `Resource "${options.id}" subscribe must return an AsyncIterable`,
        );
      }
      return iterable;
    },
    mcp: options.mcp,
  };
  if (options.generatedPattern !== undefined) {
    created.__veryfrontGeneratedPattern = options.generatedPattern;
  }
  resourceDefinitionStates.set(
    created,
    options.state as ResourceDefinitionState<unknown, unknown>,
  );
  return ObjectFreeze(created);
}

async function runResourceLoader<TParams, TData>(
  loader: ResourceConfig<TParams, TData>["load"],
  resolveParams: () => TParams,
  requestedContext: Readonly<ResourceLoadContext> | undefined,
): Promise<TData> {
  if (
    requestedContext !== undefined &&
    !isObjectRecord(requestedContext)
  ) {
    throw new TypeError("Resource load context must be an object");
  }
  if (
    requestedContext?.uri !== undefined &&
    typeof requestedContext.uri !== "string"
  ) {
    throw new TypeError("Resource load context uri must be a string");
  }
  const signal = requestedContext?.abortSignal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError("Resource load context abortSignal must be an AbortSignal");
  }
  if (signal?.aborted) throw createResourceAbortError();

  const context = requestedContext === undefined ? undefined : ObjectFreeze({
    abortSignal: signal,
    uri: requestedContext.uri,
  });
  const operation = Promise.resolve().then(() => {
    if (signal?.aborted) throw createResourceAbortError();
    return ReflectApply(loader, undefined, [
      resolveParams(),
      context,
    ]) as Promise<TData> | TData;
  });
  if (!signal) return await operation;

  let rejectCancellation: ((reason: DOMException) => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const rejectOnAbort = () => rejectCancellation?.(createResourceAbortError());
  signal.addEventListener("abort", rejectOnAbort, { once: true });
  if (signal.aborted) rejectOnAbort();

  try {
    return await Promise.race([operation, cancellation]);
  } finally {
    signal.removeEventListener("abort", rejectOnAbort);
    rejectCancellation = undefined;
  }
}

function createResourceAbortError(): DOMException {
  return new DOMException("Resource loading aborted", "AbortError");
}

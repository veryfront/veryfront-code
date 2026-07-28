import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { McpConfig, McpContentConfig } from "./schemas/index.ts";
import type { Resource, ResourceConfig, ResourceDefinition, ResourceLoadContext } from "./types.ts";
import { ResourceParamsValidationError } from "./errors.ts";
import { isValidResourceMimeType } from "./mime-type.ts";
import { containsControlCharacter } from "./string-validation.ts";

const ArrayIsArray = Array.isArray;
const ObjectFreeze = Object.freeze;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const MAX_RESOURCE_DESCRIPTION_LENGTH = 16 * 1024;
const MAX_RESOURCE_TITLE_LENGTH = 1024;
const MAX_RESOURCE_ID_LENGTH = 8 * 1024;

interface ResourceDefinitionState<TParams, TData> {
  readonly paramsSchema: Schema<TParams>;
  readonly parseParams: (data: unknown) => TParams;
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
  readonly config: CapturedResourceConfig<TParams, TData>;
}

/** Captured resource configuration used across framework-owned boundaries. */
interface CapturedResourceConfig<TParams, TData> {
  readonly pattern?: string;
  readonly description: string;
  readonly title?: string;
  readonly mcp?: McpConfig;
  readonly state: ResourceDefinitionState<TParams, TData>;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !ArrayIsArray(value);
}

function assertOptionalString(
  value: unknown,
  field: string,
): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }
}

function assertMaximumStringLength(
  value: string,
  field: string,
  maximum: number,
): void {
  if (value.length > maximum) {
    throw new TypeError(
      `${field} must not exceed ${maximum} characters`,
    );
  }
}

function assertKnownFields(
  value: object,
  label: string,
  allowedFields: readonly string[],
): void {
  for (const key of ReflectOwnKeys(value)) {
    if (typeof key === "string") {
      let supported = false;
      for (let index = 0; index < allowedFields.length; index++) {
        if (key === allowedFields[index]) {
          supported = true;
          break;
        }
      }
      if (supported) continue;
    }
    const field = typeof key === "string" ? key : "symbol";
    throw new TypeError(
      `${label} contains unsupported field "${field}"`,
    );
  }
}

function assertResourceId(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Resource definition id must be a non-empty string");
  }
  assertMaximumStringLength(
    value,
    "Resource definition id",
    MAX_RESOURCE_ID_LENGTH,
  );
  if (containsControlCharacter(value)) {
    throw new TypeError("Resource definition id must not contain control characters");
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
  captureResourceMCPConfig(value);
}

function captureResourceMCPConfig(value: unknown): McpConfig {
  if (!isObjectRecord(value)) {
    throw new TypeError("Resource MCP configuration must be an object");
  }
  assertKnownFields(
    value,
    "Resource MCP configuration",
    ["enabled", "content"],
  );
  const enabled = value.enabled;
  const contentValue = value.content;

  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new TypeError("Resource MCP enabled must be a boolean");
  }
  const content = contentValue === undefined ? undefined : snapshotMCPContentConfig(contentValue);

  const snapshot: McpConfig = {};
  if (enabled !== undefined) snapshot.enabled = enabled;
  if (content !== undefined) snapshot.content = content;
  return ObjectFreeze(snapshot);
}

/** Snapshot metadata so caller mutation cannot change an advertised contract. */
export function snapshotResourceMCPConfig(
  config: McpConfig | undefined,
): McpConfig | undefined {
  if (config === undefined) return undefined;
  return captureResourceMCPConfig(config);
}

function snapshotMCPContentConfig(
  value: unknown,
): McpContentConfig {
  if (!isObjectRecord(value)) {
    throw new TypeError("Resource MCP content configuration must be an object");
  }
  assertKnownFields(
    value,
    "Resource MCP content configuration",
    ["type", "mimeType"],
  );
  const type = value.type;
  const mimeType = value.mimeType;
  if (type === "json") {
    if (mimeType !== undefined) {
      throw new TypeError("JSON resource content always uses application/json");
    }
    return ObjectFreeze({ type: "json" as const });
  }
  if (type !== "text" && type !== "blob") {
    throw new TypeError('Resource MCP content type must be "json", "text", or "blob"');
  }
  assertMimeType(mimeType);
  return ObjectFreeze({ type, mimeType });
}

/** Capture and validate a resource configuration with one read per field. */
export function captureResourceConfig<TParams, TData>(
  value: ResourceConfig<TParams, TData>,
): CapturedResourceConfig<TParams, TData>;
export function captureResourceConfig(
  value: unknown,
): CapturedResourceConfig<unknown, unknown>;
export function captureResourceConfig(
  value: unknown,
): CapturedResourceConfig<unknown, unknown> {
  if (!isObjectRecord(value)) {
    throw new TypeError("Resource configuration must be an object");
  }

  const pattern = value.pattern;
  const description = value.description;
  const title = value.title;
  const paramsSchema = value.paramsSchema;
  const load = value.load;
  const subscribe = value.subscribe;
  const mcpValue = value.mcp;

  assertOptionalString(pattern, "Resource pattern");
  if (typeof description !== "string") {
    throw new TypeError("Resource description must be a string");
  }
  assertMaximumStringLength(
    description,
    "Resource description",
    MAX_RESOURCE_DESCRIPTION_LENGTH,
  );
  assertOptionalString(title, "Resource title");
  if (title !== undefined) {
    assertMaximumStringLength(
      title,
      "Resource title",
      MAX_RESOURCE_TITLE_LENGTH,
    );
  }
  if (!isObjectRecord(paramsSchema)) {
    throw new TypeError("Resource paramsSchema.parse must be a function");
  }
  const parseParams = paramsSchema.parse;
  if (typeof parseParams !== "function") {
    throw new TypeError("Resource paramsSchema.parse must be a function");
  }
  if (typeof load !== "function") {
    throw new TypeError("Resource load must be a function");
  }
  if (subscribe !== undefined && typeof subscribe !== "function") {
    throw new TypeError("Resource subscribe must be a function");
  }
  const mcp = mcpValue === undefined ? undefined : captureResourceMCPConfig(mcpValue);
  const schema = paramsSchema as unknown as Schema<unknown>;
  const state = ObjectFreeze({
    paramsSchema: schema,
    parseParams: parseParams as (data: unknown) => unknown,
    load: load as ResourceConfig<unknown, unknown>["load"],
    subscribe: subscribe as ResourceConfig<unknown, unknown>["subscribe"],
  });

  return ObjectFreeze({
    pattern,
    description,
    title,
    mcp,
    state,
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
  captureResourceConfig(value);
}

/** Build a resource while capturing validation, loaders, and metadata. */
export function createResourceDefinition<TParams, TData>(
  options: CreateResourceDefinitionOptions<TParams, TData>,
): Resource<TParams, TData> {
  return buildResourceDefinition({
    id: options.id,
    pattern: options.pattern,
    generatedPattern: options.generatedPattern,
    description: options.config.description,
    title: options.config.title,
    mcp: options.config.mcp,
    state: options.config.state,
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
  const captured = captureResourceConfig(value);
  const state = getResourceDefinitionState<TParams, TData>(value) ??
    captured.state;

  return buildResourceDefinition({
    id,
    pattern,
    description: captured.description,
    title: captured.title,
    mcp: captured.mcp,
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
  if (isNormalizedResourceDefinition(value)) {
    return value;
  }
  const captured = captureResourceDefinition(value);

  return buildResourceDefinition({
    id: captured.id,
    pattern: captured.pattern,
    generatedPattern: captured.generatedPattern,
    description: captured.config.description,
    title: captured.config.title,
    mcp: captured.config.mcp,
    state: captured.config.state,
  });
}

function isNormalizedResourceDefinition<TParams, TData>(
  value: ResourceDefinition<TParams, TData>,
): value is Resource<TParams, TData> {
  return resourceDefinitionStates.has(value);
}

function getResourceDefinitionState<TParams, TData>(
  value: object,
): ResourceDefinitionState<TParams, TData> | undefined {
  return resourceDefinitionStates.get(value) as
    | ResourceDefinitionState<TParams, TData>
    | undefined;
}

interface CapturedResourceDefinition<TParams, TData> {
  readonly id: string;
  readonly pattern: string;
  readonly generatedPattern?: string;
  readonly config: CapturedResourceConfig<TParams, TData>;
}

function captureResourceDefinition<TParams, TData>(
  value: ResourceDefinition<TParams, TData>,
): CapturedResourceDefinition<TParams, TData>;
function captureResourceDefinition(
  value: unknown,
): CapturedResourceDefinition<unknown, unknown>;
function captureResourceDefinition(
  value: unknown,
): CapturedResourceDefinition<unknown, unknown> {
  if (!isObjectRecord(value)) {
    throw new TypeError("Resource definition must be an object");
  }
  const id = value.id;
  const generatedPattern = value.__veryfrontGeneratedPattern;
  const config = captureResourceConfig(value);
  assertResourceId(id);
  if (typeof config.pattern !== "string" || config.pattern.length === 0) {
    throw new TypeError("Resource definition pattern must be a non-empty string");
  }
  assertOptionalString(
    generatedPattern,
    "Resource definition generated pattern",
  );
  return {
    id,
    pattern: config.pattern,
    generatedPattern,
    config,
  };
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
  assertResourceId(options.id);
  const validateParams = (params: TParams): TParams => {
    try {
      return ReflectApply(
        options.state.parseParams,
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
  const uri = requestedContext?.uri;
  const signal = requestedContext?.abortSignal;
  if (
    uri !== undefined &&
    typeof uri !== "string"
  ) {
    throw new TypeError("Resource load context uri must be a string");
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError("Resource load context abortSignal must be an AbortSignal");
  }
  if (signal?.aborted) throw createResourceAbortError();

  const context = requestedContext === undefined ? undefined : ObjectFreeze({
    abortSignal: signal,
    uri,
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

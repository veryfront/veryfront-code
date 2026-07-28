/**
 * OpenAPI Spec Generator
 *
 * Generates OpenAPI 3.1.0 specification from discovered routes.
 *
 * @module routing/api/openapi/spec-generator
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { stringify as stringifyYaml } from "@std/yaml/stringify";
import type { ApiRouteMatcher, RouteEntry } from "../api-route-matcher.ts";
import { loadHandlerModule } from "../module-loader/loader.ts";
import {
  getDefaultStatusDescription,
  OPENAPI_METADATA,
  type OpenAPIOperation,
  type OpenAPIParameter,
  type OpenAPIPathItem,
  type OpenAPIRouteMetadata,
  type OpenAPISpec,
  type WrappedHandler,
} from "./types.ts";
import {
  analyzeOpenAPIPath,
  generateOperationId,
  type OpenAPIPathDescription,
} from "./path-utils.ts";
import { isHostProjectCodeExecutionAllowed } from "#veryfront/security/project-locality.ts";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];
type HttpMethodLower = Lowercase<HttpMethod>;
export const MAX_OPENAPI_SERIALIZATION_BYTES = 16 * 1024 * 1024;
const MAX_OPENAPI_SERIALIZATION_DEPTH = 128;
const MAX_OPENAPI_SERIALIZATION_VALUES = 100_000;
const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const arraySort = Array.prototype.sort;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectPrototype = Object.prototype;
const objectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ownKeys = Reflect.ownKeys;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const NativeArray = Array;
const NativeWeakSet = WeakSet;
const weakSetAdd = NativeWeakSet.prototype.add;
const weakSetDelete = NativeWeakSet.prototype.delete;
const weakSetHas = NativeWeakSet.prototype.has;
const NativeJSON = JSON;
const jsonStringify = NativeJSON.stringify;
const stringStartsWith = String.prototype.startsWith;
const utf8Encoder = new TextEncoder();
const textEncoderEncode = TextEncoder.prototype.encode;
const serializationErrors = new NativeWeakSet<object>();

interface GenerateSpecOptions {
  /**
   * OpenAPI metadata is currently read from live route exports. Only an
   * explicitly local development project retains the historical capability.
   */
  isLocalProject?: boolean;
  /**
   * Whether runtime trust resolution permits route exports to be inspected in
   * the server process.
   */
  allowHostProjectCodeExecution?: boolean;
  /** API title for OpenAPI info */
  title?: string;
  /** API version */
  version?: string;
  /** API description */
  description?: string;
  /** Server URLs to include */
  servers?: Array<{ url: string; description?: string }>;
}

export class OpenAPISpecGenerationError extends Error {
  constructor(pattern: string, reason: string, options?: ErrorOptions) {
    super(
      `Cannot generate a complete OpenAPI specification for route ${
        JSON.stringify(pattern)
      }: ${reason}.`,
      options,
    );
    this.name = "OpenAPISpecGenerationError";
  }
}

export class OpenAPISpecUnavailableError extends Error {
  constructor() {
    super("OpenAPI specification generation requires an explicitly local project");
    this.name = "OpenAPISpecUnavailableError";
  }
}

export class OpenAPISpecSerializationError extends TypeError {
  constructor(reason: string, options?: ErrorOptions) {
    super(`OpenAPI specification is not serializable: ${reason}`, options);
    this.name = "OpenAPISpecSerializationError";
    apply(weakSetAdd, serializationErrors, [this]);
  }
}

function throwSerializationFailure(error: unknown): never {
  if (
    typeof error === "object" &&
    error !== null &&
    apply(weakSetHas, serializationErrors, [error])
  ) {
    throw error;
  }
  throw new OpenAPISpecSerializationError(
    "inspection or encoding failed",
    { cause: error },
  );
}

interface SerializationBudget {
  bytes: number;
  values: number;
}

function consumeSerializationValue(
  budget: SerializationBudget,
  depth: number,
): void {
  if (depth > MAX_OPENAPI_SERIALIZATION_DEPTH) {
    throw new OpenAPISpecSerializationError(
      `nesting exceeds ${MAX_OPENAPI_SERIALIZATION_DEPTH} levels`,
    );
  }
  budget.values++;
  if (budget.values > MAX_OPENAPI_SERIALIZATION_VALUES) {
    throw new OpenAPISpecSerializationError(
      `value count exceeds ${MAX_OPENAPI_SERIALIZATION_VALUES}`,
    );
  }
}

function consumeSerializationText(
  budget: SerializationBudget,
  value: string,
): void {
  if (value.length > MAX_OPENAPI_SERIALIZATION_BYTES) {
    throw new OpenAPISpecSerializationError(
      `text exceeds the ${MAX_OPENAPI_SERIALIZATION_BYTES}-byte input limit`,
    );
  }
  budget.bytes += apply(textEncoderEncode, utf8Encoder, [value]).byteLength;
  if (budget.bytes > MAX_OPENAPI_SERIALIZATION_BYTES) {
    throw new OpenAPISpecSerializationError(
      `text exceeds the ${MAX_OPENAPI_SERIALIZATION_BYTES}-byte input limit`,
    );
  }
}

function snapshotSerializableValue(
  value: unknown,
  ancestors: WeakSet<object>,
  budget: SerializationBudget,
  depth: number,
): unknown {
  consumeSerializationValue(budget, depth);
  if (typeof value === "string") {
    consumeSerializationText(budget, value);
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!numberIsFinite(value)) throw new OpenAPISpecSerializationError("non-finite number");
    return value === 0 ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new OpenAPISpecSerializationError(`unsupported ${typeof value} value`);
  }
  if (apply(weakSetHas, ancestors, [value])) {
    throw new OpenAPISpecSerializationError("cyclic value");
  }
  apply(weakSetAdd, ancestors, [value]);

  try {
    if (apply(arrayIsArray, Array, [value])) {
      const lengthDescriptor = apply(getOwnPropertyDescriptor, Object, [value, "length"]) as
        | PropertyDescriptor
        | undefined;
      const length = lengthDescriptor &&
          apply(objectPrototypeHasOwnProperty, lengthDescriptor, ["value"])
        ? lengthDescriptor.value
        : undefined;
      if (typeof length !== "number" || !numberIsSafeInteger(length) || length < 0) {
        throw new OpenAPISpecSerializationError("invalid array length");
      }
      if (length > MAX_OPENAPI_SERIALIZATION_VALUES - budget.values) {
        throw new OpenAPISpecSerializationError(
          `value count exceeds ${MAX_OPENAPI_SERIALIZATION_VALUES}`,
        );
      }

      const snapshot = new NativeArray<unknown>(length);
      for (let index = 0; index < length; index++) {
        const descriptor = apply(getOwnPropertyDescriptor, Object, [value, `${index}`]) as
          | PropertyDescriptor
          | undefined;
        if (
          !descriptor ||
          !apply(objectPrototypeHasOwnProperty, descriptor, ["value"]) ||
          descriptor.value === undefined
        ) {
          throw new OpenAPISpecSerializationError("sparse or undefined array entry");
        }
        apply(objectDefineProperty, Object, [
          snapshot,
          `${index}`,
          {
            configurable: true,
            enumerable: true,
            value: snapshotSerializableValue(
              descriptor.value,
              ancestors,
              budget,
              depth + 1,
            ),
            writable: true,
          },
        ]);
      }
      return snapshot;
    }

    const prototype = apply(getPrototypeOf, Object, [value]);
    if (prototype !== objectPrototype && prototype !== null) {
      throw new OpenAPISpecSerializationError("non-plain object");
    }
    const snapshot = apply(objectCreate, Object, [null]) as Record<string, unknown>;
    const keys = apply(ownKeys, Reflect, [value]) as PropertyKey[];
    if (keys.length > MAX_OPENAPI_SERIALIZATION_VALUES - budget.values) {
      throw new OpenAPISpecSerializationError(
        `value count exceeds ${MAX_OPENAPI_SERIALIZATION_VALUES}`,
      );
    }
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      if (typeof key !== "string") {
        throw new OpenAPISpecSerializationError("symbol-keyed property");
      }
      consumeSerializationText(budget, key);
      const descriptor = apply(getOwnPropertyDescriptor, Object, [value, key]) as
        | PropertyDescriptor
        | undefined;
      if (!descriptor || !descriptor.enumerable) continue;
      if (!apply(objectPrototypeHasOwnProperty, descriptor, ["value"])) {
        throw new OpenAPISpecSerializationError("accessor property");
      }
      if (descriptor.value === undefined) continue;
      apply(objectDefineProperty, Object, [
        snapshot,
        key,
        {
          configurable: true,
          enumerable: true,
          value: snapshotSerializableValue(
            descriptor.value,
            ancestors,
            budget,
            depth + 1,
          ),
          writable: true,
        },
      ]);
    }
    return snapshot;
  } finally {
    apply(weakSetDelete, ancestors, [value]);
  }
}

function snapshotOpenAPISpecForSerialization(spec: OpenAPISpec): OpenAPISpec {
  return snapshotSerializableValue(
    spec,
    new NativeWeakSet(),
    { bytes: 0, values: 0 },
    0,
  ) as OpenAPISpec;
}

function assertBoundedOpenAPISerialization(serialized: string): string {
  if (
    serialized.length > MAX_OPENAPI_SERIALIZATION_BYTES ||
    apply(textEncoderEncode, utf8Encoder, [serialized]).byteLength >
      MAX_OPENAPI_SERIALIZATION_BYTES
  ) {
    throw new OpenAPISpecSerializationError(
      `encoded output exceeds ${MAX_OPENAPI_SERIALIZATION_BYTES} bytes`,
    );
  }
  return serialized;
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isOpenAPIRoutePattern(pattern: string): boolean {
  return pattern === "/api" ||
    apply(stringStartsWith, pattern, ["/api/"]) === true;
}

type OperationOwners = Map<string, { method: HttpMethod; pattern: string }>;

export class OpenAPIOperationIdRegistry {
  readonly #owners: OperationOwners = new Map();

  record(pathItem: OpenAPIPathItem, pattern: string): void {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method.toLowerCase() as HttpMethodLower];
      const operationId = operation?.operationId;
      if (!operationId) continue;
      const owner = this.#owners.get(operationId);
      if (owner) {
        throw new TypeError(
          `generated operationId ${JSON.stringify(operationId)} duplicates ` +
            `${owner.method} ${JSON.stringify(owner.pattern)}`,
        );
      }
      this.#owners.set(operationId, { method, pattern });
    }
  }
}

export async function generateOpenAPISpec(
  router: ApiRouteMatcher,
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
  options?: GenerateSpecOptions,
): Promise<OpenAPISpec> {
  if (!isHostProjectCodeExecutionAllowed(options)) {
    throw new OpenAPISpecUnavailableError();
  }

  const spec: OpenAPISpec = {
    openapi: "3.1.0",
    info: {
      title: options?.title ?? config?.openapi?.title ?? "API Documentation",
      version: options?.version ?? config?.openapi?.version ?? "1.0.0",
      description: options?.description ?? config?.openapi?.description,
    },
    paths: {},
    tags: [],
  };

  if (options?.servers?.length) spec.servers = options.servers;

  const tagSet = new Set<string>();
  const routesToDocument: Array<{
    pattern: string;
    entry: RouteEntry;
    openApiRoute: OpenAPIPathDescription;
  }> = [];
  const routePatternsByShape = new Map<string, string>();
  const operationIds = new OpenAPIOperationIdRegistry();

  const registeredRoutes = [...router.routes];
  apply(arraySort, registeredRoutes, [
    (left: [string, RouteEntry], right: [string, RouteEntry]) =>
      compareCodeUnits(left[0], right[0]),
  ]);
  for (let routeIndex = 0; routeIndex < registeredRoutes.length; routeIndex++) {
    const registeredRoute = registeredRoutes[routeIndex]!;
    const pattern = registeredRoute[0];
    const entry = registeredRoute[1];
    if (!isOpenAPIRoutePattern(pattern)) continue;
    const analysis = analyzeOpenAPIPath(pattern);
    if (!analysis.description) {
      throw new OpenAPISpecGenerationError(
        pattern,
        analysis.reason ?? "the route cannot be represented",
      );
    }

    const routeShape = analysis.description.path.replace(/\{[^{}]+\}/g, "{}");
    const conflictingPattern = routePatternsByShape.get(routeShape);
    if (conflictingPattern !== undefined) {
      throw new OpenAPISpecGenerationError(
        pattern,
        `route shape collides with ${JSON.stringify(conflictingPattern)}`,
      );
    }
    routePatternsByShape.set(routeShape, pattern);

    routesToDocument.push({ pattern, entry, openApiRoute: analysis.description });
  }

  for (const { pattern, entry, openApiRoute } of routesToDocument) {
    try {
      const pathItem = await processRoute(
        entry,
        openApiRoute,
        projectDir,
        adapter,
        config,
        tagSet,
      );
      if (!pathItem || Object.keys(pathItem).length === 0) continue;

      operationIds.record(pathItem, pattern);
      spec.paths[openApiRoute.path] = pathItem;
    } catch (error) {
      throw new OpenAPISpecGenerationError(
        pattern,
        snapshotThrowableDiagnostic(error),
        { cause: error },
      );
    }
  }

  spec.tags = Array.from(tagSet)
    .sort()
    .map((name) => ({ name }));

  return spec;
}

async function processRoute(
  entry: RouteEntry,
  openApiRoute: OpenAPIPathDescription,
  projectDir: string,
  adapter: RuntimeAdapter,
  config: VeryfrontConfig | undefined,
  tagSet: Set<string>,
): Promise<OpenAPIPathItem | null> {
  const module = await loadHandlerModule({
    projectDir,
    modulePath: entry.route.page,
    adapter,
    config,
  });

  if (!module) return null;

  const pathItem: OpenAPIPathItem = {};

  for (const method of HTTP_METHODS) {
    const handler = module[method] as WrappedHandler | undefined;
    if (typeof handler !== "function") continue;

    const metadata = handler[OPENAPI_METADATA] as OpenAPIRouteMetadata | undefined;
    addTags(metadata, tagSet);

    pathItem[method.toLowerCase() as HttpMethodLower] = buildOperation(
      method,
      openApiRoute.path,
      metadata,
      openApiRoute.params,
    );
  }

  const defaultHandler = module.default as WrappedHandler | undefined;
  if (typeof defaultHandler !== "function") return pathItem;

  const defaultMetadata = defaultHandler[OPENAPI_METADATA] as OpenAPIRouteMetadata | undefined;
  addTags(defaultMetadata, tagSet);

  for (const method of HTTP_METHODS) {
    const methodKey = method.toLowerCase() as HttpMethodLower;
    if (pathItem[methodKey]) continue;

    pathItem[methodKey] = buildOperation(
      method,
      openApiRoute.path,
      defaultMetadata,
      openApiRoute.params,
    );
  }

  return pathItem;
}

function addTags(metadata: OpenAPIRouteMetadata | undefined, tagSet: Set<string>): void {
  for (const tag of metadata?.tags ?? []) tagSet.add(tag);
}

function buildOperation(
  method: HttpMethod,
  openApiPath: string,
  metadata: OpenAPIRouteMetadata | undefined,
  pathParams: Array<{ name: string; required: boolean; catchAll: boolean }>,
): OpenAPIOperation {
  const supportsBody = method === "POST" || method === "PUT" || method === "PATCH";

  const parameters: OpenAPIParameter[] = [];

  const operation: OpenAPIOperation = {
    operationId: generateOperationId(method, openApiPath),
    summary: metadata?.summary ?? `${method} ${openApiPath}`,
    description: metadata?.description,
    tags: metadata?.tags,
    deprecated: metadata?.deprecated,
    responses: {},
  };

  for (const param of pathParams) {
    const parameter: OpenAPIParameter = {
      name: param.name,
      in: "path",
      required: param.required,
      schema: metadata?.params?.properties?.[param.name] ?? { type: "string" as const },
    };

    if (param.catchAll) {
      parameter.description = "Catch-all parameter (matches multiple path segments)";
    }

    parameters.push(parameter);
  }

  const queryProps = metadata?.query?.properties;
  if (queryProps) {
    const required = metadata?.query?.required ?? [];
    for (const [name, schema] of Object.entries(queryProps)) {
      parameters.push({
        name,
        in: "query",
        required: required.includes(name),
        schema,
      });
    }
  }

  if (supportsBody && metadata?.body) {
    operation.requestBody = {
      required: true,
      content: {
        "application/json": { schema: metadata.body },
      },
    };
  }

  const responses = metadata?.responses;
  if (responses && Object.keys(responses).length > 0) {
    for (const [statusCode, response] of Object.entries(responses)) {
      operation.responses[statusCode] = {
        ...response,
        description: response.description || getDefaultStatusDescription(Number(statusCode)),
      };
    }
  } else {
    operation.responses = { "200": { description: "Successful response" } };
    if (supportsBody) operation.responses["400"] = { description: "Bad request" };
  }

  if (parameters.length > 0) operation.parameters = parameters;

  return operation;
}

export async function generateOpenAPIJson(
  router: ApiRouteMatcher,
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
  options?: GenerateSpecOptions,
): Promise<string> {
  const spec = await generateOpenAPISpec(router, projectDir, adapter, config, options);
  return specToJson(spec);
}

export function specToJson(spec: OpenAPISpec): string {
  try {
    return assertBoundedOpenAPISerialization(
      apply(jsonStringify, NativeJSON, [
        snapshotOpenAPISpecForSerialization(spec),
        null,
        2,
      ]) as string,
    );
  } catch (error) {
    return throwSerializationFailure(error);
  }
}

export function specToYaml(spec: OpenAPISpec): string {
  try {
    return assertBoundedOpenAPISerialization(
      stringifyYaml(snapshotOpenAPISpecForSerialization(spec)),
    );
  } catch (error) {
    return throwSerializationFailure(error);
  }
}

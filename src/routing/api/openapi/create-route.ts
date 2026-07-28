import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { type JsonSchema, zodToJsonSchema } from "#veryfront/tool/schema";
import {
  getDefaultStatusDescription,
  OPENAPI_METADATA,
  type OpenAPIRouteConfig,
  type OpenAPIRouteMetadata,
  type WrappedHandler,
} from "./types.ts";

const MAX_SUMMARY_LENGTH = 1_024;
const MAX_DESCRIPTION_LENGTH = 8_192;
const MAX_TAGS = 128;
const MAX_TAG_LENGTH = 128;
const MAX_RESPONSES = 128;
const apply = Reflect.apply;
const freeze = Object.freeze;

function invalidConfig(message: string, cause?: unknown): TypeError {
  return new TypeError(`OpenAPI route ${message}`, cause === undefined ? undefined : { cause });
}

function readOwnDataProperty(
  value: object,
  key: PropertyKey,
  label: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  } catch (cause) {
    throw invalidConfig(`${label} must contain only own data properties`, cause);
  }
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw invalidConfig(`${label} must contain only own data properties`);
  }
  return descriptor.value;
}

function optionalBoundedText(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    hasControlCharacters(value)
  ) {
    throw invalidConfig(
      `${label} must be a non-empty, control-free string no longer than ${maxLength} characters`,
    );
  }
  return value;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function snapshotTags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw invalidConfig("tags must be an array");

  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_TAGS
  ) {
    throw invalidConfig(`tags must contain at most ${MAX_TAGS} entries`);
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index++) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidConfig(`tags[${index}] must be an own data property`);
    }
    const tag = optionalBoundedText(descriptor.value, `tags[${index}]`, MAX_TAG_LENGTH)!;
    if (seen.has(tag)) throw invalidConfig(`tags contains duplicate "${tag}"`);
    seen.add(tag);
    tags.push(tag);
  }
  return freeze(tags) as string[];
}

function freezeJsonValue<T>(value: T): T {
  const stack: object[] = [];
  if (typeof value === "object" && value !== null) stack.push(value);
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of Object.values(current)) {
      if (typeof child === "object" && child !== null && !Object.isFrozen(child)) {
        stack.push(child);
      }
    }
    freeze(current);
  }
  return value;
}

function convertSchema(schema: unknown, label: string): JsonSchema {
  let converted: JsonSchema;
  try {
    converted = zodToJsonSchema(schema);
  } catch (cause) {
    throw invalidConfig(`${label} schema could not be converted to JSON Schema`, cause);
  }

  const snapshot = snapshotBoundedJsonValue(converted);
  if (
    !snapshot.success ||
    typeof snapshot.value !== "object" ||
    snapshot.value === null ||
    Array.isArray(snapshot.value)
  ) {
    throw invalidConfig(`${label} schema must convert to a bounded JSON object`);
  }
  return freezeJsonValue(snapshot.value as JsonSchema);
}

function captureResponses(value: unknown): OpenAPIRouteMetadata["responses"] {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidConfig("response must be a status-to-schema record");
  }

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw invalidConfig("response must contain only own data properties", cause);
  }
  if (keys.length > MAX_RESPONSES || keys.some((key) => typeof key !== "string")) {
    throw invalidConfig(`response must contain at most ${MAX_RESPONSES} string-keyed entries`);
  }

  const responses: NonNullable<OpenAPIRouteMetadata["responses"]> = {};
  for (const key of keys as string[]) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable) continue;
    if (!("value" in descriptor)) {
      throw invalidConfig(`response.${key} must be an own data property`);
    }

    const status = Number(key);
    if (!Number.isInteger(status) || status < 100 || status > 599 || String(status) !== key) {
      throw invalidConfig(`response status "${key}" must be an integer from 100 through 599`);
    }

    const schemaOrConfig = descriptor.value;
    let responseSchema = schemaOrConfig;
    let description: string | undefined;
    if (typeof schemaOrConfig === "object" && schemaOrConfig !== null) {
      const schemaDescriptor = Reflect.getOwnPropertyDescriptor(schemaOrConfig, "schema");
      if (schemaDescriptor) {
        if (!("value" in schemaDescriptor)) {
          throw invalidConfig(`response.${key}.schema must be an own data property`);
        }
        responseSchema = schemaDescriptor.value;
        description = optionalBoundedText(
          readOwnDataProperty(schemaOrConfig, "description", `response.${key}`),
          `response.${key}.description`,
          MAX_DESCRIPTION_LENGTH,
        );
      }
    }

    responses[key] = freeze({
      description: description ?? getDefaultStatusDescription(status),
      content: freeze({
        "application/json": freeze({
          schema: convertSchema(responseSchema, `response.${key}`),
        }),
      }),
    });
  }
  return freeze(responses);
}

function attachMetadata(
  handler: WrappedHandler,
  metadata: OpenAPIRouteMetadata,
): WrappedHandler {
  let canAttach = false;
  try {
    canAttach = Reflect.getOwnPropertyDescriptor(handler, OPENAPI_METADATA) === undefined &&
      Object.isExtensible(handler);
  } catch {
    canAttach = false;
  }

  const target = canAttach ? handler : function (
    this: unknown,
    ...args: Parameters<WrappedHandler>
  ): ReturnType<WrappedHandler> {
    return apply(handler, this, args) as ReturnType<WrappedHandler>;
  } as WrappedHandler;

  Object.defineProperty(target, OPENAPI_METADATA, {
    configurable: false,
    enumerable: false,
    value: metadata,
    writable: false,
  });
  return target;
}

export function createRoute<
  TParams extends Schema = Schema,
  TQuery extends Schema = Schema,
  TBody extends Schema = Schema,
>(config: OpenAPIRouteConfig<TParams, TQuery, TBody>): WrappedHandler {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw invalidConfig("configuration must be an object");
  }

  const rawHandler = readOwnDataProperty(config, "handler", "configuration");
  if (typeof rawHandler !== "function") {
    throw invalidConfig("handler must be a function");
  }
  const handler = rawHandler as WrappedHandler;
  const summary = optionalBoundedText(
    readOwnDataProperty(config, "summary", "configuration"),
    "summary",
    MAX_SUMMARY_LENGTH,
  );
  const description = optionalBoundedText(
    readOwnDataProperty(config, "description", "configuration"),
    "description",
    MAX_DESCRIPTION_LENGTH,
  );
  const tags = snapshotTags(readOwnDataProperty(config, "tags", "configuration"));
  const deprecated = readOwnDataProperty(config, "deprecated", "configuration");
  if (deprecated !== undefined && typeof deprecated !== "boolean") {
    throw invalidConfig("deprecated must be a boolean");
  }

  const params = readOwnDataProperty(config, "params", "configuration");
  const query = readOwnDataProperty(config, "query", "configuration");
  const body = readOwnDataProperty(config, "body", "configuration");
  const responses = captureResponses(
    readOwnDataProperty(config, "response", "configuration"),
  );
  const metadata: OpenAPIRouteMetadata = {
    ...(summary === undefined ? {} : { summary }),
    ...(description === undefined ? {} : { description }),
    ...(tags === undefined ? {} : { tags }),
    ...(deprecated === undefined ? {} : { deprecated }),
    ...(params === undefined ? {} : { params: convertSchema(params, "params") }),
    ...(query === undefined ? {} : { query: convertSchema(query, "query") }),
    ...(body === undefined ? {} : { body: convertSchema(body, "body") }),
    ...(responses === undefined ? {} : { responses }),
  };

  return attachMetadata(handler, freeze(metadata));
}

export { defineSchema } from "#veryfront/schemas/index.ts";

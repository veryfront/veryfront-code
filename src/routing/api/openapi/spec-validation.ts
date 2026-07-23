import type { OpenAPIOperation, OpenAPISpec } from "./types.ts";

export const MAX_OPENAPI_SPEC_BYTES = 8 * 1024 * 1024;
export const MAX_OPENAPI_DOCUMENT_BYTES = 16 * 1024 * 1024;

const MAX_OPENAPI_DEPTH = 64;
const MAX_OPENAPI_NODES = 250_000;
const MAX_OPENAPI_STRING_BYTES = 1024 * 1024;
const MAX_OPENAPI_OBJECT_KEYS = 10_000;
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const OPERATION_KEYS = new Set([
  "summary",
  "description",
  "tags",
  "operationId",
  "parameters",
  "requestBody",
  "responses",
  "deprecated",
]);
const encoder = new TextEncoder();

function invalidSpec(reason: string): TypeError {
  return new TypeError(`Invalid isolated OpenAPI specification: ${reason}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function dataEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw invalidSpec("object keys are not readable");
  }
  if (keys.length > MAX_OPENAPI_OBJECT_KEYS) throw invalidSpec("an object has too many keys");
  if (keys.some((key) => typeof key !== "string")) {
    throw invalidSpec("symbol properties are not supported");
  }

  return (keys as string[]).map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw invalidSpec("accessor properties are not supported");
    }
    return [key, descriptor.value];
  });
}

function assertRecord(value: unknown, reason: string): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) throw invalidSpec(reason);
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const [key] of dataEntries(value)) {
    if (!allowed.has(key)) throw invalidSpec("an unsupported field is present");
  }
}

function assertString(value: unknown, reason: string, maxBytes = 65_536): asserts value is string {
  if (typeof value !== "string" || encoder.encode(value).byteLength > maxBytes) {
    throw invalidSpec(reason);
  }
}

function assertOptionalString(value: unknown, reason: string): void {
  if (value !== undefined) assertString(value, reason);
}

function assertStringArray(value: unknown, reason: string): void {
  if (!Array.isArray(value) || value.length > MAX_OPENAPI_OBJECT_KEYS) throw invalidSpec(reason);
  for (const item of value) assertString(item, reason);
}

function assertJsonContent(value: unknown, reason: string): void {
  assertRecord(value, reason);
  for (const [mediaType, media] of dataEntries(value)) {
    if (mediaType !== "application/json") throw invalidSpec("response media type is unsupported");
    assertRecord(media, reason);
    assertAllowedKeys(media, new Set(["schema"]));
    assertRecord(media.schema, "media schema must be an object");
  }
}

function assertOperation(value: unknown): asserts value is OpenAPIOperation {
  assertRecord(value, "an operation must be an object");
  assertAllowedKeys(value, OPERATION_KEYS);
  assertOptionalString(value.summary, "operation summary must be a bounded string");
  assertOptionalString(value.description, "operation description must be a bounded string");
  assertOptionalString(value.operationId, "operation ID must be a bounded string");
  if (value.tags !== undefined) assertStringArray(value.tags, "operation tags must be strings");
  if (value.deprecated !== undefined && typeof value.deprecated !== "boolean") {
    throw invalidSpec("operation deprecated must be a boolean");
  }

  assertRecord(value.responses, "operation responses must be an object");
  const responses = dataEntries(value.responses);
  if (responses.length === 0) throw invalidSpec("an operation must define a response");
  for (const [status, response] of responses) {
    if (status !== "default" && !/^[1-5][0-9]{2}$/.test(status)) {
      throw invalidSpec("response status keys must be HTTP status codes");
    }
    assertRecord(response, "a response must be an object");
    assertAllowedKeys(response, new Set(["description", "content"]));
    assertString(response.description, "response description must be a bounded string");
    if (response.content !== undefined) {
      assertJsonContent(response.content, "response content must be an object");
    }
  }

  if (value.parameters !== undefined) {
    if (!Array.isArray(value.parameters) || value.parameters.length > MAX_OPENAPI_OBJECT_KEYS) {
      throw invalidSpec("operation parameters must be a bounded array");
    }
    for (const parameter of value.parameters) {
      assertRecord(parameter, "a parameter must be an object");
      assertAllowedKeys(
        parameter,
        new Set(["name", "in", "required", "description", "schema"]),
      );
      assertString(parameter.name, "parameter name must be a bounded string");
      if (
        typeof parameter.in !== "string" ||
        !["path", "query", "header", "cookie"].includes(parameter.in)
      ) {
        throw invalidSpec("parameter location is invalid");
      }
      if (parameter.required !== undefined && typeof parameter.required !== "boolean") {
        throw invalidSpec("parameter required must be a boolean");
      }
      assertOptionalString(parameter.description, "parameter description must be a string");
      assertRecord(parameter.schema, "parameter schema must be an object");
    }
  }

  if (value.requestBody !== undefined) {
    assertRecord(value.requestBody, "request body must be an object");
    assertAllowedKeys(value.requestBody, new Set(["required", "description", "content"]));
    if (
      value.requestBody.required !== undefined &&
      typeof value.requestBody.required !== "boolean"
    ) {
      throw invalidSpec("request body required must be a boolean");
    }
    assertOptionalString(
      value.requestBody.description,
      "request body description must be a string",
    );
    assertJsonContent(value.requestBody.content, "request body content must be an object");
  }
}

function assertJsonTree(value: unknown): void {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number; arrayItem: boolean }> = [
    { value, depth: 0, arrayItem: false },
  ];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (++nodes > MAX_OPENAPI_NODES) throw invalidSpec("document is too complex");
    if (current.depth > MAX_OPENAPI_DEPTH) throw invalidSpec("document is nested too deeply");

    if (current.value === undefined && !current.arrayItem) continue;
    if (
      current.value === null || typeof current.value === "boolean" ||
      typeof current.value === "string"
    ) {
      if (
        typeof current.value === "string" &&
        encoder.encode(current.value).byteLength > MAX_OPENAPI_STRING_BYTES
      ) {
        throw invalidSpec("a string exceeds the size limit");
      }
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) throw invalidSpec("numbers must be finite");
      continue;
    }
    if (typeof current.value !== "object") throw invalidSpec("document must contain JSON values");
    // Shared schema objects are valid JSON once serialized. Traverse each
    // identity once; JSON.stringify below still rejects an actual cycle.
    if (seen.has(current.value)) continue;
    seen.add(current.value);

    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_OPENAPI_OBJECT_KEYS) {
        throw invalidSpec("an array has too many items");
      }
      for (const item of current.value) {
        stack.push({ value: item, depth: current.depth + 1, arrayItem: true });
      }
      continue;
    }

    assertRecord(current.value, "document contains a non-plain object");
    for (const [key, child] of dataEntries(current.value)) {
      if (encoder.encode(key).byteLength > MAX_OPENAPI_STRING_BYTES) {
        throw invalidSpec("an object key exceeds the size limit");
      }
      stack.push({ value: child, depth: current.depth + 1, arrayItem: false });
    }
  }
}

/** Validate and bound an OpenAPI document received across the Worker boundary. */
export function validateOpenAPISpec(value: unknown): OpenAPISpec {
  assertRecord(value, "document must be an object");
  assertAllowedKeys(value, new Set(["openapi", "info", "paths", "tags", "servers"]));
  if (value.openapi !== "3.1.0") throw invalidSpec("openapi must be 3.1.0");

  assertRecord(value.info, "info must be an object");
  assertAllowedKeys(value.info, new Set(["title", "version", "description"]));
  assertString(value.info.title, "info title must be a bounded string");
  assertString(value.info.version, "info version must be a bounded string");
  assertOptionalString(value.info.description, "info description must be a bounded string");

  assertRecord(value.paths, "paths must be an object");
  for (const [path, pathItem] of dataEntries(value.paths)) {
    if (!path.startsWith("/") || encoder.encode(path).byteLength > 8_192) {
      throw invalidSpec("path keys must be bounded absolute paths");
    }
    assertRecord(pathItem, "path items must be objects");
    for (const [method, operation] of dataEntries(pathItem)) {
      if (!HTTP_METHODS.has(method)) throw invalidSpec("path item method is unsupported");
      assertOperation(operation);
    }
  }

  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > MAX_OPENAPI_OBJECT_KEYS) {
      throw invalidSpec("tags must be a bounded array");
    }
    for (const tag of value.tags) {
      assertRecord(tag, "tags must be objects");
      assertAllowedKeys(tag, new Set(["name", "description"]));
      assertString(tag.name, "tag name must be a bounded string");
      assertOptionalString(tag.description, "tag description must be a bounded string");
    }
  }

  if (value.servers !== undefined) {
    if (!Array.isArray(value.servers) || value.servers.length > 100) {
      throw invalidSpec("servers must be a bounded array");
    }
    for (const server of value.servers) {
      assertRecord(server, "servers must be objects");
      assertAllowedKeys(server, new Set(["url", "description"]));
      assertString(server.url, "server URL must be a bounded string", 8_192);
      assertOptionalString(server.description, "server description must be a bounded string");
      let parsed: URL;
      try {
        parsed = new URL(server.url);
      } catch {
        throw invalidSpec("server URL must be absolute");
      }
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
        throw invalidSpec("server URL is not allowed");
      }
    }
  }

  assertJsonTree(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalidSpec("document is not serializable");
  }
  if (encoder.encode(serialized).byteLength > MAX_OPENAPI_SPEC_BYTES) {
    throw invalidSpec("document exceeds the size limit");
  }

  return value as unknown as OpenAPISpec;
}

export function assertOpenAPIDocumentSize(document: string): void {
  if (encoder.encode(document).byteLength > MAX_OPENAPI_DOCUMENT_BYTES) {
    throw new RangeError("OpenAPI response exceeds the document size limit");
  }
}

import { CANONICAL_V1_MAX_MEMBER_BYTES, CANONICAL_V1_MAX_STRING_BYTES } from "./limits.ts";
import { isCloudEventsString, isTraceState } from "../string-validation.ts";
import type {
  JsonSchema,
  JsonSchemaValidationFunction,
} from "#veryfront/extensions/schema/index.ts";
import { assertEventSchemaValidator, getEventSchemaValidatorVersion } from "../schema-validator.ts";
import core from "./resources/envelope.schema.json" with { type: "json" };
import stored from "./resources/stored-envelope.schema.json" with { type: "json" };
import live from "./resources/live-envelope.schema.json" with { type: "json" };
import descendants from "./resources/descendant-read-contracts.schema.json" with { type: "json" };
import reads from "./resources/read-contracts.schema.json" with { type: "json" };
import publicPayloads from "./resources/public-payload-schemas.json" with { type: "json" };
import controls from "./resources/control-payload-schemas.json" with { type: "json" };
import resources from "./resources/schema-resources.json" with { type: "json" };
import { validatePayloadSemantics } from "./resources/payload-semantics.mjs";
import { validateSourceSemantics } from "./source-semantics.ts";
import type {
  CanonicalEventV1,
  DescendantCursorV1,
  DescendantRunReadPageV1,
  EventDiscoveryV1,
  RunReadMemberV1,
  RunReadPageV1,
  StreamMemberV1,
} from "./types.ts";

const documents: Record<string, Record<string, unknown>> = {};
for (
  const document of [
    core,
    stored,
    live,
    reads,
    descendants,
    publicPayloads,
    controls,
    ...Object.values(resources.resources),
  ]
) {
  documents[document.$id] = document;
}
const keys = Object.keys(documents);
function normalizeProperty(key: string, child: unknown, documentId: string): unknown {
  if (key === "$ref" && typeof child === "string") {
    const [id, fragment = ""] = child.split("#");
    const index = keys.indexOf(id || documentId);
    if (index < 0) throw new TypeError("Unknown canonical-v1 schema resource");
    return `#/$defs/resource${index}${fragment}`;
  }
  return normalize(child, documentId);
}
function inferSchemaTypes(result: Record<string, unknown>): void {
  if (
    result.type === undefined &&
    (result.properties !== undefined || result.required !== undefined ||
      result.additionalProperties !== undefined || result.propertyNames !== undefined)
  ) result.type = "object";
  if (
    result.type === undefined &&
    (result.pattern !== undefined || result.minLength !== undefined ||
      result.maxLength !== undefined || result.format !== undefined)
  ) result.type = "string";
  if (result.type === undefined && (result.minimum !== undefined || result.maximum !== undefined)) {
    result.type = "number";
  }
  if (
    result.type === undefined &&
    (result.items !== undefined || result.minItems !== undefined || result.maxItems !== undefined)
  ) result.type = "array";
}
function materializeRequiredProperties(result: Record<string, unknown>): void {
  if (Array.isArray(result.required)) {
    const properties = result.properties && typeof result.properties === "object"
      ? result.properties
      : {};
    for (const key of result.required) {
      if (typeof key === "string" && !(key in properties)) {
        Object.assign(properties, { [key]: {} });
      }
    }
    result.properties = properties;
  }
}
function normalize(value: unknown, documentId: string): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item, documentId));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$id" || key === "$schema" || key.startsWith("x-")) continue;
    if (key === "format" && (child === "ce-string" || child === "w3c-tracestate")) continue;
    result[key] = normalizeProperty(key, child, documentId);
  }
  inferSchemaTypes(result);
  materializeRequiredProperties(result);
  return result;
}
const normalizedDefinitions = Object.fromEntries(
  keys.map((key, index) => [`resource${index}`, normalize(documents[key], key)]),
);
let validatorVersion = -1;
const compiledValidators = new Map<string, JsonSchemaValidationFunction<unknown>>();
const sourceValidators = new Map<Record<string, unknown>, JsonSchemaValidationFunction<unknown>>();
function definitionsForRead(definition: string, documentId: string): typeof normalizedDefinitions {
  if (definition !== "page" || documentId !== descendants.$id) return normalizedDefinitions;
  const definitions = structuredClone(normalizedDefinitions);
  // Members are validated individually; continuation identity enforces nonempty pages.
  const resource = definitions[`resource${keys.indexOf(descendants.$id)}`];
  if (!resource || typeof resource !== "object" || !("$defs" in resource)) return definitions;
  const resourceDefinitions = resource.$defs;
  if (
    !resourceDefinitions || typeof resourceDefinitions !== "object" ||
    !("page" in resourceDefinitions)
  ) return definitions;
  const page = resourceDefinitions.page;
  if (page && typeof page === "object" && "allOf" in page) delete page.allOf;
  return definitions;
}

async function decode<T>(input: unknown, definition: string, documentId = reads.$id): Promise<T> {
  const adapter = assertEventSchemaValidator();
  const version = getEventSchemaValidatorVersion();
  if (validatorVersion !== version) {
    compiledValidators.clear();
    sourceValidators.clear();
    validatorVersion = version;
  }
  const canonical = input !== null && typeof input === "object" &&
    Object.getOwnPropertyDescriptor(input, "kind")?.value === "canonical";
  const cacheKey = `${documentId}:${definition}:${canonical ? "canonical" : "default"}`;
  let validate = compiledValidators.get(cacheKey);
  if (!validate) {
    const compiler = adapter.compileJsonSchema;
    if (!compiler) throw new TypeError("canonical-v1 needs compileJsonSchema support");
    const definitions = definitionsForRead(definition, documentId);
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $ref: `#/$defs/resource${keys.indexOf(documentId)}/$defs/${definition}`,
      $defs: definitions,
    } as JsonSchema;
    validate = compiler(
      schema,
      canonical
        ? {
          instanceLimits: {
            maxSerializedBytes: CANONICAL_V1_MAX_MEMBER_BYTES,
            maxStringBytes: CANONICAL_V1_MAX_STRING_BYTES,
          },
        }
        : undefined,
    );
    compiledValidators.set(cacheKey, validate);
  }
  const result = await validate(input);
  if (!result.success) throw new TypeError("Invalid canonical-v1 read value");
  // The compiled normative schema validates T at this external boundary.
  return result.value as T;
}
async function matchesSourceSchema(
  input: unknown,
  schema: Record<string, unknown>,
  documentId: string,
): Promise<boolean> {
  let validate = sourceValidators.get(schema);
  if (!validate) {
    const compiler = assertEventSchemaValidator().compileJsonSchema;
    if (!compiler) throw new TypeError("canonical-v1 needs compileJsonSchema support");
    validate = compiler({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      allOf: [normalize(schema, documentId)],
      $defs: normalizedDefinitions,
    } as JsonSchema, {
      instanceLimits: {
        maxSerializedBytes: CANONICAL_V1_MAX_MEMBER_BYTES,
        maxStringBytes: CANONICAL_V1_MAX_STRING_BYTES,
      },
    });
    sourceValidators.set(schema, validate);
  }
  return (await validate(input)).success;
}
function safeCursor(value: string): void {
  if (!/^[1-9]\d*$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError("Invalid canonical-v1 durable cursor");
  }
}
function hasProducingSource(event: CanonicalEventV1, live: boolean): boolean {
  const source = new URL(event.source);
  const rawPath = /^https:\/\/[^/]+(\/[^?#]*)$/.exec(event.source)?.[1];
  if (
    source.protocol !== "https:" || source.username || source.password ||
    source.search || source.hash || rawPath !== source.pathname ||
    event.source.includes("\\")
  ) return false;
  const ownerPath = `/runs/${encodeURIComponent(event.runid ?? "")}`;
  const marker = live ? `${ownerPath}/streams/` : ownerPath;
  const ownerStart = source.pathname.lastIndexOf(marker);
  if (ownerStart < 0) return false;
  const tail = source.pathname.slice(ownerStart + marker.length);
  if (live ? !tail || tail.includes("/") : tail !== "") return false;
  // The physical-store base is opaque identity, but it must not contain URL
  // normalization aliases or encoded separators that obscure its boundaries.
  const base = source.pathname.slice(0, ownerStart);
  try {
    return (base === "" || base.slice(1).split("/").every((part) => {
      const decoded = decodeURIComponent(part);
      const hasControl = Array.from(decoded).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      });
      return decoded !== "" && !hasControl && decoded !== "." &&
        decoded !== ".." &&
        !decoded.includes("/") && !decoded.includes("\\") &&
        encodeURIComponent(decoded) === part;
    })) && (!live || encodeURIComponent(decodeURIComponent(tail)) === tail);
  } catch {
    return false;
  }
}
async function envelope(event: CanonicalEventV1, view: string, live = false): Promise<void> {
  for (const [key, value] of Object.entries(event)) {
    if (key === "tracestate") continue;
    if (typeof value === "string" && !isCloudEventsString(value)) {
      throw new TypeError("Invalid CloudEvents String");
    }
  }
  if (event.runid !== event.subject) throw new TypeError("canonical-v1 producing owner mismatch");
  if (event.data.type !== event.type || !event.dataschema.endsWith(`:${view}`)) {
    throw new TypeError("canonical-v1 type or schema/view mismatch");
  }
  if (
    event.tracestate !== undefined &&
    (typeof event.tracestate !== "string" || !isTraceState(event.tracestate))
  ) throw new TypeError("Invalid W3C tracestate");
  if (!hasProducingSource(event, live)) {
    throw new TypeError("Invalid canonical-v1 producing source");
  }
  const payloadSchema = documents[event.dataschema];
  if (!payloadSchema) throw new TypeError("Unknown canonical-v1 payload schema");
  await validateSourceSemantics(
    event.data,
    payloadSchema,
    event.dataschema,
    documents,
    matchesSourceSchema,
  );
  if (validatePayloadSemantics(event).length) {
    throw new TypeError("Invalid canonical-v1 payload semantics");
  }
}
async function member(value: RunReadMemberV1 | StreamMemberV1): Promise<void> {
  if (value.kind === "transient") {
    await envelope(value.event, value.view, true);
    return;
  }
  if (!Number.isSafeInteger(value.metadata.event_id)) throw new TypeError("Unsafe event ID");
  if (
    value.kind === "legacy" &&
    (value.metadata.storage === "derived") !== (value.reason === "derived_history")
  ) throw new TypeError("Derived history must preserve its legacy disposition");
  if (value.kind === "canonical") {
    const { event, metadata } = value;
    safeCursor(event.id);
    if (
      String(metadata.event_id) !== event.id || metadata.run_id !== event.subject ||
      metadata.run_id !== event.runid || metadata.recorded_at !== event.recordedat
    ) {
      throw new TypeError("canonical-v1 metadata identity mismatch");
    }
    await envelope(event, metadata.view);
  }
}
export async function parseRunReadMemberV1(input: unknown): Promise<RunReadMemberV1> {
  const value = await decode<RunReadMemberV1>(input, "member");
  await member(value);
  return value;
}
export async function parseStreamMemberV1(input: unknown): Promise<StreamMemberV1> {
  const value = await decode<StreamMemberV1>(input, "streamMember");
  await member(value);
  return value;
}
function pageParts(input: unknown): { header: unknown; entries: unknown[] } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid canonical-v1 read page");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const descriptor = descriptors.entries;
  if (!descriptor || !Object.hasOwn(descriptor, "value") || !Array.isArray(descriptor.value)) {
    throw new TypeError("Invalid canonical-v1 page entries");
  }
  const rawEntries: unknown[] = descriptor.value;
  const length = Object.getOwnPropertyDescriptor(rawEntries, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 100) {
    throw new TypeError("Invalid canonical-v1 page entry count");
  }
  const entries: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const entry = Object.getOwnPropertyDescriptor(rawEntries, String(index));
    if (!entry || !Object.hasOwn(entry, "value")) {
      throw new TypeError("Invalid canonical-v1 page entry");
    }
    entries.push(entry.value);
  }
  // Preserve all page fields and descriptors so the normative schema still rejects
  // unknown fields and accessors, while its per-value budget excludes member bodies.
  const header = Object.create(Object.getPrototypeOf(input), {
    ...descriptors,
    entries: { ...descriptor, value: [] },
  });
  return { header, entries };
}

export async function parseRunReadPageV1(input: unknown): Promise<RunReadPageV1> {
  const parts = pageParts(input);
  const value = await decode<RunReadPageV1>(parts.header, "page");
  for (const entry of parts.entries) value.entries.push(await parseRunReadMemberV1(entry));
  if (value.has_more !== (value.next_cursor !== null)) {
    throw new TypeError("Invalid canonical-v1 page continuation");
  }
  if (value.next_cursor !== null) {
    safeCursor(value.next_cursor);
    if (String(value.entries.at(-1)?.metadata.event_id) !== value.next_cursor) {
      throw new TypeError("canonical-v1 cursor must identify the last returned entry");
    }
  }
  return value;
}
export async function parseEventDiscoveryV1(input: unknown): Promise<EventDiscoveryV1> {
  const value = await decode<EventDiscoveryV1>(input, "discovery");
  for (const event of value.events) {
    if (!isCloudEventsString(event.type) || !isCloudEventsString(event.meaning)) {
      throw new TypeError("Invalid canonical-v1 discovery String");
    }
  }
  return value;
}

export async function parseEventErrorV1(
  input: unknown,
): Promise<{ code: string; message: string; event_ids?: number[] }> {
  const value = await decode<{ code: string; message: string; event_ids?: number[] }>(
    input,
    "error",
  );
  if (!isCloudEventsString(value.code) || !isCloudEventsString(value.message)) {
    throw new TypeError("Invalid canonical-v1 error String");
  }
  return value;
}

/** Decode the bounded canonical transport token; API authorization binds its scope. */
export async function decodeDescendantCursorV1(token: string): Promise<DescendantCursorV1> {
  if (token.length > 2048 || !/^vfd1\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new TypeError("Invalid descendant cursor encoding");
  }
  const encoded = token.slice(5);
  const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (c) => c.charCodeAt(0)),
  );
  const value = await decode<DescendantCursorV1>(
    JSON.parse(text),
    "cursorPayload",
    descendants.$id,
  );
  safeCursor(value.event_id);
  const canonical = {
    version: value.version,
    root_run_id: value.root_run_id,
    producing_run_id: value.producing_run_id,
    view: value.view,
    sort_order: value.sort_order,
    filters_digest: value.filters_digest,
    event_id: value.event_id,
    store: value.store,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const result = "vfd1." +
    btoa(Array.from(bytes, (b) => String.fromCodePoint(b)).join("")).replaceAll("+", "-")
      .replaceAll(
        "/",
        "_",
      ).replace(/=+$/, "");
  if (result !== token) throw new TypeError("Noncanonical descendant cursor encoding");
  return value;
}
export async function parseDescendantRunReadPageV1(
  input: unknown,
): Promise<DescendantRunReadPageV1> {
  const parts = pageParts(input);
  const value = await decode<DescendantRunReadPageV1>(parts.header, "page", descendants.$id);
  for (const entry of parts.entries) value.entries.push(await parseRunReadMemberV1(entry));
  if (value.has_more !== (value.next_cursor !== null)) {
    throw new TypeError("Invalid descendant page continuation");
  }
  if (value.next_cursor !== null) {
    const position = await decodeDescendantCursorV1(value.next_cursor);
    const last = value.entries.at(-1)?.metadata;
    if (
      !last || position.event_id !== String(last.event_id) ||
      position.producing_run_id !== last.run_id || position.view !== last.view
    ) throw new TypeError("Descendant cursor must identify the last returned entry");
  }
  return value;
}

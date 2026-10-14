import { isCloudEventsString, isTraceState } from "../string-validation.ts";
import type {
  JsonSchema,
  JsonSchemaValidationFunction,
} from "#veryfront/extensions/schema/index.ts";
import { assertEventSchemaValidator, getEventSchemaValidatorVersion } from "../schema-validator.ts";
import core from "./resources/envelope.schema.json" with { type: "json" };
import stored from "./resources/stored-envelope.schema.json" with { type: "json" };
import live from "./resources/live-envelope.schema.json" with { type: "json" };
import reads from "./resources/read-contracts.schema.json" with { type: "json" };
import publicPayloads from "./resources/public-payload-schemas.json" with { type: "json" };
import controls from "./resources/control-payload-schemas.json" with { type: "json" };
import resources from "./resources/schema-resources.json" with { type: "json" };
import { validatePayloadSemantics } from "./resources/payload-semantics.mjs";
import type {
  CanonicalEventV1,
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
  if (result.type === undefined && result.items !== undefined) result.type = "array";
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
async function decode<T>(input: unknown, definition: string): Promise<T> {
  const adapter = assertEventSchemaValidator();
  const version = getEventSchemaValidatorVersion();
  if (validatorVersion !== version) {
    compiledValidators.clear();
    validatorVersion = version;
  }
  let validate = compiledValidators.get(definition);
  if (!validate) {
    const compiler = adapter.compileJsonSchema;
    if (!compiler) throw new TypeError("canonical-v1 needs compileJsonSchema support");
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $ref: `#/$defs/resource${keys.indexOf(reads.$id)}/$defs/${definition}`,
      $defs: normalizedDefinitions,
    } as JsonSchema;
    validate = compiler(schema);
    compiledValidators.set(definition, validate);
  }
  const result = await validate(input);
  if (!result.success) throw new TypeError("Invalid canonical-v1 read value");
  // The compiled normative schema validates T at this external boundary.
  return result.value as T;
}
function safeCursor(value: string): void {
  if (!/^[1-9][0-9]*$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError("Invalid canonical-v1 durable cursor");
  }
}
function envelope(event: CanonicalEventV1, view: string, live = false): void {
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
  const source = new URL(event.source);
  if (
    source.protocol !== "https:" || source.search || source.hash || source.username ||
    source.password ||
    (live
      ? !source.pathname.startsWith(`/runs/${encodeURIComponent(event.runid ?? "")}/streams/`)
      : source.pathname !== `/runs/${encodeURIComponent(event.runid ?? "")}`)
  ) {
    throw new TypeError("Invalid canonical-v1 producing source");
  }
  if (validatePayloadSemantics(event).length) {
    throw new TypeError("Invalid canonical-v1 payload semantics");
  }
}
function member(value: RunReadMemberV1 | StreamMemberV1): void {
  if (value.kind === "transient") {
    envelope(value.event, value.view, true);
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
    envelope(event, metadata.view);
  }
}
export async function parseRunReadMemberV1(input: unknown): Promise<RunReadMemberV1> {
  const value = await decode<RunReadMemberV1>(input, "member");
  member(value);
  return value;
}
export async function parseStreamMemberV1(input: unknown): Promise<StreamMemberV1> {
  const value = await decode<StreamMemberV1>(input, "streamMember");
  member(value);
  return value;
}
export async function parseRunReadPageV1(input: unknown): Promise<RunReadPageV1> {
  const value = await decode<RunReadPageV1>(input, "page");
  value.entries.forEach(member);
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

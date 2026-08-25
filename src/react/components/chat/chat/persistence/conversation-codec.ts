/**
 * Bounded, versioned serialization for local conversation persistence.
 *
 * The codec is deliberately stricter than `JSON.stringify`: values that JSON
 * would silently omit or coerce are rejected, accessors and custom `toJSON`
 * hooks are never invoked, and the resulting snapshot is detached from the
 * caller before it reaches storage.
 *
 * @module react/components/chat/persistence/conversation-codec
 */
import type { Conversation, ConversationSummary } from "./conversation-store.ts";

/** Stable marker for persisted conversation envelopes and storage keys. */
export const CONVERSATION_STORAGE_FORMAT = "veryfront.conversation-store";

/** Current persisted envelope and key-layout version. */
export const CONVERSATION_STORAGE_VERSION = 1;

/** Named shape of the local conversation codec's public resource limits. */
export interface ConversationStorageLimits {
  /** Maximum UTF-8 bytes in one serialized index: 2 MiB. */
  readonly maxIndexBytes: number;
  /** Maximum UTF-8 bytes in one serialized conversation: 4 MiB. */
  readonly maxConversationBytes: number;
  /** Maximum summaries in one store: 1,000. */
  readonly maxConversations: number;
  /** Maximum messages in one conversation: 1,000. */
  readonly maxMessagesPerConversation: number;
  /** Maximum parts in one message: 1,000. */
  readonly maxPartsPerMessage: number;
  /** Maximum nested JSON container depth: 64. */
  readonly maxJsonDepth: number;
  /** Maximum nodes in one JSON value: 65,536. */
  readonly maxJsonNodes: number;
  /** Maximum own entries in one object or array: 10,000. */
  readonly maxContainerEntries: number;
  /** Maximum UTF-8 bytes in one JSON string: 4 MiB. */
  readonly maxJsonStringBytes: number;
  /** Maximum UTF-8 bytes in a storage-key tuple component: 1 KiB. */
  readonly maxStorageKeyComponentBytes: number;
  /** Maximum UTF-8 bytes in an identifier: 1 KiB. */
  readonly maxIdentifierBytes: number;
  /** Maximum UTF-8 bytes in a title: 16 KiB. */
  readonly maxTitleBytes: number;
}

/** Explicit resource limits applied on both the read and write paths. */
export const CONVERSATION_STORAGE_LIMITS = Object.freeze(
  {
    maxIndexBytes: 2 * 1024 * 1024,
    maxConversationBytes: 4 * 1024 * 1024,
    maxConversations: 1_000,
    maxMessagesPerConversation: 1_000,
    maxPartsPerMessage: 1_000,
    maxJsonDepth: 64,
    maxJsonNodes: 65_536,
    maxContainerEntries: 10_000,
    // A valid 2 MiB inline attachment expands to roughly 2.67 MiB as a data URL.
    maxJsonStringBytes: 4 * 1024 * 1024,
    maxStorageKeyComponentBytes: 1_024,
    maxIdentifierBytes: 1_024,
    maxTitleBytes: 16 * 1024,
  } satisfies ConversationStorageLimits,
);

const ENVELOPE_NODE_ALLOWANCE = 16;
const ArrayIsArray = Array.isArray;
const JSONStringify = JSON.stringify;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ObjectPrototype = Object.prototype;
const ReflectOwnKeys = Reflect.ownKeys;
const UTF8_ENCODER = new TextEncoder();

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | JsonRecord;
interface JsonRecord {
  [key: string]: JsonValue;
}

interface SnapshotState {
  readonly ancestors: WeakSet<object>;
  readonly maxBytes: number;
  nodes: number;
  estimatedBytes: number;
}

interface StoredEnvelope {
  readonly format: typeof CONVERSATION_STORAGE_FORMAT;
  readonly version: typeof CONVERSATION_STORAGE_VERSION;
  readonly kind: "index" | "conversation";
  readonly value: JsonValue;
}

export interface EncodedConversationRecord {
  readonly serialized: string;
  readonly value: Conversation;
}

export interface EncodedConversationIndex {
  readonly serialized: string;
  readonly value: ConversationSummary[];
}

export interface DecodedConversationRecord {
  readonly value: Conversation;
  readonly legacy: boolean;
}

export interface DecodedConversationIndex {
  readonly value: ConversationSummary[];
  readonly legacy: boolean;
}

function fail(path: string, reason: string): never {
  throw new TypeError(`Invalid stored conversation value at ${path}: ${reason}`);
}

function childPath(path: string, key: string): string {
  return `${path}[${JSONStringify(key)}]`;
}

function byteLength(value: string, limit: number, label: string): number {
  if (value.length > limit) {
    throw new TypeError(`${label} exceeds ${limit} bytes`);
  }
  const bytes = UTF8_ENCODER.encode(value).byteLength;
  if (bytes > limit) {
    throw new TypeError(`${label} exceeds ${limit} bytes`);
  }
  return bytes;
}

function jsonStringByteLength(value: string, limit: number, path: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      bytes += 2;
    } else if (
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (trailing >= 0xdc00 && trailing <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }

    if (bytes > limit) {
      return fail(path, `serialized string exceeds ${limit} bytes`);
    }
  }
  return bytes;
}

function reserveBytes(state: SnapshotState, bytes: number, path: string): void {
  if (bytes > state.maxBytes - state.estimatedBytes) {
    fail(path, `serialized payload exceeds ${state.maxBytes} bytes`);
  }
  state.estimatedBytes += bytes;
}

function addNode(state: SnapshotState, path: string): void {
  state.nodes += 1;
  if (state.nodes > CONVERSATION_STORAGE_LIMITS.maxJsonNodes) {
    fail(path, `JSON node count exceeds ${CONVERSATION_STORAGE_LIMITS.maxJsonNodes}`);
  }
}

function inspectPrototype(value: object, path: string): object | null {
  try {
    return ObjectGetPrototypeOf(value);
  } catch {
    return fail(path, "prototype inspection failed");
  }
}

function inspectKeys(value: object, path: string): PropertyKey[] {
  try {
    return ReflectOwnKeys(value);
  } catch {
    return fail(path, "property-key inspection failed");
  }
}

function inspectDescriptor(value: object, key: PropertyKey, path: string): PropertyDescriptor {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ObjectGetOwnPropertyDescriptor(value, key);
  } catch {
    return fail(path, "property descriptor inspection failed");
  }
  if (descriptor === undefined) {
    return fail(path, "property changed during inspection");
  }
  return descriptor;
}

function descriptorValue(descriptor: PropertyDescriptor, path: string): unknown {
  if (!ObjectHasOwn(descriptor, "value")) {
    return fail(path, "accessor properties are not persistable");
  }
  if (!descriptor.enumerable) {
    return fail(path, "non-enumerable properties are not persistable");
  }
  return descriptor.value;
}

function defineDataProperty(
  target: JsonValue[] | JsonRecord,
  key: PropertyKey,
  value: JsonValue,
): void {
  const descriptor = ObjectCreate(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = true;
  descriptor.value = value;
  descriptor.writable = true;
  ObjectDefineProperty(target, key, descriptor);
}

function defineJsonProperty(target: JsonRecord, key: string, value: JsonValue): void {
  defineDataProperty(target, key, value);
}

function isMessageCreatedAtPath(path: readonly (string | number)[]): boolean {
  return path.length === 3 &&
    path[0] === "messages" &&
    typeof path[1] === "number" &&
    path[2] === "createdAt";
}

function snapshotDate(
  value: object,
  displayPath: string,
  path: readonly (string | number)[],
  state: SnapshotState,
): string {
  if (!isMessageCreatedAtPath(path)) {
    return fail(displayPath, "Date values are only supported for message createdAt");
  }
  if (inspectKeys(value, displayPath).length !== 0) {
    return fail(displayPath, "Date values with custom properties are not persistable");
  }

  let timestamp: number;
  try {
    timestamp = Date.prototype.getTime.call(value);
  } catch {
    return fail(displayPath, "Date value is invalid");
  }
  if (!Number.isFinite(timestamp)) {
    return fail(displayPath, "Date value is invalid");
  }

  const normalized = Date.prototype.toISOString.call(value);
  const bytes = jsonStringByteLength(
    normalized,
    CONVERSATION_STORAGE_LIMITS.maxJsonStringBytes,
    displayPath,
  );
  reserveBytes(state, bytes, displayPath);
  return normalized;
}

function snapshotArray(
  value: unknown[],
  displayPath: string,
  path: readonly (string | number)[],
  depth: number,
  state: SnapshotState,
): JsonValue[] {
  if (inspectPrototype(value, displayPath) !== Array.prototype) {
    return fail(displayPath, "array subclasses are not persistable");
  }

  const lengthDescriptor = inspectDescriptor(value, "length", displayPath);
  const length = lengthDescriptor.value;
  if (
    !ObjectHasOwn(lengthDescriptor, "value") ||
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0
  ) {
    return fail(displayPath, "array length is invalid");
  }
  if (length > CONVERSATION_STORAGE_LIMITS.maxContainerEntries) {
    return fail(
      displayPath,
      `array length exceeds ${CONVERSATION_STORAGE_LIMITS.maxContainerEntries}`,
    );
  }

  const keys = inspectKeys(value, displayPath);
  if (keys.length !== length + 1) {
    return fail(displayPath, "arrays must be dense and cannot have extra properties");
  }
  for (const key of keys) {
    if (typeof key !== "string") {
      return fail(displayPath, "symbol properties are not persistable");
    }
    if (key === "length") continue;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length || `${index}` !== key) {
      return fail(displayPath, "arrays must be dense and cannot have extra properties");
    }
  }

  reserveBytes(state, 2 + Math.max(0, length - 1), displayPath);
  const output = new Array<JsonValue>(length);
  for (let index = 0; index < length; index += 1) {
    const itemPath = `${displayPath}[${index}]`;
    const descriptor = inspectDescriptor(value, `${index}`, itemPath);
    const item = snapshotJsonValue(
      descriptorValue(descriptor, itemPath),
      itemPath,
      [...path, index],
      depth + 1,
      state,
    );
    defineDataProperty(output, index, item);
  }
  return output;
}

function snapshotRecord(
  value: object,
  displayPath: string,
  path: readonly (string | number)[],
  depth: number,
  state: SnapshotState,
): JsonRecord {
  const prototype = inspectPrototype(value, displayPath);
  if (prototype !== ObjectPrototype && prototype !== null) {
    return fail(displayPath, "only plain or null-prototype records are persistable");
  }

  const ownKeys = inspectKeys(value, displayPath);
  if (ownKeys.length > CONVERSATION_STORAGE_LIMITS.maxContainerEntries) {
    return fail(
      displayPath,
      `object key count exceeds ${CONVERSATION_STORAGE_LIMITS.maxContainerEntries}`,
    );
  }

  reserveBytes(state, 2 + Math.max(0, ownKeys.length - 1) + ownKeys.length, displayPath);
  const output = ObjectCreate(null) as JsonRecord;
  for (const propertyKey of ownKeys) {
    if (typeof propertyKey !== "string") {
      return fail(displayPath, "symbol properties are not persistable");
    }

    const propertyPath = childPath(displayPath, propertyKey);
    addNode(state, propertyPath);
    const keyBytes = jsonStringByteLength(
      propertyKey,
      CONVERSATION_STORAGE_LIMITS.maxJsonStringBytes,
      propertyPath,
    );
    reserveBytes(state, keyBytes, propertyPath);
    const descriptor = inspectDescriptor(value, propertyKey, propertyPath);
    const child = snapshotJsonValue(
      descriptorValue(descriptor, propertyPath),
      propertyPath,
      [...path, propertyKey],
      depth + 1,
      state,
    );
    defineJsonProperty(output, propertyKey, child);
  }
  return output;
}

function snapshotJsonValue(
  value: unknown,
  displayPath: string,
  path: readonly (string | number)[],
  depth: number,
  state: SnapshotState,
): JsonValue {
  if (depth > CONVERSATION_STORAGE_LIMITS.maxJsonDepth) {
    return fail(
      displayPath,
      `JSON nesting depth exceeds ${CONVERSATION_STORAGE_LIMITS.maxJsonDepth}`,
    );
  }
  addNode(state, displayPath);

  if (value === null) {
    reserveBytes(state, 4, displayPath);
    return null;
  }

  switch (typeof value) {
    case "boolean":
      reserveBytes(state, value ? 4 : 5, displayPath);
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        return fail(displayPath, "numbers must be finite");
      }
      if (Object.is(value, -0)) {
        return fail(displayPath, "negative zero is not represented losslessly by JSON");
      }
      reserveBytes(state, JSONStringify(value).length, displayPath);
      return value;
    case "string": {
      const bytes = jsonStringByteLength(
        value,
        CONVERSATION_STORAGE_LIMITS.maxJsonStringBytes,
        displayPath,
      );
      reserveBytes(state, bytes, displayPath);
      return value;
    }
    case "undefined":
    case "bigint":
    case "symbol":
    case "function":
      return fail(displayPath, `${typeof value} values are not represented by JSON`);
    case "object":
      break;
  }

  const objectValue = value as object;
  const prototype = inspectPrototype(objectValue, displayPath);
  if (prototype === Date.prototype) {
    return snapshotDate(objectValue, displayPath, path, state);
  }
  if (state.ancestors.has(objectValue)) {
    return fail(displayPath, "cyclic values are not represented by JSON");
  }

  state.ancestors.add(objectValue);
  try {
    return ArrayIsArray(value)
      ? snapshotArray(value, displayPath, path, depth, state)
      : snapshotRecord(objectValue, displayPath, path, depth, state);
  } finally {
    state.ancestors.delete(objectValue);
  }
}

function snapshotJson(value: unknown, maxBytes: number): JsonValue {
  return snapshotJsonValue(value, "$", [], 0, {
    ancestors: new WeakSet<object>(),
    maxBytes,
    nodes: 0,
    estimatedBytes: 0,
  });
}

/**
 * Serialize canonical JSON without consulting `toJSON` on either own or
 * inherited prototypes. Only primitive strings/numbers reach the intrinsic
 * JSON serializer; containers are emitted from own data descriptors.
 */
function safeJsonStringify(value: JsonValue, path = "$"): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    const serialized = JSONStringify(value);
    if (typeof serialized !== "string") return fail(path, "number cannot be serialized");
    return serialized;
  }
  if (typeof value === "string") {
    const serialized = JSONStringify(value);
    if (typeof serialized !== "string") return fail(path, "string cannot be serialized");
    return serialized;
  }

  if (ArrayIsArray(value)) {
    let serialized = "[";
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) serialized += ",";
      const itemPath = `${path}[${index}]`;
      const descriptor = inspectDescriptor(value, `${index}`, itemPath);
      serialized += safeJsonStringify(
        descriptorValue(descriptor, itemPath) as JsonValue,
        itemPath,
      );
    }
    return `${serialized}]`;
  }

  let serialized = "{";
  const keys = inspectKeys(value, path);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") {
      return fail(path, "symbol properties are not persistable");
    }
    if (index > 0) serialized += ",";
    const propertyPath = childPath(path, key);
    const serializedKey = JSONStringify(key);
    if (typeof serializedKey !== "string") {
      return fail(propertyPath, "property name cannot be serialized");
    }
    const descriptor = inspectDescriptor(value, key, propertyPath);
    serialized += `${serializedKey}:${
      safeJsonStringify(
        descriptorValue(descriptor, propertyPath) as JsonValue,
        propertyPath,
      )
    }`;
  }
  return `${serialized}}`;
}

/**
 * Convert a validated canonical snapshot into ordinary caller-facing objects.
 * Data properties are defined explicitly so a `__proto__` key remains data
 * rather than changing the returned object's prototype.
 */
function rehydrateJsonValue(value: JsonValue, path = "$"): JsonValue {
  if (value === null || typeof value !== "object") return value;

  if (ArrayIsArray(value)) {
    const output = new Array<JsonValue>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const itemPath = `${path}[${index}]`;
      const descriptor = inspectDescriptor(value, `${index}`, itemPath);
      const item = rehydrateJsonValue(
        descriptorValue(descriptor, itemPath) as JsonValue,
        itemPath,
      );
      defineDataProperty(output, index, item);
    }
    return output;
  }

  const output: JsonRecord = {};
  for (const key of inspectKeys(value, path)) {
    if (typeof key !== "string") {
      return fail(path, "symbol properties are not persistable");
    }
    const propertyPath = childPath(path, key);
    const descriptor = inspectDescriptor(value, key, propertyPath);
    defineJsonProperty(
      output,
      key,
      rehydrateJsonValue(
        descriptorValue(descriptor, propertyPath) as JsonValue,
        propertyPath,
      ),
    );
  }
  return output;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !ArrayIsArray(value);
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return ObjectHasOwn(record, key);
}

function requireString(
  record: JsonRecord,
  key: string,
  path: string,
  options: { maxBytes?: number; nonEmpty?: boolean } = {},
): string {
  if (!hasOwn(record, key)) {
    return fail(childPath(path, key), "is required");
  }
  const value = record[key];
  if (typeof value !== "string" || (options.nonEmpty && value.length === 0)) {
    return fail(childPath(path, key), `must be ${options.nonEmpty ? "a non-empty" : "a"} string`);
  }
  byteLength(
    value,
    options.maxBytes ?? CONVERSATION_STORAGE_LIMITS.maxJsonStringBytes,
    childPath(path, key),
  );
  return value;
}

function optionalString(record: JsonRecord, key: string, path: string): void {
  if (hasOwn(record, key)) requireString(record, key, path);
}

function optionalBoolean(record: JsonRecord, key: string, path: string): void {
  if (hasOwn(record, key) && typeof record[key] !== "boolean") {
    fail(childPath(path, key), "must be a boolean");
  }
}

function requireSafeCount(record: JsonRecord, key: string, path: string): number {
  if (!hasOwn(record, key)) {
    return fail(childPath(path, key), "is required");
  }
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(childPath(path, key), "must be a non-negative safe integer");
  }
  return value;
}

function optionalSafeCount(record: JsonRecord, key: string, path: string): void {
  if (hasOwn(record, key)) requireSafeCount(record, key, path);
}

function requireToolState(record: JsonRecord, path: string): void {
  if (!hasOwn(record, "state")) {
    fail(childPath(path, "state"), "is required");
  }
  const state = record.state;
  if (
    state !== "input-streaming" &&
    state !== "input-available" &&
    state !== "output-streaming" &&
    state !== "output-available" &&
    state !== "output-error"
  ) {
    fail(childPath(path, "state"), "is not a supported tool state");
  }
}

function optionalPartState(record: JsonRecord, path: string): void {
  if (hasOwn(record, "state") && record.state !== "streaming" && record.state !== "done") {
    fail(childPath(path, "state"), "is not a supported message-part state");
  }
}

function validateToolFields(record: JsonRecord, path: string): string {
  requireString(record, "toolCallId", path, {
    maxBytes: CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
    nonEmpty: true,
  });
  const toolName = requireString(record, "toolName", path, {
    maxBytes: CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
    nonEmpty: true,
  });
  requireToolState(record, path);
  optionalString(record, "errorText", path);
  optionalBoolean(record, "providerExecuted", path);
  return toolName;
}

function validatePart(value: JsonValue, path: string): void {
  if (!isRecord(value)) {
    return fail(path, "message parts must be records");
  }
  const type = requireString(value, "type", path, {
    maxBytes: CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
    nonEmpty: true,
  });

  switch (type) {
    case "text":
      requireString(value, "text", path);
      optionalPartState(value, path);
      return;
    case "reasoning":
      requireString(value, "text", path);
      optionalString(value, "signature", path);
      optionalString(value, "redactedData", path);
      optionalPartState(value, path);
      return;
    case "file":
      requireString(value, "mediaType", path, { nonEmpty: true });
      requireString(value, "url", path, { nonEmpty: true });
      optionalString(value, "filename", path);
      optionalSafeCount(value, "size", path);
      optionalString(value, "uploadId", path);
      optionalString(value, "uploadPath", path);
      return;
    case "source-url":
      requireString(value, "sourceId", path, {
        maxBytes: CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
        nonEmpty: true,
      });
      requireString(value, "url", path, { nonEmpty: true });
      optionalString(value, "title", path);
      return;
    case "source-document":
      requireString(value, "sourceId", path, {
        maxBytes: CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
        nonEmpty: true,
      });
      requireString(value, "title", path);
      optionalString(value, "mediaType", path);
      optionalString(value, "filename", path);
      return;
    case "tool-result":
      requireString(value, "toolCallId", path, {
        maxBytes: CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
        nonEmpty: true,
      });
      requireString(value, "toolName", path, {
        maxBytes: CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
        nonEmpty: true,
      });
      if (!hasOwn(value, "result")) {
        fail(childPath(path, "result"), "is required");
      }
      optionalBoolean(value, "isError", path);
      return;
    case "dynamic-tool":
      validateToolFields(value, path);
      return;
    case "step-start":
    case "step-end":
      requireSafeCount(value, "stepIndex", path);
      return;
    default:
      if (type.startsWith("tool-")) {
        const toolName = validateToolFields(value, path);
        if (type !== `tool-${toolName}`) {
          fail(childPath(path, "type"), "must match the toolName field");
        }
        return;
      }
      if (type.startsWith("data-") && type.length > "data-".length) {
        if (!hasOwn(value, "data")) {
          fail(childPath(path, "data"), "is required");
        }
        return;
      }
      fail(
        childPath(path, "type"),
        `unsupported message-part discriminator ${JSONStringify(type)}`,
      );
  }
}

function validateMessage(value: JsonValue, path: string): string {
  if (!isRecord(value)) {
    return fail(path, "messages must be records");
  }
  const id = requireString(value, "id", path, {
    maxBytes: CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
    nonEmpty: true,
  });
  if (
    !hasOwn(value, "role") ||
    (value.role !== "system" && value.role !== "user" && value.role !== "assistant")
  ) {
    fail(childPath(path, "role"), "is not a supported chat role");
  }
  if (!hasOwn(value, "parts") || !ArrayIsArray(value.parts)) {
    fail(childPath(path, "parts"), "must be an array");
  }
  if (value.parts.length > CONVERSATION_STORAGE_LIMITS.maxPartsPerMessage) {
    fail(
      childPath(path, "parts"),
      `contains more than ${CONVERSATION_STORAGE_LIMITS.maxPartsPerMessage} parts`,
    );
  }
  value.parts.forEach((part, index) => validatePart(part, `${path}["parts"][${index}]`));
  if (hasOwn(value, "metadata") && !isRecord(value.metadata)) {
    fail(childPath(path, "metadata"), "must be a record");
  }
  if (hasOwn(value, "createdAt") && typeof value.createdAt !== "string") {
    fail(childPath(path, "createdAt"), "must be a Date or string");
  }
  return id;
}

function validateConversationValue(value: JsonValue): Conversation {
  if (!isRecord(value)) {
    return fail("$", "conversation must be a record");
  }
  requireString(value, "id", "$", {
    maxBytes: CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
    nonEmpty: true,
  });
  requireString(value, "title", "$", {
    maxBytes: CONVERSATION_STORAGE_LIMITS.maxTitleBytes,
  });
  if (hasOwn(value, "agentId")) {
    requireString(value, "agentId", "$", {
      maxBytes: CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
    });
  }
  requireSafeCount(value, "createdAt", "$");
  requireSafeCount(value, "updatedAt", "$");
  if (!hasOwn(value, "messages") || !ArrayIsArray(value.messages)) {
    return fail('$["messages"]', "must be an array");
  }
  if (value.messages.length > CONVERSATION_STORAGE_LIMITS.maxMessagesPerConversation) {
    return fail(
      '$["messages"]',
      `contains more than ${CONVERSATION_STORAGE_LIMITS.maxMessagesPerConversation} messages`,
    );
  }

  const ids = new Set<string>();
  value.messages.forEach((message, index) => {
    const id = validateMessage(message, `$["messages"][${index}]`);
    if (ids.has(id)) {
      fail(`$["messages"][${index}]["id"]`, `duplicate message id ${JSONStringify(id)}`);
    }
    ids.add(id);
  });
  return value as JsonRecord & Conversation;
}

function validateSummaryValue(value: JsonValue, path: string): JsonRecord & ConversationSummary {
  if (!isRecord(value)) {
    return fail(path, "conversation summary must be a record");
  }
  requireString(value, "id", path, {
    maxBytes: CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
    nonEmpty: true,
  });
  requireString(value, "title", path, {
    maxBytes: CONVERSATION_STORAGE_LIMITS.maxTitleBytes,
  });
  if (hasOwn(value, "agentId")) {
    requireString(value, "agentId", path, {
      maxBytes: CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
    });
  }
  requireSafeCount(value, "createdAt", path);
  requireSafeCount(value, "updatedAt", path);
  const messageCount = requireSafeCount(value, "messageCount", path);
  if (messageCount > CONVERSATION_STORAGE_LIMITS.maxMessagesPerConversation) {
    fail(
      childPath(path, "messageCount"),
      `exceeds ${CONVERSATION_STORAGE_LIMITS.maxMessagesPerConversation}`,
    );
  }
  return value as JsonRecord & ConversationSummary;
}

function byNewest(left: ConversationSummary, right: ConversationSummary): number {
  return right.updatedAt - left.updatedAt;
}

function validateIndexValue(value: JsonValue): (JsonRecord & ConversationSummary)[] {
  if (!ArrayIsArray(value)) {
    return fail("$", "conversation index must be an array");
  }
  if (value.length > CONVERSATION_STORAGE_LIMITS.maxConversations) {
    return fail(
      "$",
      `conversation index contains more than ${CONVERSATION_STORAGE_LIMITS.maxConversations} items`,
    );
  }

  const ids = new Set<string>();
  const summaries = value.map((summary, index) => {
    const parsed = validateSummaryValue(summary, `$[${index}]`);
    if (ids.has(parsed.id)) {
      fail(`$[${index}]["id"]`, `duplicate conversation id ${JSONStringify(parsed.id)}`);
    }
    ids.add(parsed.id);
    return parsed;
  });
  return summaries.sort(byNewest);
}

function assertRawJsonBounds(raw: string, maxBytes: number, label: string): void {
  byteLength(raw, maxBytes, label);

  let depth = 0;
  let nodes = 0;
  let inString = false;
  let escaped = false;
  let inPrimitive = false;

  const addRawNode = (): void => {
    nodes += 1;
    if (nodes > CONVERSATION_STORAGE_LIMITS.maxJsonNodes + ENVELOPE_NODE_ALLOWANCE) {
      throw new TypeError(
        `${label} exceeds ${CONVERSATION_STORAGE_LIMITS.maxJsonNodes} JSON nodes`,
      );
    }
  };

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (inPrimitive) {
      if (
        character !== "," &&
        character !== "]" &&
        character !== "}" &&
        character !== " " &&
        character !== "\t" &&
        character !== "\r" &&
        character !== "\n"
      ) {
        continue;
      }
      inPrimitive = false;
    }

    if (character === '"') {
      addRawNode();
      inString = true;
    } else if (character === "{" || character === "[") {
      addRawNode();
      depth += 1;
      if (depth > CONVERSATION_STORAGE_LIMITS.maxJsonDepth + 2) {
        throw new TypeError(
          `${label} exceeds JSON depth ${CONVERSATION_STORAGE_LIMITS.maxJsonDepth}`,
        );
      }
    } else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) throw new TypeError(`${label} is not valid JSON`);
    } else if (
      character === "-" ||
      (character >= "0" && character <= "9") ||
      character === "t" ||
      character === "f" ||
      character === "n"
    ) {
      addRawNode();
      inPrimitive = true;
    }
  }
}

function unwrapEnvelope(
  parsed: unknown,
  expectedKind: StoredEnvelope["kind"],
): { value: unknown; legacy: boolean } {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    ArrayIsArray(parsed)
  ) {
    return { value: parsed, legacy: true };
  }

  const envelope = parsed as Record<string, unknown>;
  if (
    !ObjectHasOwn(envelope, "format") ||
    envelope.format !== CONVERSATION_STORAGE_FORMAT
  ) {
    return { value: parsed, legacy: true };
  }
  if (
    !ObjectHasOwn(envelope, "version") ||
    envelope.version !== CONVERSATION_STORAGE_VERSION
  ) {
    throw new TypeError("Unsupported conversation storage version");
  }
  if (!ObjectHasOwn(envelope, "kind") || envelope.kind !== expectedKind) {
    throw new TypeError(
      `Stored conversation envelope kind does not match ${expectedKind}`,
    );
  }
  if (!ObjectHasOwn(envelope, "value")) {
    throw new TypeError("Stored conversation envelope is missing its value");
  }
  return { value: envelope.value, legacy: false };
}

function serializeEnvelope(
  kind: StoredEnvelope["kind"],
  value: JsonValue,
  maxBytes: number,
): string {
  const envelope = ObjectCreate(null) as JsonRecord;
  defineJsonProperty(envelope, "format", CONVERSATION_STORAGE_FORMAT);
  defineJsonProperty(envelope, "version", CONVERSATION_STORAGE_VERSION);
  defineJsonProperty(envelope, "kind", kind);
  defineJsonProperty(envelope, "value", value);
  const serialized = safeJsonStringify(envelope);
  byteLength(serialized, maxBytes, `Serialized conversation ${kind}`);
  return serialized;
}

function serializeStorageKeyTuple(parts: JsonPrimitive[]): string {
  return safeJsonStringify(parts);
}

function assertStorageKeyComponent(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} must not be empty`);
  byteLength(
    value,
    CONVERSATION_STORAGE_LIMITS.maxStorageKeyComponentBytes,
    label,
  );
}

/** Injective key for the current versioned conversation index. */
export function conversationIndexStorageKey(storageKey: string): string {
  assertStorageKeyComponent(storageKey, "Conversation storage key");
  return serializeStorageKeyTuple([
    CONVERSATION_STORAGE_FORMAT,
    CONVERSATION_STORAGE_VERSION,
    storageKey,
    "index",
  ]);
}

/** Injective key for the logical store's crash-recovery transaction journal. */
export function conversationTransactionJournalStorageKey(storageKey: string): string {
  assertStorageKeyComponent(storageKey, "Conversation storage key");
  return serializeStorageKeyTuple([
    CONVERSATION_STORAGE_FORMAT,
    storageKey,
    "transaction-journal",
  ]);
}

/** Injective key for one current-version conversation blob. */
export function conversationBlobStorageKey(storageKey: string, id: string): string {
  assertStorageKeyComponent(storageKey, "Conversation storage key");
  assertStorageKeyComponent(id, "Conversation id");
  return serializeStorageKeyTuple([
    CONVERSATION_STORAGE_FORMAT,
    CONVERSATION_STORAGE_VERSION,
    storageKey,
    "conversation",
    id,
  ]);
}

/** Pre-versioning index key, retained only for lazy migration reads. */
export function legacyConversationIndexStorageKey(storageKey: string): string {
  assertStorageKeyComponent(storageKey, "Conversation storage key");
  return `${storageKey}-index`;
}

/** Pre-versioning blob key, retained only for immutable lazy-migration reads. */
export function legacyConversationBlobStorageKey(storageKey: string, id: string): string {
  assertStorageKeyComponent(storageKey, "Conversation storage key");
  assertStorageKeyComponent(id, "Conversation id");
  return `${storageKey}-${id}`;
}

/** Snapshot, validate, and encode one conversation in the current envelope. */
export function encodeConversationRecord(conversation: Conversation): EncodedConversationRecord {
  const snapshot = snapshotJson(
    conversation,
    CONVERSATION_STORAGE_LIMITS.maxConversationBytes,
  );
  validateConversationValue(snapshot);
  const serialized = serializeEnvelope(
    "conversation",
    snapshot,
    CONVERSATION_STORAGE_LIMITS.maxConversationBytes,
  );
  const value = rehydrateJsonValue(snapshot) as JsonRecord & Conversation;
  return {
    serialized,
    value,
  };
}

/** Decode either a current envelope or the legacy unversioned conversation. */
export function decodeConversationRecord(raw: string): DecodedConversationRecord {
  assertRawJsonBounds(
    raw,
    CONVERSATION_STORAGE_LIMITS.maxConversationBytes,
    "Stored conversation",
  );
  const parsed: unknown = JSON.parse(raw);
  const unwrapped = unwrapEnvelope(parsed, "conversation");
  const snapshot = snapshotJson(
    unwrapped.value,
    CONVERSATION_STORAGE_LIMITS.maxConversationBytes,
  );
  validateConversationValue(snapshot);
  return {
    value: rehydrateJsonValue(snapshot) as JsonRecord & Conversation,
    legacy: unwrapped.legacy,
  };
}

/** Snapshot, validate, sort, and encode the current conversation index. */
export function encodeConversationIndex(
  summaries: readonly ConversationSummary[],
): EncodedConversationIndex {
  const snapshot = snapshotJson(
    summaries,
    CONVERSATION_STORAGE_LIMITS.maxIndexBytes,
  );
  const canonical = validateIndexValue(snapshot);
  const serialized = serializeEnvelope(
    "index",
    canonical,
    CONVERSATION_STORAGE_LIMITS.maxIndexBytes,
  );
  const value = rehydrateJsonValue(canonical) as (JsonRecord & ConversationSummary)[];
  return {
    serialized,
    value,
  };
}

/** Decode either a current envelope or the legacy unversioned index array. */
export function decodeConversationIndex(raw: string): DecodedConversationIndex {
  assertRawJsonBounds(
    raw,
    CONVERSATION_STORAGE_LIMITS.maxIndexBytes,
    "Stored conversation index",
  );
  const parsed: unknown = JSON.parse(raw);
  const unwrapped = unwrapEnvelope(parsed, "index");
  const snapshot = snapshotJson(
    unwrapped.value,
    CONVERSATION_STORAGE_LIMITS.maxIndexBytes,
  );
  const canonical = validateIndexValue(snapshot);
  return {
    value: rehydrateJsonValue(canonical) as (JsonRecord & ConversationSummary)[],
    legacy: unwrapped.legacy,
  };
}

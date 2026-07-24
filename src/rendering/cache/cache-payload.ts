import type { RenderResult } from "../orchestrator/types.ts";
import type { CachePayload } from "./types.ts";

const MAX_CACHE_VALUE_DEPTH = 64;
const MAX_CACHE_VALUE_NODES = 100_000;
const MAX_CACHE_PAYLOAD_UTF8_BYTES = 32 * 1024 * 1024;
const MAX_RENDER_ARTIFACT_UTF8_BYTES = 16 * 1024 * 1024;
const MAX_EMBEDDED_STRING_UTF8_BYTES = 1024 * 1024;
const MAX_METADATA_STRING_UTF8_BYTES = 64 * 1024;
const MAX_HEADINGS = 10_000;
const MAX_NODE_MAP_ENTRIES = 100_000;
const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000;
const utf8Encoder = new TextEncoder();
const SERIALIZED_CACHE_ENVELOPE_KEY = "$veryfrontCachePayload";
const SERIALIZED_CACHE_ENVELOPE_VERSION = 1;
const CACHE_VALUE_TAG = "$veryfrontCacheValue";
const CACHE_VALUE_FIELD = "value";

interface CloneState {
  nodes: number;
  stringBytes: number;
  readonly ancestors: WeakSet<object>;
}

function fail(message: string): never {
  throw new TypeError(`Invalid render cache payload: ${message}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function countNode(state: CloneState, depth: number): void {
  state.nodes++;
  if (state.nodes > MAX_CACHE_VALUE_NODES) fail("value is too large");
  if (depth > MAX_CACHE_VALUE_DEPTH) fail("value is too deeply nested");
}

function ownDataValue(record: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set) fail(`${String(key)} must be a data property`);
  return descriptor.value;
}

function cloneBoundedString(
  value: string,
  state: CloneState,
  label: string,
  maxBytes: number,
): string {
  if (value.length > maxBytes) fail(`${label} is too large`);
  const byteLength = utf8Encoder.encode(value).byteLength;
  if (byteLength > maxBytes) fail(`${label} is too large`);
  state.stringBytes += byteLength;
  if (state.stringBytes > MAX_CACHE_PAYLOAD_UTF8_BYTES) {
    fail("string data is too large");
  }
  return value;
}

function cloneJsonValue(value: unknown, state: CloneState, depth = 0): unknown {
  countNode(state, depth);

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return cloneBoundedString(value, state, "embedded string", MAX_EMBEDDED_STRING_UTF8_BYTES);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("contains a non-finite number");
    return value;
  }
  if (value === undefined) return undefined;
  if (typeof value !== "object") fail(`contains unsupported ${typeof value} data`);

  const date = cloneDateValue(value);
  if (date) return date;
  if (state.ancestors.has(value)) fail("contains a cycle");

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const clonedEntries: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) fail("contains a sparse array");
        const entry = ownDataValue(value, index);
        const clonedEntry = cloneJsonValue(entry, state, depth + 1);
        if (clonedEntry === undefined) fail("contains undefined array data");
        clonedEntries.push(clonedEntry);
      }
      return clonedEntries;
    }

    if (!isPlainRecord(value)) {
      fail("contains an unsupported object type");
    }

    const cloned: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      cloneBoundedString(key, state, "object key", MAX_METADATA_STRING_UTF8_BYTES);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set) {
        fail("contains accessor properties");
      }
      const entry = cloneJsonValue(descriptor.value, state, depth + 1);
      if (entry !== undefined) {
        Object.defineProperty(cloned, key, {
          value: entry,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    return cloned;
  } finally {
    state.ancestors.delete(value);
  }
}

function cloneDateValue(value: object): Date | undefined {
  let timestamp: number;
  try {
    timestamp = Date.prototype.getTime.call(value);
  } catch {
    return undefined;
  }
  if (!Number.isFinite(timestamp)) fail("contains an invalid date");
  return new Date(timestamp);
}

function optionalTimestamp(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = ownDataValue(record, key);
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 ||
    value > MAX_DATE_TIMESTAMP_MS
  ) {
    fail(`${key} must be a non-negative valid millisecond timestamp`);
  }
  return value;
}

function cloneNodeMapEntries(
  result: Record<string, unknown>,
  payload: Record<string, unknown>,
  state: CloneState,
): Array<[number, unknown]> | undefined {
  const normalize = (entries: Array<[unknown, unknown]>): Array<[number, unknown]> => {
    if (entries.length > MAX_NODE_MAP_ENTRIES) fail("nodeMap contains too many entries");
    const seen = new Set<number>();
    return entries.map(([rawKey, rawValue]) => {
      const key = typeof rawKey === "string" && rawKey.trim() !== "" ? Number(rawKey) : rawKey;
      if (typeof key !== "number" || !Number.isSafeInteger(key)) {
        fail("nodeMap keys must be safe integers");
      }
      if (seen.has(key)) fail("nodeMap contains duplicate keys");
      seen.add(key);

      const value = cloneJsonValue(rawValue, state, 1);
      if (value === undefined) fail("nodeMap values cannot be undefined");
      return [key, value];
    });
  };

  let serialized: Array<[number, unknown]> | undefined;
  const rawNodeMapEntries = ownDataValue(payload, "nodeMapEntries");
  if (rawNodeMapEntries !== undefined) {
    if (!Array.isArray(rawNodeMapEntries)) fail("nodeMapEntries must be an array");
    const entries: Array<[unknown, unknown]> = [];
    for (let index = 0; index < rawNodeMapEntries.length; index++) {
      if (!Object.hasOwn(rawNodeMapEntries, index)) fail("nodeMapEntries is sparse");
      const entry = ownDataValue(rawNodeMapEntries, index);
      if (
        !Array.isArray(entry) || entry.length !== 2 || !Object.hasOwn(entry, 0) ||
        !Object.hasOwn(entry, 1)
      ) {
        fail("nodeMapEntries must contain complete [number, value] pairs");
      }
      entries.push([ownDataValue(entry, 0), ownDataValue(entry, 1)]);
    }
    serialized = normalize(entries);
  }

  let resultEntries: Array<[number, unknown]> | undefined;
  const rawResultNodeMap = ownDataValue(result, "nodeMap");
  if (rawResultNodeMap instanceof Map) {
    resultEntries = normalize([...Map.prototype.entries.call(rawResultNodeMap)]);
  } else if (rawResultNodeMap !== undefined) {
    if (!isPlainRecord(rawResultNodeMap)) fail("result.nodeMap must be a Map or record");
    resultEntries = normalize(
      Object.keys(rawResultNodeMap).map((key) => [key, ownDataValue(rawResultNodeMap, key)]),
    );
  }

  if (
    serialized !== undefined && resultEntries !== undefined &&
    !nodeMapEntriesEqual(serialized, resultEntries)
  ) {
    fail("nodeMapEntries conflicts with result.nodeMap");
  }

  return serialized ?? resultEntries;
}

function nodeMapEntriesEqual(
  left: Array<[number, unknown]>,
  right: Array<[number, unknown]>,
): boolean {
  if (left.length !== right.length) return false;
  const rightByKey = new Map(right);
  if (rightByKey.size !== right.length) return false;
  return left.every(([key, value]) =>
    rightByKey.has(key) && jsonValuesEqual(value, rightByKey.get(key))
  );
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  const leftDate = typeof left === "object" && left !== null ? cloneDateValue(left) : undefined;
  const rightDate = typeof right === "object" && right !== null ? cloneDateValue(right) : undefined;
  if (leftDate || rightDate) {
    return !!leftDate && !!rightDate &&
      leftDate.getTime() === rightDate.getTime();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((entry, index) => jsonValuesEqual(entry, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && jsonValuesEqual(left[key], right[key])
    );
}

function encodeCacheWireValue(
  value: unknown,
  state: CloneState,
  depth = 0,
): unknown {
  countNode(state, depth);

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return cloneBoundedString(
      value,
      state,
      "serialized cache string",
      MAX_EMBEDDED_STRING_UTF8_BYTES,
    );
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("contains a non-finite number");
    return value;
  }
  if (value === undefined) return undefined;
  if (typeof value !== "object") {
    fail(`contains unsupported ${typeof value} data`);
  }

  const date = cloneDateValue(value);
  if (date) {
    return {
      [CACHE_VALUE_TAG]: "date",
      [CACHE_VALUE_FIELD]: date.toISOString(),
    };
  }
  if (state.ancestors.has(value)) fail("contains a cycle");

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const length = ownDataValue(value, "length");
      if (
        typeof length !== "number" || !Number.isSafeInteger(length) ||
        length < 0
      ) {
        fail("contains an invalid array");
      }
      const encoded: unknown[] = [];
      for (let index = 0; index < length; index++) {
        if (!Object.hasOwn(value, index)) fail("contains a sparse array");
        const entry = encodeCacheWireValue(
          ownDataValue(value, index),
          state,
          depth + 1,
        );
        if (entry === undefined) fail("contains undefined array data");
        encoded.push(entry);
      }
      return encoded;
    }

    if (!isPlainRecord(value)) fail("contains an unsupported object type");

    const encoded: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      cloneBoundedString(
        key,
        state,
        "serialized cache key",
        MAX_METADATA_STRING_UTF8_BYTES,
      );
      const entry = encodeCacheWireValue(
        ownDataValue(value, key),
        state,
        depth + 1,
      );
      if (entry !== undefined) defineDataProperty(encoded, key, entry);
    }

    if (Object.hasOwn(value, CACHE_VALUE_TAG)) {
      return {
        [CACHE_VALUE_TAG]: "record",
        [CACHE_VALUE_FIELD]: encoded,
      };
    }
    return encoded;
  } finally {
    state.ancestors.delete(value);
  }
}

function decodeSerializedCacheEnvelope(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(value, SERIALIZED_CACHE_ENVELOPE_KEY) ||
    !Object.hasOwn(value, CACHE_VALUE_FIELD) ||
    ownDataValue(value, SERIALIZED_CACHE_ENVELOPE_KEY) !==
      SERIALIZED_CACHE_ENVELOPE_VERSION
  ) {
    return value;
  }

  return decodeCacheWireValue(
    ownDataValue(value, CACHE_VALUE_FIELD),
    {
      nodes: 0,
      stringBytes: 0,
      ancestors: new WeakSet<object>(),
    },
  );
}

function decodeCacheWireValue(
  value: unknown,
  state: CloneState,
  depth = 0,
): unknown {
  countNode(state, depth);

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return cloneBoundedString(
      value,
      state,
      "serialized cache string",
      MAX_EMBEDDED_STRING_UTF8_BYTES,
    );
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("contains a non-finite number");
    return value;
  }
  if (typeof value !== "object") {
    fail(`contains unsupported ${typeof value} data`);
  }
  if (state.ancestors.has(value)) fail("contains a cycle");

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const length = ownDataValue(value, "length");
      if (
        typeof length !== "number" || !Number.isSafeInteger(length) ||
        length < 0
      ) {
        fail("contains an invalid array");
      }
      const decoded: unknown[] = [];
      for (let index = 0; index < length; index++) {
        if (!Object.hasOwn(value, index)) fail("contains a sparse array");
        const entry = decodeCacheWireValue(
          ownDataValue(value, index),
          state,
          depth + 1,
        );
        if (entry === undefined) fail("contains undefined array data");
        decoded.push(entry);
      }
      return decoded;
    }

    if (!isPlainRecord(value)) fail("contains an unsupported object type");
    const marker = readCacheWireMarker(value);
    if (marker?.tag === "date") {
      if (typeof marker.value !== "string") fail("contains an invalid date");
      const serializedDate = cloneBoundedString(
        marker.value,
        state,
        "serialized cache date",
        MAX_METADATA_STRING_UTF8_BYTES,
      );
      const timestamp = Date.parse(serializedDate);
      if (!Number.isFinite(timestamp)) fail("contains an invalid date");
      const date = new Date(timestamp);
      if (date.toISOString() !== serializedDate) {
        fail("contains an invalid date");
      }
      return date;
    }
    if (marker?.tag === "record") {
      if (!isPlainRecord(marker.value)) {
        fail("contains an invalid escaped record");
      }
      return decodeCacheWireRecord(marker.value, state, depth);
    }
    return decodeCacheWireRecord(value, state, depth);
  } finally {
    state.ancestors.delete(value);
  }
}

function decodeCacheWireRecord(
  value: Record<string, unknown>,
  state: CloneState,
  depth: number,
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    cloneBoundedString(
      key,
      state,
      "serialized cache key",
      MAX_METADATA_STRING_UTF8_BYTES,
    );
    const entry = decodeCacheWireValue(
      ownDataValue(value, key),
      state,
      depth + 1,
    );
    if (entry !== undefined) defineDataProperty(decoded, key, entry);
  }
  return decoded;
}

function readCacheWireMarker(
  value: Record<string, unknown>,
): { tag: unknown; value: unknown } | undefined {
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(value, CACHE_VALUE_TAG) ||
    !Object.hasOwn(value, CACHE_VALUE_FIELD)
  ) {
    return undefined;
  }
  return {
    tag: ownDataValue(value, CACHE_VALUE_TAG),
    value: ownDataValue(value, CACHE_VALUE_FIELD),
  };
}

function defineDataProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function cloneHeadings(
  value: unknown,
  state: CloneState,
): RenderResult["headings"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail("result.headings must be an array");
  if (value.length > MAX_HEADINGS) fail("result.headings contains too many entries");

  const headings: NonNullable<RenderResult["headings"]> = [];
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) fail("result.headings cannot be sparse");
    const heading = ownDataValue(value, index);
    if (!isPlainRecord(heading)) fail("result.headings contains a non-object entry");
    const id = ownDataValue(heading, "id");
    const text = ownDataValue(heading, "text");
    const level = ownDataValue(heading, "level");
    if (
      typeof id !== "string" ||
      typeof text !== "string" ||
      typeof level !== "number" ||
      !Number.isSafeInteger(level) ||
      level < 1 ||
      level > 6
    ) {
      fail("result.headings contains an invalid heading");
    }
    headings.push({
      id: cloneBoundedString(id, state, "heading id", MAX_METADATA_STRING_UTF8_BYTES),
      text: cloneBoundedString(text, state, "heading text", MAX_METADATA_STRING_UTF8_BYTES),
      level,
    });
  }
  return headings;
}

function clonePageModule(value: unknown, state: CloneState): RenderResult["pageModule"] {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) fail("result.pageModule must be an object");
  const slug = ownDataValue(value, "slug");
  const code = ownDataValue(value, "code");
  const type = ownDataValue(value, "type");
  if (
    typeof slug !== "string" ||
    typeof code !== "string" ||
    (type !== "mdx" && type !== "component")
  ) {
    fail("result.pageModule is invalid");
  }
  return {
    slug: cloneBoundedString(slug, state, "pageModule.slug", MAX_METADATA_STRING_UTF8_BYTES),
    code: cloneBoundedString(code, state, "pageModule.code", MAX_RENDER_ARTIFACT_UTF8_BYTES),
    type,
  };
}

function buildCachePayload(value: unknown): CachePayload {
  if (!isPlainRecord(value)) fail("payload must be an object");
  const rawResult = ownDataValue(value, "result");
  if (!isPlainRecord(rawResult)) fail("result must be an object");
  const result = rawResult;
  const html = ownDataValue(result, "html");
  const css = ownDataValue(result, "css");
  const ssrHash = ownDataValue(result, "ssrHash");
  const stream = ownDataValue(result, "stream");
  const rawFrontmatter = ownDataValue(result, "frontmatter");

  if (typeof html !== "string") fail("result.html must be a string");
  if (css !== undefined && typeof css !== "string") {
    fail("result.css must be a string when present");
  }
  if (ssrHash !== undefined && typeof ssrHash !== "string") {
    fail("result.ssrHash must be a string when present");
  }
  if (stream !== null) fail("result.stream must be null");
  if (!isPlainRecord(rawFrontmatter)) fail("result.frontmatter must be an object");

  const state: CloneState = { nodes: 0, stringBytes: 0, ancestors: new WeakSet<object>() };
  const clonedHtml = cloneBoundedString(
    html,
    state,
    "result.html",
    MAX_RENDER_ARTIFACT_UTF8_BYTES,
  );
  const clonedCss = css === undefined ? undefined : cloneBoundedString(
    css,
    state,
    "result.css",
    MAX_RENDER_ARTIFACT_UTF8_BYTES,
  );
  const clonedSsrHash = ssrHash === undefined ? undefined : cloneBoundedString(
    ssrHash,
    state,
    "result.ssrHash",
    MAX_METADATA_STRING_UTF8_BYTES,
  );
  const frontmatter = cloneJsonValue(rawFrontmatter, state);
  if (!isPlainRecord(frontmatter)) fail("result.frontmatter must be an object");

  const nodeMapEntries = cloneNodeMapEntries(result, value, state);
  const headings = cloneHeadings(ownDataValue(result, "headings"), state);
  const pageModule = clonePageModule(ownDataValue(result, "pageModule"), state);
  const storedAt = optionalTimestamp(value, "storedAt");
  if (storedAt === undefined) fail("storedAt is required");
  const expiresAt = optionalTimestamp(value, "expiresAt");
  const staleUntil = optionalTimestamp(value, "staleUntil");
  if (staleUntil !== undefined && expiresAt === undefined) {
    fail("staleUntil requires expiresAt");
  }
  if (expiresAt !== undefined && expiresAt < storedAt) {
    fail("expiresAt cannot precede storedAt");
  }
  if (staleUntil !== undefined && staleUntil < (expiresAt ?? storedAt)) {
    fail("staleUntil cannot precede expiry");
  }

  const resultNodeMap = nodeMapEntries === undefined ? undefined : new Map<number, unknown>(
    nodeMapEntries.map(([key, entry]) => {
      const cloned = cloneJsonValue(entry, state, 1);
      if (cloned === undefined) fail("nodeMap values cannot be undefined");
      return [key, cloned];
    }),
  );

  return {
    result: {
      html: clonedHtml,
      ...(clonedCss === undefined ? {} : { css: clonedCss }),
      frontmatter: frontmatter as RenderResult["frontmatter"],
      ...(headings === undefined ? {} : { headings }),
      ...(resultNodeMap === undefined ? {} : { nodeMap: resultNodeMap }),
      stream: null,
      ...(pageModule === undefined ? {} : { pageModule }),
      ...(clonedSsrHash === undefined ? {} : { ssrHash: clonedSsrHash }),
    },
    storedAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(staleUntil === undefined ? {} : { staleUntil }),
    ...(nodeMapEntries === undefined
      ? {}
      : { nodeMapEntries: nodeMapEntries.map(([key, entry]) => [key, entry]) }),
  };
}

/** Create a detached, JSON-store-compatible snapshot of a valid payload. */
export function cloneCachePayload(value: CachePayload): CachePayload {
  return buildCachePayload(value);
}

/** Serialize without relying on JSON's lossy Map representation. */
export function serializeCachePayload(value: CachePayload): string {
  const snapshot = cloneCachePayload(value);
  const wirePayload = {
    ...snapshot,
    result: {
      ...snapshot.result,
      nodeMap: undefined,
    },
  };
  const encoded = encodeCacheWireValue(
    wirePayload,
    {
      nodes: 0,
      stringBytes: 0,
      ancestors: new WeakSet<object>(),
    },
  );
  const serialized = JSON.stringify({
    [SERIALIZED_CACHE_ENVELOPE_KEY]: SERIALIZED_CACHE_ENVELOPE_VERSION,
    [CACHE_VALUE_FIELD]: encoded,
  });
  if (utf8Encoder.encode(serialized).byteLength > MAX_CACHE_PAYLOAD_UTF8_BYTES) {
    fail("serialized data is too large");
  }
  return serialized;
}

/** Validate untrusted store data and return a detached snapshot on success. */
export function parseCachePayload(value: unknown): CachePayload | undefined {
  try {
    return buildCachePayload(decodeSerializedCacheEnvelope(value));
  } catch {
    return undefined;
  }
}

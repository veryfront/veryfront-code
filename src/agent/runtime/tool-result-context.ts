import { pushPrivateArray } from "#veryfront/security/private-array.ts";
import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import {
  encodePrivateText,
  privateTextCharCodeAt,
  privateTextSlice,
} from "#veryfront/security/private-text.ts";

const hasOwn = Object.hasOwn;
const DEFAULT_MAX_INLINE_BYTES = 16_384;
const DEFAULT_PREVIEW_BYTES = 4_096;
const DEFAULT_MAX_SECTION_BYTES = 16_384;
const DEFAULT_MAX_STORED_RESULTS = 256;
const MAX_CONFIGURED_BYTES = 1_048_576;
const MAX_STORED_RESULTS = 1_024;
const MAX_STORED_RESULT_BYTES = 16 * 1_024 * 1_024;
const MAX_TOTAL_STORED_BYTES = 64 * 1_024 * 1_024;
const MIN_SECTION_BYTES = 4;
const TOOL_RESULT_REFERENCE_TYPE = "tool_result_reference";
const TOOL_RESULT_SECTION_TYPE = "tool_result_section";
const GET_TOOL_RESULT_TOOL_NAME = "veryfront__get_tool_result";
const MAX_POINTER_BYTES = 4_096;
const MAX_POINTER_DEPTH = 32;
const SLASH = 47;
const TILDE = 126;
const ZERO = 48;
const ONE = 49;
const ArrayIsArray = Array.isArray;
const ObjectKeys = Object.keys;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

export interface ToolResultContextLimits {
  readonly maxInlineBytes?: number;
  readonly previewBytes?: number;
  readonly maxSectionBytes?: number;
  readonly maxStoredResults?: number;
}

export interface ToolResultContextOptions {
  readonly limits?: ToolResultContextLimits;
}

export interface ToolResultDisclosureInput {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly result: unknown;
  /** Provider-only representation; identity and original access remain bound to result. */
  readonly modelResult?: unknown;
  readonly isError?: boolean;
}

export interface InlineToolResultDisclosure {
  readonly kind: "inline";
  readonly modelResult: unknown;
  readonly originalResult: unknown;
  readonly byteLength: number;
}

export interface ReferencedToolResultDisclosure {
  readonly kind: "reference";
  readonly modelResult: ToolResultReferencePayload;
  readonly originalResult: unknown;
  readonly byteLength: number;
}

export interface PreviewOnlyToolResultDisclosure {
  readonly kind: "preview";
  readonly modelResult: ToolResultPreviewOnlyPayload;
  readonly originalResult: unknown;
  readonly byteLength: number;
}

export type ToolResultDisclosure =
  | InlineToolResultDisclosure
  | ReferencedToolResultDisclosure
  | PreviewOnlyToolResultDisclosure;

export interface ToolResultPreviewOnlyPayload {
  readonly type: "tool_result_preview";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly totalBytes: number;
  readonly isError?: boolean;
  readonly preview: string;
  readonly previewBytes: number;
  readonly complete: false;
  readonly retrievalUnavailable: {
    readonly reason: "capacity_exceeded";
    readonly detail: string;
  };
}

export interface ToolResultReferencePayload {
  readonly type: typeof TOOL_RESULT_REFERENCE_TYPE;
  readonly ref: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly totalBytes: number;
  readonly isError?: boolean;
  readonly preview: string;
  readonly previewBytes: number;
  readonly complete: false;
  readonly retrieval: {
    readonly tool: typeof GET_TOOL_RESULT_TOOL_NAME;
    readonly input: {
      readonly ref: string;
      readonly cursor?: string;
      readonly maxBytes?: number;
    };
  };
}

/** `value` reads retained text; `structure` lists one level of JSON child pointer tokens. */
export type ToolResultView = "value" | "structure";

export interface ToolResultSectionRequest {
  readonly ref: string;
  readonly view?: ToolResultView;
  /** RFC 6901 pointer into the retained JSON snapshot. Cursors page the selected value. */
  readonly pointer?: string;
  readonly cursor?: string;
  readonly maxBytes?: number;
}

export interface ToolResultSection {
  readonly type: typeof TOOL_RESULT_SECTION_TYPE;
  readonly ref: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly view?: "structure";
  readonly pointer?: string;
  /** UTF-8 size of the selected text that cursors page through. */
  readonly totalBytes: number;
  readonly cursor: string;
  readonly nextCursor?: string;
  readonly done: boolean;
  readonly text: string;
  readonly byteLength: number;
}

type IdentityIndex = Map<string, string>;

interface StoredToolResult {
  readonly ref: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly originalResult: unknown;
  readonly isError?: boolean;
  readonly serialized: string;
  /** True when `serialized` is a JSON encoding of a non-string result. */
  readonly json: boolean;
  readonly byteLength: number;
}

interface ResolvedLimits {
  readonly maxInlineBytes: number;
  readonly previewBytes: number;
  readonly maxSectionBytes: number;
  readonly maxStoredResults: number;
}

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

function positiveInteger(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function atLeast(name: string, value: number, minimum: number): number {
  if (value < minimum) {
    throw new RangeError(`${name} must be at least ${minimum}`);
  }
  return value;
}

function atMost(name: string, value: number, maximum: number): number {
  if (value > maximum) {
    throw new RangeError(`${name} must be at most ${maximum}`);
  }
  return value;
}

export function resolveToolResultContextLimits(
  limits: ToolResultContextLimits | undefined,
): ResolvedLimits {
  return {
    maxInlineBytes: atMost(
      "maxInlineBytes",
      positiveInteger(
        "maxInlineBytes",
        limits?.maxInlineBytes,
        DEFAULT_MAX_INLINE_BYTES,
      ),
      MAX_CONFIGURED_BYTES,
    ),
    previewBytes: atMost(
      "previewBytes",
      positiveInteger("previewBytes", limits?.previewBytes, DEFAULT_PREVIEW_BYTES),
      MAX_CONFIGURED_BYTES,
    ),
    maxSectionBytes: atMost(
      "maxSectionBytes",
      atLeast(
        "maxSectionBytes",
        positiveInteger("maxSectionBytes", limits?.maxSectionBytes, DEFAULT_MAX_SECTION_BYTES),
        MIN_SECTION_BYTES,
      ),
      MAX_CONFIGURED_BYTES,
    ),
    maxStoredResults: atMost(
      "maxStoredResults",
      positiveInteger(
        "maxStoredResults",
        limits?.maxStoredResults,
        DEFAULT_MAX_STORED_RESULTS,
      ),
      MAX_STORED_RESULTS,
    ),
  };
}

function byteLength(value: string): number {
  return encodePrivateText(value).byteLength;
}

function safeSerializedResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  const serialized = privateJsonStringify(result);
  return serialized === undefined ? "undefined" : serialized;
}

function pointerNotFound(): ReferenceError {
  return new ReferenceError("JSON pointer was not found in the retained result");
}

function selectRetainedProperty(value: unknown, token: string): unknown {
  if (value === null || typeof value !== "object") throw pointerNotFound();
  if (
    ArrayIsArray(value) &&
    (token === "" || token === "length" ||
      (token.length > 1 && privateTextCharCodeAt(token, 0) === ZERO))
  ) throw pointerNotFound();
  const descriptor = ObjectGetOwnPropertyDescriptor(value, token);
  if (!descriptor) throw pointerNotFound();
  return descriptor.value;
}

function assertPointerDepth(depth: number): void {
  if (depth > MAX_POINTER_DEPTH) {
    throw new TypeError("Retained result JSON pointer exceeds the maximum depth");
  }
}

function decodePointerEscape(pointer: string, index: number): string {
  const escape = privateTextCharCodeAt(pointer, index);
  if (escape !== ZERO && escape !== ONE) {
    throw new TypeError("Invalid retained result JSON pointer escape");
  }
  return escape === ZERO ? "~" : "/";
}

/** Resolve an RFC 6901 pointer against own properties of the retained JSON snapshot. */
function selectRetainedJsonValue(serialized: string, pointer: string): unknown {
  if (
    byteLength(pointer) > MAX_POINTER_BYTES ||
    (pointer !== "" && privateTextCharCodeAt(pointer, 0) !== SLASH)
  ) {
    throw new TypeError("Invalid retained result JSON pointer");
  }
  let value: unknown = privateJsonParse(serialized);
  if (pointer === "") return value;
  let token = "";
  let depth = 0;
  for (let index = 1; index <= pointer.length; index++) {
    const code = index === pointer.length ? SLASH : privateTextCharCodeAt(pointer, index);
    if (code === SLASH) {
      assertPointerDepth(++depth);
      value = selectRetainedProperty(value, token);
      token = "";
    } else if (code === TILDE) {
      token += decodePointerEscape(pointer, ++index);
    } else {
      token += privateTextSlice(pointer, index, index + 1);
    }
  }
  return value;
}

function jsonValueType(value: unknown): string {
  if (value === null) return "null";
  return ArrayIsArray(value) ? "array" : typeof value;
}

function escapedPointerCharacter(key: string, index: number): string {
  const code = privateTextCharCodeAt(key, index);
  if (code === TILDE) return "~0";
  if (code === SLASH) return "~1";
  return privateTextSlice(key, index, index + 1);
}

function escapePointerToken(key: string): string {
  let token = "/";
  for (let index = 0; index < key.length; index++) {
    token += escapedPointerCharacter(key, index);
  }
  return token;
}

/** One level of child pointer tokens and JSON types, without field values. */
function describeRetainedStructure(value: unknown): string {
  const fields: { pointerToken: string; type: string }[] = [];
  if (value !== null && typeof value === "object") {
    const keys = ObjectKeys(value);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      pushPrivateArray(fields, {
        pointerToken: escapePointerToken(key),
        type: jsonValueType(descriptor.value),
      });
    }
  }
  // Each retained child contributes one field object and two scalar values.
  // Include the root, its type, the field array and its length as well.
  return privateJsonStringify(
    { type: jsonValueType(value), fields },
    null,
    undefined,
    3 * fields.length + 4,
  )!;
}

function selectRetainedText(record: StoredToolResult, request: ToolResultSectionRequest): string {
  const view = request.view ?? "value";
  if (view !== "value" && view !== "structure") {
    throw new TypeError("Invalid retained result view");
  }
  if (
    view === "value" && (request.pointer === undefined || (request.pointer === "" && record.json))
  ) return record.serialized;
  if (!record.json) throw new TypeError("Selected tool result is not JSON");
  const value = selectRetainedJsonValue(record.serialized, request.pointer ?? "");
  if (view === "structure") return describeRetainedStructure(value);
  return privateJsonStringify(value, null, undefined, record.serialized.length + 1)!;
}

function toolResultIdentityKey(
  input: Pick<ToolResultDisclosureInput, "toolCallId" | "toolName">,
): string {
  return `${input.toolCallId}\u0000${input.toolName}`;
}

function isObjectIdentity(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function sliceUnderUtf8Budget(value: string, start: number, maxBytes: number): {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly byteLength: number;
} {
  const boundedStart = adjustSurrogateStartBoundary(
    value,
    Math.min(Math.max(start, 0), value.length),
  );
  let low = boundedStart;
  let high = Math.min(value.length, boundedStart + maxBytes);
  let bestEnd = boundedStart;
  let bestText = "";
  let bestBytes = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const adjusted = adjustSurrogateBoundary(value, middle);
    const candidate = privateTextSlice(value, boundedStart, adjusted);
    const candidateBytes = byteLength(candidate);
    if (candidateBytes <= maxBytes) {
      bestEnd = adjusted;
      bestText = candidate;
      bestBytes = candidateBytes;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return { text: bestText, start: boundedStart, end: bestEnd, byteLength: bestBytes };
}

function adjustSurrogateStartBoundary(value: string, start: number): number {
  if (start <= 0 || start >= value.length) {
    return start;
  }
  const previous = privateTextCharCodeAt(value, start - 1);
  const current = privateTextCharCodeAt(value, start);
  if (
    previous >= HIGH_SURROGATE_MIN && previous <= HIGH_SURROGATE_MAX &&
    current >= LOW_SURROGATE_MIN && current <= LOW_SURROGATE_MAX
  ) {
    return start - 1;
  }
  return start;
}

function adjustSurrogateBoundary(value: string, end: number): number {
  if (end <= 0 || end >= value.length) {
    return end;
  }
  const previous = privateTextCharCodeAt(value, end - 1);
  const next = privateTextCharCodeAt(value, end);
  if (
    previous >= HIGH_SURROGATE_MIN && previous <= HIGH_SURROGATE_MAX &&
    next >= LOW_SURROGATE_MIN && next <= LOW_SURROGATE_MAX
  ) {
    return end - 1;
  }
  return end;
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") {
    return 0;
  }
  if (!/^(0|[1-9]\d*)$/.test(cursor)) {
    throw new RangeError("Tool result cursor must be a plain non-negative decimal integer string");
  }
  const parsed = Number(cursor);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError("Tool result cursor must be a safe integer string");
  }
  return parsed;
}

function createReferencePayload(
  record: StoredToolResult,
  previewBytes: number,
): ToolResultReferencePayload {
  const preview = sliceUnderUtf8Budget(record.serialized, 0, previewBytes);
  return {
    type: TOOL_RESULT_REFERENCE_TYPE,
    ref: record.ref,
    toolCallId: record.toolCallId,
    toolName: record.toolName,
    totalBytes: record.byteLength,
    ...(record.isError === true ? { isError: true } : {}),
    preview: preview.text,
    previewBytes: preview.byteLength,
    complete: false,
    retrieval: {
      tool: GET_TOOL_RESULT_TOOL_NAME,
      input: {
        ref: record.ref,
        maxBytes: Math.max(previewBytes, MIN_SECTION_BYTES),
      },
    },
  };
}

function createPreviewOnlyPayload(input: {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly serialized: string;
  readonly byteLength: number;
  readonly previewBytes: number;
  readonly detail: string;
  readonly isError?: boolean;
}): ToolResultPreviewOnlyPayload {
  const preview = sliceUnderUtf8Budget(input.serialized, 0, input.previewBytes);
  return {
    type: "tool_result_preview",
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    totalBytes: input.byteLength,
    ...(input.isError === true ? { isError: true } : {}),
    preview: preview.text,
    previewBytes: preview.byteLength,
    complete: false,
    retrievalUnavailable: {
      reason: "capacity_exceeded",
      detail: input.detail,
    },
  };
}

class ToolResultContextCapacityError extends RangeError {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

function capacityDetail(error: unknown): string | undefined {
  return error instanceof ToolResultContextCapacityError ? error.detail : undefined;
}

/** @internal Distinguish expected retention capacity failures from other errors. */
export function isToolResultContextCapacityError(error: unknown): boolean {
  return capacityDetail(error) !== undefined;
}

export class ToolResultContext {
  readonly #limits: ResolvedLimits;
  readonly #records = createPrivateMap<string, StoredToolResult>();
  #objectRefs = createPrivateWeakStore<object, IdentityIndex>();
  #primitiveRefs = createPrivateMap<unknown, IdentityIndex>();
  #totalStoredBytes = 0;
  #nextId = 1;
  // Retain only the most recent selection; continuation pages reuse its encoding.
  #selection?: {
    record: StoredToolResult;
    pointer: string | undefined;
    view: ToolResultView;
    text: string;
    byteLength: number;
  };

  constructor(options: ToolResultContextOptions = {}) {
    this.#limits = resolveToolResultContextLimits(options.limits);
  }

  disclose(input: ToolResultDisclosureInput): ToolResultDisclosure {
    return this.#disclose(input, false);
  }

  /** Retain an exact historical result for a model-only reference. Capacity errors propagate. */
  discloseReference(
    input: ToolResultDisclosureInput,
    options: { readonly previewBytes?: number } = {},
  ): ReferencedToolResultDisclosure {
    const disclosure = this.#disclose(input, true, options.previewBytes);
    if (disclosure.kind !== "reference") {
      throw new Error("Forced tool result disclosure did not create a reference");
    }
    return disclosure;
  }

  #disclose(
    input: ToolResultDisclosureInput,
    forceReference: boolean,
    requestedPreviewBytes?: number,
  ): ToolResultDisclosure {
    const previewBytes = requestedPreviewBytes === undefined ? this.#limits.previewBytes : Math.min(
      positiveInteger("previewBytes", requestedPreviewBytes, this.#limits.previewBytes),
      this.#limits.previewBytes,
    );
    const modelResult = hasOwn(input, "modelResult") ? input.modelResult : input.result;
    const serialized = safeSerializedResult(modelResult);
    const length = byteLength(serialized);
    if (!forceReference && length <= this.#limits.maxInlineBytes) {
      return {
        kind: "inline",
        modelResult,
        originalResult: input.result,
        byteLength: length,
      };
    }

    const existing = this.#findByIdentity(input);
    if (existing) {
      return {
        kind: "reference",
        modelResult: createReferencePayload(existing, previewBytes),
        originalResult: input.result,
        byteLength: existing.byteLength,
      };
    }

    const record = this.#store({
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      originalResult: input.result,
      ...(input.isError === true ? { isError: true } : {}),
      serialized,
      json: typeof modelResult !== "string" && serialized !== "undefined",
      byteLength: length,
    });
    return {
      kind: "reference",
      modelResult: createReferencePayload(record, previewBytes),
      originalResult: input.result,
      byteLength: length,
    };
  }

  discloseForModelContext(input: ToolResultDisclosureInput): ToolResultDisclosure {
    try {
      return this.disclose(input);
    } catch (error) {
      const detail = capacityDetail(error);
      if (detail === undefined) {
        throw error;
      }
      const modelResult = hasOwn(input, "modelResult") ? input.modelResult : input.result;
      const serialized = safeSerializedResult(modelResult);
      const length = byteLength(serialized);
      return {
        kind: "preview",
        modelResult: createPreviewOnlyPayload({
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          serialized,
          byteLength: length,
          previewBytes: this.#limits.previewBytes,
          detail,
          ...(input.isError === true ? { isError: true } : {}),
        }),
        originalResult: input.result,
        byteLength: length,
      };
    }
  }

  read(request: ToolResultSectionRequest): ToolResultSection {
    const record = this.#records.get(request.ref);
    if (!record) {
      throw new ReferenceError("Tool result reference was not found in this run");
    }
    const cursor = parseCursor(request.cursor);
    const maxBytes = atLeast(
      "maxBytes",
      positiveInteger("maxBytes", request.maxBytes, this.#limits.maxSectionBytes),
      MIN_SECTION_BYTES,
    );
    const boundedBytes = Math.min(maxBytes, this.#limits.maxSectionBytes);
    const view = request.view ?? "value";
    const cached = this.#selection;
    const reused = cached?.record === record && cached.pointer === request.pointer &&
      cached.view === view;
    const selected = reused ? cached.text : selectRetainedText(record, request);
    let selectedBytes: number;
    if (reused) selectedBytes = cached.byteLength;
    else if (view === "value" && (request.pointer === undefined || request.pointer === "")) {
      selectedBytes = record.byteLength;
    } else selectedBytes = byteLength(selected);
    this.#selection = {
      record,
      pointer: request.pointer,
      view,
      text: selected,
      byteLength: selectedBytes,
    };
    const section = sliceUnderUtf8Budget(selected, cursor, boundedBytes);
    const nextCursor = section.end < selected.length ? String(section.end) : undefined;
    return {
      type: TOOL_RESULT_SECTION_TYPE,
      ref: record.ref,
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      ...(request.view === "structure" ? { view: "structure" as const } : {}),
      ...(request.pointer !== undefined ? { pointer: request.pointer } : {}),
      totalBytes: selectedBytes,
      cursor: String(section.start),
      ...(nextCursor ? { nextCursor } : {}),
      done: nextCursor === undefined,
      text: section.text,
      byteLength: section.byteLength,
    };
  }

  getOriginalResult(ref: string): unknown {
    const record = this.#records.get(ref);
    if (!record) {
      throw new ReferenceError("Tool result reference was not found in this run");
    }
    return record.originalResult;
  }

  delete(ref: string): boolean {
    const record = this.#records.get(ref);
    if (!record) {
      return false;
    }
    this.#records.delete(ref);
    if (this.#selection?.record === record) this.#selection = undefined;
    this.#totalStoredBytes -= record.byteLength;
    this.#forgetIdentity(record);
    return true;
  }

  clear(): void {
    this.#selection = undefined;
    this.#records.clear();
    this.#objectRefs = createPrivateWeakStore();
    this.#primitiveRefs = createPrivateMap();
    this.#totalStoredBytes = 0;
  }

  /** @internal Test-only diagnostics for storage-accounting regressions. */
  __getDiagnosticsForTests(): {
    readonly totalStoredBytes: number;
    readonly primitiveIdentityValues: number;
    readonly primitiveIdentityEntries: number;
  } {
    let primitiveIdentityEntries = 0;
    for (const index of this.#primitiveRefs.values()) {
      primitiveIdentityEntries += index.size;
    }
    return {
      totalStoredBytes: this.#totalStoredBytes,
      primitiveIdentityValues: this.#primitiveRefs.size,
      primitiveIdentityEntries,
    };
  }

  get size(): number {
    return this.#records.size;
  }

  #store(input: Omit<StoredToolResult, "ref">): StoredToolResult {
    this.#ensureCapacity(input.byteLength);
    const ref = `tool_result_${this.#nextId}`;
    this.#nextId += 1;
    const record: StoredToolResult = {
      ref,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      originalResult: input.originalResult,
      ...(input.isError === true ? { isError: true } : {}),
      serialized: input.serialized,
      json: input.json,
      byteLength: input.byteLength,
    };
    this.#records.set(ref, record);
    this.#totalStoredBytes += record.byteLength;
    this.#rememberIdentity(record);
    return record;
  }

  #findByIdentity(input: ToolResultDisclosureInput): StoredToolResult | undefined {
    const identityKey = toolResultIdentityKey(input);
    const index = isObjectIdentity(input.result)
      ? this.#objectRefs.get(input.result)
      : this.#primitiveRefs.get(input.result);
    const ref = index?.get(identityKey);
    if (!ref) {
      return undefined;
    }
    return this.#records.get(ref);
  }

  #rememberIdentity(record: StoredToolResult): void {
    const identityKey = toolResultIdentityKey(record);
    if (isObjectIdentity(record.originalResult)) {
      const existing = this.#objectRefs.get(record.originalResult) ?? createPrivateMap();
      existing.set(identityKey, record.ref);
      this.#objectRefs.set(record.originalResult, existing);
      return;
    }

    const existing = this.#primitiveRefs.get(record.originalResult) ?? createPrivateMap();
    existing.set(identityKey, record.ref);
    this.#primitiveRefs.set(record.originalResult, existing);
  }

  #forgetIdentity(record: StoredToolResult): void {
    const identityKey = toolResultIdentityKey(record);
    if (isObjectIdentity(record.originalResult)) {
      this.#objectRefs.get(record.originalResult)?.delete(identityKey);
      return;
    }

    const existing = this.#primitiveRefs.get(record.originalResult);
    if (!existing) {
      return;
    }
    existing.delete(identityKey);
    if (existing.size === 0) {
      this.#primitiveRefs.delete(record.originalResult);
    }
  }

  #ensureCapacity(byteLength: number): void {
    if (byteLength > MAX_STORED_RESULT_BYTES) {
      throw new ToolResultContextCapacityError(
        "Tool result exceeds the per-result storage limit",
        "per-result storage limit exceeded",
      );
    }
    if (this.#records.size >= this.#limits.maxStoredResults) {
      throw new ToolResultContextCapacityError(
        "Tool result context stored result limit exceeded",
        "stored result limit exceeded",
      );
    }
    if (this.#totalStoredBytes + byteLength > MAX_TOTAL_STORED_BYTES) {
      throw new ToolResultContextCapacityError(
        "Tool result context total storage limit exceeded",
        "total storage limit exceeded",
      );
    }
  }
}

export function createToolResultContext(options: ToolResultContextOptions = {}): ToolResultContext {
  return new ToolResultContext(options);
}

/**
 * Tool-limit slots to keep for the framework `veryfront__get_tool_result` reader, which
 * the runtime appends after tool selection whenever tool-result context is on.
 */
export function getToolResultReaderReservedToolSlots(toolResultContext: unknown): number {
  return toolResultContext === true ||
      (typeof toolResultContext === "object" && toolResultContext !== null)
    ? 1
    : 0;
}

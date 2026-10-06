import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import {
  encodePrivateText,
  privateTextCharCodeAt,
  privateTextSlice,
} from "#veryfront/security/private-text.ts";

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
const GET_TOOL_RESULT_TOOL_NAME = "get_tool_result";

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

export type ToolResultDisclosure = InlineToolResultDisclosure | ReferencedToolResultDisclosure;

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

export interface ToolResultSectionRequest {
  readonly ref: string;
  readonly cursor?: string;
  readonly maxBytes?: number;
}

export interface ToolResultSection {
  readonly type: typeof TOOL_RESULT_SECTION_TYPE;
  readonly ref: string;
  readonly toolCallId: string;
  readonly toolName: string;
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

function resolveLimits(limits: ToolResultContextLimits | undefined): ResolvedLimits {
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

  const serialized = privateJsonStringify(result, null, 2);
  return serialized === undefined ? "undefined" : serialized;
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
  readonly end: number;
  readonly byteLength: number;
} {
  const boundedStart = Math.min(Math.max(start, 0), value.length);
  let low = boundedStart;
  let high = value.length;
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

  return { text: bestText, end: bestEnd, byteLength: bestBytes };
}

function adjustSurrogateBoundary(value: string, end: number): number {
  if (end <= 0 || end >= value.length) {
    return end;
  }
  const previous = privateTextCharCodeAt(value, end - 1);
  if (previous >= HIGH_SURROGATE_MIN && previous <= HIGH_SURROGATE_MAX) {
    return end - 1;
  }
  return end;
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") {
    return 0;
  }
  const parsed = Number(cursor);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError("Tool result cursor must be a non-negative integer string");
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

export class ToolResultContext {
  readonly #limits: ResolvedLimits;
  readonly #records = createPrivateMap<string, StoredToolResult>();
  #objectRefs = createPrivateWeakStore<object, IdentityIndex>();
  #primitiveRefs = createPrivateMap<unknown, IdentityIndex>();
  #totalStoredBytes = 0;
  #nextId = 1;

  constructor(options: ToolResultContextOptions = {}) {
    this.#limits = resolveLimits(options.limits);
  }

  disclose(input: ToolResultDisclosureInput): ToolResultDisclosure {
    const serialized = safeSerializedResult(input.result);
    const length = byteLength(serialized);
    if (length <= this.#limits.maxInlineBytes) {
      return {
        kind: "inline",
        modelResult: input.result,
        originalResult: input.result,
        byteLength: length,
      };
    }

    const existing = this.#findByIdentity(input);
    if (existing) {
      return {
        kind: "reference",
        modelResult: createReferencePayload(existing, this.#limits.previewBytes),
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
      byteLength: length,
    });
    return {
      kind: "reference",
      modelResult: createReferencePayload(record, this.#limits.previewBytes),
      originalResult: input.result,
      byteLength: length,
    };
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
    const section = sliceUnderUtf8Budget(record.serialized, cursor, boundedBytes);
    const nextCursor = section.end < record.serialized.length ? String(section.end) : undefined;
    return {
      type: TOOL_RESULT_SECTION_TYPE,
      ref: record.ref,
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      totalBytes: record.byteLength,
      cursor: String(cursor),
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
    this.#totalStoredBytes -= record.byteLength;
    this.#forgetIdentity(record);
    return true;
  }

  clear(): void {
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
      throw new RangeError("Tool result exceeds the per-result storage limit");
    }
    if (this.#records.size >= this.#limits.maxStoredResults) {
      throw new RangeError("Tool result context stored result limit exceeded");
    }
    if (this.#totalStoredBytes + byteLength > MAX_TOTAL_STORED_BYTES) {
      throw new RangeError("Tool result context total storage limit exceeded");
    }
  }
}

export function createToolResultContext(options: ToolResultContextOptions = {}): ToolResultContext {
  return new ToolResultContext(options);
}

/**
 * Core-owned Skill document envelope and parser-provider boundary.
 *
 * YAML decoding is extension-owned. Core bounds the authored document before
 * dispatch and captures the decoded value as an owned data-only mapping.
 */

import { resolve } from "../extensions/contracts.ts";
import {
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
  snapshotSkillDocumentParserProvider,
} from "../extensions/parser/skill-document-parser.ts";
import { isProxyWithoutHooks } from "../errors/safe-diagnostics.ts";
import { SKILL_DOCUMENT_MAX_CHARACTERS } from "./limits.ts";
import { isWellFormedUtf16 } from "./string-safety.ts";

const SKILL_FRONTMATTER_MAX_DEPTH = 32;
const SKILL_FRONTMATTER_MAX_NODES = 8_192;
const SKILL_FRONTMATTER_MAX_CONTAINER_ENTRIES = 2_048;
const SKILL_FRONTMATTER_MAX_SNAPSHOT_CHARACTERS = SKILL_DOCUMENT_MAX_CHARACTERS;

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const arrayPrototype = Array.prototype;
const NativeArray = Array;
const NativeRangeError = RangeError;
const NativeSyntaxError = SyntaxError;
const NativeTypeError = TypeError;
const NativeWeakSet = WeakSet;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const objectPrototype = Object.prototype;
const reflectOwnKeys = Reflect.ownKeys;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringSlice = String.prototype.slice;
const stringTrim = String.prototype.trim;
const weakSetAdd = WeakSet.prototype.add;
const weakSetDelete = WeakSet.prototype.delete;
const weakSetHas = WeakSet.prototype.has;

/** Result of splitting and decoding one bounded `SKILL.md` document. */
export interface ParsedSkillContent {
  frontmatter: Record<string, unknown>;
  body: string;
}

interface SnapshotState {
  readonly ancestors: WeakSet<object>;
  nodes: number;
  characters: number;
}

function call<T>(
  fn: (...args: never[]) => T,
  receiver: unknown,
  args: unknown[],
): T {
  return apply(fn, receiver, args) as T;
}

function invalidFrontmatter(): never {
  throw new NativeTypeError(
    "Skill frontmatter must be a bounded, acyclic, data-only mapping",
  );
}

function hasOwn(value: PropertyDescriptor, key: PropertyKey): boolean {
  return call(objectHasOwnProperty, value, [key]);
}

function ownDataValue(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = call(objectGetOwnPropertyDescriptor, Object, [value, key]);
  } catch {
    return invalidFrontmatter();
  }
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !hasOwn(descriptor, "value")
  ) {
    return invalidFrontmatter();
  }
  return descriptor.value;
}

function addCharacters(state: SnapshotState, count: number): void {
  if (count > SKILL_FRONTMATTER_MAX_SNAPSHOT_CHARACTERS - state.characters) {
    invalidFrontmatter();
  }
  state.characters += count;
}

function beginValue(state: SnapshotState, depth: number): void {
  if (
    depth > SKILL_FRONTMATTER_MAX_DEPTH ||
    state.nodes >= SKILL_FRONTMATTER_MAX_NODES
  ) {
    invalidFrontmatter();
  }
  state.nodes += 1;
}

function snapshotArrayValue(
  value: unknown[],
  depth: number,
  state: SnapshotState,
): unknown[] {
  let prototype: object | null;
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    prototype = call(objectGetPrototypeOf, Object, [value]);
    lengthDescriptor = call(objectGetOwnPropertyDescriptor, Object, [
      value,
      "length",
    ]);
  } catch {
    return invalidFrontmatter();
  }
  if (
    prototype !== arrayPrototype ||
    lengthDescriptor === undefined ||
    !hasOwn(lengthDescriptor, "value") ||
    lengthDescriptor.enumerable !== false ||
    !call(numberIsSafeInteger, Number, [lengthDescriptor.value]) ||
    (lengthDescriptor.value as number) < 0 ||
    (lengthDescriptor.value as number) >
      SKILL_FRONTMATTER_MAX_CONTAINER_ENTRIES
  ) {
    return invalidFrontmatter();
  }

  const length = lengthDescriptor.value as number;
  let keys: PropertyKey[];
  try {
    keys = call(reflectOwnKeys, Reflect, [value]);
  } catch {
    return invalidFrontmatter();
  }
  if (keys.length !== length + 1) return invalidFrontmatter();

  const snapshot = new NativeArray<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    call(objectDefineProperty, Object, [snapshot, index, {
      configurable: true,
      enumerable: true,
      value: snapshotValue(
        ownDataValue(value, `${index}`),
        depth + 1,
        state,
      ),
      writable: true,
    }]);
  }
  return snapshot;
}

function snapshotRecordValue(
  value: object,
  depth: number,
  state: SnapshotState,
): Record<string, unknown> {
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = call(objectGetPrototypeOf, Object, [value]);
    keys = call(reflectOwnKeys, Reflect, [value]);
  } catch {
    return invalidFrontmatter();
  }
  if (
    (prototype !== objectPrototype && prototype !== null) ||
    keys.length > SKILL_FRONTMATTER_MAX_CONTAINER_ENTRIES
  ) {
    return invalidFrontmatter();
  }

  const snapshot = call<Record<string, unknown>>(objectCreate, Object, [null]);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") return invalidFrontmatter();
    if (!isWellFormedUtf16(key)) return invalidFrontmatter();
    addCharacters(state, key.length);
    const child = snapshotValue(
      ownDataValue(value, key),
      depth + 1,
      state,
    );
    call(objectDefineProperty, Object, [snapshot, key, {
      configurable: true,
      enumerable: true,
      value: child,
      writable: true,
    }]);
  }
  return snapshot;
}

function snapshotValue(
  value: unknown,
  depth: number,
  state: SnapshotState,
): unknown {
  beginValue(state, depth);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (!isWellFormedUtf16(value)) return invalidFrontmatter();
    addCharacters(state, value.length);
    return value;
  }
  if (typeof value === "number") {
    if (!call(numberIsFinite, Number, [value])) return invalidFrontmatter();
    return value;
  }
  if (typeof value !== "object") return invalidFrontmatter();

  let isProxy: boolean;
  try {
    isProxy = isProxyWithoutHooks(value);
  } catch {
    return invalidFrontmatter();
  }
  if (isProxy || call(weakSetHas, state.ancestors, [value])) {
    return invalidFrontmatter();
  }
  call(weakSetAdd, state.ancestors, [value]);
  try {
    return call(arrayIsArray, Array, [value])
      ? snapshotArrayValue(value as unknown[], depth, state)
      : snapshotRecordValue(value, depth, state);
  } finally {
    call(weakSetDelete, state.ancestors, [value]);
  }
}

/**
 * Detach an extension-decoded YAML value into a core-owned mapping.
 */
export function snapshotSkillFrontmatterMapping(
  value: unknown,
): Record<string, unknown> {
  if (value === null || typeof value !== "object") return invalidFrontmatter();
  let isProxy: boolean;
  try {
    isProxy = isProxyWithoutHooks(value);
  } catch {
    return invalidFrontmatter();
  }
  if (isProxy || call(arrayIsArray, Array, [value])) {
    return invalidFrontmatter();
  }

  const snapshot = snapshotValue(value, 0, {
    ancestors: new NativeWeakSet<object>(),
    characters: 0,
    nodes: 0,
  });
  if (
    snapshot === null || typeof snapshot !== "object" ||
    call(arrayIsArray, Array, [snapshot])
  ) {
    return invalidFrontmatter();
  }
  return snapshot as Record<string, unknown>;
}

function charCodeAt(value: string, index: number): number {
  return call(stringCharCodeAt, value, [index]);
}

function slice(value: string, start: number, end?: number): string {
  return end === undefined
    ? call(stringSlice, value, [start])
    : call(stringSlice, value, [start, end]);
}

function firstFrontmatterLineStart(content: string): number | undefined {
  if (
    content.length >= 4 &&
    charCodeAt(content, 0) === 0x2d &&
    charCodeAt(content, 1) === 0x2d &&
    charCodeAt(content, 2) === 0x2d
  ) {
    if (charCodeAt(content, 3) === 0x0a) return 4;
    if (
      content.length >= 5 &&
      charCodeAt(content, 3) === 0x0d &&
      charCodeAt(content, 4) === 0x0a
    ) {
      return 5;
    }
  }
  return undefined;
}

function findLineFeed(content: string, start: number): number {
  for (let index = start; index < content.length; index += 1) {
    if (charCodeAt(content, index) === 0x0a) return index;
  }
  return -1;
}

function splitSkillDocumentEnvelope(content: string): {
  body: string;
  frontmatterSource?: string;
} {
  const firstLineStart = firstFrontmatterLineStart(content);
  if (firstLineStart === undefined) return { body: content };

  let lineStart = firstLineStart;
  while (lineStart <= content.length) {
    const lineFeed = findLineFeed(content, lineStart);
    const lineEnd = lineFeed === -1 ? content.length : lineFeed;
    const contentEnd = lineEnd > lineStart &&
        charCodeAt(content, lineEnd - 1) === 0x0d
      ? lineEnd - 1
      : lineEnd;
    if (slice(content, lineStart, contentEnd) === "---") {
      let frontmatterEnd = lineStart;
      if (
        frontmatterEnd > firstLineStart &&
        charCodeAt(content, frontmatterEnd - 1) === 0x0a
      ) {
        frontmatterEnd -= 1;
        if (
          frontmatterEnd > firstLineStart &&
          charCodeAt(content, frontmatterEnd - 1) === 0x0d
        ) {
          frontmatterEnd -= 1;
        }
      }
      return {
        body: lineFeed === -1 ? "" : slice(content, lineFeed + 1),
        frontmatterSource: slice(
          content,
          firstLineStart,
          frontmatterEnd,
        ),
      };
    }
    if (lineFeed === -1) break;
    lineStart = lineFeed + 1;
  }

  throw new NativeSyntaxError(
    "Skill document is missing a closing frontmatter delimiter",
  );
}

/**
 * Parse one bounded Skill document with an explicit provider or the active
 * extension contract generation.
 */
export function parseBoundedSkillDocument(
  content: string,
  provider?: SkillDocumentParserProvider,
): ParsedSkillContent {
  if (typeof content !== "string") {
    throw new NativeTypeError("Skill document content must be a string");
  }
  if (!isWellFormedUtf16(content)) {
    throw new NativeTypeError("Skill document content must contain well-formed UTF-16");
  }
  if (content.length > SKILL_DOCUMENT_MAX_CHARACTERS) {
    throw new NativeRangeError(
      `Skill document exceeds ${SKILL_DOCUMENT_MAX_CHARACTERS} characters`,
    );
  }

  const envelope = splitSkillDocumentEnvelope(content);
  if (envelope.frontmatterSource === undefined) {
    return { frontmatter: {}, body: envelope.body };
  }
  const normalized = call<string>(
    stringTrim,
    envelope.frontmatterSource,
    [],
  );
  if (normalized.length === 0) {
    return { frontmatter: {}, body: envelope.body };
  }

  const resolved = provider === undefined
    ? resolve<unknown>(SkillDocumentParserProviderName)
    : provider;
  const parser = snapshotSkillDocumentParserProvider(resolved);
  let decoded: unknown;
  try {
    decoded = parser.parseFrontmatter(envelope.frontmatterSource);
  } catch {
    throw new NativeSyntaxError("Skill frontmatter could not be decoded");
  }

  return {
    frontmatter: snapshotSkillFrontmatterMapping(decoded),
    body: envelope.body,
  };
}

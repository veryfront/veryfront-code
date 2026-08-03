/**
 * Secret / credential redaction for structured log context.
 *
 * Defense-in-depth (#1989): the logger, the error-logging path, and the
 * observability log buffer all accept arbitrary `context`/`data` objects from
 * callers and serialize them to log sinks. There is no guarantee a caller
 * never hands us a tokens object, an `Authorization` header bag, or a request
 * body with a password field. This pass masks values whose *key* looks like a
 * credential before serialization, so an accidental
 * `logger.info("...", { authorization: token })` cannot leak the secret.
 *
 * Sensitive keys are masked and every string value is scrubbed for credentials
 * embedded in URL userinfo, query parameters, or fragment parameters. The
 * deny-list errs toward over-redaction — masking a benign `tokenCount` is
 * acceptable; leaking a real token is not. The traversal fails *closed*: on a
 * cycle, depth overflow, or a throwing getter it returns {@link REDACTED}
 * rather than risk emitting an unredacted object.
 */

/** Replacement value substituted for any sensitive field. */
export const REDACTED = "[REDACTED]";

const apply = Reflect.apply;
const arrayPop = Array.prototype.pop;
const arrayPush = Array.prototype.push;
const NativeUint32Array = Uint32Array;
const arrayIsArray = Array.isArray;
const arrayPrototype = Array.prototype;
const bigIntToString = BigInt.prototype.toString;
const NativeMap = Map;
const mapDelete = Map.prototype.delete;
const mapGet = Map.prototype.get;
const mapKeys = Map.prototype.keys;
const mapSet = Map.prototype.set;
const objectDefineProperty = Object.defineProperty;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectPrototype = Object.prototype;
const NativeSet = Set;
const nativeDecodeURIComponent = decodeURIComponent;
const NativeURL = URL;
const numberIsFinite = Number.isFinite;
const numberIsInteger = Number.isInteger;
const regExpExec = RegExp.prototype.exec;
const regExpGlobalGetter = objectGetOwnPropertyDescriptor(RegExp.prototype, "global")!.get!;
const regExpUnicodeGetter = objectGetOwnPropertyDescriptor(RegExp.prototype, "unicode")!.get!;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringIncludes = String.prototype.includes;
const stringIndexOf = String.prototype.indexOf;
const stringSlice = String.prototype.slice;
const stringStartsWith = String.prototype.startsWith;
const stringToLowerCase = String.prototype.toLowerCase;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setHas = Set.prototype.has;
const mapIteratorNext = objectGetPrototypeOf(new NativeMap().keys()).next;
const mapSizeGetter = objectGetOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const urlHostGetter = objectGetOwnPropertyDescriptor(NativeURL.prototype, "host")!.get!;
const urlOriginGetter = objectGetOwnPropertyDescriptor(NativeURL.prototype, "origin")!.get!;
const urlPasswordGetter = objectGetOwnPropertyDescriptor(NativeURL.prototype, "password")!.get!;
const urlPathnameGetter = objectGetOwnPropertyDescriptor(NativeURL.prototype, "pathname")!.get!;
const urlProtocolGetter = objectGetOwnPropertyDescriptor(NativeURL.prototype, "protocol")!.get!;
const urlUsernameGetter = objectGetOwnPropertyDescriptor(NativeURL.prototype, "username")!.get!;
const NON_ALPHANUMERIC_PATTERN = /[^a-z0-9]/g;
const CAMEL_CASE_BOUNDARY_PATTERN = /([a-z0-9])([A-Z])/g;
const ACRONYM_BOUNDARY_PATTERN = /([A-Z])([A-Z][a-z])/g;
const PROVIDER_CREDENTIAL_PATTERN =
  /\b(?:sk-[A-Za-z0-9._-]{8,}|gh[po]_[A-Za-z0-9._-]{8,}|xox[baprs]-[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9._-]{8,})\b/g;

function replaceWithCapturedExec(
  input: string,
  pattern: RegExp,
  replacement: string | ((match: RegExpExecArray) => string),
): string {
  const global = apply(regExpGlobalGetter, pattern, []) as boolean;
  const unicode = apply(regExpUnicodeGetter, pattern, []) as boolean;
  let cursor = 0;
  let matched = false;
  let result = "";

  pattern.lastIndex = 0;
  try {
    while (true) {
      const match = apply(regExpExec, pattern, [input]) as RegExpExecArray | null;
      if (match === null) break;

      const text = match[0];
      const start = match.index;
      result += sliceString(input, cursor, start);
      result += typeof replacement === "string" ? replacement : replacement(match);
      cursor = start + text.length;
      matched = true;

      if (!global) break;
      if (text.length === 0) {
        pattern.lastIndex = advanceStringIndex(input, start, unicode);
      }
    }
  } finally {
    pattern.lastIndex = 0;
  }

  return matched ? result + sliceString(input, cursor) : input;
}

/** Strip all non-alphanumeric characters and lowercase, used for key normalization. */
function normalizeToAlphanumeric(s: string): string {
  const lowercase = apply(stringToLowerCase, s, []) as string;
  return replaceWithCapturedExec(lowercase, NON_ALPHANUMERIC_PATTERN, "");
}

const FORWARD_SLASH_CODE_UNIT = 47;
const BACKSLASH_CODE_UNIT = 92;
const COLON_CODE_UNIT = 58;
const ASCII_UPPERCASE_A_CODE_UNIT = 65;
const ASCII_UPPERCASE_Z_CODE_UNIT = 90;
const ASCII_LOWERCASE_OFFSET = 32;

function stringCodeUnitAt(value: string, index: number): number {
  return apply(stringCharCodeAt, value, [index]) as number;
}

function advanceStringIndex(value: string, index: number, unicode: boolean): number {
  const next = index + 1;
  if (!unicode || next >= value.length) return next;

  const first = stringCodeUnitAt(value, index);
  if (first < 0xd800 || first > 0xdbff) return next;
  const second = stringCodeUnitAt(value, next);
  return second >= 0xdc00 && second <= 0xdfff ? index + 2 : next;
}

function sliceString(value: string, start: number, end?: number): string {
  return end === undefined
    ? apply(stringSlice, value, [start]) as string
    : apply(stringSlice, value, [start, end]) as string;
}

function isPathSeparatorCodeUnit(codeUnit: number): boolean {
  return codeUnit === FORWARD_SLASH_CODE_UNIT || codeUnit === BACKSLASH_CODE_UNIT;
}

function isAsciiLetterCodeUnit(codeUnit: number): boolean {
  const lowercase = codeUnit >= ASCII_UPPERCASE_A_CODE_UNIT &&
      codeUnit <= ASCII_UPPERCASE_Z_CODE_UNIT
    ? codeUnit + ASCII_LOWERCASE_OFFSET
    : codeUnit;
  return lowercase >= 97 && lowercase <= 122;
}

function splitIdentifierTokens(value: string): string[] {
  const tokens: string[] = [];
  let tokenStart = 0;

  for (let index = 0; index <= value.length; index++) {
    const codeUnit = index === value.length ? -1 : stringCodeUnitAt(value, index);
    const isIdentifierCodeUnit = (codeUnit >= 97 && codeUnit <= 122) ||
      (codeUnit >= 48 && codeUnit <= 57);
    if (isIdentifierCodeUnit) continue;

    if (index > tokenStart) {
      tokens[tokens.length] = sliceString(value, tokenStart, index);
    }
    tokenStart = index + 1;
  }

  return tokens;
}

function isWindowsPath(path: string): boolean {
  if (path.length >= 2) {
    const first = stringCodeUnitAt(path, 0);
    const second = stringCodeUnitAt(path, 1);
    if (isPathSeparatorCodeUnit(first) && isPathSeparatorCodeUnit(second)) return true;
  }
  return path.length >= 3 &&
    isAsciiLetterCodeUnit(stringCodeUnitAt(path, 0)) &&
    stringCodeUnitAt(path, 1) === COLON_CODE_UNIT &&
    isPathSeparatorCodeUnit(stringCodeUnitAt(path, 2));
}

function normalizePathCodeUnit(codeUnit: number, foldAsciiCase: boolean): number {
  if (isPathSeparatorCodeUnit(codeUnit)) return FORWARD_SLASH_CODE_UNIT;
  return foldAsciiCase &&
      codeUnit >= ASCII_UPPERCASE_A_CODE_UNIT &&
      codeUnit <= ASCII_UPPERCASE_Z_CODE_UNIT
    ? codeUnit + ASCII_LOWERCASE_OFFSET
    : codeUnit;
}

/**
 * Replace every non-overlapping occurrence of a trusted path in untrusted text.
 *
 * Comparison treats slash and backslash as equivalent. Windows drive and UNC
 * paths additionally use ASCII-only case folding, matching Windows path
 * identity without locale-sensitive conversion. The linear-time matcher keeps
 * the path literal: regex syntax in either input cannot change what matches.
 */
export function redactPathFromText(
  input: string,
  path: string,
  replacement: string,
): string {
  if (path.length === 0 || input.length < path.length) return input;

  const foldAsciiCase = isWindowsPath(path);
  const patternLength = path.length;
  const pattern = new NativeUint32Array(patternLength);
  const prefixTable = new NativeUint32Array(patternLength);
  for (let index = 0; index < patternLength; index++) {
    pattern[index] = normalizePathCodeUnit(
      stringCodeUnitAt(path, index),
      foldAsciiCase,
    );
  }

  prefixTable[0] = 0;
  for (let index = 1, prefixLength = 0; index < patternLength;) {
    if (pattern[index] === pattern[prefixLength]) {
      prefixTable[index] = ++prefixLength;
      index++;
    } else if (prefixLength > 0) {
      prefixLength = prefixTable[prefixLength - 1]!;
    } else {
      prefixTable[index] = 0;
      index++;
    }
  }

  let result = "";
  let copyStart = 0;
  let matchLength = 0;
  for (let index = 0; index < input.length; index++) {
    const codeUnit = normalizePathCodeUnit(
      stringCodeUnitAt(input, index),
      foldAsciiCase,
    );
    while (matchLength > 0 && codeUnit !== pattern[matchLength]) {
      matchLength = prefixTable[matchLength - 1]!;
    }
    if (codeUnit === pattern[matchLength]) matchLength++;
    if (matchLength !== patternLength) continue;

    const matchStart = index - patternLength + 1;
    result += apply(stringSlice, input, [copyStart, matchStart]) as string;
    result += replacement;
    copyStart = index + 1;
    matchLength = 0;
  }

  return copyStart === 0 ? input : result + (apply(stringSlice, input, [copyStart]) as string);
}

/**
 * Normalized substrings that mark a key as sensitive. Matching is done against
 * a lowercased, non-alphanumeric-stripped form of the key, so `API-Key`,
 * `api_key`, and `apiKey` all collapse to `apikey` and match.
 *
 * Bare `"auth"` is matched separately as an exact normalized key so `author`
 * remains visible. Short tokens like `"dsn"`/`"sas"` are deliberately omitted
 * to avoid masking keys such as `feedsNamespace`.
 */
const SENSITIVE_KEY_PATTERNS = [
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "secret",
  "clientsecret",
  "token",
  "apikey",
  "accesskey",
  "privatekey",
  "credential",
  "authheader",
  "authorization",
  "cookie",
  "bearer",
  "jwt",
  "connectionstring",
  "signature",
  "sessionid",
  "sid",
  "otp",
  "mfa",
  "pin",
  "salt",
  "xsrf",
  "csrf",
] as const;

const SENSITIVE_KEY_CACHE_MAX_SIZE = 512;
/** Avoid retaining attacker-controlled, oversized property names in the cache. */
const SENSITIVE_KEY_CACHE_MAX_KEY_LENGTH = 128;
const sensitiveKeyCache = new NativeMap<string, boolean>();

/** Stop traversing past this depth to keep the pass cheap and stack-safe. */
const MAX_DEPTH = 16;
/** Bound every individual array/object before allocating a redacted copy. */
const MAX_CONTAINER_ENTRIES = 1_024;
/** Bound aggregate work across an entire redaction call, not per branch. */
const MAX_TRAVERSAL_NODES = 4_096;
/** Bound hostile or cyclic prototype walks while looking for serializers. */
const MAX_SERIALIZATION_HOOK_PROTOTYPES = 64;
/** Bound the quadratic identifier-token scan used for free-text assignments. */
const MAX_ASSIGNMENT_KEY_LENGTH = 256;

/**
 * Whether a context key names a credential and should have its value masked.
 *
 * Uses substring matching on a normalized key, so `clientSecret`,
 * `x-api-key`, and `refresh_token` all match while benign words that merely
 * *contain* a pattern as a separate token (e.g. `author`) do not — `author`
 * normalizes to `author`, which contains none of the patterns.
 */
export function isSensitiveKey(key: string): boolean {
  const cacheable = key.length <= SENSITIVE_KEY_CACHE_MAX_KEY_LENGTH;
  if (cacheable) {
    const cached = apply(mapGet, sensitiveKeyCache, [key]) as boolean | undefined;
    if (cached !== undefined) return cached;
  }

  const normalized = normalizeToAlphanumeric(key);
  let sensitive = normalized === "auth";
  for (let index = 0; !sensitive && index < SENSITIVE_KEY_PATTERNS.length; index++) {
    sensitive = apply(stringIncludes, normalized, [SENSITIVE_KEY_PATTERNS[index]]) as boolean;
  }

  if (cacheable) {
    const cacheSize = apply(mapSizeGetter, sensitiveKeyCache, []) as number;
    if (cacheSize >= SENSITIVE_KEY_CACHE_MAX_SIZE) {
      const iterator = apply(mapKeys, sensitiveKeyCache, []) as MapIterator<string>;
      const oldestKey = (apply(mapIteratorNext, iterator, []) as IteratorResult<string>).value;
      if (oldestKey !== undefined) apply(mapDelete, sensitiveKeyCache, [oldestKey]);
    }
    apply(mapSet, sensitiveKeyCache, [key, sensitive]);
  }

  return sensitive;
}

export type RedactedValue =
  | string
  | number
  | boolean
  | null
  | RedactedValue[]
  | { [key: string]: RedactedValue };

type RedactionMode = "compatible" | "serialization";

interface RedactionBudget {
  remainingNodes: number;
  exhausted: boolean;
}

/**
 * `Array.isArray` normally looks like a harmless classifier, but it throws for
 * revoked proxies. Returning `null` lets every public redaction entry point
 * fail closed without touching the unreadable value again.
 */
function classifyArray(value: object): boolean | null {
  try {
    return arrayIsArray(value);
  } catch {
    return null;
  }
}

function hasSeenSerializationHookOwner(seenOwners: object[], owner: object): boolean {
  for (let index = 0; index < seenOwners.length; index++) {
    if (seenOwners[index] === owner) return true;
  }
  return false;
}

/**
 * Read a deliberate serialization hook without consulting hooks installed on
 * the intrinsic Object or Array prototypes. Custom and platform prototypes
 * such as Date and URL remain supported through data-property methods.
 */
function readSerializationHook(value: object): unknown {
  let owner: object | null = value;
  const seenOwners: object[] = [];
  let prototypesVisited = 0;
  while (owner !== null) {
    if (owner === objectPrototype || owner === arrayPrototype) return undefined;
    if (
      prototypesVisited >= MAX_SERIALIZATION_HOOK_PROTOTYPES ||
      hasSeenSerializationHookOwner(seenOwners, owner)
    ) {
      throw new TypeError("serialization hook prototype chain is cyclic or too deep");
    }
    prototypesVisited++;
    apply(arrayPush, seenOwners, [owner]);
    const descriptor = objectGetOwnPropertyDescriptor(owner, "toJSON");
    if (descriptor !== undefined) {
      if (!objectHasOwn(descriptor, "value")) {
        throw new TypeError("serialization hooks must be data properties");
      }
      return descriptor.value;
    }
    owner = objectGetPrototypeOf(owner);
  }
  return undefined;
}

function redactValue(
  value: unknown,
  depth: number,
  seen: Set<object>,
  mode: RedactionMode,
  budget: RedactionBudget,
): unknown {
  if (budget.remainingNodes <= 0) {
    budget.exhausted = true;
    return REDACTED;
  }
  budget.remainingNodes--;

  if (typeof value === "string") return sanitizeUrlCredentials(value);
  if (typeof value === "bigint") {
    return mode === "serialization" ? apply(bigIntToString, value, []) as string : value;
  }
  if (typeof value === "number") {
    return mode === "serialization" && !numberIsFinite(value) ? null : value;
  }
  if (typeof value === "boolean" || value === null) return value;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return mode === "serialization" ? REDACTED : value;
  }

  const arrayClassification = classifyArray(value);
  if (arrayClassification === null) return REDACTED;

  if (arrayClassification) {
    if (depth >= MAX_DEPTH || apply(setHas, seen, [value])) return REDACTED;
    apply(setAdd, seen, [value]);
    try {
      const arrayValue = value as unknown[];
      const length = arrayValue.length;
      if (!numberIsInteger(length) || length < 0 || length > MAX_CONTAINER_ENTRIES) {
        return REDACTED;
      }
      const redacted: unknown[] = mode === "compatible" ? new Array(length) : [];
      for (let index = 0; index < length; index++) {
        if (mode === "compatible" && !(index in arrayValue)) continue;
        const item = redactValue(arrayValue[index], depth + 1, seen, mode, budget);
        if (budget.exhausted) return REDACTED;
        if (mode === "compatible") {
          redacted[index] = item;
        } else {
          apply(arrayPush, redacted, [item]);
        }
      }
      return redacted;
    } catch {
      // Array indices can be accessors or proxy traps. A failed read makes the
      // serialized contents unknowable, so the complete array fails closed.
      return REDACTED;
    } finally {
      apply(setDelete, seen, [value]);
    }
  }

  // Objects defining `toJSON` (Date, URL, custom serializers) are serialized
  // by `JSON.stringify` via the *return value* of `toJSON`, not their own
  // enumerable keys. A key-based pass over the object's own properties would
  // therefore miss credentials smuggled through `toJSON`, e.g.
  // `{ toJSON: () => ({ apiKey: "sk-..." }) }` (CODEX P2). When `toJSON`
  // returns an object, array, or scalar, the serialization API redacts *that*
  // snapshot. The compatibility API keeps scalar serializers such as Date and
  // URL intact, preserving the established generic return contract.
  if (depth >= MAX_DEPTH || apply(setHas, seen, [value])) return REDACTED;
  let toJSON: unknown;
  try {
    toJSON = readSerializationHook(value);
  } catch {
    // Accessors can throw before a serializer is callable. Never inspect the
    // raw object after that because its eventual serialization is unknown.
    return REDACTED;
  }

  if (typeof toJSON === "function") {
    apply(setAdd, seen, [value]);
    try {
      const serialized = apply(toJSON, value, []);
      if (mode === "serialization") {
        return redactValue(serialized, depth + 1, seen, mode, budget);
      }
      if (typeof serialized === "string") {
        const sanitized = sanitizeUrlCredentials(serialized);
        return sanitized === serialized ? value : sanitized;
      }
      if (serialized !== null && typeof serialized === "object") {
        if (classifyArray(serialized) === null) return REDACTED;
        return redactValue(serialized, depth + 1, seen, mode, budget);
      }

      // Other scalar results serialize safely as-is in compatibility mode.
      return value;
    } catch {
      // A throwing toJSON must never let the raw object (whose own keys we
      // skipped) through: fail closed.
      return REDACTED;
    } finally {
      apply(setDelete, seen, [value]);
    }
  }

  apply(setAdd, seen, [value]);
  try {
    const out: Record<string, unknown> = {};
    const record = value as Record<string, unknown>;
    let propertyCount = 0;
    for (const key in record) {
      if (!objectHasOwn(record, key)) continue;
      propertyCount++;
      if (propertyCount > MAX_CONTAINER_ENTRIES) return REDACTED;

      if (isSensitiveKey(key)) {
        objectDefineProperty(out, key, {
          configurable: true,
          enumerable: true,
          value: REDACTED,
          writable: true,
        });
        continue;
      }

      const child = record[key];
      // Match JSON object semantics only for the explicit serialization API.
      // The generic compatibility API retains undefined own properties.
      if (mode === "serialization" && child === undefined) continue;
      const redactedChild = redactValue(child, depth + 1, seen, mode, budget);
      if (budget.exhausted) return REDACTED;
      objectDefineProperty(out, key, {
        configurable: true,
        enumerable: true,
        value: redactedChild,
        writable: true,
      });
    }
    return out;
  } catch {
    // A throwing getter (or other access error) must never let an
    // unredacted object through: fail closed.
    return REDACTED;
  } finally {
    apply(setDelete, seen, [value]);
  }
}

/**
 * Returns a redacted copy of `context` while preserving the established source
 * and runtime value shapes. Any property whose key is {@link isSensitiveKey}
 * is replaced with {@link REDACTED}; nested records and arrays are traversed,
 * while primitives and scalar-serializing objects retain their original types.
 * The input is never mutated.
 *
 * Use {@link redactForSerialization} at JSON/logging boundaries where BigInt,
 * functions, symbols, and custom `toJSON` implementations must be normalized.
 */
export function redactSensitive<T>(context: T): T {
  return redactValue(context, 0, new NativeSet<object>(), "compatible", {
    remainingNodes: MAX_TRAVERSAL_NODES,
    exhausted: false,
  }) as T;
}

/**
 * Returns a JSON-safe redacted snapshot of `context`. Sensitive keys are
 * masked, nested values are traversed, BigInts become decimal strings,
 * non-finite numbers become `null`, and unsupported or unreadable values fail
 * closed. Objects with `toJSON` are snapshotted exactly once before redaction.
 */
export function redactForSerialization(context: unknown): RedactedValue {
  return redactValue(context, 0, new NativeSet<object>(), "serialization", {
    remainingNodes: MAX_TRAVERSAL_NODES,
    exhausted: false,
  }) as RedactedValue;
}

/**
 * Query-string parameter names that commonly carry credentials in URLs.
 * Matched case-insensitively against the parameter name.
 */
const SENSITIVE_URL_PARAMS = [
  "access_token",
  "accesstoken",
  "refresh_token",
  "api_key",
  "apikey",
  "code",
  "token",
  "secret",
  "client_secret",
  "password",
  "passwd",
  "pwd",
  "state",
  "sig",
  "signature",
  "auth",
  "x-amz-credential",
  "x-amz-signature",
  "x-amz-security-token",
  "x-goog-credential",
  "x-goog-signature",
] as const;

const NORMALIZED_SENSITIVE_URL_PARAMS = new NativeSet<string>();
for (let index = 0; index < SENSITIVE_URL_PARAMS.length; index++) {
  apply(setAdd, NORMALIZED_SENSITIVE_URL_PARAMS, [
    normalizeToAlphanumeric(SENSITIVE_URL_PARAMS[index]!),
  ]);
}

const URL_USERINFO_RE = /(\b[a-z][a-z0-9+.-]*:\/\/|\/\/)([^/?#\s]+)@/gi;
const HORIZONTAL_WHITESPACE_URL_USERINFO_RE =
  /(\b[a-z][a-z0-9+.-]*:\/\/|\/\/)([a-z0-9._~!$&'()*+,;=%-]+):([^/?#@\r\n \t]+[ \t][^/?#@\r\n]*)@/gi;
const MAX_URL_PARAMETER_DECODE_PASSES = 3;

interface RedactedAssignmentValue {
  end: number;
  replacement: string;
}

function isHorizontalAssignmentBoundary(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "," ||
    character === ";" ||
    character === "&" ||
    character === "?" ||
    character === "#"
  );
}

function isAsciiLetter(character: string | undefined): boolean {
  if (!character) return false;
  const code = stringCodeUnitAt(character, 0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAssignmentKeyStartCharacter(character: string | undefined): boolean {
  return isAsciiLetter(character) || character === "_" || character === "$";
}

function isAssignmentKeyCharacter(character: string | undefined): boolean {
  if (!character) return false;
  const code = stringCodeUnitAt(character, 0);
  return (
    isAssignmentKeyStartCharacter(character) ||
    (code >= 48 && code <= 57) ||
    character === "." ||
    character === "-"
  );
}

/**
 * Check for a syntactically recognizable next `key=value` / `"key": value`
 * field without allocating substrings. Assignment values may themselves
 * contain whitespace and punctuation, so only a complete next-field prefix is
 * trusted as a boundary.
 */
function assignmentStartsAt(input: string, start: number): boolean {
  let index = start;
  const keyQuote = input[index] === `"` || input[index] === "'" ? input[index++] : "";
  if (!isAssignmentKeyStartCharacter(input[index])) return false;

  index++;
  while (isAssignmentKeyCharacter(input[index])) index++;
  if (keyQuote) {
    if (input[index] !== keyQuote) return false;
    index++;
  }
  while (input[index] === " " || input[index] === "\t") index++;
  return input[index] === ":" || input[index] === "=";
}

function isAssignmentBoundaryCharacter(character: string): boolean {
  return (
    character === "\r" ||
    character === "\n" ||
    character === "}" ||
    character === "]" ||
    isHorizontalAssignmentBoundary(character)
  );
}

function skipAssignmentBoundaryCharacters(input: string, start: number): number {
  let index = start;
  while (
    index < input.length &&
    isAssignmentBoundaryCharacter(input[index]!)
  ) {
    index++;
  }
  return index;
}

function assignmentValueEndsAt(input: string, start: number): boolean {
  const boundaryEnd = skipAssignmentBoundaryCharacters(input, start);
  return boundaryEnd >= input.length || assignmentStartsAt(input, boundaryEnd);
}

function redactAssignmentValue(input: string, start: number): RedactedAssignmentValue {
  let scanStart = start;
  let preserveValueQuote = true;
  if (apply(stringStartsWith, input, [REDACTED, start])) {
    const markerEnd = start + REDACTED.length;
    if (assignmentValueEndsAt(input, markerEnd)) {
      return {
        end: markerEnd,
        replacement: REDACTED,
      };
    }
    scanStart = markerEnd;
    preserveValueQuote = false;
  }

  const wrapperQuote = preserveValueQuote &&
      (input[scanStart] === `"` || input[scanStart] === "'" || input[scanStart] === "`")
    ? input[scanStart]
    : "";
  let wrapperQuoteClosed = false;
  const replacement = (): string =>
    wrapperQuote ? `${wrapperQuote}${REDACTED}${wrapperQuoteClosed ? wrapperQuote : ""}` : REDACTED;

  const expectedClosings: string[] = [];
  let quote = "";
  let quoteStart = -1;
  for (let index = scanStart; index < input.length;) {
    const character = input[index]!;
    if (quote) {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === quote) {
        if (quoteStart === scanStart && expectedClosings.length === 0) {
          wrapperQuoteClosed = true;
          return { end: index + 1, replacement: replacement() };
        }
        quote = "";
        quoteStart = -1;
      }
      index++;
      continue;
    }

    if (character === `"` || character === "'" || character === "`") {
      quote = character;
      quoteStart = index;
      index++;
      continue;
    }
    if (character === "{" || character === "[") {
      apply(arrayPush, expectedClosings, [character === "{" ? "}" : "]"]);
      index++;
      continue;
    }
    if (
      expectedClosings.length > 0 &&
      (character === "}" || character === "]")
    ) {
      if (expectedClosings[expectedClosings.length - 1] !== character) {
        return { end: input.length, replacement: replacement() };
      }
      apply(arrayPop, expectedClosings, []);
      index++;
      if (
        expectedClosings.length === 0 &&
        assignmentValueEndsAt(input, index)
      ) {
        return { end: index, replacement: replacement() };
      }
      continue;
    }

    if (
      expectedClosings.length > 0 ||
      !isAssignmentBoundaryCharacter(character)
    ) {
      index++;
      continue;
    }

    const boundaryStart = index;
    index = skipAssignmentBoundaryCharacters(input, index);
    if (index >= input.length || assignmentStartsAt(input, index)) {
      return { end: boundaryStart, replacement: replacement() };
    }
  }

  return { end: input.length, replacement: replacement() };
}

function redactCredentialAssignments(
  input: string,
  prefixPattern: RegExp,
  keyGroup: number,
  urlParameterBoundaryGroup?: number,
): string {
  let cursor = 0;
  let result = "";

  for (
    let match = apply(regExpExec, prefixPattern, [input]) as RegExpExecArray | null;
    match;
    match = apply(regExpExec, prefixPattern, [input]) as RegExpExecArray | null
  ) {
    const key = match[keyGroup]!;
    if (!isSensitiveAssignmentKey(key)) continue;

    const valueStart = prefixPattern.lastIndex;
    const boundary = urlParameterBoundaryGroup === undefined
      ? undefined
      : match[urlParameterBoundaryGroup];
    const markerEnd = valueStart + REDACTED.length;
    if (
      (boundary === "?" || boundary === "&" || boundary === ";") &&
      apply(stringStartsWith, input, [REDACTED, valueStart]) &&
      input[markerEnd] === "#"
    ) {
      // The URL-parameter pass already bounded this credential at the URI
      // fragment delimiter. Preserve that delimiter without treating an
      // arbitrary `[REDACTED]suffix` assignment as trustworthy.
      continue;
    }
    const redactedValue = redactAssignmentValue(input, valueStart);
    result += sliceString(input, cursor, match.index);
    result += match[0];
    result += redactedValue.replacement;
    cursor = redactedValue.end;
    prefixPattern.lastIndex = redactedValue.end;
  }

  return cursor === 0 ? input : result + sliceString(input, cursor);
}

/**
 * Classify free-text assignment keys without applying the structured-key
 * substring policy to ordinary words. Identifier and camel-case boundaries
 * still recognize `refreshToken`, `client_secret`, and `x-api-key`, while
 * words such as `mapping` and `considered` stay intact.
 */
function isSensitiveAssignmentKey(key: string): boolean {
  // The token-range classifier below is quadratic in the number of identifier
  // tokens. Oversized attacker-controlled keys fail closed before that work.
  if (key.length > MAX_ASSIGNMENT_KEY_LENGTH) return true;

  const withAcronymBoundaries = replaceWithCapturedExec(
    key,
    ACRONYM_BOUNDARY_PATTERN,
    (match) => `${match[1]} ${match[2]}`,
  );
  const withBoundaries = replaceWithCapturedExec(
    withAcronymBoundaries,
    CAMEL_CASE_BOUNDARY_PATTERN,
    (match) => `${match[1]} ${match[2]}`,
  );
  const lowercase = apply(stringToLowerCase, withBoundaries, []) as string;
  const tokens = splitIdentifierTokens(lowercase);

  for (let start = 0; start < tokens.length; start++) {
    if (tokens[start]!.length === 0) continue;
    let candidate = "";
    for (let end = start; end < tokens.length; end++) {
      const token = tokens[end]!;
      if (token.length === 0) continue;
      candidate += token;
      for (let index = 0; index < SENSITIVE_KEY_PATTERNS.length; index++) {
        if (candidate === SENSITIVE_KEY_PATTERNS[index]) return true;
      }
    }
  }

  return tokens.length === 1 && tokens[0] === "auth";
}

function isStandaloneUrlAuthorityBeforeWhitespace(
  scheme: string,
  user: string,
  password: string,
): boolean {
  let whitespaceIndex = -1;
  for (let index = 0; index < password.length; index++) {
    const codeUnit = stringCodeUnitAt(password, index);
    if (codeUnit === 0x20 || codeUnit === 0x09) {
      whitespaceIndex = index;
      break;
    }
  }
  if (whitespaceIndex < 0) return false;

  const authority = `${user}:${sliceString(password, 0, whitespaceIndex)}`;
  const candidate = scheme === "//" ? `https://${authority}` : `${scheme}${authority}`;
  try {
    const url = new NativeURL(candidate);
    const username = apply(urlUsernameGetter, url, []) as string;
    const password = apply(urlPasswordGetter, url, []) as string;
    return username.length === 0 && password.length === 0;
  } catch {
    return false;
  }
}

function decodeUrlParameterName(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < MAX_URL_PARAMETER_DECODE_PASSES; pass++) {
    let next: string;
    try {
      next = nativeDecodeURIComponent(decoded);
    } catch {
      break;
    }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

/**
 * Strip credentials from URL-shaped strings so they can be safely emitted in
 * free-form text (error messages, stacks, lifted `request_url` fields). Unlike
 * {@link redactSensitive}, which is key-based, this scrubs secrets embedded in
 * the *value* itself:
 *
 * - URL userinfo: `https://user:password@example.test/path` -> `https://user:[REDACTED]@example.test/path`
 * - sensitive query params: `?access_token=abc` -> `?access_token=[REDACTED]`
 * - credential assignments: `refreshToken=abc` -> `refreshToken=[REDACTED]`
 * - common provider tokens: `Using token sk-...` -> `Using token [REDACTED]`
 *
 * It is intentionally tolerant: it operates on any string (a DSN, a Mongo URI,
 * an axios error message containing a URL) via regex rather than requiring a
 * parseable URL, so malformed or partial URLs in error text are still scrubbed.
 * Strings without credential-shaped content pass through unchanged.
 */
export function sanitizeUrlCredentials(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;

  // 1) userinfo: scheme://user:pass@  → mask the password (and any bare creds).
  let out = replaceWithCapturedExec(
    input,
    URL_USERINFO_RE,
    (match) => {
      const scheme = match[1]!;
      const userinfo = match[2]!;
      const colon = apply(stringIndexOf, userinfo, [":"]) as number;
      if (colon === -1) {
        // `scheme://token@host` — the whole userinfo is credential-like.
        return `${scheme}${REDACTED}@`;
      }
      const user = sliceString(userinfo, 0, colon);
      return `${scheme}${user}:${REDACTED}@`;
    },
  );
  out = replaceWithCapturedExec(
    out,
    HORIZONTAL_WHITESPACE_URL_USERINFO_RE,
    (match) => {
      const scheme = match[1]!;
      const user = match[2]!;
      const password = match[3]!;
      // Do not reinterpret a complete URL followed later by an email address
      // on the same line as malformed userinfo. Raw-horizontal-whitespace
      // recovery is limited to explicit `user:password` shapes whose prefix
      // cannot already be parsed as a standalone authority.
      if (isStandaloneUrlAuthorityBeforeWhitespace(scheme, user, password)) {
        return match[0];
      }
      return `${scheme}${user}:${REDACTED}@`;
    },
  );

  // 2) sensitive query/fragment params: `key=value` → `key=[REDACTED]`.
  // Match `?key=`, `#key=`, `&key=`, and `;key=` separators and stop at the
  // next delimiter. OAuth implicit-flow tokens commonly appear after `#`.
  out = replaceWithCapturedExec(
    out,
    /([?#&;])([-a-z0-9_.%\[\]]+)=([^&#;\s]*)/gi,
    (match) => {
      const sep = match[1]!;
      const key = match[2]!;
      const decodedKey = decodeUrlParameterName(key);
      const sensitive = apply(setHas, NORMALIZED_SENSITIVE_URL_PARAMS, [
        normalizeToAlphanumeric(decodedKey),
      ]) ||
        isSensitiveKey(decodedKey);
      return sensitive ? `${sep}${key}=${REDACTED}` : match[0];
    },
  );

  // 3) Cookie header values.
  // Cookie headers can carry multiple independent credentials separated by
  // semicolons (and Set-Cookie attributes can contain commas). Mask the entire
  // header line before the generic assignment scanner can stop at the first
  // delimiter and expose later values.
  out = replaceWithCapturedExec(
    out,
    /(^|[^a-z0-9_-])((?:set-cookie|cookie)\s*:\s*)[^\r\n]*/gi,
    (match) => `${match[1]}${match[2]}${REDACTED}`,
  );

  // 4) Header-shaped authorization values and standalone auth schemes.
  // Authorization schemes are extensible (AWS SigV4, Digest, custom proxy
  // schemes, and others), so mask the complete line instead of trying to
  // enumerate schemes or parse their credential-bearing parameters.
  out = replaceWithCapturedExec(
    out,
    /\b(authorization\s*[:=]\s*)[^\r\n]*/gi,
    (match) => `${match[1]}${REDACTED}`,
  );
  out = replaceWithCapturedExec(
    out,
    /\b(bearer|basic)(\s+)(?:"[^"\r\n]*"|'[^'\r\n]*'|[a-z0-9._~+/=-]+)/gi,
    (match) => `${match[1]}${match[2]}${REDACTED}`,
  );

  // 5) Common provider token shapes can appear as bare values without an
  // assignment delimiter, for example `Using token sk-...`.
  out = replaceWithCapturedExec(out, PROVIDER_CREDENTIAL_PATTERN, REDACTED);

  // 6) Credential assignments embedded in free-form messages/errors. Match
  // generic identifier-shaped keys and apply the same credential vocabulary
  // at identifier boundaries. This keeps JSON snippets, header dumps, and
  // ordinary `key=value` text from drifting to a weaker policy without
  // masking benign words that merely contain a short pattern.
  // Handle quoted JSON/object keys first and preserve their quoting so the
  // sanitized text remains intelligible and structurally valid.
  out = redactCredentialAssignments(
    out,
    /(["'])([_$a-z][a-z0-9_.$-]*)\1(\s*[:=]\s*)/gi,
    2,
  );
  out = redactCredentialAssignments(
    out,
    /(^|[^a-z0-9_.$-])([_$a-z][a-z0-9_.$-]*)(\s*[:=]\s*)/gi,
    2,
    1,
  );

  return out;
}

function firstUrlDelimiterIndex(input: string): number {
  const queryIndex = apply(stringIndexOf, input, ["?"]) as number;
  const hashIndex = apply(stringIndexOf, input, ["#"]) as number;
  if (queryIndex === -1) return hashIndex;
  if (hashIndex === -1) return queryIndex;
  return queryIndex < hashIndex ? queryIndex : hashIndex;
}

function sanitizeProtocolRelativeUrlForSpan(input: string): string | null {
  if (!apply(stringStartsWith, input, ["//"])) return null;

  try {
    const url = new NativeURL(`https:${input}`);
    return `//${apply(urlHostGetter, url, [])}${apply(urlPathnameGetter, url, [])}`;
  } catch (_) {
    return null;
  }
}

/**
 * Return the URL form safe to attach to observability span attributes.
 *
 * Span attributes bypass the logger's structured redaction pass, so `http.url`
 * must not include query strings, fragments, or URL userinfo. This intentionally
 * strips every query parameter instead of selectively redacting credential-like
 * names because cache keys and callback state can be sensitive even when the
 * parameter name is not obviously a credential.
 */
export function sanitizeUrlForSpan(input: string): string {
  if (typeof input !== "string" || input.length === 0) return input;

  try {
    const url = new NativeURL(input);
    const protocol = apply(urlProtocolGetter, url, []) as string;
    const pathname = apply(urlPathnameGetter, url, []) as string;
    const origin = apply(urlOriginGetter, url, []) as string;
    if (protocol === "blob:") {
      try {
        const embeddedUrl = new NativeURL(pathname);
        const embeddedOrigin = apply(urlOriginGetter, embeddedUrl, []) as string;
        return embeddedOrigin === "null" ? "blob:" : `blob:${embeddedOrigin}`;
      } catch (_) {
        return "blob:";
      }
    }
    if (origin !== "null") return `${origin}${pathname}`;
    if (apply(regExpExec, /^[a-z][a-z0-9+.-]*:/i, [input]) !== null) return protocol;
  } catch (_) {
    // Relative or malformed URL-shaped strings are handled by the fallback.
  }

  const delimiterIndex = firstUrlDelimiterIndex(input);
  const withoutQueryOrFragment = delimiterIndex === -1
    ? input
    : sliceString(input, 0, delimiterIndex);
  const protocolRelativeUrl = sanitizeProtocolRelativeUrlForSpan(withoutQueryOrFragment);
  if (protocolRelativeUrl) return protocolRelativeUrl;

  return sanitizeUrlCredentials(withoutQueryOrFragment);
}

/**
 * Apply {@link sanitizeUrlCredentials} to the `name`, `message`, and `stack` of a
 * serialized-error-shaped object, returning a new object. Used by the logger's
 * JSON and text paths so errors carrying DSNs, Mongo URIs, or
 * `?access_token=`-bearing URLs do not leak credentials (the serialized error
 * bypasses the key-based redactor). Returns the input unchanged when falsy.
 */
export function sanitizeSerializedError<
  T extends { name?: unknown; message?: unknown; stack?: unknown } | undefined,
>(error: T): T {
  if (!error) return error;
  const out: { name?: unknown; message?: unknown; stack?: unknown } = { ...error };
  if (typeof out.name === "string") out.name = sanitizeUrlCredentials(out.name);
  if (typeof out.message === "string") out.message = sanitizeUrlCredentials(out.message);
  if (typeof out.stack === "string") out.stack = sanitizeUrlCredentials(out.stack);
  return out as T;
}

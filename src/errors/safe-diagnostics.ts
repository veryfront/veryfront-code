import {
  type ErrorCategory,
  isVeryfrontErrorInstance,
  type RFC9457Response,
  VeryfrontError,
  type VeryfrontErrorSnapshot,
} from "./types.ts";
import {
  buildErrorDocsUrl,
  ERROR_OUTPUT_MAX_LENGTH_CHARS,
  sanitizeBoundedDiagnosticText,
  sanitizeBoundedErrorSlug,
  sanitizeBoundedStackText,
  sanitizeBoundedTerminalText,
} from "./diagnostic-policy.ts";
import {
  type RedactedValue,
  redactForSerialization,
  redactPathFromText,
} from "#veryfront/utils/logger/redact.ts";
import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

export {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

export {
  buildErrorDocsUrl,
  ERROR_CONTEXT_MAX_LENGTH_CHARS,
  ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
  ERROR_DOCS_BASE_URL,
  ERROR_DOCS_SLUG_MAX_LENGTH_CHARS,
  ERROR_OUTPUT_MAX_LENGTH_CHARS,
  ERROR_STACK_MAX_LENGTH_CHARS,
  limitRenderedErrorOutput,
  sanitizeBoundedErrorSlug,
} from "./diagnostic-policy.ts";

const freeze = Object.freeze;
const arrayJoin = Array.prototype.join;
const arrayPop = Array.prototype.pop;
const arrayPush = Array.prototype.push;
const nativeDecodeURIComponent = decodeURIComponent;
const jsonStringify = JSON.stringify;
const numberIsFinite = Number.isFinite;
const numberIsInteger = Number.isInteger;
const UNKNOWN_ERROR_SNAPSHOT: VeryfrontErrorSnapshot = freeze({
  slug: "unknown-error",
  category: "GENERAL",
  status: 500,
  title: "Unknown/unclassified error",
  message: "Unknown/unclassified error",
  suggestion: "Check logs for more details",
});
const apply = Reflect.apply;
const defineProperties = Object.defineProperties;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const NativeError = Error;
const NativeString = String;
const NativeUint32Array = Uint32Array;
const NativeURL = URL;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringSlice = String.prototype.slice;
const stringToLowerCase = String.prototype.toLowerCase;
const stringToUpperCase = String.prototype.toUpperCase;
const URL_HOSTNAME_GETTER = getOwnPropertyDescriptor(NativeURL.prototype, "hostname")?.get;
const URL_PATHNAME_GETTER = getOwnPropertyDescriptor(NativeURL.prototype, "pathname")?.get;
const NATIVE_ERROR_STACK_GETTER = getOwnPropertyDescriptor(new NativeError(), "stack")?.get;
const ERROR_CATEGORIES: ReadonlySet<ErrorCategory> = new Set([
  "CONFIG",
  "BUILD",
  "RUNTIME",
  "ROUTE",
  "MODULE",
  "SERVER",
  "BOUNDARY",
  "DEV",
  "DEPLOY",
  "AGENT",
  "GENERAL",
]);
const MISSING_DATA_FIELD = Symbol("missing-data-field");
const FORWARD_SLASH_CODE_UNIT = 47;
const BACKSLASH_CODE_UNIT = 92;
const COLON_CODE_UNIT = 58;
const VERTICAL_BAR_CODE_UNIT = 124;
const ASCII_UPPERCASE_A_CODE_UNIT = 65;
const ASCII_UPPERCASE_Z_CODE_UNIT = 90;
const ASCII_LOWERCASE_OFFSET = 32;
const FILESYSTEM_DIAGNOSTIC_FALLBACK = "Filesystem operation failed";
const DOM_EXCEPTION_MESSAGE_GETTER = typeof DOMException === "function"
  ? getOwnPropertyDescriptor(DOMException.prototype, "message")?.get
  : undefined;
const DOM_EXCEPTION_NAME_GETTER = typeof DOMException === "function"
  ? getOwnPropertyDescriptor(DOMException.prototype, "name")?.get
  : undefined;

function isProblemDetailsResponseStatus(status: number): boolean {
  return numberIsInteger(status) &&
    status >= 200 &&
    status <= 599 &&
    status !== 204 &&
    status !== 205 &&
    status !== 304;
}

/** Mask credentials embedded in arbitrary diagnostic text. */
export function sanitizeDiagnosticText(value: unknown): string {
  return sanitizeBoundedDiagnosticText(value);
}

/**
 * Prepare one untrusted diagnostic field for terminal or plain-text output.
 * Apply framework-owned ANSI styling only after this sanitizer returns.
 */
export function sanitizeTerminalDiagnosticText(value: unknown): string {
  return sanitizeBoundedTerminalText(value);
}

/** Mask credentials and apply the larger shared stack bound. */
export function sanitizeStackDiagnosticText(value: unknown): string {
  return sanitizeBoundedStackText(value);
}

export function sanitizeOptionalDiagnosticText(value: unknown): string | undefined {
  return value === undefined ? undefined : sanitizeDiagnosticText(value);
}

function ownDataField(
  value: Error,
  key: PropertyKey,
): unknown | typeof MISSING_DATA_FIELD {
  const descriptor = getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : MISSING_DATA_FIELD;
}

function optionalOwnString(
  error: Error,
  key: PropertyKey,
): string | undefined | typeof MISSING_DATA_FIELD {
  const value = ownDataField(error, key);
  if (value === MISSING_DATA_FIELD || value === undefined) return value;
  return typeof value === "string" ? value : MISSING_DATA_FIELD;
}

function readOwnDataStack(error: Error): string | undefined {
  const descriptor = getOwnPropertyDescriptor(error, "stack");
  if (!descriptor) return undefined;
  if ("value" in descriptor) {
    return typeof descriptor.value === "string" ? descriptor.value : undefined;
  }
  if (descriptor.get !== NATIVE_ERROR_STACK_GETTER || !NATIVE_ERROR_STACK_GETTER) {
    return undefined;
  }
  try {
    const stack = apply(NATIVE_ERROR_STACK_GETTER, error, []);
    return typeof stack === "string" ? stack : undefined;
  } catch {
    return undefined;
  }
}

function readNativeErrorName(error: Error): string {
  const ownName = ownDataField(error, "name");
  if (typeof ownName === "string" && ownName) {
    return sanitizeDiagnosticText(ownName);
  }

  const prototype = getPrototypeOf(error);
  if (prototype === null || isProxyWithoutHooks(prototype)) return "Error";
  const descriptor = getOwnPropertyDescriptor(prototype, "name");
  if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
    return sanitizeDiagnosticText(descriptor.value || "Error");
  }
  if (descriptor?.get === DOM_EXCEPTION_NAME_GETTER && DOM_EXCEPTION_NAME_GETTER) {
    try {
      const name = apply(DOM_EXCEPTION_NAME_GETTER, error, []);
      return typeof name === "string" && name ? sanitizeDiagnosticText(name) : "Error";
    } catch {
      return "Error";
    }
  }
  return "Error";
}

interface ThrowableBoundarySnapshot {
  readonly error: VeryfrontErrorSnapshot;
  readonly context?: unknown;
  readonly name: string;
  readonly registered: boolean;
}

function snapshotThrowableBoundary(error: unknown): ThrowableBoundarySnapshot {
  const message = snapshotThrowableDiagnostic(error);
  if (!isNativeErrorWithoutHooks(error)) {
    return {
      error: {
        ...UNKNOWN_ERROR_SNAPSHOT,
        detail: message || "Unknown error",
      },
      name: "Error",
      registered: false,
    };
  }

  try {
    const rawStack = readOwnDataStack(error);
    const stack = rawStack === undefined ? undefined : sanitizeStackDiagnosticText(rawStack);
    const name = readNativeErrorName(error);

    if (isVeryfrontErrorInstance(error)) {
      const slug = ownDataField(error, "slug");
      const category = ownDataField(error, "category");
      const status = ownDataField(error, "status");
      const title = ownDataField(error, "title");
      const suggestion = optionalOwnString(error, "suggestion");
      const exitCode = ownDataField(error, "exitCode");
      const detail = optionalOwnString(error, "detail");
      const instance = optionalOwnString(error, "instance");
      const cause = ownDataField(error, "cause");
      const context = ownDataField(error, "context");

      if (
        typeof slug === "string" &&
        typeof category === "string" &&
        ERROR_CATEGORIES.has(category as ErrorCategory) &&
        typeof status === "number" &&
        numberIsFinite(status) &&
        typeof title === "string" &&
        suggestion !== MISSING_DATA_FIELD &&
        (exitCode === MISSING_DATA_FIELD ||
          exitCode === undefined ||
          (typeof exitCode === "number" && numberIsFinite(exitCode))) &&
        detail !== MISSING_DATA_FIELD &&
        instance !== MISSING_DATA_FIELD
      ) {
        return {
          error: {
            slug: sanitizeBoundedErrorSlug(slug),
            category: category as ErrorCategory,
            status,
            title: sanitizeDiagnosticText(title),
            message,
            suggestion: suggestion === undefined ? undefined : sanitizeDiagnosticText(suggestion),
            exitCode: exitCode === MISSING_DATA_FIELD ? undefined : exitCode,
            detail: detail === undefined ? undefined : sanitizeDiagnosticText(detail),
            cause: typeof cause === "string" ? sanitizeDiagnosticText(cause) : undefined,
            instance: instance === undefined ? undefined : sanitizeDiagnosticText(instance),
            stack,
          },
          context: context === MISSING_DATA_FIELD ? undefined : context,
          name,
          registered: true,
        };
      }
    }

    return {
      error: {
        ...UNKNOWN_ERROR_SNAPSHOT,
        detail: message || "Unknown error",
        stack,
      },
      name,
      registered: false,
    };
  } catch {
    return {
      error: {
        ...UNKNOWN_ERROR_SNAPSHOT,
        detail: "Unknown error",
      },
      name: "Error",
      registered: false,
    };
  }
}

/**
 * Detach an untrusted throwable into framework-owned data properties.
 *
 * The returned Error can safely cross logging and HTTP boundaries: no field on
 * it retains a project accessor, proxy, or object-valued cause/context.
 */
export function detachThrowableForBoundary(error: unknown): Error {
  const boundary = snapshotThrowableBoundary(error);
  const snapshot = boundary.error;
  const detached = boundary.registered
    ? new VeryfrontError(snapshot.message, {
      slug: snapshot.slug,
      category: snapshot.category,
      status: snapshot.status,
      title: snapshot.title,
      suggestion: snapshot.suggestion,
      exitCode: snapshot.exitCode,
      detail: snapshot.detail,
      cause: snapshot.cause,
      instance: snapshot.instance,
    })
    : new NativeError(snapshot.detail ?? snapshot.message);

  defineProperties(detached, {
    name: {
      configurable: true,
      value: boundary.registered ? "VeryfrontError" : boundary.name,
      writable: true,
    },
    stack: {
      configurable: true,
      value: snapshot.stack,
      writable: true,
    },
  });

  return detached;
}

/**
 * Snapshot one thrown value into a bounded diagnostic without invoking
 * conversion hooks on objects or functions.
 *
 * Native and Veryfront errors are detached through their Error fields.
 * Primitive values are safe to convert directly. Arbitrary objects and
 * functions are intentionally opaque because `String(value)` can execute
 * project-owned `Symbol.toPrimitive`, `toString`, or proxy hooks.
 */
function readThrowableDiagnostic(error: unknown): string {
  if (isNativeErrorWithoutHooks(error)) {
    try {
      const message = getOwnPropertyDescriptor(error, "message");
      if (message) {
        return "value" in message && typeof message.value === "string"
          ? message.value
          : "Unknown error";
      }

      if (DOM_EXCEPTION_MESSAGE_GETTER) {
        try {
          const domMessage = apply(DOM_EXCEPTION_MESSAGE_GETTER, error, []);
          if (typeof domMessage === "string") {
            return domMessage;
          }
        } catch {
          // Ordinary Error objects do not carry DOMException internal slots.
        }
      }

      return "";
    } catch {
      return "Unknown error";
    }
  }

  if (error === null) return "null";

  switch (typeof error) {
    case "string":
      return error;
    case "number":
    case "bigint":
    case "boolean":
    case "symbol":
    case "undefined":
      return NativeString(error);
    default:
      return "Unknown error";
  }
}

export function snapshotThrowableDiagnostic(error: unknown): string {
  return sanitizeDiagnosticText(readThrowableDiagnostic(error));
}

function isPathSeparatorCodeUnit(codeUnit: number): boolean {
  return codeUnit === FORWARD_SLASH_CODE_UNIT || codeUnit === BACKSLASH_CODE_UNIT;
}

function charCodeAtString(value: string, index: number): number {
  return apply(stringCharCodeAt, value, [index]) as number;
}

function sliceString(value: string, start: number, end?: number): string {
  return end === undefined
    ? apply(stringSlice, value, [start]) as string
    : apply(stringSlice, value, [start, end]) as string;
}

function lowercaseString(value: string): string {
  return apply(stringToLowerCase, value, []) as string;
}

function uppercaseString(value: string): string {
  return apply(stringToUpperCase, value, []) as string;
}

function isAsciiLetterCodeUnit(codeUnit: number): boolean {
  return (codeUnit >= 65 && codeUnit <= 90) || (codeUnit >= 97 && codeUnit <= 122);
}

function trimUrlIgnoredAsciiWhitespace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && charCodeAtString(value, start) <= 0x20) start++;
  while (end > start && charCodeAtString(value, end - 1) <= 0x20) end--;
  return start === 0 && end === value.length ? value : sliceString(value, start, end);
}

function fileUrlNormalizationSource(path: string): string {
  const trimmed = trimUrlIgnoredAsciiWhitespace(path);
  return lowercaseString(sliceString(trimmed, 0, 5)) === "file:" ? trimmed : path;
}

export function isAbsoluteFilesystemPathForDiagnostic(path: string): boolean {
  const candidate = fileUrlNormalizationSource(path);
  if (lowercaseString(sliceString(candidate, 0, 5)) === "file:") return true;
  if (isPathSeparatorCodeUnit(charCodeAtString(candidate, 0))) return true;
  return candidate.length >= 3 &&
    isAsciiLetterCodeUnit(charCodeAtString(candidate, 0)) &&
    charCodeAtString(candidate, 1) === COLON_CODE_UNIT &&
    isPathSeparatorCodeUnit(charCodeAtString(candidate, 2));
}

function isWindowsFilesystemPath(path: string): boolean {
  if (path.length >= 2) {
    const first = charCodeAtString(path, 0);
    const second = charCodeAtString(path, 1);
    if (isPathSeparatorCodeUnit(first) && isPathSeparatorCodeUnit(second)) return true;
  }
  return path.length >= 3 &&
    isAsciiLetterCodeUnit(charCodeAtString(path, 0)) &&
    charCodeAtString(path, 1) === COLON_CODE_UNIT &&
    isPathSeparatorCodeUnit(charCodeAtString(path, 2));
}

function normalizeFilesystemPathCodeUnit(codeUnit: number, foldAsciiCase: boolean): number {
  if (isPathSeparatorCodeUnit(codeUnit)) return FORWARD_SLASH_CODE_UNIT;
  return foldAsciiCase &&
      codeUnit >= ASCII_UPPERCASE_A_CODE_UNIT &&
      codeUnit <= ASCII_UPPERCASE_Z_CODE_UNIT
    ? codeUnit + ASCII_LOWERCASE_OFFSET
    : codeUnit;
}

/** Identify literal or percent-encoded dot segments in a file URL path. */
function fileUrlDotSegmentLength(segment: string): number {
  let dots = 0;
  for (let cursor = 0; cursor < segment.length;) {
    const codeUnit = charCodeAtString(segment, cursor);
    if (codeUnit === 46) {
      dots++;
      cursor++;
    } else if (
      codeUnit === 37 &&
      charCodeAtString(segment, cursor + 1) === 50 &&
      (charCodeAtString(segment, cursor + 2) === 69 ||
        charCodeAtString(segment, cursor + 2) === 101)
    ) {
      dots++;
      cursor += 3;
    } else {
      return 0;
    }
    if (dots > 2) return 0;
  }
  return dots;
}

/** Identify the local file authority without treating malformed encodings as local. */
function isLocalhostFileAuthority(authority: string): boolean {
  try {
    return lowercaseString(nativeDecodeURIComponent(authority)) === "localhost";
  } catch {
    return false;
  }
}

/** Normalize lexical `.` and `..` segments without resolving the filesystem. */
function normalizeFilesystemPathForDiagnostic(path: string): string {
  const windowsPath = isWindowsFilesystemPath(path);
  const hasFileScheme = lowercaseString(sliceString(path, 0, 5)) === "file:";
  const hasDrive = path.length >= 3 &&
    isAsciiLetterCodeUnit(charCodeAtString(path, 0)) &&
    charCodeAtString(path, 1) === COLON_CODE_UNIT &&
    isPathSeparatorCodeUnit(charCodeAtString(path, 2));
  const hasUncRoot = !hasDrive && path.length >= 2 &&
    isPathSeparatorCodeUnit(charCodeAtString(path, 0)) &&
    isPathSeparatorCodeUnit(charCodeAtString(path, 1));
  const leadingSeparator = !hasDrive && !hasUncRoot && isPathSeparatorCodeUnit(
    charCodeAtString(path, 0),
  );
  let prefix: string;
  let start: number;
  let protectedSegments: number;
  if (hasFileScheme) {
    let cursor = 5;
    if (
      isPathSeparatorCodeUnit(charCodeAtString(path, cursor)) &&
      isPathSeparatorCodeUnit(charCodeAtString(path, cursor + 1))
    ) {
      cursor += 2;
      const authorityStart = cursor;
      while (cursor < path.length && !isPathSeparatorCodeUnit(charCodeAtString(path, cursor))) {
        cursor++;
      }
      const authority = sliceString(path, authorityStart, cursor);
      while (cursor < path.length && isPathSeparatorCodeUnit(charCodeAtString(path, cursor))) {
        cursor++;
      }
      prefix = `file://${isLocalhostFileAuthority(authority) ? "" : authority}/`;
      start = cursor;
    } else {
      while (cursor < path.length && isPathSeparatorCodeUnit(charCodeAtString(path, cursor))) {
        cursor++;
      }
      prefix = "file:/";
      start = cursor;
    }
    protectedSegments = 0;
  } else {
    prefix = hasDrive
      ? `${sliceString(path, 0, 2)}/`
      : hasUncRoot
      ? "//"
      : leadingSeparator
      ? "/"
      : "";
    start = hasDrive ? 3 : hasUncRoot ? 2 : leadingSeparator ? 1 : 0;
    protectedSegments = hasUncRoot ? 2 : 0;
  }
  const segments: string[] = [];
  for (let segmentStart = start; segmentStart < path.length;) {
    let cursor = segmentStart;
    while (cursor < path.length && !isPathSeparatorCodeUnit(charCodeAtString(path, cursor))) {
      cursor++;
    }
    const segment = sliceString(path, segmentStart, cursor);
    const dotSegmentLength = hasFileScheme
      ? fileUrlDotSegmentLength(segment)
      : segment === "."
      ? 1
      : segment === ".."
      ? 2
      : 0;
    if (dotSegmentLength === 2) {
      if (segments.length > protectedSegments) apply(arrayPop, segments, []);
    } else if (segment && dotSegmentLength !== 1) {
      apply(arrayPush, segments, [segment]);
    }
    while (cursor < path.length && isPathSeparatorCodeUnit(charCodeAtString(path, cursor))) {
      cursor++;
    }
    segmentStart = cursor;
  }
  const normalized = `${prefix}${apply(arrayJoin, segments, ["/"])}`;
  return windowsPath && normalized.length >= 1
    ? uppercaseString(normalized[0]!) + sliceString(normalized, 1)
    : normalized;
}

function normalizePosixDoubleSeparatorPathForDiagnostic(path: string): string | undefined {
  if (
    charCodeAtString(path, 0) !== FORWARD_SLASH_CODE_UNIT ||
    charCodeAtString(path, 1) !== FORWARD_SLASH_CODE_UNIT
  ) {
    return undefined;
  }
  let cursor = 2;
  while (charCodeAtString(path, cursor) === FORWARD_SLASH_CODE_UNIT) cursor++;
  return normalizeFilesystemPathForDiagnostic(`/${sliceString(path, cursor)}`);
}

function minimumAbsolutePathPrefixLength(path: string): number {
  let index = 0;
  if (
    path.length >= 3 && isAsciiLetterCodeUnit(charCodeAtString(path, 0)) &&
    charCodeAtString(path, 1) === COLON_CODE_UNIT &&
    isPathSeparatorCodeUnit(charCodeAtString(path, 2))
  ) {
    index = 3;
  } else {
    while (index < path.length && isPathSeparatorCodeUnit(charCodeAtString(path, index))) index++;
  }
  while (index < path.length && !isPathSeparatorCodeUnit(charCodeAtString(path, index))) index++;
  return index;
}

function isPathContinuationCodeUnit(codeUnit: number): boolean {
  return isAsciiLetterCodeUnit(codeUnit) ||
    (codeUnit >= 48 && codeUnit <= 57) ||
    codeUnit === 45 ||
    codeUnit === 46 ||
    codeUnit === 58 ||
    codeUnit === 95 ||
    isPathSeparatorCodeUnit(codeUnit);
}

/** Detect a shortened trusted absolute path that cannot be safely redacted as a whole. */
function containsTruncatedFilesystemPathPrefix(input: string, path: string): boolean {
  const minimumPrefixLength = minimumAbsolutePathPrefixLength(path);
  if (minimumPrefixLength === 0 || minimumPrefixLength >= path.length) return false;

  const foldAsciiCase = isWindowsFilesystemPath(path);
  const prefixTable = new NativeUint32Array(path.length);
  for (let index = 1, prefixLength = 0; index < path.length;) {
    if (
      normalizeFilesystemPathCodeUnit(charCodeAtString(path, index), foldAsciiCase) ===
        normalizeFilesystemPathCodeUnit(charCodeAtString(path, prefixLength), foldAsciiCase)
    ) {
      prefixTable[index] = ++prefixLength;
      index++;
    } else if (prefixLength > 0) {
      prefixLength = prefixTable[prefixLength - 1]!;
    } else {
      prefixTable[index] = 0;
      index++;
    }
  }

  let matched = 0;
  for (let index = 0; index < input.length; index++) {
    const inputCodeUnit = normalizeFilesystemPathCodeUnit(
      charCodeAtString(input, index),
      foldAsciiCase,
    );
    while (
      matched > 0 &&
      inputCodeUnit !==
        normalizeFilesystemPathCodeUnit(charCodeAtString(path, matched), foldAsciiCase)
    ) {
      matched = prefixTable[matched - 1]!;
    }
    if (
      inputCodeUnit ===
        normalizeFilesystemPathCodeUnit(charCodeAtString(path, matched), foldAsciiCase)
    ) {
      matched++;
    }

    if (matched === path.length) {
      matched = prefixTable[matched - 1]!;
      continue;
    }
    if (
      matched >= minimumPrefixLength &&
      (index + 1 === input.length ||
        !isPathContinuationCodeUnit(charCodeAtString(input, index + 1)))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Derive the native filesystem spelling of a normalized file URL.
 *
 * Host APIs report the decoded platform path (e.g. Node's
 * `open '/private/nope'` for `file:///private/nope`), which matches neither
 * the requested URL nor its normalized form, so that spelling must be
 * redacted as an additional alias. Returns undefined for non-file paths and
 * for malformed percent encodings the platform would reject before reaching
 * the host API.
 */
function platformPathFromNormalizedFileUrl(normalizedPath: string): string | undefined {
  if (lowercaseString(sliceString(normalizedPath, 0, 5)) !== "file:") return undefined;
  if (!URL_HOSTNAME_GETTER || !URL_PATHNAME_GETTER) return undefined;

  let canonicalAuthority: string;
  let canonicalPathname: string;
  try {
    const parsed = new NativeURL(normalizedPath);
    const hostname = apply(URL_HOSTNAME_GETTER, parsed, []);
    const pathname = apply(URL_PATHNAME_GETTER, parsed, []);
    if (typeof hostname !== "string" || typeof pathname !== "string") return undefined;
    canonicalAuthority = hostname;
    canonicalPathname = pathname;
  } catch {
    return undefined;
  }

  let decodedBody: string;
  try {
    decodedBody = nativeDecodeURIComponent(canonicalPathname);
  } catch {
    return undefined;
  }
  let bodyStart = 0;
  while (
    bodyStart < decodedBody.length &&
    isPathSeparatorCodeUnit(charCodeAtString(decodedBody, bodyStart))
  ) {
    bodyStart++;
  }
  decodedBody = sliceString(decodedBody, bodyStart);

  if (canonicalAuthority && lowercaseString(canonicalAuthority) !== "localhost") {
    return `//${canonicalAuthority}/${decodedBody}`;
  }
  // The WHATWG file URL parser also accepts the legacy vertical-bar drive
  // spelling ("file:///C|/nope"), which the host resolves to "C:\nope", so
  // that form must normalize to a colon drive before the alias is derived.
  if (
    decodedBody.length >= 2 &&
    isAsciiLetterCodeUnit(charCodeAtString(decodedBody, 0)) &&
    charCodeAtString(decodedBody, 1) === VERTICAL_BAR_CODE_UNIT &&
    (decodedBody.length === 2 || isPathSeparatorCodeUnit(charCodeAtString(decodedBody, 2)))
  ) {
    decodedBody = `${sliceString(decodedBody, 0, 1)}:${sliceString(decodedBody, 2)}`;
  }
  const hasDrive = decodedBody.length >= 2 &&
    isAsciiLetterCodeUnit(charCodeAtString(decodedBody, 0)) &&
    charCodeAtString(decodedBody, 1) === COLON_CODE_UNIT;
  return hasDrive ? decodedBody : `/${decodedBody}`;
}

/** Snapshot a diagnostic after removing a trusted filesystem path, before bounding it. */
export function snapshotThrowableDiagnosticRedactingPath(
  error: unknown,
  path: string,
  replacement: string,
): string {
  const diagnostic = readThrowableDiagnostic(error);
  const normalizationSource = fileUrlNormalizationSource(path);
  const normalizedPath = normalizeFilesystemPathForDiagnostic(normalizationSource);
  const posixDoubleSeparatorPath = normalizePosixDoubleSeparatorPathForDiagnostic(
    normalizationSource,
  );
  const rawPlatformPath = platformPathFromNormalizedFileUrl(normalizedPath);
  const rawPosixDrivePlatformPath = rawPlatformPath && isWindowsFilesystemPath(rawPlatformPath)
    ? `/${rawPlatformPath}`
    : undefined;
  const platformPath = rawPlatformPath === path || rawPlatformPath === normalizationSource ||
      rawPlatformPath === normalizedPath
    ? undefined
    : rawPlatformPath;
  const posixDrivePlatformPath = rawPosixDrivePlatformPath === path ||
      rawPosixDrivePlatformPath === normalizationSource ||
      rawPosixDrivePlatformPath === normalizedPath ||
      rawPosixDrivePlatformPath === platformPath
    ? undefined
    : rawPosixDrivePlatformPath;
  let redacted = redactPathFromText(diagnostic, path, replacement);
  if (normalizationSource !== path) {
    redacted = redactPathFromText(redacted, normalizationSource, replacement);
  }
  if (normalizedPath !== path && normalizedPath !== normalizationSource) {
    redacted = redactPathFromText(redacted, normalizedPath, replacement);
  }
  if (
    posixDoubleSeparatorPath !== undefined &&
    posixDoubleSeparatorPath !== path &&
    posixDoubleSeparatorPath !== normalizedPath
  ) {
    redacted = redactPathFromText(redacted, posixDoubleSeparatorPath, replacement);
  }
  if (posixDrivePlatformPath !== undefined) {
    redacted = redactPathFromText(redacted, posixDrivePlatformPath, replacement);
  }
  if (platformPath !== undefined) {
    redacted = redactPathFromText(redacted, platformPath, replacement);
  }
  if (
    containsTruncatedFilesystemPathPrefix(redacted, path) ||
    (normalizationSource !== path &&
      containsTruncatedFilesystemPathPrefix(redacted, normalizationSource)) ||
    (normalizedPath !== path && normalizedPath !== normalizationSource &&
      containsTruncatedFilesystemPathPrefix(redacted, normalizedPath)) ||
    (posixDoubleSeparatorPath !== undefined &&
      containsTruncatedFilesystemPathPrefix(redacted, posixDoubleSeparatorPath)) ||
    (posixDrivePlatformPath !== undefined &&
      containsTruncatedFilesystemPathPrefix(redacted, posixDrivePlatformPath)) ||
    (platformPath !== undefined && containsTruncatedFilesystemPathPrefix(redacted, platformPath))
  ) {
    return `${FILESYSTEM_DIAGNOSTIC_FALLBACK} for ${replacement}`;
  }
  return sanitizeDiagnosticText(redacted);
}

/**
 * Snapshot a throwable once and return a stable Veryfront-shaped diagnostic.
 *
 * Invalid or unreadable VeryfrontError proxies degrade to the canonical
 * unknown-error identity. Plain errors contribute only safely-read own data.
 * Object-valued context is intentionally excluded so this generic snapshot
 * never retains project-owned accessors, proxies, or serializers.
 */
export function snapshotErrorForBoundary(error: unknown): VeryfrontErrorSnapshot {
  return sanitizeBoundaryErrorSnapshot(snapshotThrowableBoundary(error).error);
}

function sanitizeBoundaryErrorSnapshot(
  candidate: VeryfrontErrorSnapshot,
): VeryfrontErrorSnapshot {
  return {
    slug: sanitizeBoundedErrorSlug(candidate.slug),
    category: candidate.category,
    status: candidate.status,
    title: sanitizeDiagnosticText(candidate.title),
    message: sanitizeDiagnosticText(candidate.message),
    suggestion: sanitizeOptionalDiagnosticText(candidate.suggestion),
    exitCode: candidate.exitCode,
    detail: sanitizeOptionalDiagnosticText(candidate.detail),
    cause: typeof candidate.cause === "string"
      ? sanitizeDiagnosticText(candidate.cause)
      : undefined,
    instance: sanitizeOptionalDiagnosticText(candidate.instance),
    stack: candidate.stack === undefined ? undefined : sanitizeStackDiagnosticText(candidate.stack),
  };
}

export interface ErrorLoggingBoundarySnapshot {
  readonly error: VeryfrontErrorSnapshot;
  readonly context?: RedactedValue;
}

/**
 * Capture the error identity plus a framework-owned context copy for logging.
 *
 * The generic boundary snapshot remains context-free. This narrower path
 * redacts and detaches the context before returning it, so callers can never
 * retain or serialize the project-owned source object.
 */
export function snapshotErrorForLoggingBoundary(
  error: unknown,
): ErrorLoggingBoundarySnapshot {
  const boundary = snapshotThrowableBoundary(error);
  return {
    error: sanitizeBoundaryErrorSnapshot(boundary.error),
    context: boundary.context === undefined ? undefined : redactForSerialization(boundary.context),
  };
}

export interface SafeProblemDetails extends RFC9457Response {
  stack?: string;
}

/** Build a credential-scrubbed RFC 9457 snapshot without calling error methods. */
export function createSafeProblemDetails(
  error: unknown,
  instance?: string,
): SafeProblemDetails {
  const candidate = snapshotErrorForBoundary(error);
  const snapshot = isProblemDetailsResponseStatus(candidate.status) ? candidate : {
    ...UNKNOWN_ERROR_SNAPSHOT,
    detail: candidate.detail ?? candidate.message,
    stack: candidate.stack,
  };

  return {
    type: buildErrorDocsUrl(snapshot.slug),
    title: sanitizeDiagnosticText(snapshot.title),
    status: snapshot.status,
    detail: sanitizeOptionalDiagnosticText(snapshot.detail),
    instance: sanitizeOptionalDiagnosticText(snapshot.instance ?? instance),
    category: snapshot.category,
    suggestion: sanitizeOptionalDiagnosticText(snapshot.suggestion),
    cause: typeof snapshot.cause === "string" ? sanitizeDiagnosticText(snapshot.cause) : undefined,
    stack: snapshot.stack === undefined ? undefined : sanitizeStackDiagnosticText(snapshot.stack),
  };
}

/**
 * Serialize a problem-details object without allowing optional diagnostics to
 * amplify one response beyond the shared output budget.
 */
export function stringifySafeProblemDetails(
  body: SafeProblemDetails,
  pretty = false,
): string {
  const bounded = { ...body };
  const serialize = (): string => jsonStringify(bounded, null, pretty ? 2 : undefined);
  let serialized = serialize();
  if (serialized.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS) return serialized;

  for (const key of ["stack", "cause", "detail", "instance", "suggestion"] as const) {
    delete bounded[key];
    serialized = serialize();
    if (serialized.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS) return serialized;
  }

  return jsonStringify(
    {
      type: buildErrorDocsUrl(UNKNOWN_ERROR_SNAPSHOT.slug),
      title: UNKNOWN_ERROR_SNAPSHOT.title,
      status: UNKNOWN_ERROR_SNAPSHOT.status,
      category: UNKNOWN_ERROR_SNAPSHOT.category,
    },
    null,
    pretty ? 2 : undefined,
  );
}

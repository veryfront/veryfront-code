/**
 * Bounded, race-resistant parsing for extension manifest files.
 *
 * This module is internal. Callers must select JSON or JSONC explicitly so a
 * strict manifest cannot silently acquire the more permissive activation JSONC
 * security profile. The profile is deliberately narrower than Deno's full
 * loose config parser and never uses regex or best-effort source rewriting.
 *
 * @module extensions/manifest-reader
 */

import { defineError, VeryfrontError } from "#veryfront/errors/types.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { getDenoRuntime, isBun, isNode } from "#veryfront/platform/compat/runtime.ts";
import { quoteDiagnosticString } from "./diagnostic-string.ts";

/** Maximum accepted UTF-8 manifest size (256 KiB). */
export const MAX_EXTENSION_MANIFEST_BYTES = 256 * 1024;

const READ_BUFFER_BYTES = MAX_EXTENSION_MANIFEST_BYTES + 1;
const MAX_MANIFEST_BYTES_BIGINT = BigInt(MAX_EXTENSION_MANIFEST_BYTES);

// Capture the intrinsics used after asynchronous filesystem calls. This keeps
// parsing deterministic if application code mutates the corresponding globals
// while a manifest read is in flight.
const NativeError = Error;
const NativeSet = Set;
const NativeSyntaxError = SyntaxError;
const NativeUint8Array = Uint8Array;
const reflectApply = Reflect.apply;
const arrayPop = Array.prototype.pop;
const arrayPush = Array.prototype.push;
const functionHasInstance = Function.prototype[Symbol.hasInstance];
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const jsonParse = JSON.parse;
const numberIsSafeInteger = Number.isSafeInteger;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringSlice = String.prototype.slice;
const textDecoderDecode = TextDecoder.prototype.decode;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const typedArrayPrototype = reflectApply(objectGetPrototypeOf, undefined, [
  NativeUint8Array.prototype,
]) as object;
const typedArrayByteLength = (
  reflectApply(objectGetOwnPropertyDescriptor, undefined, [
    typedArrayPrototype,
    "byteLength",
  ]) as PropertyDescriptor
).get as (this: Uint8Array) => number;
const typedArrayBuffer = (
  reflectApply(objectGetOwnPropertyDescriptor, undefined, [
    typedArrayPrototype,
    "buffer",
  ]) as PropertyDescriptor
).get as (this: Uint8Array) => ArrayBufferLike;
const typedArrayByteOffset = (
  reflectApply(objectGetOwnPropertyDescriptor, undefined, [
    typedArrayPrototype,
    "byteOffset",
  ]) as PropertyDescriptor
).get as (this: Uint8Array) => number;

const MANIFEST_READ_ERROR = defineError({
  slug: "extension-manifest-read-failed",
  category: "CONFIG",
  status: 500,
  title: "Unable to read extension manifest",
  suggestion: "Check the manifest path and filesystem permissions",
});

const MANIFEST_FILE_ERROR = defineError({
  slug: "extension-manifest-file-invalid",
  category: "CONFIG",
  status: 422,
  title: "Extension manifest file is unsafe",
  suggestion: "Use a regular file that is not a symbolic link",
});

const MANIFEST_SIZE_ERROR = defineError({
  slug: "extension-manifest-too-large",
  category: "CONFIG",
  status: 413,
  title: "Extension manifest is too large",
  suggestion: `Keep extension manifests at or below ${MAX_EXTENSION_MANIFEST_BYTES} bytes`,
});

const MANIFEST_PARSE_ERROR = defineError({
  slug: "extension-manifest-parse-failed",
  category: "CONFIG",
  status: 422,
  title: "Extension manifest is malformed",
  suggestion: "Correct the manifest syntax and try again",
});

/** Manifest grammar selected by the caller. */
export type ExtensionManifestSyntax = "json" | "jsonc";

/** Metadata required to validate that a path and open handle identify one file. */
export interface ExtensionManifestFileInfo {
  readonly isFile: boolean;
  readonly isSymlink: boolean;
  readonly size: number | bigint;
  readonly dev: number | bigint | null;
  readonly ino: number | bigint | null;
}

/** Narrow file handle used by the manifest reader and its deterministic tests. */
export interface ExtensionManifestFileHandle {
  read(buffer: Uint8Array): Promise<number | null>;
  stat(): Promise<ExtensionManifestFileInfo>;
  close(): void | Promise<void>;
}

/** Narrow filesystem seam used to make identity races and stream growth testable. */
export interface ExtensionManifestFileSystem {
  lstat(path: string): Promise<ExtensionManifestFileInfo>;
  open(path: string): Promise<ExtensionManifestFileHandle>;
  isNotFound(error: unknown): boolean;
}

/** Options for reading an extension manifest. */
export interface ReadExtensionManifestOptions {
  /** Select strict JSON or JSON-with-comments explicitly. */
  readonly syntax: ExtensionManifestSyntax;
  /** @internal Deterministic filesystem seam for tests and platform adapters. */
  readonly fileSystem?: ExtensionManifestFileSystem;
}

/** Missing manifests are data, not parse or I/O failures. */
export type ExtensionManifestReadResult<T = unknown> =
  | { readonly kind: "missing" }
  | {
    readonly kind: "found";
    readonly manifest: T;
    readonly bytesRead: number;
  };

interface NodeBigIntFileInfo {
  isFile(): boolean;
  isSymbolicLink(): boolean;
  readonly size: bigint;
  readonly dev: bigint;
  readonly ino: bigint;
}

interface NodeFileHandle {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: null,
  ): Promise<{ bytesRead: number }>;
  stat(options: { bigint: true }): Promise<NodeBigIntFileInfo>;
  close(): Promise<void>;
}

function fromDenoFileInfo(info: Deno.FileInfo): ExtensionManifestFileInfo {
  return {
    isFile: info.isFile,
    isSymlink: info.isSymlink,
    size: info.size,
    dev: info.dev,
    ino: info.ino,
  };
}

function fromNodeFileInfo(info: NodeBigIntFileInfo): ExtensionManifestFileInfo {
  return {
    isFile: info.isFile(),
    isSymlink: info.isSymbolicLink(),
    size: info.size,
    dev: info.dev,
    ino: info.ino,
  };
}

async function defaultLstat(path: string): Promise<ExtensionManifestFileInfo> {
  const deno = getDenoRuntime();
  if (deno) return fromDenoFileInfo(await deno.lstat(path));

  if (isNode || isBun) {
    const fs = await import("node:fs/promises");
    const info: NodeBigIntFileInfo = await fs.lstat(path, { bigint: true });
    return fromNodeFileInfo(info);
  }

  throw new Error("The current runtime does not provide filesystem access");
}

async function defaultOpen(path: string): Promise<ExtensionManifestFileHandle> {
  const deno = getDenoRuntime();
  if (deno) {
    const handle = await deno.open(path, { read: true });
    return {
      read: (buffer) => handle.read(buffer),
      stat: async () => fromDenoFileInfo(await handle.stat()),
      close: () => handle.close(),
    };
  }

  if (isNode || isBun) {
    const fs = await import("node:fs/promises");
    const handle: NodeFileHandle = await fs.open(path, "r");
    return {
      async read(buffer): Promise<number | null> {
        const bufferLength = reflectApply(typedArrayByteLength, buffer, []) as number;
        const result = await handle.read(buffer, 0, bufferLength, null);
        return result.bytesRead === 0 ? null : result.bytesRead;
      },
      stat: async () => fromNodeFileInfo(await handle.stat({ bigint: true })),
      close: () => handle.close(),
    };
  }

  throw new Error("The current runtime does not provide filesystem access");
}

const DEFAULT_FILE_SYSTEM: ExtensionManifestFileSystem = Object.freeze({
  lstat: defaultLstat,
  open: defaultOpen,
  isNotFound: isNotFoundError,
});

function errorContext(path: string, operation: string): Record<string, unknown> {
  return { path, operation };
}

function ownStringProperty(value: Error, property: string): string | undefined {
  const descriptor = reflectApply(objectGetOwnPropertyDescriptor, undefined, [value, property]) as
    | PropertyDescriptor
    | undefined;
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function intrinsicInstanceOf(
  value: unknown,
  constructor: { readonly prototype: object },
): boolean {
  try {
    return reflectApply(functionHasInstance, constructor, [value]) as boolean;
  } catch {
    return false;
  }
}

function diagnosticCause(cause: unknown): Error {
  try {
    if (intrinsicInstanceOf(cause, NativeError)) {
      const error = cause as Error;
      const message = ownStringProperty(error, "message") ?? "The operation failed";
      const code = ownStringProperty(error, "code");
      const summary = code
        ? `${quoteDiagnosticString(code)}: ${quoteDiagnosticString(message)}`
        : quoteDiagnosticString(message);
      return intrinsicInstanceOf(error, NativeSyntaxError)
        ? new NativeSyntaxError(summary)
        : new NativeError(summary);
    }
  } catch {
    return new NativeError("The operation error could not be inspected safely");
  }

  return new NativeError("The operation failed without an Error value");
}

function combinedDiagnosticCause(operationError: unknown, closeError: unknown): Error {
  const operationCause = diagnosticCause(operationError);
  const closeCause = diagnosticCause(closeError);
  const operationMessage = ownStringProperty(operationCause, "message") ?? "unknown operation";
  const closeMessage = ownStringProperty(closeCause, "message") ?? "unknown close";
  return new NativeError(
    `Manifest operation failed: ${operationMessage}; handle close failed: ${closeMessage}`,
  );
}

function readError(path: string, operation: string, cause: unknown): VeryfrontError {
  return MANIFEST_READ_ERROR.create({
    message: `Failed to ${operation} extension manifest ${quoteDiagnosticString(path)}`,
    cause: diagnosticCause(cause),
    context: errorContext(path, operation),
  });
}

function fileError(path: string, detail: string): VeryfrontError {
  return MANIFEST_FILE_ERROR.create({
    message: `Rejected extension manifest ${quoteDiagnosticString(path)}: ${detail}`,
    context: errorContext(path, "validate-file-identity"),
  });
}

function sizeError(path: string): VeryfrontError {
  return MANIFEST_SIZE_ERROR.create({
    message: `Extension manifest ${
      quoteDiagnosticString(path)
    } exceeds ${MAX_EXTENSION_MANIFEST_BYTES} bytes`,
    context: {
      ...errorContext(path, "read-bounded"),
      maxBytes: MAX_EXTENSION_MANIFEST_BYTES,
    },
  });
}

function parseError(
  path: string,
  syntax: ExtensionManifestSyntax,
  cause: unknown,
): VeryfrontError {
  const syntaxLabel = syntax === "json" ? "JSON" : "JSONC";
  return MANIFEST_PARSE_ERROR.create({
    message: `Failed to parse ${syntaxLabel} extension manifest ${quoteDiagnosticString(path)}`,
    cause: diagnosticCause(cause),
    context: { ...errorContext(path, "parse"), syntax },
  });
}

function requireManifestSyntax(
  path: string,
  syntax: unknown,
): ExtensionManifestSyntax {
  if (syntax === "json" || syntax === "jsonc") return syntax;
  throw MANIFEST_PARSE_ERROR.create({
    message: `Rejected extension manifest ${quoteDiagnosticString(path)}: unsupported syntax`,
    context: { ...errorContext(path, "select-syntax"), syntax },
  });
}

function isManifestError(error: unknown): error is VeryfrontError {
  try {
    if (!intrinsicInstanceOf(error, VeryfrontError)) return false;
    const slug = ownStringProperty(error as VeryfrontError, "slug");
    return slug === MANIFEST_READ_ERROR.slug ||
      slug === MANIFEST_FILE_ERROR.slug ||
      slug === MANIFEST_SIZE_ERROR.slug ||
      slug === MANIFEST_PARSE_ERROR.slug;
  } catch {
    return false;
  }
}

function validateSize(path: string, info: ExtensionManifestFileInfo): void {
  if (typeof info.size === "bigint") {
    if (info.size < 0n) {
      throw fileError(path, "the filesystem returned an invalid negative size");
    }
    if (info.size > MAX_MANIFEST_BYTES_BIGINT) throw sizeError(path);
    return;
  }

  if (!numberIsSafeInteger(info.size) || info.size < 0) {
    throw fileError(path, "the filesystem returned an invalid size");
  }
  if (info.size > MAX_EXTENSION_MANIFEST_BYTES) throw sizeError(path);
}

function validateRegularFile(
  path: string,
  info: ExtensionManifestFileInfo,
  source: string,
): void {
  if (info.isSymlink) {
    throw fileError(path, `the ${source} path is a symbolic link`);
  }
  if (!info.isFile) {
    throw fileError(path, `the ${source} target is not a regular file`);
  }
  validateSize(path, info);
}

function identityPart(value: number | bigint | null): string | undefined {
  if (typeof value === "bigint") return value >= 0n ? `${value}` : undefined;
  if (typeof value === "number" && numberIsSafeInteger(value) && value >= 0) {
    return `${value}`;
  }
  return undefined;
}

function fileIdentity(
  path: string,
  info: ExtensionManifestFileInfo,
  source: string,
): string {
  const dev = identityPart(info.dev);
  const ino = identityPart(info.ino);
  if (dev === undefined || ino === undefined) {
    throw fileError(path, `the ${source} identity cannot be verified`);
  }
  return `${dev}:${ino}`;
}

function assertSameFile(
  path: string,
  beforeOpen: ExtensionManifestFileInfo,
  openHandle: ExtensionManifestFileInfo,
  currentPath: ExtensionManifestFileInfo,
): void {
  validateRegularFile(path, openHandle, "open handle");
  validateRegularFile(path, currentPath, "current");

  const beforeIdentity = fileIdentity(path, beforeOpen, "pre-open path");
  const handleIdentity = fileIdentity(path, openHandle, "open handle");
  const currentIdentity = fileIdentity(path, currentPath, "current path");

  if (beforeIdentity !== handleIdentity || handleIdentity !== currentIdentity) {
    throw fileError(path, "the file identity changed while it was being opened");
  }
}

function byteView(value: Uint8Array, offset: number, length: number): Uint8Array {
  const buffer = reflectApply(typedArrayBuffer, value, []) as ArrayBufferLike;
  const byteOffset = reflectApply(typedArrayByteOffset, value, []) as number;
  return new NativeUint8Array(buffer, byteOffset + offset, length);
}

async function readBounded(
  path: string,
  handle: ExtensionManifestFileHandle,
): Promise<{ bytes: Uint8Array; bytesRead: number }> {
  const buffer = new NativeUint8Array(READ_BUFFER_BYTES);
  let offset = 0;

  while (offset < READ_BUFFER_BYTES) {
    const remainingLength = READ_BUFFER_BYTES - offset;
    const remaining = byteView(buffer, offset, remainingLength);
    const bytesRead = await handle.read(remaining);
    if (bytesRead === null) break;
    if (!numberIsSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > remainingLength) {
      throw fileError(path, "the filesystem returned an invalid read length");
    }
    offset += bytesRead;
  }

  if (offset > MAX_EXTENSION_MANIFEST_BYTES) throw sizeError(path);
  return {
    bytes: byteView(buffer, 0, offset),
    bytesRead: offset,
  };
}

function isJsonWhitespace(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;
}

function isDenoJsoncWhitespace(code: number): boolean {
  return (code >= 0x09 && code <= 0x0d) || code === 0x20 ||
    code === 0x85 || code === 0xa0 || code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) || code === 0x2028 ||
    code === 0x2029 || code === 0x202f || code === 0x205f ||
    code === 0x3000;
}

function stripJsoncComments(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index++) {
    const code = reflectApply(stringCharCodeAt, source, [index]) as number;

    if (inString) {
      output += reflectApply(stringSlice, source, [index, index + 1]) as string;
      if (escaped) {
        escaped = false;
      } else if (code === 0x5c) {
        escaped = true;
      } else if (code === 0x22) {
        inString = false;
      }
      continue;
    }

    if (code === 0x22) {
      inString = true;
      output += '"';
      continue;
    }

    if (code !== 0x2f || index + 1 >= source.length) {
      output += isDenoJsoncWhitespace(code) && !isJsonWhitespace(code)
        ? " "
        : reflectApply(stringSlice, source, [index, index + 1]) as string;
      continue;
    }

    const next = reflectApply(stringCharCodeAt, source, [index + 1]) as number;
    if (next === 0x2f) {
      output += "  ";
      index += 2;
      while (index < source.length) {
        const commentCode = reflectApply(stringCharCodeAt, source, [index]) as number;
        const afterCommentCode = index + 1 < source.length
          ? reflectApply(stringCharCodeAt, source, [index + 1]) as number
          : -1;
        if (commentCode === 0x0a || (commentCode === 0x0d && afterCommentCode === 0x0a)) {
          output += reflectApply(stringSlice, source, [index, index + 1]) as string;
          break;
        }
        output += " ";
        index++;
      }
      continue;
    }

    if (next === 0x2a) {
      output += "  ";
      index += 2;
      let terminated = false;
      while (index < source.length) {
        const commentCode = reflectApply(stringCharCodeAt, source, [index]) as number;
        const afterCommentCode = index + 1 < source.length
          ? reflectApply(stringCharCodeAt, source, [index + 1]) as number
          : -1;
        if (commentCode === 0x2a && afterCommentCode === 0x2f) {
          output += "  ";
          index++;
          terminated = true;
          break;
        }
        output += commentCode === 0x0a || commentCode === 0x0d
          ? reflectApply(stringSlice, source, [index, index + 1]) as string
          : " ";
        index++;
      }
      if (!terminated) {
        throw new NativeSyntaxError("Unterminated block comment in JSONC manifest");
      }
      continue;
    }

    output += "/";
  }

  return output;
}

function rejectDuplicateObjectKeys(source: string): void {
  const scopes: Array<Set<string> | null> = [];

  for (let index = 0; index < source.length; index++) {
    const code = reflectApply(stringCharCodeAt, source, [index]) as number;
    if (code === 0x7b) {
      reflectApply(arrayPush, scopes, [new NativeSet<string>()]);
      continue;
    }
    if (code === 0x5b) {
      reflectApply(arrayPush, scopes, [null]);
      continue;
    }
    if (code === 0x7d || code === 0x5d) {
      reflectApply(arrayPop, scopes, []);
      continue;
    }
    if (code !== 0x22) continue;

    const tokenStart = index;
    let escaped = false;
    let terminated = false;
    for (index++; index < source.length; index++) {
      const stringCode = reflectApply(stringCharCodeAt, source, [index]) as number;
      if (escaped) {
        escaped = false;
      } else if (stringCode === 0x5c) {
        escaped = true;
      } else if (stringCode === 0x22) {
        terminated = true;
        break;
      }
    }
    if (!terminated) return;

    let next = index + 1;
    while (
      next < source.length &&
      isJsonWhitespace(reflectApply(stringCharCodeAt, source, [next]) as number)
    ) {
      next++;
    }
    if (
      next >= source.length ||
      reflectApply(stringCharCodeAt, source, [next]) as number !== 0x3a
    ) continue;

    const scope = scopes[scopes.length - 1];
    if (!scope) continue;
    const token = reflectApply(stringSlice, source, [tokenStart, index + 1]) as string;
    let key: unknown;
    try {
      key = reflectApply(jsonParse, undefined, [token]);
    } catch {
      return;
    }
    if (typeof key !== "string") continue;
    if (reflectApply(setHas, scope, [key]) as boolean) {
      throw new NativeSyntaxError(`Duplicate object key ${quoteDiagnosticString(key)}`);
    }
    reflectApply(setAdd, scope, [key]);
  }
}

function containsJsonToken(source: string): boolean {
  for (let index = 0; index < source.length; index++) {
    if (!isJsonWhitespace(reflectApply(stringCharCodeAt, source, [index]) as number)) {
      return true;
    }
  }
  return false;
}

function jsoncProfileCause(error: unknown): SyntaxError {
  const parserCause = diagnosticCause(error);
  const detail = ownStringProperty(parserCause, "message") ?? "The document is invalid";
  return new NativeSyntaxError(
    "Activation JSONC security profile rejected malformed or unsupported loose syntax. " +
      "Use double-quoted JSON keys and strings plus standards-JSON values. " +
      `Comments, trailing commas, and Deno whitespace are supported. Parser detail: ${detail}`,
  );
}

function stripJsoncTrailingCommas(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let previousSignificantCode: number | undefined;

  for (let index = 0; index < source.length; index++) {
    const code = reflectApply(stringCharCodeAt, source, [index]) as number;

    if (inString) {
      output += reflectApply(stringSlice, source, [index, index + 1]) as string;
      if (escaped) {
        escaped = false;
      } else if (code === 0x5c) {
        escaped = true;
      } else if (code === 0x22) {
        inString = false;
      }
      continue;
    }

    if (code === 0x22) {
      inString = true;
      output += '"';
      previousSignificantCode = code;
      continue;
    }

    if (code === 0x2c) {
      let next = index + 1;
      while (
        next < source.length &&
        isJsonWhitespace(reflectApply(stringCharCodeAt, source, [next]) as number)
      ) {
        next++;
      }
      const nextCode = next < source.length
        ? reflectApply(stringCharCodeAt, source, [next]) as number
        : -1;
      const followsValue = previousSignificantCode !== undefined &&
        previousSignificantCode !== 0x5b &&
        previousSignificantCode !== 0x7b &&
        previousSignificantCode !== 0x2c &&
        previousSignificantCode !== 0x3a;
      output += (nextCode === 0x5d || nextCode === 0x7d) && followsValue ? " " : ",";
      previousSignificantCode = code;
      continue;
    }

    output += reflectApply(stringSlice, source, [index, index + 1]) as string;
    if (!isJsonWhitespace(code)) previousSignificantCode = code;
  }

  return output;
}

/**
 * Parse strict JSON or the hardened JSONC subset used for Deno manifests.
 *
 * JSONC accepts comments, trailing commas, Deno's Unicode whitespace, and an
 * empty/comment-only document. It deliberately keeps JSON's double-quoted
 * strings and property names: Deno's optional loose keys and single-quoted
 * strings are rejected rather than approximated with brittle rewriting.
 */
export function parseExtensionManifest<T = unknown>(
  source: string,
  syntax: ExtensionManifestSyntax,
  path = "<extension-manifest>",
): T {
  const selectedSyntax = requireManifestSyntax(path, syntax);
  try {
    const json = selectedSyntax === "jsonc"
      ? stripJsoncTrailingCommas(stripJsoncComments(source))
      : source;
    if (selectedSyntax === "jsonc" && !containsJsonToken(json)) return {} as T;
    rejectDuplicateObjectKeys(json);
    return reflectApply(jsonParse, undefined, [json]) as T;
  } catch (error) {
    throw parseError(
      path,
      selectedSyntax,
      selectedSyntax === "jsonc" ? jsoncProfileCause(error) : error,
    );
  }
}

async function closeAfterRead<T>(
  path: string,
  handle: ExtensionManifestFileHandle,
  operation: () => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  let operationFailed = false;
  let operationError: unknown;

  try {
    result = await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  try {
    await handle.close();
  } catch (closeError) {
    const cause = operationFailed
      ? combinedDiagnosticCause(operationError, closeError)
      : closeError;
    throw readError(path, "close", cause);
  }

  if (operationFailed) throw operationError;
  return result as T;
}

/**
 * Read and parse one extension manifest through one file handle.
 *
 * The reader rejects terminal symlinks and non-regular files, verifies that
 * pre-open, current-path, and handle identities agree, and caps all reads at a
 * fixed `MAX + 1` buffer so concurrent file growth remains bounded.
 */
export async function readExtensionManifest<T = unknown>(
  path: string,
  options: ReadExtensionManifestOptions,
): Promise<ExtensionManifestReadResult<T>> {
  const syntax = requireManifestSyntax(path, options.syntax);
  const fileSystem = options.fileSystem ?? DEFAULT_FILE_SYSTEM;
  let beforeOpen: ExtensionManifestFileInfo;

  try {
    beforeOpen = await fileSystem.lstat(path);
  } catch (error) {
    if (fileSystem.isNotFound(error)) return { kind: "missing" };
    throw readError(path, "inspect", error);
  }

  validateRegularFile(path, beforeOpen, "pre-open");
  fileIdentity(path, beforeOpen, "pre-open path");

  let handle: ExtensionManifestFileHandle;
  try {
    handle = await fileSystem.open(path);
  } catch (error) {
    throw readError(path, "open", error);
  }

  return await closeAfterRead(path, handle, async () => {
    try {
      const handleInfo = await handle.stat();
      const currentPathInfo = await fileSystem.lstat(path);
      assertSameFile(path, beforeOpen, handleInfo, currentPathInfo);

      const { bytes, bytesRead } = await readBounded(path, handle);

      // Detect replacement of the directory entry while bytes were read. The
      // open handle remains stable, but accepting a manifest no longer present
      // at its declared path would make activation timing-dependent.
      const finalPathInfo = await fileSystem.lstat(path);
      assertSameFile(path, beforeOpen, handleInfo, finalPathInfo);

      let source: string;
      try {
        source = reflectApply(textDecoderDecode, utf8Decoder, [bytes]) as string;
      } catch (error) {
        throw parseError(path, syntax, error);
      }

      return {
        kind: "found",
        manifest: parseExtensionManifest<T>(source, syntax, path),
        bytesRead,
      };
    } catch (error) {
      if (isManifestError(error)) throw error;
      throw readError(path, "read", error);
    }
  });
}

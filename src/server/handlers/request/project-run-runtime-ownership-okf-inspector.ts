import { privateJsonStringify } from "#veryfront/security/private-json.ts";

export interface RuntimeOwnershipOkfInspection {
  body: string;
  metadata: Record<string, unknown>;
}

const RuntimeReflectApply = Reflect.apply;
const RuntimeStringPrototypeCharCodeAt = String.prototype.charCodeAt;
const RuntimeStringPrototypeIndexOf = String.prototype.indexOf;
const RuntimeStringPrototypeSlice = String.prototype.slice;
const RuntimeStringPrototypeStartsWith = String.prototype.startsWith;
const RuntimeStringPrototypeTrim = String.prototype.trim;
const RuntimeRegExpPrototypeExec = RegExp.prototype.exec;
const RuntimeObjectCreate = Object.create;
const RuntimeObjectDefineProperty = Object.defineProperty;
const RuntimeObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const RuntimeNumber = Number;
const RuntimeNumberIsFinite = Number.isFinite;
const RuntimeError = Error;

const FRONTMATTER_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const UNSUPPORTED_SCALAR_PREFIX = /^[&*!{[|>?@-]/;

function codeUnit(value: string, index: number): number {
  return RuntimeReflectApply(RuntimeStringPrototypeCharCodeAt, value, [
    index,
  ]) as number;
}

function startsWith(value: string, search: string): boolean {
  return RuntimeReflectApply(RuntimeStringPrototypeStartsWith, value, [
    search,
  ]) as boolean;
}

function slice(value: string, start: number, end?: number): string {
  return RuntimeReflectApply(RuntimeStringPrototypeSlice, value, [
    start,
    end,
  ]) as string;
}

function trim(value: string): string {
  return RuntimeReflectApply(RuntimeStringPrototypeTrim, value, []) as string;
}

function indexOf(value: string, search: string): number {
  return RuntimeReflectApply(RuntimeStringPrototypeIndexOf, value, [
    search,
  ]) as number;
}

function test(pattern: RegExp, value: string): boolean {
  return RuntimeReflectApply(RuntimeRegExpPrototypeExec, pattern, [value]) !==
    null;
}

function unsupportedFrontmatter(message: string): Error {
  return new RuntimeError(
    `Unsupported OKF frontmatter for runtime ownership proof: ${message}`,
  );
}

function readEnvelope(source: string): { frontMatter: string; body: string } {
  const envelopeSource = startsWith(source, "\uFEFF") ? slice(source, 1) : source;
  const openingLength = startsWith(envelopeSource, "---\n")
    ? 4
    : startsWith(envelopeSource, "---\r\n")
    ? 5
    : 0;
  if (openingLength === 0) {
    throw unsupportedFrontmatter("missing leading delimiter");
  }

  const remainder = slice(envelopeSource, openingLength);
  for (let index = 0; index < remainder.length; index++) {
    if (index !== 0 && codeUnit(remainder, index - 1) !== 10) continue;
    if (
      codeUnit(remainder, index) !== 45 ||
      codeUnit(remainder, index + 1) !== 45 ||
      codeUnit(remainder, index + 2) !== 45
    ) continue;
    const after = index + 3;
    if (after === remainder.length) {
      return { frontMatter: slice(remainder, 0, index), body: "" };
    }
    if (codeUnit(remainder, after) === 10) {
      return {
        frontMatter: slice(remainder, 0, index),
        body: slice(remainder, after + 1),
      };
    }
    if (
      codeUnit(remainder, after) === 13 && codeUnit(remainder, after + 1) === 10
    ) {
      return {
        frontMatter: slice(remainder, 0, index),
        body: slice(remainder, after + 2),
      };
    }
  }
  throw unsupportedFrontmatter("missing closing delimiter");
}

function defineMetadata(
  metadata: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const descriptor = RuntimeObjectCreate(null) as PropertyDescriptor;
  descriptor.value = value;
  descriptor.enumerable = true;
  descriptor.writable = true;
  descriptor.configurable = true;
  RuntimeReflectApply(RuntimeObjectDefineProperty, Object, [
    metadata,
    key,
    descriptor,
  ]);
}

function parseScalar(value: string): unknown {
  if (value === "") {
    throw unsupportedFrontmatter("nested mappings are not supported");
  }
  if (test(UNSUPPORTED_SCALAR_PREFIX, value)) {
    throw unsupportedFrontmatter("YAML features are not supported");
  }
  const quote = codeUnit(value, 0);
  if (quote === 34 || quote === 39) {
    if (value.length < 2 || codeUnit(value, value.length - 1) !== quote) {
      throw unsupportedFrontmatter("unterminated quoted scalar");
    }
    const inner = slice(value, 1, value.length - 1);
    if (
      indexOf(inner, "\\") !== -1 ||
      indexOf(inner, quote === 34 ? '"' : "'") !== -1
    ) {
      throw unsupportedFrontmatter("escaped scalars are not supported");
    }
    return inner;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (test(JSON_NUMBER, value)) {
    const number = RuntimeNumber(value);
    if (!RuntimeNumberIsFinite(number)) {
      throw unsupportedFrontmatter("non-finite numbers are not supported");
    }
    return number;
  }
  return value;
}

function parseFlatMetadata(frontMatter: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = RuntimeObjectCreate(null);
  let lineStart = 0;
  let sawLine = false;
  while (lineStart <= frontMatter.length) {
    let lineEnd = lineStart;
    while (
      lineEnd < frontMatter.length && codeUnit(frontMatter, lineEnd) !== 10
    ) lineEnd++;
    const rawLine = codeUnit(frontMatter, lineEnd - 1) === 13
      ? slice(frontMatter, lineStart, lineEnd - 1)
      : slice(frontMatter, lineStart, lineEnd);
    const line = trim(rawLine);
    if (line !== "" && codeUnit(line, 0) !== 35) {
      sawLine = true;
      if (codeUnit(rawLine, 0) === 32 || codeUnit(rawLine, 0) === 9) {
        throw unsupportedFrontmatter("nested YAML is not supported");
      }
      const separator = indexOf(line, ":");
      if (separator <= 0) {
        throw unsupportedFrontmatter("expected key-value mapping");
      }
      const key = trim(slice(line, 0, separator));
      const rawValue = trim(slice(line, separator + 1));
      if (!test(FRONTMATTER_KEY, key)) {
        throw unsupportedFrontmatter("invalid metadata key");
      }
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw unsupportedFrontmatter("reserved metadata key");
      }
      if (
        RuntimeReflectApply(RuntimeObjectGetOwnPropertyDescriptor, Object, [
          metadata,
          key,
        ]) !==
          undefined
      ) {
        throw unsupportedFrontmatter("duplicate metadata key");
      }
      defineMetadata(metadata, key, parseScalar(rawValue));
    }
    if (lineEnd === frontMatter.length) break;
    lineStart = lineEnd + 1;
  }
  if (!sawLine) throw unsupportedFrontmatter("empty metadata is not supported");
  privateJsonStringify(metadata);
  return metadata;
}

export function inspectRuntimeOwnershipOkfDocument(
  sourcePath: string,
  content: string,
): RuntimeOwnershipOkfInspection {
  if (typeof sourcePath !== "string" || sourcePath.length === 0) {
    throw unsupportedFrontmatter("source path is required");
  }
  if (typeof content !== "string") {
    throw unsupportedFrontmatter("source content must be text");
  }
  const envelope = readEnvelope(content);
  const metadata = parseFlatMetadata(envelope.frontMatter);
  return { body: envelope.body, metadata };
}

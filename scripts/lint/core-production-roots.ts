import { builtinModules, isBuiltin } from "node:module";
import {
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  relative,
  resolve,
  toFileUrl,
} from "#std/path";
import {
  BROWSER_SAFE_EXPORTS,
  BROWSER_SAFE_INTERNAL_ENTRY_POINTS,
} from "../build/browser-safe-exports.mjs";
import { isPathContained } from "../lib/path-containment.ts";

export type CoreProductionTarget = "browser" | "node" | "deno" | "universal";

export interface ManifestExportClaim {
  manifestPath: string;
  exportName: string;
  /** Logical module identity, including an explicit query or fragment. */
  identity?: string;
  /** Physical repository path used for filesystem access. */
  path: string;
  alternativeIndex?: number;
  alternativeIndices?: Partial<
    Record<Exclude<CoreProductionTarget, "universal">, number>
  >;
  targets?: Array<Exclude<CoreProductionTarget, "universal">>;
}

export interface ProductionEntrypoint {
  id: string;
  /** Logical module identity, including an explicit query or fragment. */
  identity?: string;
  /** Physical repository path used for filesystem access. */
  path: string;
  manifestClaims: ManifestExportClaim[];
}

export interface SourceAssignment {
  pathPrefix: string;
}

export interface CoreProductionContext {
  id: string;
  target: CoreProductionTarget;
  entrypoints: ProductionEntrypoint[];
  assignedSource: SourceAssignment[];
  configPaths: string[];
  manifestPaths: string[];
  packageConfigPaths: string[];
}

export interface CoreProductionRegistry {
  contexts: CoreProductionContext[];
  manifestClaims: ManifestExportClaim[];
  configs: ReadonlyMap<string, Record<string, unknown>>;
}

export interface CoreProductionPackageDefinition {
  manifestPath: string;
  sourceRoot: string;
  targets: readonly Exclude<CoreProductionTarget, "universal">[];
}

export interface ConfigurationDependencyEdge {
  configPath: string;
  field: string;
  specifier: string;
  target: string;
}

export interface ImportMapLayer {
  path: string;
  baseUrl?: string;
  repositoryRootUrl?: string;
  imports?: Record<string, string>;
  scopes?: Record<string, Record<string, string>>;
}

export interface ImportMapResolution {
  resolved: string;
  trace: string[];
  origin:
    | { kind: "request"; base: "importer" }
    | { kind: "mapping"; base: string };
  localPath?: string;
  mapping?: ImportMapMappingProvenance;
}

export interface ImportMapMappingProvenance {
  owner: string;
  base: string;
  sourceKey: string;
  canonicalKey: string;
  selectedAddress: string;
  canonicalTarget: string;
  sourceScope?: string;
  canonicalScope?: string;
}

export interface ImportMapResolver {
  resolve(specifier: string, importer?: string): string;
  resolveWithTrace(specifier: string, importer?: string): ImportMapResolution;
}

export class CoreProductionRegistryError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(code: string, message: string, path?: string) {
    super(message);
    this.name = "CoreProductionRegistryError";
    this.code = code;
    this.path = path;
  }
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const BROWSER_SAFE_EXPORT_NAMES = new Set<string>(BROWSER_SAFE_EXPORTS);

// Public node: entrypoints available at the package's Node 18.18.0 minimum.
const NODE_18_18_PUBLIC_BUILTINS = new Set(
  [
    "assert",
    "assert/strict",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "dns/promises",
    "domain",
    "events",
    "fs",
    "fs/promises",
    "http",
    "http2",
    "https",
    "inspector",
    "module",
    "net",
    "os",
    "path",
    "path/posix",
    "path/win32",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "readline/promises",
    "repl",
    "stream",
    "stream/consumers",
    "stream/promises",
    "stream/web",
    "string_decoder",
    "sys",
    "test",
    "test/reporters",
    "timers",
    "timers/promises",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "util/types",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
  ].map((name) => `node:${name}`),
);

const DENO_PUBLIC_NODE_BUILTINS = new Set(
  builtinModules
    .filter((name) => /^[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_-]*)*$/.test(name))
    .map((name) => `node:${name}`)
    .filter((specifier) => isBuiltin(specifier)),
);

const ADDITIONAL_CORE_RUNTIME_ENTRYPOINTS = [
  "src/config/declarative-evaluator.ts",
  "src/config/declarative-evaluator-worker-entry.ts",
  "src/config/declarative-evaluator-worker-runner.ts",
  "src/proxy/main.ts",
  "src/security/sandbox/worker-script.ts",
  "src/server/production-server.ts",
] as const;

const BROWSER_RUNTIME_ENTRYPOINT_PATHS = Object.freeze(
  Object.values(BROWSER_SAFE_INTERNAL_ENTRY_POINTS).map(
    normalizeRepositoryPath,
  ).sort(compareOrdinal),
);

/**
 * Non-manifest production roots. Browser build roots flow directly from the
 * browser build inventory so adding one cannot silently omit it from audit.
 */
export const CORE_RUNTIME_ENTRYPOINTS = Object.freeze([
  ...new Set([
    ...ADDITIONAL_CORE_RUNTIME_ENTRYPOINTS,
    ...BROWSER_RUNTIME_ENTRYPOINT_PATHS,
  ]),
].sort(compareOrdinal));

/** The single inventory from which manifest loading and production roots flow. */
export const CORE_PRODUCTION_PACKAGES:
  readonly CoreProductionPackageDefinition[] = Object.freeze([
    {
      manifestPath: "deno.json",
      sourceRoot: "src",
      targets: ["browser", "node", "deno"],
    },
    {
      manifestPath: "cli/deno.json",
      sourceRoot: "cli",
      targets: ["node", "deno"],
    },
    {
      manifestPath: "react/deno.json",
      sourceRoot: "react",
      targets: ["deno"],
    },
    {
      manifestPath: "browser/studio-bridge/deno.json",
      sourceRoot: "browser/studio-bridge",
      targets: ["browser"],
    },
  ]);

const BROWSER_RUNTIME_ENTRYPOINTS = new Set<string>(
  BROWSER_RUNTIME_ENTRYPOINT_PATHS,
);

function normalizeRepositoryPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isFileUrlSpecifier(specifier: string): boolean {
  return /^file:/i.test(specifier);
}

function urlDecorationIndex(specifier: string): number {
  const queryIndex = specifier.indexOf("?");
  // A leading `#` is part of a bare import-map key. A later `#` is a URL
  // fragment delimiter after an exact key or prefix suffix.
  const hashIndex = specifier.indexOf("#", specifier.startsWith("#") ? 1 : 0);
  return [queryIndex, hashIndex]
    .filter((index) => index >= 0)
    .reduce((minimum, index) => Math.min(minimum, index), specifier.length);
}

function physicalUrlIdentity(identity: string): string {
  return identity.slice(0, urlDecorationIndex(identity));
}

function urlIdentityDecoration(identity: string): string {
  return identity.slice(urlDecorationIndex(identity));
}

export function assertLocalFileUrl(value: string | URL, label: string): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw new Error(`${label} is not a valid local file URL: ${value}`);
  }
  if (
    url.protocol !== "file:" ||
    (url.hostname !== "" && url.hostname.toLowerCase() !== "localhost")
  ) {
    throw new Error(`${label} must use a local file URL: ${url.href}`);
  }
  return url;
}

function fromValidatedFileUrl(value: string | URL, label: string): string {
  return fromFileUrl(assertLocalFileUrl(value, label));
}

function containedRelativePath(
  root: string,
  candidate: string,
): string | undefined {
  if (!isPathContained(root, candidate)) return undefined;
  const result = relative(root, candidate);
  // Cross-drive and UNC `relative()` implementations may return an absolute
  // path. Such a result is never evidence of containment.
  if (isAbsolute(result)) return undefined;
  return normalizeRepositoryPath(result);
}

export function assertCanonicalPathEncoding(
  path: string,
  label: string,
): void {
  const encodingSubject = path.slice(0, urlDecorationIndex(path));
  let decoded = encodingSubject;
  for (let depth = 0; depth < 16; depth++) {
    if (/%[0-9a-f]{2}/i.test(decoded)) {
      throw new Error(
        `${label} contains a percent-encoded path component: ${path}`,
      );
    }
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error(`${label} contains invalid URL encoding: ${path}`);
    }
    if (next === decoded) return;
    decoded = next;
  }
  throw new Error(`${label} exceeds URL decoding limit: ${path}`);
}

function assertRepositoryPath(path: string, label: string): string {
  const normalized = normalizeRepositoryPath(path);
  if (
    normalized === "" || isAbsolute(path) || path.includes("\\") ||
    normalized === ".." || normalized.startsWith("../") ||
    normalized.split("/").includes("..") ||
    normalized.split("/").includes(".") ||
    normalized.includes("//")
  ) {
    throw new Error(
      `${label} must be a normalized repository-relative path: ${path}`,
    );
  }
  return normalized;
}

export function expandProductionTarget(
  target: CoreProductionTarget,
): Array<Exclude<CoreProductionTarget, "universal">> {
  return target === "universal" ? ["browser", "node", "deno"] : [target];
}

/** Admit only exact node:-prefixed public builtins supported by each target. */
export function isImportableBuiltin(
  specifier: string,
  target: CoreProductionTarget,
): boolean {
  return expandProductionTarget(target).every((expanded) => {
    if (expanded === "browser") return false;
    const candidate = expanded === "deno" && /^node:/i.test(specifier)
      ? `node:${specifier.slice(specifier.indexOf(":") + 1)}`
      : specifier;
    if (!candidate.startsWith("node:")) return false;
    return (expanded === "node"
      ? NODE_18_18_PUBLIC_BUILTINS
      : DENO_PUBLIC_NODE_BUILTINS).has(
        candidate,
      );
  });
}

interface DuplicateJsonKey {
  path: string[];
  key: string;
}

type JsonDialect = "deno-config" | "strict-json";

interface ParsedJsonDocument {
  value: unknown;
  duplicate?: DuplicateJsonKey;
}

interface JsonPathNode {
  parent: JsonPathNode | undefined;
  segment: string;
}

interface JsonObjectFrame {
  kind: "object";
  path: JsonPathNode | undefined;
  start: number;
  state: "member" | "commit" | "separator";
  value: Record<string, unknown>;
  seen: Set<string>;
  pending: { key: string; value: unknown } | undefined;
}

interface JsonArrayFrame {
  kind: "array";
  path: JsonPathNode | undefined;
  start: number;
  state: "element" | "commit" | "separator";
  value: unknown[];
  pending: unknown;
}

type JsonContainerFrame = JsonObjectFrame | JsonArrayFrame;

interface ParsedJsonValueStart {
  value: unknown;
  frame?: JsonContainerFrame;
}

const DENO_CONFIG_WHITESPACE = /\p{White_Space}/u;
const DENO_CONFIG_ALPHANUMERIC = /[\p{Alphabetic}\p{Number}]/u;
const DENO_CONFIG_WORD_CHARACTER = /[_\-\p{Alphabetic}\p{Number}]/u;
const MAX_SIGNED_HEX_DIGITS = "7fffffffffffffff";
const SIMPLE_ESCAPE_VALUES = {
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
} as const;

/**
 * Parse either Deno's deliberately loose config dialect or strict JSON without
 * evaluating source. Deno-config behavior is locked to Deno-correlated lexical
 * tests; external import maps use the strict mode exclusively.
 */
class ConfigJsonParser {
  readonly #content: string;
  readonly #dialect: JsonDialect;
  #index = 0;
  #duplicate: DuplicateJsonKey | undefined;

  constructor(content: string, dialect: JsonDialect) {
    this.#content = content;
    this.#dialect = dialect;
  }

  parse(): ParsedJsonDocument {
    this.#skipTrivia();
    if (this.#index === this.#content.length) {
      if (this.#dialect === "deno-config") return { value: {} };
      this.#fail("expected JSON value");
    }
    const root = this.#parseValueStart(undefined, undefined);
    const frames = root.frame ? [root.frame] : [];
    while (frames.length > 0) {
      const frame = frames.at(-1)!;
      if (frame.kind === "object") this.#advanceObject(frame, frames);
      else this.#advanceArray(frame, frames);
    }
    this.#skipTrivia();
    if (this.#index !== this.#content.length) {
      this.#fail("unexpected token after root value");
    }
    return { value: root.value, duplicate: this.#duplicate };
  }

  #parseValueStart(
    parentPath: JsonPathNode | undefined,
    segment: string | undefined,
  ): ParsedJsonValueStart {
    this.#skipTrivia();
    const character = this.#current();
    if (character === "{") {
      const start = this.#index;
      this.#index++;
      const value: Record<string, unknown> = {};
      return {
        value,
        frame: {
          kind: "object",
          path: this.#nestedPath(parentPath, segment),
          start,
          state: "member",
          value,
          seen: new Set(),
          pending: undefined,
        },
      };
    }
    if (character === "[") {
      const start = this.#index;
      this.#index++;
      const value: unknown[] = [];
      return {
        value,
        frame: {
          kind: "array",
          path: this.#nestedPath(parentPath, segment),
          start,
          state: "element",
          value,
          pending: undefined,
        },
      };
    }
    if (character === '"') return { value: this.#parseString() };
    if (character === "'") {
      if (this.#dialect === "strict-json") {
        this.#fail("single-quoted strings are not permitted");
      }
      return { value: this.#parseString() };
    }
    if (character === "-" || character === "+" || isAsciiDigit(character)) {
      return { value: this.#numberValue(this.#parseNumberToken()) };
    }
    for (
      const [keyword, value] of [
        ["true", true],
        ["false", false],
        ["null", null],
      ] as const
    ) {
      if (this.#matchesKeyword(keyword)) {
        this.#index += keyword.length;
        return { value };
      }
    }
    this.#fail("unexpected value token");
  }

  #advanceObject(
    frame: JsonObjectFrame,
    frames: JsonContainerFrame[],
  ): void {
    if (frame.state === "commit") {
      const pending = frame.pending!;
      if (frame.seen.has(pending.key) && !this.#duplicate) {
        this.#duplicate = {
          path: materializeJsonPath(frame.path),
          key: pending.key,
        };
      }
      frame.seen.add(pending.key);
      Object.defineProperty(frame.value, pending.key, {
        value: pending.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      frame.pending = undefined;
      frame.state = "separator";
      return;
    }

    this.#skipTrivia();
    if (frame.state === "member") {
      if (this.#index === this.#content.length) {
        this.#failAt(frame.start, "unterminated object");
      }
      if (this.#consume("}")) {
        frames.pop();
        return;
      }
      const key = this.#parsePropertyName();
      this.#skipTrivia();
      if (!this.#consume(":")) this.#fail("expected colon after object key");
      const member = this.#parseValueStart(frame.path, key);
      frame.pending = { key, value: member.value };
      frame.state = "commit";
      if (member.frame) frames.push(member.frame);
      return;
    }

    if (this.#consume("}")) {
      frames.pop();
      return;
    }
    if (this.#consume(",")) {
      this.#skipTrivia();
      if (this.#current() === "}") {
        if (this.#dialect === "strict-json") {
          this.#fail("trailing object comma is not permitted");
        }
        this.#index++;
        frames.pop();
        return;
      }
      frame.state = "member";
      return;
    }
    if (this.#dialect === "strict-json") {
      this.#fail("expected comma between object properties");
    }
    frame.state = "member";
  }

  #advanceArray(
    frame: JsonArrayFrame,
    frames: JsonContainerFrame[],
  ): void {
    if (frame.state === "commit") {
      frame.value.push(frame.pending);
      frame.pending = undefined;
      frame.state = "separator";
      return;
    }

    this.#skipTrivia();
    if (frame.state === "element") {
      if (this.#index === this.#content.length) {
        this.#failAt(frame.start, "unterminated array");
      }
      if (this.#consume("]")) {
        frames.pop();
        return;
      }
      const index = String(frame.value.length);
      const element = this.#parseValueStart(frame.path, index);
      frame.pending = element.value;
      frame.state = "commit";
      if (element.frame) frames.push(element.frame);
      return;
    }

    if (this.#consume("]")) {
      frames.pop();
      return;
    }
    if (this.#consume(",")) {
      this.#skipTrivia();
      if (this.#current() === "]") {
        if (this.#dialect === "strict-json") {
          this.#fail("trailing array comma is not permitted");
        }
        this.#index++;
        frames.pop();
        return;
      }
      frame.state = "element";
      return;
    }
    if (this.#dialect === "strict-json") {
      this.#fail("expected comma between array elements");
    }
    frame.state = "element";
  }

  #nestedPath(
    parent: JsonPathNode | undefined,
    segment: string | undefined,
  ): JsonPathNode | undefined {
    return segment === undefined ? undefined : { parent, segment };
  }

  #parsePropertyName(): string {
    this.#skipTrivia();
    const character = this.#current();
    if (character === '"') return this.#parseString();
    if (this.#dialect === "strict-json") {
      this.#fail("expected quoted object key");
    }
    if (character === "'") return this.#parseString();
    if (character === "-" || character === "+" || isAsciiDigit(character)) {
      return this.#parseNumberToken();
    }
    if (
      this.#matchesKeyword("true") || this.#matchesKeyword("false") ||
      this.#matchesKeyword("null")
    ) {
      this.#fail("literal keywords are not object keys");
    }
    return this.#parseWord();
  }

  #parseWord(): string {
    const start = this.#index;
    while (this.#index < this.#content.length) {
      const character = this.#current()!;
      if (this.#isWhitespace(character) || character === ":") break;
      if (!DENO_CONFIG_WORD_CHARACTER.test(character)) {
        this.#failAt(start, "invalid unquoted object key");
      }
      this.#advance();
    }
    if (this.#index === start) this.#fail("expected object key");
    return this.#content.slice(start, this.#index);
  }

  #parseString(): string {
    const stringStart = this.#index;
    const quote = this.#current()!;
    this.#index++;
    let segmentStart = this.#index;
    const decodedSegments: string[] = [];
    while (this.#index < this.#content.length) {
      const character = this.#current()!;
      if (character === quote) {
        const finalSegment = this.#content.slice(segmentStart, this.#index);
        this.#index++;
        if (decodedSegments.length === 0) return finalSegment;
        decodedSegments.push(finalSegment);
        return decodedSegments.join("");
      }
      if (character === "\\") {
        decodedSegments.push(this.#content.slice(segmentStart, this.#index));
        decodedSegments.push(this.#parseStringEscape(quote, stringStart));
        segmentStart = this.#index;
        continue;
      }
      if (
        this.#dialect === "strict-json" && character.codePointAt(0)! <= 0x1f
      ) {
        this.#fail("unescaped control character in string");
      }
      this.#advance();
    }
    this.#failAt(stringStart, "unterminated string literal");
  }

  #parseStringEscape(quote: string, stringStart: number): string {
    const escapeStart = this.#index;
    this.#index++;
    const escaped = this.#current();
    if (escaped === undefined) {
      this.#failAt(stringStart, "unterminated string literal");
    }
    if (escaped === quote) {
      this.#index++;
      return quote;
    }
    if (escaped === '"' || escaped === "'") {
      this.#failAt(escapeStart, "invalid escape for string delimiter");
    }
    if (Object.hasOwn(SIMPLE_ESCAPE_VALUES, escaped)) {
      this.#index++;
      return SIMPLE_ESCAPE_VALUES[escaped as keyof typeof SIMPLE_ESCAPE_VALUES];
    }
    if (escaped !== "u") {
      this.#failAt(escapeStart, "invalid string escape");
    }
    this.#index++;
    return this.#parseUnicodeEscape(escapeStart);
  }

  #parseUnicodeEscape(escapeStart: number): string {
    const first = this.#parseHexCodeUnit(escapeStart);
    if (first >= 0xdc00 && first <= 0xdfff) {
      this.#failAt(escapeStart, "unpaired low surrogate escape");
    }
    if (first < 0xd800 || first > 0xdbff) {
      return String.fromCodePoint(first);
    }
    if (this.#current() !== "\\" || this.#content[this.#index + 1] !== "u") {
      this.#failAt(escapeStart, "unpaired high surrogate escape");
    }
    this.#index += 2;
    const second = this.#parseHexCodeUnit(escapeStart);
    if (second < 0xdc00 || second > 0xdfff) {
      this.#failAt(
        escapeStart,
        "high surrogate is not followed by a low surrogate",
      );
    }
    return String.fromCodePoint(
      ((first - 0xd800) * 0x400) + (second - 0xdc00) + 0x10000,
    );
  }

  #parseHexCodeUnit(escapeStart: number): number {
    const digits = this.#content.slice(this.#index, this.#index + 4);
    if (!/^[0-9a-f]{4}$/i.test(digits)) {
      this.#failAt(
        escapeStart,
        "Unicode escape must contain four hexadecimal digits",
      );
    }
    this.#index += 4;
    return Number.parseInt(digits, 16);
  }

  #parseNumberToken(): string {
    const start = this.#index;
    if (this.#current() === "+") {
      if (this.#dialect === "strict-json") {
        this.#fail("unary plus is not permitted in JSON numbers");
      }
      this.#index++;
    } else if (this.#current() === "-") {
      this.#index++;
    }

    if (this.#current() === "0") {
      this.#index++;
      if (this.#current() === "x" || this.#current() === "X") {
        if (this.#dialect === "strict-json") {
          this.#fail("hexadecimal numbers are not permitted in JSON");
        }
        this.#index++;
        const firstDigit = this.#index;
        while (isAsciiHexDigit(this.#current())) this.#index++;
        if (this.#index === firstDigit) {
          this.#fail("expected hexadecimal digit");
        }
        return this.#content.slice(start, this.#index);
      }
    } else if (isAsciiOneToNine(this.#current())) {
      while (isAsciiDigit(this.#current())) this.#index++;
    } else {
      this.#fail("expected digit in number");
    }

    if (this.#current() === ".") {
      this.#index++;
      const firstDigit = this.#index;
      while (isAsciiDigit(this.#current())) this.#index++;
      if (this.#index === firstDigit) this.#fail("expected fractional digit");
    }
    if (this.#current() === "e" || this.#current() === "E") {
      this.#index++;
      if (this.#current() === "+" || this.#current() === "-") this.#index++;
      const firstDigit = this.#index;
      while (isAsciiDigit(this.#current())) this.#index++;
      if (this.#index === firstDigit) this.#fail("expected exponent digit");
    }
    return this.#content.slice(start, this.#index);
  }

  #numberValue(token: string): number | string {
    const unsigned = token.replace(/^[+-]/, "");
    if (/^0x/i.test(unsigned)) {
      const digits = unsigned.slice(2).replace(/^0+/, "") || "0";
      if (
        digits.length > MAX_SIGNED_HEX_DIGITS.length ||
        (digits.length === MAX_SIGNED_HEX_DIGITS.length &&
          digits.toLowerCase() > MAX_SIGNED_HEX_DIGITS)
      ) {
        return token;
      }
      const magnitude = Number.parseInt(digits, 16);
      return token.startsWith("-") && magnitude !== 0 ? -magnitude : magnitude;
    }
    const value = Number(token.startsWith("+") ? token.slice(1) : token);
    if (Number.isFinite(value)) return value;
    if (this.#dialect === "deno-config") return token;
    this.#fail("JSON number is outside the supported finite range");
  }

  #matchesKeyword(keyword: string): boolean {
    if (!this.#content.startsWith(keyword, this.#index)) return false;
    const next = this.#characterAt(this.#index + keyword.length);
    return next === undefined || !DENO_CONFIG_ALPHANUMERIC.test(next);
  }

  #skipTrivia(): void {
    while (this.#index < this.#content.length) {
      while (this.#isWhitespace(this.#current())) this.#advance();
      if (
        this.#dialect !== "deno-config" || this.#current() !== "/" ||
        !["/", "*"].includes(this.#content[this.#index + 1] ?? "")
      ) {
        return;
      }
      if (this.#content[this.#index + 1] === "/") this.#skipLineComment();
      else this.#skipBlockComment();
    }
  }

  #skipLineComment(): void {
    this.#index += 2;
    while (this.#index < this.#content.length) {
      if (this.#current() === "\n") return;
      if (
        this.#current() === "\r" && this.#content[this.#index + 1] === "\n"
      ) {
        return;
      }
      this.#advance();
    }
  }

  #skipBlockComment(): void {
    const start = this.#index;
    this.#index += 2;
    while (this.#index < this.#content.length) {
      if (
        this.#current() === "*" && this.#content[this.#index + 1] === "/"
      ) {
        this.#index += 2;
        return;
      }
      this.#advance();
    }
    this.#failAt(start, "unterminated block comment");
  }

  #isWhitespace(character: string | undefined): boolean {
    if (character === undefined) return false;
    return this.#dialect === "deno-config"
      ? DENO_CONFIG_WHITESPACE.test(character)
      : [" ", "\t", "\r", "\n"].includes(character);
  }

  #consume(character: string): boolean {
    if (this.#current() !== character) return false;
    this.#index += character.length;
    return true;
  }

  #current(): string | undefined {
    return this.#characterAt(this.#index);
  }

  #characterAt(index: number): string | undefined {
    const codePoint = this.#content.codePointAt(index);
    return codePoint === undefined
      ? undefined
      : String.fromCodePoint(codePoint);
  }

  #advance(): void {
    const character = this.#current();
    if (character !== undefined) this.#index += character.length;
  }

  #fail(message: string): never {
    this.#failAt(this.#index, message);
  }

  #failAt(index: number, message: string): never {
    const prefix = this.#content.slice(0, index);
    let line = 1;
    let column = 1;
    for (const character of prefix) {
      if (character === "\n") {
        line++;
        column = 1;
      } else column++;
    }
    throw new SyntaxError(`${message} at line ${line} column ${column}`);
  }
}

function materializeJsonPath(path: JsonPathNode | undefined): string[] {
  const segments: string[] = [];
  for (let current = path; current; current = current.parent) {
    segments.push(current.segment);
  }
  return segments.reverse();
}

function isAsciiDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isAsciiOneToNine(character: string | undefined): boolean {
  return character !== undefined && character >= "1" && character <= "9";
}

function isAsciiHexDigit(character: string | undefined): boolean {
  return character !== undefined && /^[0-9a-f]$/i.test(character);
}

function parseJsonDocument(
  content: string,
  dialect: JsonDialect,
): ParsedJsonDocument {
  return new ConfigJsonParser(content, dialect).parse();
}

async function readManifest(
  root: string,
  manifestPath: string,
  rootRealPath?: string,
): Promise<{ config: Record<string, unknown>; content: string }> {
  let content: string;
  try {
    const stat = await Deno.lstat(join(root, manifestPath));
    if (!stat.isFile || stat.isSymlink) {
      throw new CoreProductionRegistryError(
        "invalid-manifest",
        `invalid manifest: ${manifestPath}: expected a regular non-symlink file`,
        manifestPath,
      );
    }
    if (rootRealPath) {
      const realPath = await Deno.realPath(join(root, manifestPath));
      if (realPath !== join(rootRealPath, manifestPath)) {
        throw new CoreProductionRegistryError(
          "manifest-path-escape",
          `manifest path escapes repository root: ${manifestPath}`,
          manifestPath,
        );
      }
    }
    content = await Deno.readTextFile(join(root, manifestPath));
  } catch (error) {
    if (error instanceof CoreProductionRegistryError) throw error;
    if (error instanceof Deno.errors.NotFound) {
      throw new CoreProductionRegistryError(
        "missing-manifest",
        `missing-manifest: ${manifestPath}`,
        manifestPath,
      );
    }
    throw new CoreProductionRegistryError(
      "manifest-read-failure",
      `manifest-read-failure: ${manifestPath}`,
      manifestPath,
    );
  }
  let config: Record<string, unknown>;
  try {
    const { value: parsed, duplicate } = parseJsonDocument(
      content,
      "deno-config",
    );
    if (duplicate?.path.at(-1) === "exports") {
      throw new CoreProductionRegistryError(
        "duplicate-manifest-export",
        `duplicate manifest export key: ${manifestPath}: ${duplicate.key}`,
        manifestPath,
      );
    }
    if (duplicate) {
      throw new Error(
        `duplicate JSON key at ${[...duplicate.path, duplicate.key].join(".")}`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("manifest root must be an object");
    }
    config = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CoreProductionRegistryError) throw error;
    throw new CoreProductionRegistryError(
      "manifest-parse-failure",
      `manifest-parse-failure: ${manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      manifestPath,
    );
  }
  if (Object.hasOwn(config, "extends")) {
    throw new CoreProductionRegistryError(
      "unsupported-config-extends",
      `unsupported deno config construct: ${manifestPath}: extends`,
      manifestPath,
    );
  }
  return { config, content };
}

function externalImportMapPath(
  rootPath: string,
  rootRealPath: string,
  configPath: string,
  reference: string,
): { identity: string; path: string } {
  try {
    assertCanonicalPathEncoding(reference, "external import-map reference");
  } catch (error) {
    throw new CoreProductionRegistryError(
      "import-map-path-escape",
      error instanceof Error ? error.message : String(error),
      configPath,
    );
  }
  let absolute: string;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)) {
    if (!isFileUrlSpecifier(reference)) {
      throw new CoreProductionRegistryError(
        "unsupported-import-map-reference",
        `external import map must be a local file: ${configPath}: ${reference}`,
        configPath,
      );
    }
    try {
      const physicalUrl = assertLocalFileUrl(
        reference,
        `external import-map reference ${configPath}`,
      );
      physicalUrl.search = "";
      physicalUrl.hash = "";
      absolute = resolve(fromValidatedFileUrl(
        physicalUrl,
        `external import-map reference ${configPath}`,
      ));
    } catch {
      throw new CoreProductionRegistryError(
        "import-map-path-escape",
        `invalid external import-map file URL: ${configPath}: ${reference}`,
        configPath,
      );
    }
  } else {
    if (isAbsolute(reference)) {
      throw new CoreProductionRegistryError(
        "import-map-path-escape",
        `absolute external import-map path is not permitted: ${configPath}: ${reference}`,
        configPath,
      );
    }
    absolute = resolve(
      rootRealPath,
      dirname(configPath),
      physicalUrlIdentity(reference),
    );
  }
  const containingRoot = [rootPath, rootRealPath].find((candidate) =>
    isPathContained(candidate, absolute)
  );
  if (!containingRoot) {
    throw new CoreProductionRegistryError(
      "import-map-path-escape",
      `external import map escapes repository root: ${configPath}: ${reference}`,
      configPath,
    );
  }
  const path = containedRelativePath(containingRoot, absolute);
  if (path === undefined) {
    throw new CoreProductionRegistryError(
      "import-map-path-escape",
      `external import map escapes repository root: ${configPath}: ${reference}`,
      configPath,
    );
  }
  if (path === "") {
    throw new CoreProductionRegistryError(
      "import-map-path-escape",
      `external import map must name a repository file: ${configPath}: ${reference}`,
      configPath,
    );
  }
  const physicalPath = assertRepositoryPath(
    path,
    `external import map for ${configPath}`,
  );
  return {
    identity: `${physicalPath}${urlIdentityDecoration(reference)}`,
    path: physicalPath,
  };
}

function validateExternalImportMap(
  path: string,
  config: Record<string, unknown>,
): void {
  for (const key of Object.keys(config)) {
    if (!["imports", "scopes", "integrity"].includes(key)) {
      throw new CoreProductionRegistryError(
        "malformed-import-map",
        `unsupported external import-map field: ${path}: ${key}`,
        path,
      );
    }
  }
  if (config.integrity !== undefined) {
    if (
      !config.integrity || typeof config.integrity !== "object" ||
      Array.isArray(config.integrity) ||
      Object.values(config.integrity).some((value) => typeof value !== "string")
    ) {
      throw new CoreProductionRegistryError(
        "malformed-import-map",
        `malformed external import-map integrity: ${path}`,
        path,
      );
    }
  }
  try {
    configImportMapLayer(path, config);
  } catch (error) {
    throw new CoreProductionRegistryError(
      "malformed-import-map",
      `malformed external import map: ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      path,
    );
  }
}

async function readExternalImportMap(
  rootRealPath: string,
  path: string,
): Promise<Record<string, unknown>> {
  const absolutePath = join(rootRealPath, path);
  let content: string;
  try {
    const stat = await Deno.lstat(absolutePath);
    if (!stat.isFile || stat.isSymlink) {
      throw new CoreProductionRegistryError(
        "import-map-path-escape",
        `external import map must be a regular non-symlink file: ${path}`,
        path,
      );
    }
    const realPath = await Deno.realPath(absolutePath);
    if (realPath !== absolutePath) {
      throw new CoreProductionRegistryError(
        "import-map-path-escape",
        `external import map escapes repository root: ${path}`,
        path,
      );
    }
    content = await Deno.readTextFile(absolutePath);
  } catch (error) {
    if (error instanceof CoreProductionRegistryError) throw error;
    if (error instanceof Deno.errors.NotFound) {
      throw new CoreProductionRegistryError(
        "missing-import-map",
        `missing external import map: ${path}`,
        path,
      );
    }
    throw new CoreProductionRegistryError(
      "import-map-read-failure",
      `external import-map read failure: ${path}`,
      path,
    );
  }
  let config: Record<string, unknown>;
  try {
    const { value: parsed, duplicate } = parseJsonDocument(
      content,
      "strict-json",
    );
    if (duplicate) {
      throw new CoreProductionRegistryError(
        "malformed-import-map",
        `duplicate external import-map key: ${path}: ${duplicate.key}`,
        path,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("import-map root must be an object");
    }
    config = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CoreProductionRegistryError) throw error;
    throw new CoreProductionRegistryError(
      "import-map-parse-failure",
      `external import-map parse failure: ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      path,
    );
  }
  validateExternalImportMap(path, config);
  return config;
}

async function loadEffectiveConfigPaths(
  rootPath: string,
  rootRealPath: string,
  configPath: string,
  config: Record<string, unknown>,
  configs: Map<string, Record<string, unknown>>,
): Promise<string[]> {
  if (config.importMap === undefined) return [configPath];
  if (typeof config.importMap !== "string" || config.importMap.length === 0) {
    throw new CoreProductionRegistryError(
      "malformed-import-map-reference",
      `external import-map reference must be a non-empty string: ${configPath}`,
      configPath,
    );
  }
  if (Object.hasOwn(config, "imports") || Object.hasOwn(config, "scopes")) {
    throw new CoreProductionRegistryError(
      "conflicting-import-map",
      `external importMap is exclusive with inline imports/scopes: ${configPath}`,
      configPath,
    );
  }
  const importMap = externalImportMapPath(
    rootPath,
    rootRealPath,
    configPath,
    config.importMap,
  );
  if (!configs.has(importMap.identity)) {
    configs.set(
      importMap.identity,
      await readExternalImportMap(rootRealPath, importMap.path),
    );
  }
  return [configPath, importMap.identity];
}

type ConcreteTarget = Exclude<CoreProductionTarget, "universal">;

const ALL_CONCRETE_TARGETS: ConcreteTarget[] = ["browser", "node", "deno"];

function targetsForCondition(
  manifestPath: string,
  exportName: string,
  condition: string,
): ConcreteTarget[] {
  if (condition === "browser") return ["browser"];
  if (condition === "node" || condition === "require") return ["node"];
  if (condition === "deno") return ["deno"];
  if (["default", "import", "types"].includes(condition)) {
    return ALL_CONCRETE_TARGETS;
  }
  throw new Error(
    `unknown manifest export condition: ${manifestPath}: ${exportName}: ${condition}`,
  );
}

function validateConditionalExport(
  manifestPath: string,
  exportName: string,
  value: unknown,
): void {
  if (typeof value === "string") {
    try {
      assertCanonicalPathEncoding(
        value,
        `manifest export ${manifestPath}: ${exportName}`,
      );
    } catch {
      throw new Error(
        `manifest export escapes core roots: ${manifestPath}: ${exportName}`,
      );
    }
    if (
      !/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(
        physicalUrlIdentity(value),
      )
    ) {
      throw new Error(
        `manifest export is not a supported code target: ${manifestPath}: ${exportName}: ${value}`,
      );
    }
    return;
  }
  if (value === null) return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      validateConditionalExport(manifestPath, exportName, entry);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    throw new Error(
      `invalid manifest export branch: ${manifestPath}: ${exportName}`,
    );
  }
  for (const [condition, branch] of Object.entries(value)) {
    targetsForCondition(manifestPath, exportName, condition);
    validateConditionalExport(manifestPath, exportName, branch);
  }
}

function selectConditionalExport(
  manifestPath: string,
  exportName: string,
  value: unknown,
  activeConditions: ReadonlySet<string>,
): string[] | undefined {
  if (typeof value === "string") return [value];
  if (value === null) return [];
  if (Array.isArray(value)) {
    const alternatives: string[] = [];
    let matched = false;
    for (const entry of value) {
      const selected = selectConditionalExport(
        manifestPath,
        exportName,
        entry,
        activeConditions,
      );
      if (selected !== undefined) {
        matched = true;
        alternatives.push(...selected);
      }
    }
    return matched ? alternatives : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [condition, branch] of Object.entries(value)) {
    if (condition === "types") continue;
    if (activeConditions.has(condition)) {
      const selected = selectConditionalExport(
        manifestPath,
        exportName,
        branch,
        activeConditions,
      );
      if (selected !== undefined) return selected;
    }
  }
  return undefined;
}

interface SelectedConditionalExport {
  path: string;
  alternativeIndex: number;
}

function selectConditionalExportsForTarget(
  manifestPath: string,
  exportName: string,
  value: unknown,
  target: ConcreteTarget,
): SelectedConditionalExport[] {
  const conditionSets = target === "node"
    ? [
      new Set(["node", "require", "default"]),
      new Set(["node", "import", "default"]),
    ]
    : target === "deno"
    ? [new Set(["deno", "import", "default"])]
    : [new Set(["browser", "import", "default"])];
  const selected = conditionSets.flatMap((conditions) =>
    selectConditionalExport(
      manifestPath,
      exportName,
      value,
      conditions,
    ) ?? []
  );
  const unique = new Map<string, number>();
  for (const path of selected) {
    if (!unique.has(path)) unique.set(path, unique.size);
  }
  return [...unique].map(([path, alternativeIndex]) => ({
    path,
    alternativeIndex,
  }));
}

function manifestClaims(
  manifestPath: string,
  manifest: Record<string, unknown>,
  allowedSourceRoots: readonly string[],
): ManifestExportClaim[] {
  const base = dirname(manifestPath);
  const exportsValue = manifest.exports;
  const entries = typeof exportsValue === "string"
    ? [[".", exportsValue] as const]
    : exportsValue && typeof exportsValue === "object" &&
        !Array.isArray(exportsValue)
    ? Object.keys(exportsValue).some((key) => key.startsWith("."))
      ? Object.entries(exportsValue)
      : [[".", exportsValue] as const]
    : [];
  const byKey = new Map<string, ManifestExportClaim>();
  for (const [exportName, value] of entries) {
    validateConditionalExport(manifestPath, exportName, value);
    for (const concreteTarget of ALL_CONCRETE_TARGETS) {
      for (
        const selected of selectConditionalExportsForTarget(
          manifestPath,
          exportName,
          value,
          concreteTarget,
        )
      ) {
        const target = selected.path;
        const physicalTarget = physicalUrlIdentity(target);
        if (
          isAbsolute(physicalTarget) || physicalTarget.includes("\\") ||
          physicalTarget.replace(/^\.\//, "").split("/").some((part) =>
            part === "." || part === ".."
          )
        ) {
          throw new Error(
            `manifest export escapes core roots: ${manifestPath}: ${exportName}`,
          );
        }
        const path = assertRepositoryPath(
          normalizeRepositoryPath(join(base, physicalTarget)),
          `manifest export ${manifestPath}: ${exportName}`,
        );
        const identity = `${path}${urlIdentityDecoration(target)}`;
        const claim: ManifestExportClaim = {
          manifestPath,
          exportName,
          identity,
          path,
          alternativeIndex: selected.alternativeIndex,
          alternativeIndices: {
            [concreteTarget]: selected.alternativeIndex,
          },
          targets: [concreteTarget],
        };
        if (
          !allowedSourceRoots.some((root) =>
            claim.path === root || claim.path.startsWith(`${root}/`)
          )
        ) {
          throw new Error(
            `manifest entrypoint escapes core roots: ${claim.path}`,
          );
        }
        const key = claimKey(claim);
        const existing = byKey.get(key);
        if (existing) {
          existing.alternativeIndex = Math.min(
            existing.alternativeIndex ?? selected.alternativeIndex,
            selected.alternativeIndex,
          );
          existing.alternativeIndices = {
            ...existing.alternativeIndices,
            [concreteTarget]: Math.min(
              existing.alternativeIndices?.[concreteTarget] ??
                selected.alternativeIndex,
              selected.alternativeIndex,
            ),
          };
          existing.targets = [
            ...new Set([...(existing.targets ?? []), concreteTarget]),
          ].sort();
        } else byKey.set(key, claim);
      }
    }
  }
  return [...byKey.values()].sort(compareClaims);
}

function compareClaims(
  left: ManifestExportClaim,
  right: ManifestExportClaim,
): number {
  return compareOrdinal(left.manifestPath, right.manifestPath) ||
    compareOrdinal(left.exportName, right.exportName) ||
    (left.alternativeIndex ?? 0) - (right.alternativeIndex ?? 0) ||
    compareOrdinal(left.path, right.path);
}

function claimKey(claim: ManifestExportClaim): string {
  return `${claim.manifestPath}\0${claim.exportName}\0${
    claim.identity ?? claim.path
  }`;
}

function claimEntrypoint(claim: ManifestExportClaim): ProductionEntrypoint {
  return {
    id: `manifest:${claim.manifestPath}:${claim.exportName}:${
      claim.identity ?? claim.path
    }`,
    identity: claim.identity ?? claim.path,
    path: claim.path,
    manifestClaims: [claim],
  };
}

function runtimeEntrypoint(path: string): ProductionEntrypoint {
  return { id: `runtime:${path}`, identity: path, path, manifestClaims: [] };
}

function entrypointIdentity(entrypoint: ProductionEntrypoint): string {
  return entrypoint.identity ?? entrypoint.path;
}

function uniqueEntrypoints(
  entries: ProductionEntrypoint[],
): ProductionEntrypoint[] {
  const byIdentity = new Map<string, ProductionEntrypoint>();
  for (const entry of entries) {
    const identity = entrypointIdentity(entry);
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, {
        ...entry,
        identity,
        manifestClaims: [...entry.manifestClaims],
      });
      continue;
    }
    existing.manifestClaims = [
      ...existing.manifestClaims,
      ...entry.manifestClaims,
    ].sort(
      compareClaims,
    );
    existing.id = `entrypoint:${identity}`;
  }
  return [...byIdentity.values()].sort((left, right) =>
    compareOrdinal(entrypointIdentity(left), entrypointIdentity(right)) ||
    compareOrdinal(left.id, right.id)
  );
}

function duplicate(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

export function validateCoreProductionRegistry(
  registry: CoreProductionRegistry,
  eligiblePaths?: readonly string[],
): void {
  if (registry.contexts.length === 0) {
    throw new Error("empty core production context registry");
  }
  const knownClaims = new Map(
    registry.manifestClaims.map((claim) => [claimKey(claim), claim]),
  );
  if (knownClaims.size !== registry.manifestClaims.length) {
    throw new Error("duplicate manifest export claim in registry");
  }
  const assignedClaims = new Set<string>();
  const contextIds = new Set<string>();
  for (const context of registry.contexts) {
    if (contextIds.has(context.id)) {
      throw new Error(`duplicate core production context id: ${context.id}`);
    }
    contextIds.add(context.id);
    if (context.entrypoints.length === 0) {
      throw new Error(`empty core production context: ${context.id}`);
    }
    if (context.configPaths.length === 0) {
      throw new Error(`context has no config paths: ${context.id}`);
    }
    if (context.manifestPaths.length === 0) {
      throw new Error(`context has no manifest paths: ${context.id}`);
    }
    if (context.packageConfigPaths.length === 0) {
      throw new Error(`context has no package config ownership: ${context.id}`);
    }
    for (
      const [label, values] of [
        [
          "entrypoint id",
          context.entrypoints.map((entrypoint) => entrypoint.id),
        ],
        [
          "entrypoint path",
          context.entrypoints.map(entrypointIdentity),
        ],
        ["config path", context.configPaths],
        ["manifest path", context.manifestPaths],
        ["package config path", context.packageConfigPaths],
        [
          "source assignment",
          context.assignedSource.map((assignment) => assignment.pathPrefix),
        ],
      ] as const
    ) {
      const repeated = duplicate(values);
      if (repeated) {
        throw new Error(`duplicate ${label}: ${context.id}: ${repeated}`);
      }
    }
    for (const configPath of context.configPaths) {
      assertRepositoryPath(
        physicalUrlIdentity(configPath),
        `config path for ${context.id}`,
      );
      if (!registry.configs.has(configPath)) {
        throw new Error(
          `context config is not loaded: ${context.id}: ${configPath}`,
        );
      }
    }
    for (const manifestPath of context.manifestPaths) {
      assertRepositoryPath(manifestPath, `manifest path for ${context.id}`);
      if (!registry.configs.has(manifestPath)) {
        throw new Error(
          `context manifest is not loaded: ${context.id}: ${manifestPath}`,
        );
      }
    }
    for (const packageConfigPath of context.packageConfigPaths) {
      assertRepositoryPath(
        packageConfigPath,
        `package config path for ${context.id}`,
      );
      if (
        !context.configPaths.includes(packageConfigPath) ||
        !context.manifestPaths.includes(packageConfigPath)
      ) {
        throw new Error(
          `package config ownership is not an active manifest: ${context.id}: ${packageConfigPath}`,
        );
      }
    }
    for (const entrypoint of context.entrypoints) {
      assertRepositoryPath(entrypoint.path, `entrypoint for ${context.id}`);
      const identity = entrypointIdentity(entrypoint);
      if (physicalUrlIdentity(identity) !== entrypoint.path) {
        throw new Error(
          `entrypoint identity does not match physical path: ${context.id}: ${identity}`,
        );
      }
      for (const claim of entrypoint.manifestClaims) {
        const key = claimKey(claim);
        const canonicalClaim = knownClaims.get(key);
        if (!canonicalClaim) {
          throw new Error(
            `stale manifest export claim: ${context.id}: ${claim.manifestPath}: ${claim.exportName}`,
          );
        }
        const canonicalTargets = [
          ...(canonicalClaim.targets ?? ALL_CONCRETE_TARGETS),
        ].sort(
          compareOrdinal,
        );
        const attachedTargets = [...(claim.targets ?? ALL_CONCRETE_TARGETS)]
          .sort(
            compareOrdinal,
          );
        const canonicalAlternatives = JSON.stringify(
          canonicalClaim.alternativeIndices ?? null,
        );
        const attachedAlternatives = JSON.stringify(
          claim.alternativeIndices ?? null,
        );
        if (
          canonicalTargets.length !== attachedTargets.length ||
          canonicalTargets.some((target, index) =>
            target !== attachedTargets[index]
          ) || canonicalAlternatives !== attachedAlternatives
        ) {
          throw new Error(
            `manifest claim metadata differs from registry: ${context.id}: ${claim.exportName}`,
          );
        }
        if (
          claim.path !== entrypoint.path ||
          (claim.identity ?? claim.path) !== identity
        ) {
          throw new Error(
            `manifest claim path does not match entrypoint: ${context.id}: ${claim.path}: ${entrypoint.path}`,
          );
        }
        const claimTargets = claim.targets ?? ALL_CONCRETE_TARGETS;
        if (
          !expandProductionTarget(context.target).every((target) =>
            claimTargets.includes(target)
          )
        ) {
          throw new Error(
            `manifest claim target is incompatible with context: ${context.id}: ${claim.exportName}`,
          );
        }
        assignedClaims.add(key);
      }
    }
    for (const assignment of context.assignedSource) {
      const prefix = assertRepositoryPath(
        assignment.pathPrefix,
        `source assignment for ${context.id}`,
      );
      if (!prefix.endsWith("/")) {
        throw new Error(
          `source assignment must end in /: ${context.id}: ${prefix}`,
        );
      }
    }
  }
  for (const claim of registry.manifestClaims) {
    if (!assignedClaims.has(claimKey(claim))) {
      throw new Error(
        `unassigned manifest export claim: ${claim.manifestPath}: ${claim.exportName}`,
      );
    }
  }
  if (eligiblePaths !== undefined && eligiblePaths.length === 0) {
    throw new Error("zero eligible production files");
  }
  for (const rawPath of eligiblePaths ?? []) {
    const path = assertRepositoryPath(rawPath, "eligible production file");
    const owned = registry.contexts.some((context) =>
      context.entrypoints.some((entrypoint) => entrypoint.path === path) ||
      context.assignedSource.some((assignment) =>
        path.startsWith(assignment.pathPrefix)
      )
    );
    if (!owned) {
      throw new Error(
        `eligible production file has no context ownership: ${path}`,
      );
    }
  }
}

/** Load authoritative manifest claims plus explicit non-manifest runtime roots. */
export async function loadCoreProductionRegistry(
  root: string,
): Promise<CoreProductionRegistry> {
  const rootPath = resolve(root);
  const rootRealPath = await Deno.realPath(rootPath);
  const manifestReads = new Map<string, Record<string, unknown>>();
  for (const definition of CORE_PRODUCTION_PACKAGES) {
    manifestReads.set(
      definition.manifestPath,
      (await readManifest(root, definition.manifestPath, rootRealPath)).config,
    );
  }
  const configs = new Map(manifestReads);
  const effectiveConfigPaths = new Map<string, string[]>();
  for (const definition of CORE_PRODUCTION_PACKAGES) {
    effectiveConfigPaths.set(
      definition.manifestPath,
      await loadEffectiveConfigPaths(
        rootPath,
        rootRealPath,
        definition.manifestPath,
        manifestReads.get(definition.manifestPath)!,
        configs,
      ),
    );
  }
  const rootConfigPaths = effectiveConfigPaths.get("deno.json")!;
  const cliConfigPaths = effectiveConfigPaths.get("cli/deno.json")!;
  const combinedConfigPaths = [
    ...new Set([
      ...rootConfigPaths,
      ...cliConfigPaths,
    ]),
  ];
  for (const [configPath, config] of configs) {
    try {
      createImportMapResolver([
        configImportMapLayer(configPath, config, rootPath),
      ]);
    } catch (error) {
      throw new CoreProductionRegistryError(
        "import-map-validation-failure",
        `invalid import map: ${configPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        configPath,
      );
    }
  }
  const claimsByManifest = new Map<string, ManifestExportClaim[]>();
  for (const definition of CORE_PRODUCTION_PACKAGES) {
    const allowedRoots = definition.manifestPath === "deno.json"
      ? ["src", "cli"]
      : [definition.sourceRoot];
    const manifestEntries = manifestClaims(
      definition.manifestPath,
      manifestReads.get(definition.manifestPath)!,
      allowedRoots,
    );
    if (manifestEntries.length === 0) {
      throw new Error(
        `core manifest exposes zero production entrypoints: ${definition.manifestPath}`,
      );
    }
    claimsByManifest.set(definition.manifestPath, manifestEntries);
  }
  const claims = [...claimsByManifest.values()].flat().sort(compareClaims);
  const rootClaims = claims.filter((claim) =>
    claim.manifestPath === "deno.json" && claim.exportName !== "./cli"
  );
  const cliClaims = claims.filter((claim) => claim.path.startsWith("cli/"));
  const runtimeEntries = CORE_RUNTIME_ENTRYPOINTS.map(runtimeEntrypoint);
  const rootEntriesFor = (target: ConcreteTarget) =>
    uniqueEntrypoints([
      ...rootClaims.filter((claim) =>
        (claim.targets ?? ALL_CONCRETE_TARGETS).includes(target)
      ).map(
        claimEntrypoint,
      ),
      ...runtimeEntries,
    ]);
  const cliEntriesFor = (target: ConcreteTarget) =>
    uniqueEntrypoints(
      cliClaims.filter((claim) =>
        (claim.targets ?? ALL_CONCRETE_TARGETS).includes(target)
      ).map(
        claimEntrypoint,
      ),
    );
  const browserEntries = uniqueEntrypoints([
    ...rootClaims.filter((claim) =>
      BROWSER_SAFE_EXPORT_NAMES.has(claim.exportName) &&
      (claim.targets ?? ALL_CONCRETE_TARGETS).includes("browser")
    ).map(claimEntrypoint),
    ...runtimeEntries.filter((entrypoint) =>
      BROWSER_RUNTIME_ENTRYPOINTS.has(entrypoint.path)
    ),
  ]);
  const packageEntries = (manifestPath: string, target: ConcreteTarget) =>
    uniqueEntrypoints(
      (claimsByManifest.get(manifestPath) ?? []).filter((claim) =>
        (claim.targets ?? ALL_CONCRETE_TARGETS).includes(target)
      ).map(claimEntrypoint),
    );
  const reactConfigPaths = effectiveConfigPaths.get("react/deno.json")!;
  const studioConfigPaths = effectiveConfigPaths.get(
    "browser/studio-bridge/deno.json",
  )!;
  const contexts: CoreProductionContext[] = [
    {
      id: "root-node",
      target: "node",
      entrypoints: rootEntriesFor("node"),
      assignedSource: [{ pathPrefix: "src/" }],
      configPaths: rootConfigPaths,
      manifestPaths: ["deno.json"],
      packageConfigPaths: ["deno.json"],
    },
    {
      id: "root-deno",
      target: "deno",
      entrypoints: rootEntriesFor("deno"),
      assignedSource: [{ pathPrefix: "src/" }],
      configPaths: rootConfigPaths,
      manifestPaths: ["deno.json"],
      packageConfigPaths: ["deno.json"],
    },
    {
      id: "cli-node",
      target: "node",
      entrypoints: cliEntriesFor("node"),
      assignedSource: [{ pathPrefix: "cli/" }],
      configPaths: combinedConfigPaths,
      manifestPaths: ["deno.json", "cli/deno.json"],
      packageConfigPaths: ["cli/deno.json"],
    },
    {
      id: "cli-deno",
      target: "deno",
      entrypoints: cliEntriesFor("deno"),
      assignedSource: [{ pathPrefix: "cli/" }],
      configPaths: combinedConfigPaths,
      manifestPaths: ["deno.json", "cli/deno.json"],
      packageConfigPaths: ["cli/deno.json"],
    },
    {
      id: "browser-runtime",
      target: "browser",
      entrypoints: browserEntries,
      assignedSource: [],
      configPaths: rootConfigPaths,
      manifestPaths: ["deno.json"],
      packageConfigPaths: ["deno.json"],
    },
    {
      id: "react-deno",
      target: "deno",
      entrypoints: packageEntries("react/deno.json", "deno"),
      assignedSource: [{ pathPrefix: "react/" }],
      configPaths: reactConfigPaths,
      manifestPaths: ["react/deno.json"],
      packageConfigPaths: ["react/deno.json"],
    },
    {
      id: "studio-bridge-browser",
      target: "browser",
      entrypoints: packageEntries(
        "browser/studio-bridge/deno.json",
        "browser",
      ),
      assignedSource: [{ pathPrefix: "browser/studio-bridge/" }],
      configPaths: studioConfigPaths,
      manifestPaths: ["browser/studio-bridge/deno.json"],
      packageConfigPaths: ["browser/studio-bridge/deno.json"],
    },
  ];
  const registry: CoreProductionRegistry = {
    contexts,
    manifestClaims: claims,
    configs,
  };
  validateCoreProductionRegistry(registry);
  const registeredRoots = new Map<string, string>();
  const sourceRoots = CORE_PRODUCTION_PACKAGES.map((definition) =>
    definition.sourceRoot
  ).sort(compareOrdinal);
  for (const sourceRoot of sourceRoots) {
    const sourcePath = join(root, sourceRoot);
    let sourceStat: Deno.FileInfo;
    try {
      sourceStat = await Deno.lstat(sourcePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new CoreProductionRegistryError(
          "missing-production-root",
          `missing production root: ${sourceRoot}`,
          sourceRoot,
        );
      }
      throw new CoreProductionRegistryError(
        "production-root-read-failure",
        `production root read failure: ${sourceRoot}`,
        sourceRoot,
      );
    }
    if (!sourceStat.isDirectory || sourceStat.isSymlink) {
      throw new CoreProductionRegistryError(
        "invalid-production-root",
        `registered production root is invalid: ${sourceRoot}`,
        sourceRoot,
      );
    }
    const realPath = await Deno.realPath(sourcePath);
    if (realPath !== join(rootRealPath, sourceRoot)) {
      throw new CoreProductionRegistryError(
        "production-root-escape",
        `registered production root escapes repository: ${sourceRoot}`,
        sourceRoot,
      );
    }
    registeredRoots.set(sourceRoot, realPath);
  }
  for (const context of contexts) {
    for (const entrypoint of context.entrypoints) {
      let stat: Deno.FileInfo;
      try {
        stat = await Deno.lstat(join(root, entrypoint.path));
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          throw new CoreProductionRegistryError(
            "missing-production-entrypoint",
            `missing production entrypoint: ${context.id}: ${entrypoint.path}`,
            entrypoint.path,
          );
        }
        throw new CoreProductionRegistryError(
          "production-entrypoint-read-failure",
          `production entrypoint read failure: ${context.id}: ${entrypoint.path}`,
          entrypoint.path,
        );
      }
      if (!stat.isFile || stat.isSymlink) {
        throw new CoreProductionRegistryError(
          "invalid-production-entrypoint",
          `invalid production entrypoint: ${context.id}: ${entrypoint.path}`,
          entrypoint.path,
        );
      }
      const realPath = await Deno.realPath(join(root, entrypoint.path));
      const sourceRoot = sourceRoots.find((candidate) =>
        entrypoint.path === candidate ||
        entrypoint.path.startsWith(`${candidate}/`)
      );
      const registeredRoot = sourceRoot === undefined
        ? undefined
        : registeredRoots.get(sourceRoot);
      if (!registeredRoot || !isPathContained(registeredRoot, realPath)) {
        throw new CoreProductionRegistryError(
          "production-entrypoint-escape",
          `production entrypoint escapes registered root: ${context.id}: ${entrypoint.path}`,
          entrypoint.path,
        );
      }
    }
  }
  return registry;
}

function addRecordEdges(
  edges: ConfigurationDependencyEdge[],
  configPath: string,
  field: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `malformed configuration dependency field: ${configPath}: ${field}`,
    );
  }
  for (const [specifier, target] of Object.entries(value)) {
    if (typeof target !== "string") {
      throw new Error(
        `malformed configuration dependency field: ${configPath}: ${field}`,
      );
    }
    edges.push({ configPath, field, specifier, target });
  }
}

function addArrayEdges(
  edges: ConfigurationDependencyEdge[],
  configPath: string,
  field: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (
    !Array.isArray(value) || value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(
      `malformed configuration dependency field: ${configPath}: ${field}`,
    );
  }
  for (const entry of value) {
    if (typeof entry === "string") {
      edges.push({ configPath, field, specifier: entry, target: entry });
    }
  }
}

function configurationTargets(
  configPath: string,
  field: string,
  value: unknown,
): Array<{ field: string; target: string }> {
  if (typeof value === "string") return [{ field, target: value }];
  if (value === null || value === false) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      configurationTargets(configPath, field, entry)
    );
  }
  if (!value || typeof value !== "object") {
    throw new Error(
      `malformed configuration dependency field: ${configPath}: ${field}`,
    );
  }
  return Object.entries(value).flatMap(([branch, entry]) =>
    configurationTargets(configPath, `${field}.${branch}`, entry)
  );
}

export function collectConfigurationDependencyEdges(
  configPath: string,
  config: Record<string, unknown>,
): ConfigurationDependencyEdge[] {
  const edges: ConfigurationDependencyEdge[] = [];
  addRecordEdges(edges, configPath, "imports", config.imports);
  if (config.scopes !== undefined) {
    if (
      !config.scopes || typeof config.scopes !== "object" ||
      Array.isArray(config.scopes)
    ) {
      throw new Error(
        `malformed configuration dependency field: ${configPath}: scopes`,
      );
    }
    for (const [scope, mappings] of Object.entries(config.scopes)) {
      addRecordEdges(edges, configPath, `scopes.${scope}`, mappings);
    }
  }
  if (config.exports !== undefined) {
    if (typeof config.exports === "string") {
      edges.push({
        configPath,
        field: "exports",
        specifier: ".",
        target: config.exports,
      });
    } else {
      if (
        !config.exports || typeof config.exports !== "object" ||
        Array.isArray(config.exports)
      ) {
        throw new Error(
          `malformed configuration dependency field: ${configPath}: exports`,
        );
      }
      const exportObject = config.exports as Record<string, unknown>;
      const exportEntries = Object.keys(exportObject).some((key) =>
          key.startsWith(".")
        )
        ? Object.entries(exportObject)
        : [[".", exportObject] as const];
      for (const [specifier, branch] of exportEntries) {
        for (
          const target of configurationTargets(configPath, "exports", branch)
        ) {
          edges.push({
            configPath,
            field: target.field,
            specifier,
            target: target.target,
          });
        }
      }
    }
  }
  for (
    const field of ["dependencies", "peerDependencies", "optionalDependencies"]
  ) {
    addRecordEdges(edges, configPath, field, config[field]);
  }
  for (const field of ["bundledDependencies", "bundleDependencies"]) {
    addArrayEdges(edges, configPath, field, config[field]);
  }
  for (const field of ["main", "module", "types"]) {
    if (typeof config[field] === "string") {
      edges.push({
        configPath,
        field,
        specifier: field,
        target: config[field] as string,
      });
    } else if (config[field] !== undefined) {
      throw new Error(
        `malformed configuration dependency field: ${configPath}: ${field}`,
      );
    }
  }
  if (typeof config.bin === "string") {
    edges.push({
      configPath,
      field: "bin",
      specifier: "bin",
      target: config.bin,
    });
  } else if (config.bin !== undefined) {
    addRecordEdges(edges, configPath, "bin", config.bin);
  }
  if (typeof config.browser === "string") {
    edges.push({
      configPath,
      field: "browser",
      specifier: "browser",
      target: config.browser,
    });
  } else if (config.browser !== undefined) {
    if (
      !config.browser || typeof config.browser !== "object" ||
      Array.isArray(config.browser)
    ) {
      throw new Error(
        `malformed configuration dependency field: ${configPath}: browser`,
      );
    }
    for (const [specifier, target] of Object.entries(config.browser)) {
      if (typeof target === "string") {
        edges.push({ configPath, field: "browser", specifier, target });
      } else if (target !== false) {
        throw new Error(
          `malformed configuration dependency field: ${configPath}: browser`,
        );
      }
    }
  }
  addArrayEdges(edges, configPath, "packageRoots", config.packageRoots);
  addArrayEdges(edges, configPath, "workspace", config.workspace);
  if (Array.isArray(config.workspaces)) {
    addArrayEdges(edges, configPath, "workspaces", config.workspaces);
  } else if (config.workspaces !== undefined) {
    if (
      !config.workspaces || typeof config.workspaces !== "object" ||
      Array.isArray(config.workspaces)
    ) {
      throw new Error(
        `malformed configuration dependency field: ${configPath}: workspaces`,
      );
    }
    const packages = (config.workspaces as Record<string, unknown>).packages;
    addArrayEdges(edges, configPath, "workspaces", packages);
  }
  const compilerOptions = config.compilerOptions;
  if (compilerOptions !== undefined) {
    if (
      !compilerOptions || typeof compilerOptions !== "object" ||
      Array.isArray(compilerOptions)
    ) {
      throw new Error(
        `malformed configuration dependency field: ${configPath}: compilerOptions`,
      );
    }
    const options = compilerOptions as Record<string, unknown>;
    const jsxRuntime = options.jsx === "react-jsxdev"
      ? "jsx-dev-runtime"
      : options.jsx === "react-jsx" || options.jsx === "precompile"
      ? "jsx-runtime"
      : undefined;
    for (const field of ["jsxImportSource", "jsxImportSourceTypes"]) {
      if (typeof options[field] === "string") {
        const source = options[field] as string;
        if (jsxRuntime) {
          const label = jsxRuntime === "jsx-runtime"
            ? "runtime"
            : "dev-runtime";
          // Deno performs a textual append. A trailing slash therefore
          // intentionally produces a double slash and is not normalized.
          const generated = `${source}/${jsxRuntime}`;
          edges.push({
            configPath,
            field: `compilerOptions.${field}.${label}`,
            specifier: generated,
            target: generated,
          });
        }
      } else if (options[field] !== undefined) {
        throw new Error(
          `malformed configuration dependency field: ${configPath}: compilerOptions.${field}`,
        );
      }
    }
    addArrayEdges(edges, configPath, "compilerOptions.types", options.types);
  }
  return edges;
}

interface ImportMapCandidate {
  key: string;
  canonicalKey: string;
  sourceKey: string;
  canonicalRequestedIdentity?: string;
  selectedTarget: string;
  target: string;
  localPath?: string;
  owner: string;
  base: string;
  sourceScope?: string;
  canonicalScope?: string;
  scopeLength: number;
}

interface ImportMapLayerUrls {
  baseUrl: string;
  repositoryRootUrl: string;
  repositoryRootPath: string;
}

interface CompiledImportMapMapping {
  key: string;
  canonicalKey: string;
  sourceKey: string;
  selectedTarget: string;
  target: string;
  targetUrl: string;
  localPath?: string;
  owner: string;
  base: string;
  layer: ImportMapLayer;
  urls: ImportMapLayerUrls;
}

interface ImportMapCandidateMatch {
  mapping: CompiledImportMapMapping;
  canonicalRequestedIdentity?: string;
  sourceScope?: string;
  canonicalScope?: string;
  scopeLength: number;
  suffix?: string;
}

interface CompiledImportMapScope {
  url: string;
  sourceScope: string;
  canonicalScope: string;
  mappings: CompiledImportMapMapping[];
}

interface CompiledImportMapLayer {
  layer: ImportMapLayer;
  urls: ImportMapLayerUrls;
  imports: CompiledImportMapMapping[];
  scopes: CompiledImportMapScope[];
}

const SYNTHETIC_REPOSITORY_ROOT_URL = "file:///__core_repository__/";

function normalizedDirectoryUrl(url: string, label: string): string {
  const parsed = assertLocalFileUrl(url, label);
  if (
    parsed.search || parsed.hash || parsed.href.endsWith("?") ||
    parsed.href.endsWith("#")
  ) {
    throw new Error(`${label} must be a local file URL: ${url}`);
  }
  return parsed.href.endsWith("/") ? parsed.href : `${parsed.href}/`;
}

function layerUrls(
  layer: ImportMapLayer,
): ImportMapLayerUrls {
  const repositoryRootUrl = normalizedDirectoryUrl(
    layer.repositoryRootUrl ?? SYNTHETIC_REPOSITORY_ROOT_URL,
    `import-map repository root ${layer.path}`,
  );
  let baseUrl: string;
  try {
    baseUrl = new URL(layer.baseUrl ?? layer.path, repositoryRootUrl).href;
  } catch {
    throw new Error(`invalid import-map base URL: ${layer.path}`);
  }
  if (!isFileUrlSpecifier(baseUrl)) {
    throw new Error(`import-map base must be a local file URL: ${layer.path}`);
  }
  assertLocalFileUrl(baseUrl, `import-map base ${layer.path}`);
  return {
    baseUrl,
    repositoryRootUrl,
    repositoryRootPath: resolve(fromValidatedFileUrl(
      repositoryRootUrl,
      `import-map repository root ${layer.path}`,
    )),
  };
}

function repositoryPathForFileUrl(
  url: URL,
  layer: ImportMapLayer,
  label: string,
  urls: ImportMapLayerUrls = layerUrls(layer),
): string {
  if (url.protocol !== "file:" || url.search || url.hash) {
    throw new Error(`${label} must resolve to a plain local file URL: ${url}`);
  }
  const { repositoryRootPath } = urls;
  const targetPath = resolve(fromValidatedFileUrl(url, label));
  const path = containedRelativePath(
    repositoryRootPath,
    targetPath,
  );
  if (path === undefined) {
    throw new Error(`${label} escapes repository root: ${url.href}`);
  }
  return path;
}

function canonicalScopeUrl(
  scope: string,
  layer: ImportMapLayer,
  urls: ImportMapLayerUrls = layerUrls(layer),
): string {
  assertCanonicalPathEncoding(scope, `import-map scope ${layer.path}`);
  const { baseUrl } = urls;
  let scopeUrl: URL;
  try {
    scopeUrl = new URL(scope, baseUrl);
  } catch {
    throw new Error(`invalid import-map scope: ${layer.path}: ${scope}`);
  }
  repositoryPathForFileUrl(
    physicalImportMapFileUrl(scopeUrl),
    layer,
    `import-map scope ${layer.path}: ${scope}`,
    urls,
  );
  return scopeUrl.href;
}

function canonicalImporterUrl(
  importer: string,
  layer: ImportMapLayer,
  urls: ImportMapLayerUrls = layerUrls(layer),
): string {
  assertCanonicalPathEncoding(importer, "import-map importer");
  const { repositoryRootUrl } = urls;
  let importerUrl: URL;
  try {
    importerUrl = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(importer)
      ? new URL(importer)
      : isAbsolute(importer)
      ? toFileUrl(resolve(importer))
      : new URL(normalizeRepositoryPath(importer), repositoryRootUrl);
  } catch {
    throw new Error(`invalid import-map importer: ${importer}`);
  }
  repositoryPathForFileUrl(
    physicalImportMapFileUrl(importerUrl),
    layer,
    "import-map importer",
    urls,
  );
  return importerUrl.href;
}

function importMapAddressUrl(
  address: string,
  baseUrl: string,
): URL | undefined {
  if (
    !address.startsWith("/") && !address.startsWith("./") &&
    !address.startsWith("../") &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(address)
  ) return undefined;
  try {
    return new URL(address, baseUrl);
  } catch {
    return undefined;
  }
}

function stableImportMapUrl(
  url: string,
  urls: ImportMapLayerUrls,
): string {
  if (url === urls.repositoryRootUrl) return "./";
  if (url.startsWith(urls.repositoryRootUrl)) {
    return `./${url.slice(urls.repositoryRootUrl.length)}`;
  }
  return url;
}

function canonicalImportMapKey(
  key: string,
  urls: ImportMapLayerUrls,
): { key: string; canonicalKey: string } {
  const keyUrl = importMapAddressUrl(key, urls.baseUrl)?.href;
  return keyUrl
    ? { key: keyUrl, canonicalKey: stableImportMapUrl(keyUrl, urls) }
    : { key, canonicalKey: key };
}

function canonicalImportMapTarget(
  target: string,
  layer: ImportMapLayer,
  owner: string,
  urls: ImportMapLayerUrls = layerUrls(layer),
): {
  selectedTarget: string;
  target: string;
  targetUrl: string;
  localPath?: string;
} {
  const targetUrl = importMapAddressUrl(target, urls.baseUrl);
  if (!targetUrl) {
    throw new Error(`invalid import-map target address: ${owner}: ${target}`);
  }
  const canonicalTarget = canonicalImportMapUrlIdentity(
    target,
    targetUrl,
    layer,
    `import-map target ${owner}: ${target}`,
    urls,
  );
  const localPath = localPathForImportMapFileUrl(
    targetUrl,
    layer,
    `import-map target ${owner}: ${target}`,
    urls,
  );
  return {
    // Preserve Deno-accepted encoded syntax as provenance while traversal uses
    // the canonical file identity in `target`.
    selectedTarget: target,
    target: canonicalTarget,
    targetUrl: targetUrl.href,
    ...(localPath === undefined ? {} : { localPath }),
  };
}

function physicalImportMapFileUrl(url: URL): URL {
  const physicalUrl = new URL(url.href);
  physicalUrl.search = "";
  physicalUrl.hash = "";
  return physicalUrl;
}

function localPathForImportMapFileUrl(
  url: URL,
  layer: ImportMapLayer,
  label: string,
  urls: ImportMapLayerUrls,
): string | undefined {
  if (url.protocol !== "file:") return undefined;
  try {
    return repositoryPathForFileUrl(
      physicalImportMapFileUrl(url),
      layer,
      label,
      urls,
    );
  } catch {
    return undefined;
  }
}

function canonicalImportMapUrlIdentity(
  address: string,
  addressUrl: URL,
  layer: ImportMapLayer,
  label: string,
  urls: ImportMapLayerUrls,
): string {
  if (addressUrl.protocol !== "file:") return addressUrl.href;
  try {
    const physicalUrl = physicalImportMapFileUrl(addressUrl);
    const path = repositoryPathForFileUrl(physicalUrl, layer, label, urls);
    const trailingSlash = physicalUrl.pathname.endsWith("/") && path !== ""
      ? "/"
      : "";
    const localIdentity = path === "" ? "./" : `./${path}${trailingSlash}`;
    return `${localIdentity}${canonicalUrlDecorations(address, addressUrl)}`;
  } catch {
    // An outside file address remains a file URL so policy cannot mistake it
    // for a repository-relative source path.
    return addressUrl.href || address;
  }
}

function canonicalUrlDecorations(address: string, addressUrl: URL): string {
  const queryIndex = address.indexOf("?");
  const hashIndex = address.indexOf("#");
  const hasQuery = queryIndex >= 0 &&
    (hashIndex < 0 || queryIndex < hashIndex);
  const hasHash = hashIndex >= 0;
  const search = addressUrl.search || (hasQuery ? "?" : "");
  const hash = addressUrl.hash || (hasHash ? "#" : "");
  return `${search}${hash}`;
}

function compileImportMapMappings(
  mappings: Record<string, string>,
  owner: string,
  layer: ImportMapLayer,
  urls: ImportMapLayerUrls,
): CompiledImportMapMapping[] {
  const compiled: CompiledImportMapMapping[] = [];
  const base = stableImportMapUrl(new URL(".", urls.baseUrl).href, urls);
  for (const [key, target] of Object.entries(mappings)) {
    if (key.length === 0) {
      throw new Error(`empty import-map key: ${owner}`);
    }
    if (typeof target !== "string") {
      throw new Error(`malformed import-map target: ${owner}: ${key}`);
    }
    if (key.endsWith("/") && !target.endsWith("/")) {
      throw new Error(
        `import-map prefix target must end with /: ${owner}: ${key}: ${target}`,
      );
    }
    const compiledTarget = canonicalImportMapTarget(
      target,
      layer,
      owner,
      urls,
    );
    const compiledKey = canonicalImportMapKey(key, urls);
    compiled.push({
      key: compiledKey.key,
      canonicalKey: compiledKey.canonicalKey,
      sourceKey: key,
      selectedTarget: compiledTarget.selectedTarget,
      target: compiledTarget.target,
      targetUrl: compiledTarget.targetUrl,
      ...(compiledTarget.localPath === undefined
        ? {}
        : { localPath: compiledTarget.localPath }),
      owner: layer.path,
      base,
      layer,
      urls,
    });
  }
  return compiled;
}

function compileImportMapLayer(layer: ImportMapLayer): CompiledImportMapLayer {
  const urls = layerUrls(layer);
  const scopes: CompiledImportMapScope[] = [];
  for (const [scope, mappings] of Object.entries(layer.scopes ?? {})) {
    if (
      !mappings || typeof mappings !== "object" || Array.isArray(mappings)
    ) {
      throw new Error(`malformed import-map scope: ${layer.path}: ${scope}`);
    }
    const scopeUrl = canonicalScopeUrl(scope, layer, urls);
    scopes.push({
      url: scopeUrl,
      sourceScope: scope,
      canonicalScope: stableImportMapUrl(scopeUrl, urls),
      mappings: compileImportMapMappings(
        mappings,
        `${layer.path}#${scope}`,
        layer,
        urls,
      ),
    });
  }
  return {
    layer,
    urls,
    imports: compileImportMapMappings(
      layer.imports ?? {},
      layer.path,
      layer,
      urls,
    ),
    scopes,
  };
}

function mappingCandidateMatches(
  specifier: string,
  mappings: readonly CompiledImportMapMapping[],
  scopeLength: number,
  canonicalRequestedIdentity?: string,
  sourceScope?: string,
  canonicalScope?: string,
): ImportMapCandidateMatch[] {
  const matches: ImportMapCandidateMatch[] = [];
  for (const mapping of mappings) {
    const { key } = mapping;
    if (key === specifier) {
      matches.push({
        mapping,
        canonicalRequestedIdentity,
        sourceScope,
        canonicalScope,
        scopeLength,
      });
    } else if (key.endsWith("/") && specifier.startsWith(key)) {
      matches.push({
        mapping,
        canonicalRequestedIdentity,
        sourceScope,
        canonicalScope,
        scopeLength,
        suffix: specifier.slice(key.length),
      });
    }
  }
  return matches;
}

function materializeImportMapCandidate(
  requestedSpecifier: string,
  match: ImportMapCandidateMatch,
): ImportMapCandidate {
  const {
    key,
    canonicalKey,
    sourceKey,
    selectedTarget,
    target,
    targetUrl,
    localPath,
    owner,
    base,
    layer,
    urls,
  } = match.mapping;
  const {
    canonicalRequestedIdentity,
    sourceScope,
    canonicalScope,
    scopeLength,
    suffix,
  } = match;
  if (suffix === undefined) {
    return {
      key,
      canonicalKey,
      sourceKey,
      canonicalRequestedIdentity,
      selectedTarget,
      target,
      localPath,
      owner,
      base,
      sourceScope,
      canonicalScope,
      scopeLength,
    };
  }
  let resolvedTargetUrl: URL;
  try {
    resolvedTargetUrl = new URL(suffix, targetUrl);
  } catch {
    throw new Error(
      `import-map prefix suffix could not be URL-parsed relative to import-map prefix target: ${owner}: ${sourceKey}: ${requestedSpecifier}`,
    );
  }
  if (!resolvedTargetUrl.href.startsWith(targetUrl)) {
    throw new Error(
      `import-map prefix target backtracks outside its address: ${owner}: ${sourceKey}: ${requestedSpecifier}`,
    );
  }
  const resolvedSelectedTarget = `${selectedTarget}${suffix}`;
  const resolvedTarget = canonicalImportMapUrlIdentity(
    resolvedSelectedTarget,
    resolvedTargetUrl,
    layer,
    `import-map prefix target ${owner}: ${sourceKey}: ${requestedSpecifier}`,
    urls,
  );
  const resolvedLocalPath = localPathForImportMapFileUrl(
    resolvedTargetUrl,
    layer,
    `import-map prefix target ${owner}: ${sourceKey}: ${requestedSpecifier}`,
    urls,
  );
  if (
    localPath !== undefined && resolvedLocalPath !== undefined &&
    resolvedLocalPath !== localPath &&
    !resolvedLocalPath.startsWith(`${localPath}/`)
  ) {
    throw new Error(
      `import-map prefix target backtracks outside its canonical address: ${owner}: ${sourceKey}: ${requestedSpecifier}`,
    );
  }
  return {
    key,
    canonicalKey,
    sourceKey,
    canonicalRequestedIdentity,
    selectedTarget: resolvedSelectedTarget,
    target: resolvedTarget,
    localPath: resolvedLocalPath,
    owner,
    base,
    sourceScope,
    canonicalScope,
    scopeLength,
  };
}

function canonicalImportMapMatchSpecifier(
  specifier: string,
  baseUrl: string,
  layer: ImportMapLayer,
  urls: ImportMapLayerUrls,
): {
  matchSpecifier: string;
  canonicalIdentity?: string;
  localPath?: string;
} {
  let canonicalEncoding = true;
  try {
    assertCanonicalPathEncoding(specifier, "import-map requested specifier");
  } catch {
    canonicalEncoding = false;
  }
  const addressUrl = importMapAddressUrl(specifier, baseUrl);
  if (!addressUrl) return { matchSpecifier: specifier };
  const canonicalIdentity = canonicalImportMapUrlIdentity(
    specifier,
    addressUrl,
    layer,
    `import-map requested specifier: ${specifier}`,
    urls,
  );
  return {
    matchSpecifier: addressUrl.href,
    canonicalIdentity: canonicalEncoding ? undefined : canonicalIdentity,
    localPath: localPathForImportMapFileUrl(
      addressUrl,
      layer,
      `import-map requested specifier: ${specifier}`,
      urls,
    ),
  };
}

function candidatesForSpecifier(
  specifier: string,
  layers: readonly CompiledImportMapLayer[],
  importer?: string,
): {
  candidates: ImportMapCandidateMatch[];
  canonicalRequestedIdentities: string[];
  requestedLocalPaths: string[];
} {
  const scoped: ImportMapCandidateMatch[] = [];
  const global: ImportMapCandidateMatch[] = [];
  const canonicalRequestedIdentities = new Set<string>();
  const requestedLocalPaths = new Set<string>();
  for (const { layer, urls, imports, scopes } of layers) {
    const importerUrl = importer
      ? canonicalImporterUrl(importer, layer, urls)
      : undefined;
    const match = canonicalImportMapMatchSpecifier(
      specifier,
      importerUrl ?? urls.baseUrl,
      layer,
      urls,
    );
    if (
      match.canonicalIdentity !== undefined &&
      match.canonicalIdentity !== specifier
    ) {
      canonicalRequestedIdentities.add(match.canonicalIdentity);
    }
    if (match.localPath !== undefined) {
      requestedLocalPaths.add(match.localPath);
    }
    global.push(...mappingCandidateMatches(
      match.matchSpecifier,
      imports,
      0,
      match.canonicalIdentity,
    ));
    if (importerUrl) {
      for (const scope of scopes) {
        if (importerUrl.startsWith(scope.url)) {
          scoped.push(...mappingCandidateMatches(
            match.matchSpecifier,
            scope.mappings,
            scope.url.length,
            match.canonicalIdentity,
            scope.sourceScope,
            scope.canonicalScope,
          ));
        }
      }
    }
  }
  if (scoped.length > 0) {
    const longestScope = Math.max(
      ...scoped.map((candidate) => candidate.scopeLength),
    );
    return {
      candidates: scoped.filter((candidate) =>
        candidate.scopeLength === longestScope
      ),
      canonicalRequestedIdentities: [...canonicalRequestedIdentities],
      requestedLocalPaths: [...requestedLocalPaths],
    };
  }
  return {
    candidates: global,
    canonicalRequestedIdentities: [...canonicalRequestedIdentities],
    requestedLocalPaths: [...requestedLocalPaths],
  };
}

function resolveCompiledImportMapSpecifierWithTrace(
  specifier: string,
  layers: readonly CompiledImportMapLayer[],
  importer?: string,
): ImportMapResolution {
  const {
    candidates,
    canonicalRequestedIdentities,
    requestedLocalPaths,
  } = candidatesForSpecifier(
    specifier,
    layers,
    importer,
  );
  if (candidates.length === 0) {
    const canonicalIdentity = canonicalRequestedIdentities.length === 1
      ? canonicalRequestedIdentities[0]
      : undefined;
    const localPath = requestedLocalPaths.length === 1
      ? requestedLocalPaths[0]
      : undefined;
    return {
      resolved: canonicalIdentity ?? specifier,
      trace: canonicalIdentity ? [specifier, canonicalIdentity] : [specifier],
      origin: { kind: "request", base: "importer" },
      ...(localPath ? { localPath } : {}),
    };
  }
  const longest = Math.max(
    ...candidates.map((candidate) => candidate.mapping.key.length),
  );
  const best = candidates
    .filter((candidate) => candidate.mapping.key.length === longest)
    .map((candidate) => materializeImportMapCandidate(specifier, candidate));
  const targetPairs = [
    ...new Set(
      best.map((candidate) =>
        JSON.stringify([candidate.selectedTarget, candidate.target])
      ),
    ),
  ];
  const identities = [
    ...new Set(
      best.map((candidate) =>
        `${candidate.owner}\0${
          candidate.sourceScope ?? ""
        }\0${candidate.sourceKey}`
      ),
    ),
  ];
  if (targetPairs.length !== 1 || identities.length !== 1) {
    throw new Error(
      `ambiguous import-map match for ${specifier}: ${
        best.map((candidate) => `${candidate.owner}#${candidate.sourceKey}`)
          .sort().join(", ")
      }`,
    );
  }
  const selected = best[0];
  const trace = [specifier];
  for (
    const identity of [
      selected.canonicalRequestedIdentity,
      selected.target,
    ]
  ) {
    if (identity !== undefined && identity !== trace.at(-1)) {
      trace.push(identity);
    }
  }
  return {
    resolved: selected.target,
    trace,
    origin: { kind: "mapping", base: selected.base },
    ...(selected.localPath ? { localPath: selected.localPath } : {}),
    mapping: {
      owner: selected.owner,
      base: selected.base,
      sourceKey: selected.sourceKey,
      canonicalKey: selected.canonicalKey,
      selectedAddress: selected.selectedTarget,
      canonicalTarget: selected.target,
      ...(selected.sourceScope === undefined ? {} : {
        sourceScope: selected.sourceScope,
        canonicalScope: selected.canonicalScope,
      }),
    },
  };
}

export function createImportMapResolver(
  layers: readonly ImportMapLayer[],
): ImportMapResolver {
  const compiledLayers = layers.map(compileImportMapLayer);
  const repositoryRoots = new Set(
    compiledLayers.map((layer) => layer.urls.repositoryRootUrl),
  );
  if (repositoryRoots.size > 1) {
    throw new Error("import-map layers use different repository roots");
  }
  const cache = new Map<string, Map<string, ImportMapResolution>>();
  const resolveWithTrace = (
    specifier: string,
    importer?: string,
  ): ImportMapResolution => {
    const importerKey = importer ?? "";
    let importerCache = cache.get(importerKey);
    if (!importerCache) {
      importerCache = new Map();
      cache.set(importerKey, importerCache);
    }
    let resolution = importerCache.get(specifier);
    if (!resolution) {
      resolution = resolveCompiledImportMapSpecifierWithTrace(
        specifier,
        compiledLayers,
        importer,
      );
      importerCache.set(specifier, resolution);
    }
    return {
      resolved: resolution.resolved,
      trace: [...resolution.trace],
      origin: { ...resolution.origin },
      ...(resolution.localPath ? { localPath: resolution.localPath } : {}),
      ...(resolution.mapping ? { mapping: { ...resolution.mapping } } : {}),
    };
  };
  return {
    resolve: (specifier, importer) =>
      resolveWithTrace(specifier, importer).resolved,
    resolveWithTrace,
  };
}

export function resolveImportMapSpecifierWithTrace(
  specifier: string,
  layers: ImportMapLayer[],
  importer?: string,
): ImportMapResolution {
  return createImportMapResolver(layers).resolveWithTrace(specifier, importer);
}

export function resolveImportMapSpecifier(
  specifier: string,
  layers: ImportMapLayer[],
  importer?: string,
): string {
  return createImportMapResolver(layers).resolve(specifier, importer);
}

export function configImportMapLayer(
  configPath: string,
  config: Record<string, unknown>,
  repositoryRoot?: string,
): ImportMapLayer {
  const imports = config.imports === undefined
    ? undefined
    : stringImportMapRecord(config.imports, `${configPath}: imports`);
  let scopes: Record<string, Record<string, string>> | undefined;
  if (config.scopes !== undefined) {
    if (
      !config.scopes || typeof config.scopes !== "object" ||
      Array.isArray(config.scopes)
    ) {
      throw new Error(`malformed import-map scopes: ${configPath}`);
    }
    scopes = {};
    for (const [scope, mappings] of Object.entries(config.scopes)) {
      scopes[scope] = stringImportMapRecord(
        mappings,
        `${configPath}: scopes.${scope}`,
      );
    }
  }
  const rootPath = repositoryRoot === undefined
    ? undefined
    : resolve(repositoryRoot);
  const rootHref = rootPath === undefined ? undefined : normalizedDirectoryUrl(
    toFileUrl(rootPath).href,
    `import-map repository root ${configPath}`,
  );
  const layer: ImportMapLayer = {
    path: configPath,
    baseUrl: rootPath === undefined
      ? undefined
      : `${toFileUrl(resolve(rootPath, physicalUrlIdentity(configPath))).href}${
        urlIdentityDecoration(configPath)
      }`,
    repositoryRootUrl: rootHref,
    imports,
    scopes,
  };
  return layer;
}

function stringImportMapRecord(
  value: unknown,
  label: string,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`malformed import-map mappings: ${label}`);
  }
  const mappings: Record<string, string> = {};
  for (const [key, target] of Object.entries(value)) {
    if (typeof target !== "string") {
      throw new Error(`malformed import-map target: ${label}: ${key}`);
    }
    mappings[key] = target;
  }
  return mappings;
}

export function resolveConfigRelativePath(
  repositoryRoot: string,
  configPath: string,
  target: string,
): string {
  assertCanonicalPathEncoding(target, "configuration target");
  const physicalTarget = target.slice(0, urlDecorationIndex(target));
  const root = resolve(repositoryRoot);
  let absoluteTarget: string;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(physicalTarget)) {
    if (!isFileUrlSpecifier(physicalTarget)) {
      throw new Error(`unsupported configuration target scheme: ${target}`);
    }
    absoluteTarget = resolve(fromValidatedFileUrl(
      physicalTarget,
      "configuration target",
    ));
    const path = containedRelativePath(root, absoluteTarget);
    if (path === undefined) {
      throw new Error(`file URL escapes repository root: ${target}`);
    }
    return path;
  }
  if (isAbsolute(physicalTarget)) {
    throw new Error(
      `absolute configuration paths are not permitted: ${target}`,
    );
  }
  const normalizedTarget = normalizeRepositoryPath(physicalTarget);
  absoluteTarget = physicalTarget.startsWith("./") &&
      (normalizedTarget.startsWith("src/") ||
        normalizedTarget.startsWith("cli/"))
    ? resolve(root, normalizedTarget)
    : resolve(root, dirname(configPath), physicalTarget);
  const path = containedRelativePath(root, absoluteTarget);
  if (path === undefined) {
    throw new Error(`configuration target escapes repository root: ${target}`);
  }
  return path;
}

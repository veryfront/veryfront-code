/**
 * Non-executing evaluator for hosted Veryfront configuration source.
 *
 * The project source is parsed by the pinned first-party Babel parser and then
 * interpreted as a deliberately small expression language. It is never
 * imported, evaluated, generated, or passed to a JavaScript runtime.
 *
 * @module
 */

import type { ASTNode, CodeParser } from "#veryfront/extensions/parser/index.ts";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import {
  canonicalizeConfigSnapshot,
  CONFIG_SNAPSHOT_LIMITS,
  ConfigSnapshotError,
  type ConfigSnapshotRecord,
  type ConfigSnapshotValue,
} from "./snapshot.ts";
import {
  MAX_CORS_ORIGIN_COUNT,
  MAX_CORS_ORIGIN_LENGTH,
  MAX_CORS_ORIGIN_LIST_LENGTH,
} from "#veryfront/utils/cors-policy-limits.ts";
import { PROJECT_ENV_SNAPSHOT_LIMITS } from "#veryfront/platform/compat/process/project-env-contract.ts";

const IntrinsicArray = Array;
const IntrinsicUint8Array = Uint8Array;
const IntrinsicWeakMap = WeakMap;
const IntrinsicWeakSet = WeakSet;
const ArrayIsArray = Array.isArray;
const ArrayPrototypeSort = Array.prototype.sort;
const NumberIsFinite = Number.isFinite;
const NumberIsInteger = Number.isInteger;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const StringPrototypeCharAt = String.prototype.charAt;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeTrim = String.prototype.trim;
const WeakMapPrototypeGet = WeakMap.prototype.get;
const WeakMapPrototypeSet = WeakMap.prototype.set;
const WeakSetPrototypeAdd = WeakSet.prototype.add;
const WeakSetPrototypeHas = WeakSet.prototype.has;

interface CapturedSubtleCrypto {
  readonly receiver: object;
  readonly generateKey: (...args: never[]) => unknown;
  readonly sign: (...args: never[]) => unknown;
}

const intrinsicSubtleCrypto = captureSubtleCrypto();

const AST_SCAN_ENTRY_LIMIT = 131_072;
const CONFIG_FILE_NAME = "veryfront.config.ts";
const FIRST_PARTY_PARSER_DIRECTORY = "ext-parser-babel";
const FIRST_PARTY_PARSER_PACKAGE = "@veryfront/ext-parser-babel";
const FIRST_PARTY_PARSER_SOURCE_ENTRY = "parser-only";
const FIRST_PARTY_PARSER_PACKAGE_SUBPATH = "parser-only";
const FINGERPRINT_NAMESPACE = "veryfront-declarative-context-v1";
const FINGERPRINT_PREFIX = "ctx1:";
const HEX_DIGITS = "0123456789abcdef";
const MAX_HOSTED_EXTENSION_NAME_LENGTH = 256;
const POLICY_VERSION = "hosted-declarative-config-v1";

type TrustedCodeParser = Pick<CodeParser, "parse">;

type TrustedParserModule = Readonly<{
  BabelParseOnlyParser: new () => TrustedCodeParser;
}>;

/**
 * Fixed limits for parsing and interpreting hosted configuration source.
 *
 * A killable subprocess remains responsible for the hard wall-clock and
 * memory boundary because Babel parsing is synchronous.
 */
export interface DeclarativeConfigLimits {
  readonly maxSourceBytes: number;
  readonly maxTopLevelStatements: number;
  readonly maxImports: number;
  readonly maxImportSpecifiers: number;
  readonly maxBindings: number;
  readonly maxAstNodes: number;
  readonly maxValidationDepth: number;
  readonly maxEvaluationSteps: number;
  readonly maxEvaluationDepth: number;
  readonly maxArguments: number;
  readonly maxSpreadOperations: number;
  readonly maxSpreadCopies: number;
  readonly maxObjectProperties: number;
  readonly maxObjectKeyLength: number;
  readonly maxArrayElements: number;
  readonly maxTemplateExpressions: number;
  readonly maxIntermediateStringUnits: number;
  readonly maxEnvironmentNameLength: number;
  readonly maxEnvironmentEntries: number;
  readonly maxEnvironmentKeyLength: number;
  readonly maxEnvironmentValueLength: number;
  readonly maxEnvironmentBytes: number;
}

/** Limits enforced before and during every evaluation. */
export const DECLARATIVE_CONFIG_LIMITS: Readonly<DeclarativeConfigLimits> = ObjectFreeze({
  maxSourceBytes: 65_536,
  maxTopLevelStatements: 256,
  maxImports: 1,
  maxImportSpecifiers: 8,
  maxBindings: 128,
  maxAstNodes: 4_096,
  maxValidationDepth: 64,
  maxEvaluationSteps: 3_000,
  maxEvaluationDepth: 32,
  maxArguments: 16,
  maxSpreadOperations: 64,
  maxSpreadCopies: 1_024,
  maxObjectProperties: 512,
  maxObjectKeyLength: 256,
  maxArrayElements: 1_024,
  maxTemplateExpressions: 64,
  maxIntermediateStringUnits: 1_048_576,
  maxEnvironmentNameLength: 255,
  maxEnvironmentEntries: PROJECT_ENV_SNAPSHOT_LIMITS.maxEntries,
  maxEnvironmentKeyLength: PROJECT_ENV_SNAPSHOT_LIMITS.maxKeyChars,
  maxEnvironmentValueLength: PROJECT_ENV_SNAPSHOT_LIMITS.maxValueChars,
  maxEnvironmentBytes: PROJECT_ENV_SNAPSHOT_LIMITS.maxUtf8Bytes,
});

/** Cache/policy identity for this exact declarative language. */
export const DECLARATIVE_CONFIG_POLICY_VERSION = POLICY_VERSION;

export type DeclarativeConfigErrorCode =
  | "evaluation-type-error"
  | "evaluator-unavailable"
  | "forbidden-capability"
  | "input-invalid"
  | "invalid-binding"
  | "invalid-helper-usage"
  | "invalid-result"
  | "non-finite-number"
  | "parser-contract-violation"
  | "parser-unavailable"
  | "resource-limit-exceeded"
  | "source-too-large"
  | "syntax-error"
  | "unsupported-hosted-feature"
  | "unsupported-syntax";

export type DeclarativeConfigErrorPhase =
  | "input"
  | "parse"
  | "validate"
  | "evaluate"
  | "result";

export interface DeclarativeConfigSourceLocation {
  /** One-based line number. */
  readonly line: number;
  /** Zero-based column number. */
  readonly column: number;
  /** Zero-based UTF-16 source offset. */
  readonly offset: number;
  readonly fileName: typeof CONFIG_FILE_NAME;
}

/** Stable details suitable for policy decisions without exposing source text. */
export type DeclarativeConfigErrorReason =
  | "arguments"
  | "array-elements"
  | "ast-nodes"
  | "ast-shape"
  | "binding-count"
  | "dangerous-key"
  | "duplicate-binding"
  | "duplicate-default-export"
  | "duplicate-key"
  | "environment-accessor"
  | "environment-bytes"
  | "environment-entries"
  | "environment-key"
  | "environment-name"
  | "environment-prototype"
  | "environment-symbol"
  | "environment-value"
  | "evaluation-depth"
  | "evaluation-steps"
  | "function-value"
  | "helper-arguments"
  | "helper-as-value"
  | "host-global"
  | "hosted-cors-origin"
  | "hosted-custom-middleware"
  | "hosted-extensions"
  | "import-form"
  | "intermediate-string"
  | "missing-default-export"
  | "non-finite-result"
  | "object-key"
  | "object-properties"
  | "operand-type"
  | "options-accessor"
  | "options-prototype"
  | "parser-load"
  | "parser-shape"
  | "prepared-context"
  | "result-not-record"
  | "result-not-snapshot-safe"
  | "source-bytes"
  | "spread-copies"
  | "spread-operations"
  | "statement-count"
  | "syntax-error"
  | "template-expressions"
  | "unbound-identifier"
  | "crypto-unavailable"
  | "unsupported-call"
  | "unsupported-export"
  | "unsupported-expression"
  | "unsupported-import"
  | "unsupported-statement";

/** Typed failure emitted for every rejected source or bounded-resource case. */
export class DeclarativeConfigEvaluationError extends Error {
  readonly code: DeclarativeConfigErrorCode;
  readonly phase: DeclarativeConfigErrorPhase;
  readonly reason: DeclarativeConfigErrorReason;
  readonly location: DeclarativeConfigSourceLocation | null;
  readonly retryable: boolean;

  constructor(options: {
    code: DeclarativeConfigErrorCode;
    phase: DeclarativeConfigErrorPhase;
    reason: DeclarativeConfigErrorReason;
    location?: DeclarativeConfigSourceLocation | null;
    retryable?: boolean;
  }) {
    super(
      `Hosted configuration rejected (${options.code}: ${options.reason})`,
    );
    this.name = "DeclarativeConfigEvaluationError";
    this.code = options.code;
    this.phase = options.phase;
    this.reason = options.reason;
    this.location = options.location ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/** Explicit environment data used to prepare a hosted evaluation context. */
export interface PrepareDeclarativeConfigContextOptions {
  readonly environmentName: string;
  /**
   * Tenant environment decoded outside the project source. Only own,
   * enumerable string data properties are accepted.
   *
   * The value must originate at a non-executable decoding boundary.
   * Same-realm proxies are outside this API's threat model because JavaScript
   * cannot reliably identify them before a reflection trap runs.
   */
  readonly environment: unknown;
}

/**
 * Opaque, same-isolate context token for repeat hosted evaluations.
 *
 * The fingerprint is process-local and intentionally cannot be persisted as a
 * distributed cache identity. Cache callers must also bind the source digest.
 */
export interface PreparedDeclarativeConfigContext {
  readonly cacheFingerprint: string;
}

/**
 * Coupled cache identity and direct worker input derived from one prepared
 * snapshot. This DTO is intended only for a trusted structured-clone boundary.
 */
export interface PreparedDeclarativeConfigWorkerPayload {
  readonly cacheFingerprint: string;
  readonly policyVersion: typeof DECLARATIVE_CONFIG_POLICY_VERSION;
  readonly evaluationOptions: DirectDeclarativeConfigEvaluationOptions;
}

/** Hosted evaluation with direct environment input. */
export interface DirectDeclarativeConfigEvaluationOptions
  extends PrepareDeclarativeConfigContextOptions {
  readonly source: string;
  readonly preparedContext?: never;
}

/** Hosted evaluation reusing a previously prepared context. */
export interface PreparedDeclarativeConfigEvaluationOptions {
  readonly source: string;
  readonly preparedContext: PreparedDeclarativeConfigContext;
  readonly environmentName?: never;
  readonly environment?: never;
}

/** Explicit data supplied to the hosted evaluator. */
export type DeclarativeConfigEvaluationOptions =
  | DirectDeclarativeConfigEvaluationOptions
  | PreparedDeclarativeConfigEvaluationOptions;

type HelperName =
  | "defineConfig"
  | "defineConfigWithEnv"
  | "getEnv"
  | "mergeConfigs";

type RuntimePrimitive = null | boolean | number | string | undefined;

interface RuntimeRecord {
  readonly [key: string]: RuntimeValue;
}

type RuntimeValue = RuntimePrimitive | RuntimeRecord | readonly RuntimeValue[];

type Binding =
  | Readonly<{ kind: "helper"; helper: HelperName }>
  | Readonly<{ kind: "value"; value: RuntimeValue }>;

interface LexicalEnvironment {
  readonly bindings: Record<string, Binding>;
  readonly parent: LexicalEnvironment | null;
}

interface EvaluationContext {
  readonly source: string;
  readonly tenantEnvironment: Readonly<Record<string, string>>;
  readonly environmentName: string;
  bindingCount: number;
  evaluationSteps: number;
  spreadOperations: number;
  spreadCopies: number;
  intermediateStringUnits: number;
}

interface PreparedContextState {
  readonly tenantEnvironment: Readonly<Record<string, string>>;
  readonly environmentName: string;
}

interface CapturedOption {
  readonly present: boolean;
  readonly value: unknown;
}

interface CapturedEvaluationOptions {
  readonly source: CapturedOption;
  readonly environmentName: CapturedOption;
  readonly environment: CapturedOption;
  readonly preparedContext: CapturedOption;
}

let trustedParserPromise: Promise<TrustedCodeParser> | undefined;
let fingerprintKeyPromise: Promise<CryptoKey> | undefined;
const preparedContextStates = new IntrinsicWeakMap<object, PreparedContextState>();

function throwEvaluationError(
  code: DeclarativeConfigErrorCode,
  phase: DeclarativeConfigErrorPhase,
  reason: DeclarativeConfigErrorReason,
  context?: EvaluationContext,
  node?: ASTNode,
): never {
  throw new DeclarativeConfigEvaluationError({
    code,
    phase,
    reason,
    location: context && node ? sourceLocation(context.source, node.start) : null,
  });
}

function sourceLocation(
  source: string,
  offsetValue: unknown,
): DeclarativeConfigSourceLocation | null {
  if (
    typeof offsetValue !== "number" ||
    !NumberIsInteger(offsetValue) ||
    offsetValue < 0 ||
    offsetValue > source.length
  ) {
    return null;
  }

  let line = 1;
  let column = 0;
  for (let index = 0; index < offsetValue; index += 1) {
    const code = ReflectApply(StringPrototypeCharCodeAt, source, [index]) as number;
    if (code === 13) {
      line += 1;
      column = 0;
      if (
        index + 1 < offsetValue &&
        (ReflectApply(StringPrototypeCharCodeAt, source, [index + 1]) as number) === 10
      ) {
        index += 1;
      }
    } else if (code === 10 || code === 0x2028 || code === 0x2029) {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }

  return ObjectFreeze({
    line,
    column,
    offset: offsetValue,
    fileName: CONFIG_FILE_NAME,
  });
}

function isAstNode(value: unknown): value is ASTNode {
  if (typeof value !== "object" || value === null) return false;
  try {
    const descriptor = ObjectGetOwnPropertyDescriptor(value, "type");
    return descriptor !== undefined &&
      hasOwn(descriptor, "value") &&
      typeof descriptor.value === "string";
  } catch {
    return false;
  }
}

function requireAstNode(
  value: unknown,
  context: EvaluationContext,
  parent: ASTNode,
): ASTNode {
  if (!isAstNode(value)) {
    return throwEvaluationError(
      "parser-contract-violation",
      "validate",
      "ast-shape",
      context,
      parent,
    );
  }
  return value;
}

function requireNodeArray(
  value: unknown,
  context: EvaluationContext,
  parent: ASTNode,
): unknown[] {
  if (!ArrayIsArray(value)) {
    return throwEvaluationError(
      "parser-contract-violation",
      "validate",
      "ast-shape",
      context,
      parent,
    );
  }
  return value;
}

function findCallableDataProperty(
  receiver: object,
  property: PropertyKey,
): ((...args: never[]) => unknown) | undefined {
  let current: object | null = receiver;
  let depth = 0;
  while (current !== null && depth < 16) {
    const descriptor = ObjectGetOwnPropertyDescriptor(current, property);
    if (descriptor !== undefined) {
      return hasOwn(descriptor, "value") &&
          typeof descriptor.value === "function"
        ? descriptor.value as (...args: never[]) => unknown
        : undefined;
    }
    current = ObjectGetPrototypeOf(current);
    depth += 1;
  }
  return undefined;
}

function captureSubtleCrypto(): CapturedSubtleCrypto | undefined {
  try {
    const cryptoValue: unknown = globalThis.crypto;
    if (typeof cryptoValue !== "object" || cryptoValue === null) {
      return undefined;
    }
    const subtleValue: unknown = (cryptoValue as Crypto).subtle;
    if (typeof subtleValue !== "object" || subtleValue === null) {
      return undefined;
    }
    const generateKey = findCallableDataProperty(subtleValue, "generateKey");
    const sign = findCallableDataProperty(subtleValue, "sign");
    if (!generateKey || !sign) return undefined;
    return ObjectFreeze({
      receiver: subtleValue,
      generateKey,
      sign,
    });
  } catch {
    return undefined;
  }
}

function hasOwn(target: object, key: PropertyKey): boolean {
  return ReflectApply(ObjectPrototypeHasOwnProperty, target, [key]) as boolean;
}

function defineDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
  enumerable: boolean,
  writable: boolean,
  configurable: boolean,
): void {
  const descriptor = ObjectCreate(null) as PropertyDescriptor;
  descriptor.value = value;
  descriptor.enumerable = enumerable;
  descriptor.writable = writable;
  descriptor.configurable = configurable;
  ObjectDefineProperty(target, key, descriptor);
}

function weakSetHas(seen: WeakSet<object>, value: object): boolean {
  return ReflectApply(WeakSetPrototypeHas, seen, [value]) as boolean;
}

function weakSetAdd(seen: WeakSet<object>, value: object): void {
  ReflectApply(WeakSetPrototypeAdd, seen, [value]);
}

function pushValue<T>(array: T[], value: T): void {
  defineDataProperty(array, array.length, value, true, true, true);
}

async function loadTrustedParser(): Promise<TrustedCodeParser> {
  try {
    const parserModule = await importFirstPartyExtensionModule<TrustedParserModule>(
      FIRST_PARTY_PARSER_DIRECTORY,
      FIRST_PARTY_PARSER_PACKAGE,
      {
        sourceEntry: FIRST_PARTY_PARSER_SOURCE_ENTRY,
        packageSubpath: FIRST_PARTY_PARSER_PACKAGE_SUBPATH,
      },
    );
    if (typeof parserModule.BabelParseOnlyParser !== "function") throw new TypeError();
    return captureTrustedParser(new parserModule.BabelParseOnlyParser());
  } catch {
    throw new DeclarativeConfigEvaluationError({
      code: "parser-unavailable",
      phase: "parse",
      reason: "parser-load",
      retryable: true,
    });
  }
}

function captureTrustedParser(parser: unknown): TrustedCodeParser {
  if (typeof parser !== "object" || parser === null) {
    return throwParserShapeError();
  }
  let parse: ((...args: never[]) => unknown) | undefined;
  try {
    parse = findCallableDataProperty(parser, "parse");
  } catch {
    return throwParserShapeError();
  }
  if (!parse) return throwParserShapeError();
  const parseMethod = parse;

  const captured = ObjectCreate(null) as TrustedCodeParser;
  defineDataProperty(
    captured,
    "parse",
    (options: Parameters<TrustedCodeParser["parse"]>[0]) =>
      ReflectApply(parseMethod, parser, [options]) as Promise<ASTNode>,
    true,
    false,
    false,
  );
  return ObjectFreeze(captured);
}

function throwParserShapeError(): never {
  throw new DeclarativeConfigEvaluationError({
    code: "parser-contract-violation",
    phase: "input",
    reason: "parser-shape",
  });
}

async function getTrustedParser(): Promise<TrustedCodeParser> {
  const pending = trustedParserPromise ??= loadTrustedParser();
  try {
    return await pending;
  } catch (error) {
    if (trustedParserPromise === pending) trustedParserPromise = undefined;
    throw error;
  }
}

function countUtf8BytesUpTo(value: string, maximum: number): number {
  if (value.length > maximum) {
    return maximum + 1;
  }

  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
    let additionalBytes: number;
    if (code <= 0x7f) {
      additionalBytes = 1;
    } else if (code <= 0x7ff) {
      additionalBytes = 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = ReflectApply(StringPrototypeCharCodeAt, value, [index + 1]) as number;
      if (next >= 0xdc00 && next <= 0xdfff) {
        additionalBytes = 4;
        index += 1;
      } else {
        additionalBytes = 3;
      }
    } else {
      additionalBytes = 3;
    }
    if (additionalBytes > maximum - bytes) {
      return maximum + 1;
    }
    bytes += additionalBytes;
  }
  return bytes;
}

function countUtf8BytesBounded(source: string): number {
  return countUtf8BytesUpTo(
    source,
    DECLARATIVE_CONFIG_LIMITS.maxSourceBytes,
  );
}

function parseErrorLocation(
  source: string,
  error: unknown,
): DeclarativeConfigSourceLocation | null {
  const position = typeof error === "object" && error !== null
    ? (error as Record<string, unknown>).pos
    : undefined;
  return sourceLocation(source, position);
}

function parserErrorReason(error: unknown): DeclarativeConfigErrorReason {
  const reasonCode = typeof error === "object" && error !== null
    ? (error as Record<string, unknown>).reasonCode
    : undefined;
  if (reasonCode === "DuplicateDefaultExport") return "duplicate-default-export";
  if (reasonCode === "VarRedeclaration") return "duplicate-binding";
  return "syntax-error";
}

function preflightAst(ast: ASTNode, source: string): void {
  const stack: unknown[] = [ast];
  const seen = new IntrinsicWeakSet<object>();
  let cursor = 0;
  let astNodes = 0;
  let scannedEntries = 0;

  while (cursor < stack.length) {
    const value = stack[cursor];
    cursor += 1;
    if (typeof value !== "object" || value === null) continue;
    if (weakSetHas(seen, value)) continue;
    weakSetAdd(seen, value);

    if (ArrayIsArray(value)) {
      scannedEntries += value.length;
      if (scannedEntries > AST_SCAN_ENTRY_LIMIT) {
        throw new DeclarativeConfigEvaluationError({
          code: "resource-limit-exceeded",
          phase: "validate",
          reason: "ast-nodes",
        });
      }
      for (let index = 0; index < value.length; index += 1) {
        pushValue(stack, value[index]);
      }
      continue;
    }

    const record = value as Record<PropertyKey, unknown>;
    if (typeof record.type === "string") {
      astNodes += 1;
      if (astNodes > DECLARATIVE_CONFIG_LIMITS.maxAstNodes) {
        throw new DeclarativeConfigEvaluationError({
          code: "resource-limit-exceeded",
          phase: "validate",
          reason: "ast-nodes",
          location: sourceLocation(source, record.start),
        });
      }
    }

    const keys = ReflectOwnKeys(record);
    scannedEntries += keys.length;
    if (scannedEntries > AST_SCAN_ENTRY_LIMIT) {
      throw new DeclarativeConfigEvaluationError({
        code: "resource-limit-exceeded",
        phase: "validate",
        reason: "ast-nodes",
        location: sourceLocation(source, record.start),
      });
    }
    for (let index = 0; index < keys.length; index += 1) {
      const descriptor = ObjectGetOwnPropertyDescriptor(record, keys[index]!);
      if (descriptor && hasOwn(descriptor, "value")) {
        pushValue(stack, descriptor.value);
      }
    }
  }
}

function extractProgram(
  ast: ASTNode,
  source: string,
): ASTNode {
  if (ast.type !== "File" || !isAstNode(ast.program) || ast.program.type !== "Program") {
    throw new DeclarativeConfigEvaluationError({
      code: "parser-contract-violation",
      phase: "validate",
      reason: "ast-shape",
      location: sourceLocation(source, ast.start),
    });
  }
  const program = ast.program;
  if (
    program.sourceType !== "module" ||
    program.interpreter !== null ||
    !ArrayIsArray(program.directives) ||
    program.directives.length !== 0 ||
    !ArrayIsArray(program.body)
  ) {
    throw new DeclarativeConfigEvaluationError({
      code: "unsupported-syntax",
      phase: "validate",
      reason: "unsupported-statement",
      location: sourceLocation(source, program.start),
    });
  }
  return program;
}

function isEnvironmentKey(key: string): boolean {
  if (key.length === 0) return false;
  for (let index = 0; index < key.length; index += 1) {
    const code = ReflectApply(StringPrototypeCharCodeAt, key, [index]) as number;
    if (code === 0 || code === 61) return false;
  }
  return true;
}

function isEnvironmentValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if ((ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number) === 0) {
      return false;
    }
  }
  return true;
}

function validateEnvironmentName(name: unknown): string {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > DECLARATIVE_CONFIG_LIMITS.maxEnvironmentNameLength
  ) {
    throw new DeclarativeConfigEvaluationError({
      code: "input-invalid",
      phase: "input",
      reason: "environment-name",
    });
  }
  for (let index = 0; index < name.length; index += 1) {
    const code = ReflectApply(StringPrototypeCharCodeAt, name, [index]) as number;
    if (code < 32 || code === 127) {
      throw new DeclarativeConfigEvaluationError({
        code: "input-invalid",
        phase: "input",
        reason: "environment-name",
      });
    }
  }
  return name;
}

function snapshotTenantEnvironment(
  input: unknown,
): Readonly<Record<string, string>> {
  if (typeof input !== "object" || input === null) {
    throw new DeclarativeConfigEvaluationError({
      code: "input-invalid",
      phase: "input",
      reason: "environment-prototype",
    });
  }
  let inputIsArray: boolean;
  try {
    inputIsArray = ArrayIsArray(input);
  } catch {
    throw new DeclarativeConfigEvaluationError({
      code: "input-invalid",
      phase: "input",
      reason: "environment-prototype",
    });
  }
  if (inputIsArray) {
    throw new DeclarativeConfigEvaluationError({
      code: "input-invalid",
      phase: "input",
      reason: "environment-prototype",
    });
  }

  let prototype: object | null;
  try {
    prototype = ObjectGetPrototypeOf(input);
  } catch {
    throw new DeclarativeConfigEvaluationError({
      code: "input-invalid",
      phase: "input",
      reason: "environment-prototype",
    });
  }
  if (prototype !== null && prototype !== ObjectPrototype) {
    throw new DeclarativeConfigEvaluationError({
      code: "input-invalid",
      phase: "input",
      reason: "environment-prototype",
    });
  }

  let keys: PropertyKey[];
  try {
    keys = ReflectOwnKeys(input);
  } catch {
    throw new DeclarativeConfigEvaluationError({
      code: "input-invalid",
      phase: "input",
      reason: "environment-prototype",
    });
  }
  if (keys.length > DECLARATIVE_CONFIG_LIMITS.maxEnvironmentEntries) {
    throw new DeclarativeConfigEvaluationError({
      code: "resource-limit-exceeded",
      phase: "input",
      reason: "environment-entries",
    });
  }
  ReflectApply(ArrayPrototypeSort, keys, [
    (left: PropertyKey, right: PropertyKey) =>
      typeof left === "string" && typeof right === "string"
        ? left < right ? -1 : left > right ? 1 : 0
        : typeof left === "string"
        ? -1
        : typeof right === "string"
        ? 1
        : 0,
  ]);

  const output = ObjectCreate(null) as Record<string, string>;
  let totalBytes = 0;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== "string") {
      throw new DeclarativeConfigEvaluationError({
        code: "input-invalid",
        phase: "input",
        reason: "environment-symbol",
      });
    }
    if (
      key.length > DECLARATIVE_CONFIG_LIMITS.maxEnvironmentKeyLength ||
      !isEnvironmentKey(key)
    ) {
      throw new DeclarativeConfigEvaluationError({
        code: "input-invalid",
        phase: "input",
        reason: "environment-key",
      });
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = ObjectGetOwnPropertyDescriptor(input, key);
    } catch {
      throw new DeclarativeConfigEvaluationError({
        code: "input-invalid",
        phase: "input",
        reason: "environment-accessor",
      });
    }
    if (
      descriptor === undefined ||
      !hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      throw new DeclarativeConfigEvaluationError({
        code: "input-invalid",
        phase: "input",
        reason: "environment-accessor",
      });
    }
    if (
      typeof descriptor.value !== "string" ||
      descriptor.value.length > DECLARATIVE_CONFIG_LIMITS.maxEnvironmentValueLength ||
      !isEnvironmentValue(descriptor.value)
    ) {
      throw new DeclarativeConfigEvaluationError({
        code: "input-invalid",
        phase: "input",
        reason: "environment-value",
      });
    }

    const remainingBytes = DECLARATIVE_CONFIG_LIMITS.maxEnvironmentBytes - totalBytes;
    const keyBytes = countUtf8BytesUpTo(key, remainingBytes);
    if (keyBytes > remainingBytes) {
      throw new DeclarativeConfigEvaluationError({
        code: "resource-limit-exceeded",
        phase: "input",
        reason: "environment-bytes",
      });
    }
    totalBytes += keyBytes;
    const remainingValueBytes = DECLARATIVE_CONFIG_LIMITS.maxEnvironmentBytes - totalBytes;
    const valueBytes = countUtf8BytesUpTo(
      descriptor.value,
      remainingValueBytes,
    );
    if (valueBytes > remainingValueBytes) {
      throw new DeclarativeConfigEvaluationError({
        code: "resource-limit-exceeded",
        phase: "input",
        reason: "environment-bytes",
      });
    }
    totalBytes += valueBytes;
    defineDataProperty(
      output,
      key,
      descriptor.value,
      true,
      false,
      false,
    );
  }
  return ObjectFreeze(output);
}

function sortedEnvironmentKeys(
  environment: Readonly<Record<string, string>>,
): string[] {
  const ownKeys = ReflectOwnKeys(environment);
  const keys = new IntrinsicArray<string>();
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index];
    if (typeof key !== "string") {
      throw new TypeError("Prepared environment contains a non-string key");
    }
    pushValue(keys, key);
  }
  ReflectApply(ArrayPrototypeSort, keys, [
    (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0,
  ]);
  return keys;
}

function addFingerprintFrameLength(total: number, value: string): number {
  const frameBytes = 4 + value.length * 2;
  if (!NumberIsFinite(frameBytes) || frameBytes > Number.MAX_SAFE_INTEGER - total) {
    throw new TypeError("Prepared context fingerprint input is too large");
  }
  return total + frameBytes;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): number {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
  return offset + 4;
}

function writeFingerprintFrame(
  bytes: Uint8Array,
  offset: number,
  value: string,
): number {
  let cursor = writeUint32(bytes, offset, value.length);
  for (let index = 0; index < value.length; index += 1) {
    const code = ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
    bytes[cursor] = code >>> 8;
    bytes[cursor + 1] = code;
    cursor += 2;
  }
  return cursor;
}

function canonicalPreparedContextBytes(state: PreparedContextState): Uint8Array {
  const keys = sortedEnvironmentKeys(state.tenantEnvironment);
  let byteLength = 4;
  byteLength = addFingerprintFrameLength(byteLength, FINGERPRINT_NAMESPACE);
  byteLength = addFingerprintFrameLength(byteLength, POLICY_VERSION);
  byteLength = addFingerprintFrameLength(byteLength, state.environmentName);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = ObjectGetOwnPropertyDescriptor(state.tenantEnvironment, key);
    if (!descriptor || !hasOwn(descriptor, "value") || typeof descriptor.value !== "string") {
      throw new TypeError("Prepared environment snapshot invariant failed");
    }
    byteLength = addFingerprintFrameLength(byteLength, key);
    byteLength = addFingerprintFrameLength(byteLength, descriptor.value);
  }

  const bytes = new IntrinsicUint8Array(byteLength);
  let offset = 0;
  offset = writeFingerprintFrame(bytes, offset, FINGERPRINT_NAMESPACE);
  offset = writeFingerprintFrame(bytes, offset, POLICY_VERSION);
  offset = writeFingerprintFrame(bytes, offset, state.environmentName);
  offset = writeUint32(bytes, offset, keys.length);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = ObjectGetOwnPropertyDescriptor(state.tenantEnvironment, key)!;
    offset = writeFingerprintFrame(bytes, offset, key);
    offset = writeFingerprintFrame(bytes, offset, descriptor.value as string);
  }
  if (offset !== byteLength) {
    throw new TypeError("Prepared context fingerprint framing invariant failed");
  }
  return bytes;
}

async function getFingerprintKey(): Promise<CryptoKey> {
  const subtleCrypto = intrinsicSubtleCrypto;
  if (!subtleCrypto) return throwCryptoUnavailable();

  if (fingerprintKeyPromise === undefined) {
    const algorithm = ObjectCreate(null) as HmacKeyGenParams;
    defineDataProperty(algorithm, "name", "HMAC", true, false, false);
    defineDataProperty(algorithm, "hash", "SHA-256", true, false, false);
    defineDataProperty(algorithm, "length", 256, true, false, false);
    const usages = new IntrinsicArray<KeyUsage>();
    pushValue(usages, "sign");
    try {
      fingerprintKeyPromise = ReflectApply(
        subtleCrypto.generateKey,
        subtleCrypto.receiver,
        [algorithm, false, usages],
      ) as Promise<CryptoKey>;
    } catch {
      return throwCryptoUnavailable();
    }
  }

  const pending = fingerprintKeyPromise;
  try {
    return await pending;
  } catch {
    if (fingerprintKeyPromise === pending) fingerprintKeyPromise = undefined;
    return throwCryptoUnavailable();
  }
}

async function fingerprintPreparedContext(
  state: PreparedContextState,
): Promise<string> {
  const subtleCrypto = intrinsicSubtleCrypto;
  if (!subtleCrypto) return throwCryptoUnavailable();

  let digest: Uint8Array;
  try {
    const bytes = canonicalPreparedContextBytes(state);
    const signature = await (ReflectApply(
      subtleCrypto.sign,
      subtleCrypto.receiver,
      ["HMAC", await getFingerprintKey(), bytes],
    ) as Promise<ArrayBuffer>);
    digest = new IntrinsicUint8Array(signature);
  } catch (error) {
    if (error instanceof DeclarativeConfigEvaluationError) throw error;
    return throwCryptoUnavailable();
  }
  let hexadecimal = "";
  for (let index = 0; index < digest.length; index += 1) {
    const value = digest[index]!;
    hexadecimal += ReflectApply(StringPrototypeCharAt, HEX_DIGITS, [
      value >>> 4,
    ]) as string;
    hexadecimal += ReflectApply(StringPrototypeCharAt, HEX_DIGITS, [
      value & 15,
    ]) as string;
  }
  return `${FINGERPRINT_PREFIX}${hexadecimal}`;
}

function throwCryptoUnavailable(): never {
  throw new DeclarativeConfigEvaluationError({
    code: "evaluator-unavailable",
    phase: "input",
    reason: "crypto-unavailable",
    retryable: true,
  });
}

function setPreparedContextState(
  token: object,
  state: PreparedContextState,
): void {
  ReflectApply(WeakMapPrototypeSet, preparedContextStates, [token, state]);
}

function getPreparedContextState(
  token: unknown,
): PreparedContextState | undefined {
  if (typeof token !== "object" || token === null) return undefined;
  return ReflectApply(
    WeakMapPrototypeGet,
    preparedContextStates,
    [token],
  ) as PreparedContextState | undefined;
}

function requirePreparedContextState(
  token: unknown,
): PreparedContextState {
  const state = getPreparedContextState(token);
  if (state) return state;
  throw new DeclarativeConfigEvaluationError({
    code: "input-invalid",
    phase: "input",
    reason: "prepared-context",
  });
}

function throwOptionsError(
  reason: "options-accessor" | "options-prototype",
): never {
  throw new DeclarativeConfigEvaluationError({
    code: "input-invalid",
    phase: "input",
    reason,
  });
}

function requireOptionsRecord(value: unknown): object {
  if (typeof value !== "object" || value === null) {
    return throwOptionsError("options-prototype");
  }
  let prototype: object | null;
  try {
    if (ArrayIsArray(value)) {
      return throwOptionsError("options-prototype");
    }
    prototype = ObjectGetPrototypeOf(value);
  } catch {
    return throwOptionsError("options-prototype");
  }
  if (prototype !== null && prototype !== ObjectPrototype) {
    return throwOptionsError("options-prototype");
  }
  return value;
}

function captureOption(
  options: object,
  key: "source" | "environmentName" | "environment" | "preparedContext",
): CapturedOption {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ObjectGetOwnPropertyDescriptor(options, key);
  } catch {
    return throwOptionsError("options-accessor");
  }
  if (descriptor === undefined) {
    return ObjectFreeze({ present: false, value: undefined });
  }
  if (descriptor.enumerable !== true || !hasOwn(descriptor, "value")) {
    return throwOptionsError("options-accessor");
  }
  return ObjectFreeze({ present: true, value: descriptor.value });
}

function captureEvaluationOptions(
  value: unknown,
): CapturedEvaluationOptions {
  const options = requireOptionsRecord(value);
  return ObjectFreeze({
    source: captureOption(options, "source"),
    environmentName: captureOption(options, "environmentName"),
    environment: captureOption(options, "environment"),
    preparedContext: captureOption(options, "preparedContext"),
  });
}

/**
 * Validate and detach environment input once for safe reuse across evaluations.
 *
 * The returned token is valid only in this JavaScript isolate. Its HMAC
 * fingerprint covers the policy version, environment name, and canonical
 * environment snapshot, but deliberately does not cover config source.
 */
export async function prepareDeclarativeConfigContext(
  options: PrepareDeclarativeConfigContextOptions,
): Promise<PreparedDeclarativeConfigContext> {
  const capturedOptions = captureEvaluationOptions(options);
  const state = ObjectCreate(null) as PreparedContextState;
  defineDataProperty(
    state,
    "environmentName",
    validateEnvironmentName(capturedOptions.environmentName.value),
    true,
    false,
    false,
  );
  defineDataProperty(
    state,
    "tenantEnvironment",
    snapshotTenantEnvironment(capturedOptions.environment.value),
    true,
    false,
    false,
  );
  ObjectFreeze(state);
  const cacheFingerprint = await fingerprintPreparedContext(state);
  const token = ObjectCreate(null) as PreparedDeclarativeConfigContext;
  defineDataProperty(
    token,
    "cacheFingerprint",
    cacheFingerprint,
    true,
    false,
    false,
  );
  ObjectFreeze(token);
  setPreparedContextState(token, state);
  return token;
}

/**
 * Create the single DTO a trusted boundary should use for both cache identity
 * and worker evaluation. Keeping the values coupled avoids pairing a
 * fingerprint from one prepared snapshot with another snapshot's environment.
 *
 * @internal
 */
export function createPreparedDeclarativeConfigWorkerPayload(
  source: string,
  preparedContext: PreparedDeclarativeConfigContext,
): PreparedDeclarativeConfigWorkerPayload {
  if (typeof source !== "string") {
    throw new DeclarativeConfigEvaluationError({
      code: "input-invalid",
      phase: "input",
      reason: "source-bytes",
    });
  }
  if (countUtf8BytesBounded(source) > DECLARATIVE_CONFIG_LIMITS.maxSourceBytes) {
    throw new DeclarativeConfigEvaluationError({
      code: "source-too-large",
      phase: "input",
      reason: "source-bytes",
    });
  }

  const state = requirePreparedContextState(preparedContext);
  const fingerprintDescriptor = ObjectGetOwnPropertyDescriptor(
    preparedContext,
    "cacheFingerprint",
  );
  if (
    !fingerprintDescriptor ||
    !hasOwn(fingerprintDescriptor, "value") ||
    typeof fingerprintDescriptor.value !== "string"
  ) {
    throw new TypeError("Prepared context fingerprint invariant failed");
  }

  const evaluationOptions = ObjectCreate(
    null,
  ) as DirectDeclarativeConfigEvaluationOptions;
  defineDataProperty(
    evaluationOptions,
    "source",
    source,
    true,
    false,
    false,
  );
  defineDataProperty(
    evaluationOptions,
    "environmentName",
    state.environmentName,
    true,
    false,
    false,
  );
  defineDataProperty(
    evaluationOptions,
    "environment",
    state.tenantEnvironment,
    true,
    false,
    false,
  );
  ObjectFreeze(evaluationOptions);

  const payload = ObjectCreate(null) as PreparedDeclarativeConfigWorkerPayload;
  defineDataProperty(
    payload,
    "cacheFingerprint",
    fingerprintDescriptor.value,
    true,
    false,
    false,
  );
  defineDataProperty(
    payload,
    "policyVersion",
    POLICY_VERSION,
    true,
    false,
    false,
  );
  defineDataProperty(
    payload,
    "evaluationOptions",
    evaluationOptions,
    true,
    false,
    false,
  );
  return ObjectFreeze(payload);
}

function createEnvironment(parent: LexicalEnvironment | null = null): LexicalEnvironment {
  return {
    bindings: ObjectCreate(null) as Record<string, Binding>,
    parent,
  };
}

function lookupBinding(
  environment: LexicalEnvironment,
  name: string,
): Binding | undefined {
  let current: LexicalEnvironment | null = environment;
  while (current !== null) {
    const descriptor = ObjectGetOwnPropertyDescriptor(current.bindings, name);
    if (descriptor && hasOwn(descriptor, "value")) {
      return descriptor.value as Binding;
    }
    current = current.parent;
  }
  return undefined;
}

function isForbiddenGlobal(name: string): boolean {
  switch (name) {
    case "Bun":
    case "Deno":
    case "Function":
    case "Infinity":
    case "NaN":
    case "Object":
    case "Proxy":
    case "Reflect":
    case "WebAssembly":
    case "WebSocket":
    case "Worker":
    case "document":
    case "eval":
    case "exports":
    case "fetch":
    case "global":
    case "globalThis":
    case "module":
    case "process":
    case "require":
    case "self":
    case "undefined":
    case "window":
      return true;
    default:
      return false;
  }
}

function declareBinding(
  context: EvaluationContext,
  environment: LexicalEnvironment,
  name: string,
  binding: Binding,
  node: ASTNode,
  count = true,
): void {
  if (isForbiddenGlobal(name)) {
    return throwEvaluationError(
      "forbidden-capability",
      "validate",
      "host-global",
      context,
      node,
    );
  }
  if (hasOwn(environment.bindings, name)) {
    return throwEvaluationError(
      "invalid-binding",
      "validate",
      "duplicate-binding",
      context,
      node,
    );
  }
  if (count) {
    context.bindingCount += 1;
    if (context.bindingCount > DECLARATIVE_CONFIG_LIMITS.maxBindings) {
      return throwEvaluationError(
        "resource-limit-exceeded",
        "validate",
        "binding-count",
        context,
        node,
      );
    }
  }
  defineDataProperty(
    environment.bindings,
    name,
    binding,
    true,
    false,
    false,
  );
}

function addEvaluationStep(
  context: EvaluationContext,
  node: ASTNode,
  count = 1,
): void {
  if (count > DECLARATIVE_CONFIG_LIMITS.maxEvaluationSteps - context.evaluationSteps) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "evaluate",
      "evaluation-steps",
      context,
      node,
    );
  }
  context.evaluationSteps += count;
}

function addSpreadOperation(context: EvaluationContext, node: ASTNode): void {
  context.spreadOperations += 1;
  if (context.spreadOperations > DECLARATIVE_CONFIG_LIMITS.maxSpreadOperations) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "validate",
      "spread-operations",
      context,
      node,
    );
  }
}

function addSpreadCopy(context: EvaluationContext, node: ASTNode): void {
  context.spreadCopies += 1;
  if (context.spreadCopies > DECLARATIVE_CONFIG_LIMITS.maxSpreadCopies) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "evaluate",
      "spread-copies",
      context,
      node,
    );
  }
  addEvaluationStep(context, node);
}

function chargeString(
  context: EvaluationContext,
  length: number,
  node: ASTNode,
): void {
  if (
    length >
      DECLARATIVE_CONFIG_LIMITS.maxIntermediateStringUnits -
        context.intermediateStringUnits
  ) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "evaluate",
      "intermediate-string",
      context,
      node,
    );
  }
  context.intermediateStringUnits += length;
}

function assertValidationDepth(
  context: EvaluationContext,
  node: ASTNode,
  depth: number,
): void {
  if (depth > DECLARATIVE_CONFIG_LIMITS.maxValidationDepth) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "validate",
      "evaluation-depth",
      context,
      node,
    );
  }
}

function assertEvaluationDepth(
  context: EvaluationContext,
  node: ASTNode,
  depth: number,
): void {
  if (depth > DECLARATIVE_CONFIG_LIMITS.maxEvaluationDepth) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "evaluate",
      "evaluation-depth",
      context,
      node,
    );
  }
}

function identifierName(
  node: ASTNode,
  context: EvaluationContext,
): string {
  if (node.type !== "Identifier" || typeof node.name !== "string") {
    return throwEvaluationError(
      "parser-contract-violation",
      "validate",
      "ast-shape",
      context,
      node,
    );
  }
  return node.name;
}

function helperFromImportedName(name: string): HelperName | null {
  switch (name) {
    case "defineConfig":
    case "defineConfigWithEnv":
    case "getEnv":
    case "mergeConfigs":
      return name;
    default:
      return null;
  }
}

function processImport(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  countBindings = true,
): void {
  if (
    !isAstNode(node.source) ||
    node.source.type !== "StringLiteral" ||
    node.source.value !== "veryfront" ||
    !ArrayIsArray(node.specifiers) ||
    (ArrayIsArray(node.attributes) && node.attributes.length !== 0) ||
    (ArrayIsArray(node.assertions) && node.assertions.length !== 0)
  ) {
    return throwEvaluationError(
      "unsupported-syntax",
      "validate",
      "unsupported-import",
      context,
      node,
    );
  }
  if (node.specifiers.length === 0) {
    return throwEvaluationError(
      "unsupported-syntax",
      "validate",
      "import-form",
      context,
      node,
    );
  }
  if (node.specifiers.length > DECLARATIVE_CONFIG_LIMITS.maxImportSpecifiers) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "validate",
      "arguments",
      context,
      node,
    );
  }

  const declarationTypeOnly = node.importKind === "type";
  for (let index = 0; index < node.specifiers.length; index += 1) {
    const specifier = requireAstNode(node.specifiers[index], context, node);
    if (specifier.type !== "ImportSpecifier") {
      return throwEvaluationError(
        "unsupported-syntax",
        "validate",
        "import-form",
        context,
        specifier,
      );
    }
    const typeOnly = declarationTypeOnly || specifier.importKind === "type";
    if (typeOnly) continue;

    const imported = requireAstNode(specifier.imported, context, specifier);
    const local = requireAstNode(specifier.local, context, specifier);
    const importedName = identifierName(imported, context);
    const localName = identifierName(local, context);
    const helper = helperFromImportedName(importedName);
    if (helper === null) {
      return throwEvaluationError(
        "unsupported-syntax",
        "validate",
        "unsupported-import",
        context,
        imported,
      );
    }
    declareBinding(
      context,
      environment,
      localName,
      ObjectFreeze({ kind: "helper", helper }),
      local,
      countBindings,
    );
  }
}

function isTypeOnlyDeclaration(node: ASTNode): boolean {
  return node.type === "TSInterfaceDeclaration" ||
    node.type === "TSTypeAliasDeclaration";
}

function expressionArray(
  node: ASTNode,
  field: "arguments" | "elements" | "expressions" | "properties",
  context: EvaluationContext,
): unknown[] {
  return requireNodeArray(node[field], context, node);
}

function validateIdentifierExpression(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
): void {
  const name = identifierName(node, context);
  const binding = lookupBinding(environment, name);
  if (!binding) {
    return throwEvaluationError(
      isForbiddenGlobal(name) ? "forbidden-capability" : "invalid-binding",
      "validate",
      isForbiddenGlobal(name) ? "host-global" : "unbound-identifier",
      context,
      node,
    );
  }
  if (binding.kind === "helper") {
    return throwEvaluationError(
      "invalid-helper-usage",
      "validate",
      "helper-as-value",
      context,
      node,
    );
  }
}

function validateLiteral(node: ASTNode, context: EvaluationContext): void {
  switch (node.type) {
    case "StringLiteral":
      if (typeof node.value === "string") return;
      break;
    case "NumericLiteral":
      if (typeof node.value === "number") {
        if (!NumberIsFinite(node.value)) {
          return throwEvaluationError(
            "non-finite-number",
            "validate",
            "non-finite-result",
            context,
            node,
          );
        }
        return;
      }
      break;
    case "BooleanLiteral":
      if (typeof node.value === "boolean") return;
      break;
    case "NullLiteral":
      return;
  }
  return throwEvaluationError(
    "parser-contract-violation",
    "validate",
    "ast-shape",
    context,
    node,
  );
}

function staticObjectKey(
  property: ASTNode,
  context: EvaluationContext,
): string {
  const keyNode = requireAstNode(property.key, context, property);
  let key: string;
  if (keyNode.type === "Identifier") {
    key = identifierName(keyNode, context);
  } else if (keyNode.type === "StringLiteral" && typeof keyNode.value === "string") {
    key = keyNode.value;
  } else if (keyNode.type === "NumericLiteral" && typeof keyNode.value === "number") {
    if (!NumberIsFinite(keyNode.value)) {
      return throwEvaluationError(
        "non-finite-number",
        "validate",
        "non-finite-result",
        context,
        keyNode,
      );
    }
    key = `${keyNode.value}`;
  } else {
    return throwEvaluationError(
      "unsupported-syntax",
      "validate",
      "object-key",
      context,
      keyNode,
    );
  }

  if (
    key.length > DECLARATIVE_CONFIG_LIMITS.maxObjectKeyLength ||
    key === "__proto__" ||
    key === "constructor" ||
    key === "prototype"
  ) {
    return throwEvaluationError(
      key === "__proto__" || key === "constructor" || key === "prototype"
        ? "forbidden-capability"
        : "resource-limit-exceeded",
      "validate",
      key === "__proto__" || key === "constructor" || key === "prototype"
        ? "dangerous-key"
        : "object-key",
      context,
      keyNode,
    );
  }
  return key;
}

function validateObjectExpression(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): void {
  const properties = expressionArray(node, "properties", context);
  if (properties.length > DECLARATIVE_CONFIG_LIMITS.maxObjectProperties) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "validate",
      "object-properties",
      context,
      node,
    );
  }

  const explicitKeys = ObjectCreate(null) as Record<string, true>;
  for (let index = 0; index < properties.length; index += 1) {
    const property = requireAstNode(properties[index], context, node);
    if (property.type === "SpreadElement") {
      addSpreadOperation(context, property);
      validateExpression(
        requireAstNode(property.argument, context, property),
        context,
        environment,
        depth + 1,
      );
      continue;
    }
    if (
      property.type === "ObjectMethod" ||
      property.type === "ArrowFunctionExpression" ||
      property.type === "FunctionExpression"
    ) {
      return throwEvaluationError(
        "unsupported-hosted-feature",
        "validate",
        "function-value",
        context,
        property,
      );
    }
    if (
      property.type !== "ObjectProperty" ||
      property.computed === true ||
      property.method === true
    ) {
      return throwEvaluationError(
        "unsupported-syntax",
        "validate",
        "unsupported-expression",
        context,
        property,
      );
    }
    const key = staticObjectKey(property, context);
    if (hasOwn(explicitKeys, key)) {
      return throwEvaluationError(
        "invalid-result",
        "validate",
        "duplicate-key",
        context,
        property,
      );
    }
    defineDataProperty(explicitKeys, key, true, false, false, false);
    validateExpression(
      requireAstNode(property.value, context, property),
      context,
      environment,
      depth + 1,
    );
  }
}

function validateArrayExpression(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): void {
  const elements = expressionArray(node, "elements", context);
  if (elements.length > DECLARATIVE_CONFIG_LIMITS.maxArrayElements) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "validate",
      "array-elements",
      context,
      node,
    );
  }
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (element === null) {
      return throwEvaluationError(
        "unsupported-syntax",
        "validate",
        "array-elements",
        context,
        node,
      );
    }
    const elementNode = requireAstNode(element, context, node);
    if (elementNode.type === "SpreadElement") {
      addSpreadOperation(context, elementNode);
      validateExpression(
        requireAstNode(elementNode.argument, context, elementNode),
        context,
        environment,
        depth + 1,
      );
    } else {
      validateExpression(elementNode, context, environment, depth + 1);
    }
  }
}

function validateTemplateLiteral(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): void {
  const expressions = expressionArray(node, "expressions", context);
  const quasis = requireNodeArray(node.quasis, context, node);
  if (
    expressions.length > DECLARATIVE_CONFIG_LIMITS.maxTemplateExpressions ||
    quasis.length !== expressions.length + 1
  ) {
    return throwEvaluationError(
      expressions.length > DECLARATIVE_CONFIG_LIMITS.maxTemplateExpressions
        ? "resource-limit-exceeded"
        : "parser-contract-violation",
      "validate",
      expressions.length > DECLARATIVE_CONFIG_LIMITS.maxTemplateExpressions
        ? "template-expressions"
        : "ast-shape",
      context,
      node,
    );
  }
  for (let index = 0; index < quasis.length; index += 1) {
    const quasi = requireAstNode(quasis[index], context, node);
    const value = quasi.value;
    if (
      quasi.type !== "TemplateElement" ||
      typeof value !== "object" ||
      value === null ||
      typeof (value as Record<string, unknown>).cooked !== "string"
    ) {
      return throwEvaluationError(
        "unsupported-syntax",
        "validate",
        "unsupported-expression",
        context,
        quasi,
      );
    }
    if (index < expressions.length) {
      validateExpression(
        requireAstNode(expressions[index], context, node),
        context,
        environment,
        depth + 1,
      );
    }
  }
}

function validateEnvironmentFactory(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): void {
  assertValidationDepth(context, node, depth);
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSTypeAssertion"
  ) {
    return validateEnvironmentFactory(
      requireAstNode(node.expression, context, node),
      context,
      environment,
      depth + 1,
    );
  }
  if (
    node.type !== "ArrowFunctionExpression" ||
    node.async === true ||
    node.generator === true ||
    !ArrayIsArray(node.params) ||
    node.params.length !== 1 ||
    !isAstNode(node.params[0]) ||
    node.params[0].type !== "Identifier" ||
    !isAstNode(node.body) ||
    node.body.type === "BlockStatement"
  ) {
    return throwEvaluationError(
      "invalid-helper-usage",
      "validate",
      "helper-arguments",
      context,
      node,
    );
  }

  const child = createEnvironment(environment);
  const parameter = node.params[0];
  declareBinding(
    context,
    child,
    identifierName(parameter, context),
    ObjectFreeze({ kind: "value", value: context.environmentName }),
    parameter,
  );
  validateExpression(node.body, context, child, depth + 1);
}

function resolveCalledHelper(
  call: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
): HelperName {
  const callee = requireAstNode(call.callee, context, call);
  if (callee.type !== "Identifier") {
    return throwEvaluationError(
      "forbidden-capability",
      "validate",
      "unsupported-call",
      context,
      callee,
    );
  }
  const name = identifierName(callee, context);
  const binding = lookupBinding(environment, name);
  if (!binding) {
    return throwEvaluationError(
      isForbiddenGlobal(name) ? "forbidden-capability" : "invalid-binding",
      "validate",
      isForbiddenGlobal(name) ? "host-global" : "unbound-identifier",
      context,
      callee,
    );
  }
  if (binding.kind !== "helper") {
    return throwEvaluationError(
      "forbidden-capability",
      "validate",
      "unsupported-call",
      context,
      callee,
    );
  }
  return binding.helper;
}

function validateCallExpression(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): void {
  if (node.optional === true) {
    return throwEvaluationError(
      "unsupported-syntax",
      "validate",
      "unsupported-call",
      context,
      node,
    );
  }
  const args = expressionArray(node, "arguments", context);
  if (args.length > DECLARATIVE_CONFIG_LIMITS.maxArguments) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "validate",
      "arguments",
      context,
      node,
    );
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (isAstNode(argument) && argument.type === "SpreadElement") {
      return throwEvaluationError(
        "invalid-helper-usage",
        "validate",
        "helper-arguments",
        context,
        argument,
      );
    }
  }

  const helper = resolveCalledHelper(node, context, environment);
  switch (helper) {
    case "defineConfig":
      if (args.length !== 1) {
        return throwEvaluationError(
          "invalid-helper-usage",
          "validate",
          "helper-arguments",
          context,
          node,
        );
      }
      validateExpression(
        requireAstNode(args[0], context, node),
        context,
        environment,
        depth + 1,
      );
      return;
    case "getEnv": {
      if (args.length !== 1) {
        return throwEvaluationError(
          "invalid-helper-usage",
          "validate",
          "helper-arguments",
          context,
          node,
        );
      }
      const argument = requireAstNode(args[0], context, node);
      if (
        argument.type !== "StringLiteral" ||
        typeof argument.value !== "string" ||
        argument.value.length > DECLARATIVE_CONFIG_LIMITS.maxEnvironmentKeyLength ||
        !isEnvironmentKey(argument.value)
      ) {
        return throwEvaluationError(
          "invalid-helper-usage",
          "validate",
          "helper-arguments",
          context,
          argument,
        );
      }
      return;
    }
    case "mergeConfigs":
      for (let index = 0; index < args.length; index += 1) {
        validateExpression(
          requireAstNode(args[index], context, node),
          context,
          environment,
          depth + 1,
        );
      }
      return;
    case "defineConfigWithEnv":
      if (args.length !== 1) {
        return throwEvaluationError(
          "invalid-helper-usage",
          "validate",
          "helper-arguments",
          context,
          node,
        );
      }
      validateEnvironmentFactory(
        requireAstNode(args[0], context, node),
        context,
        environment,
        depth + 1,
      );
  }
}

function validateExpression(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): void {
  assertValidationDepth(context, node, depth);
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
      return validateLiteral(node, context);
    case "Identifier":
      return validateIdentifierExpression(node, context, environment);
    case "ObjectExpression":
      return validateObjectExpression(node, context, environment, depth);
    case "ArrayExpression":
      return validateArrayExpression(node, context, environment, depth);
    case "TemplateLiteral":
      return validateTemplateLiteral(node, context, environment, depth);
    case "CallExpression":
      return validateCallExpression(node, context, environment, depth);
    case "LogicalExpression": {
      if (node.operator !== "&&" && node.operator !== "||" && node.operator !== "??") {
        break;
      }
      validateExpression(
        requireAstNode(node.left, context, node),
        context,
        environment,
        depth + 1,
      );
      validateExpression(
        requireAstNode(node.right, context, node),
        context,
        environment,
        depth + 1,
      );
      return;
    }
    case "BinaryExpression": {
      const allowed = node.operator === "===" ||
        node.operator === "!==" ||
        node.operator === "<" ||
        node.operator === "<=" ||
        node.operator === ">" ||
        node.operator === ">=" ||
        node.operator === "+" ||
        node.operator === "-" ||
        node.operator === "*" ||
        node.operator === "/" ||
        node.operator === "%";
      if (!allowed) break;
      validateExpression(
        requireAstNode(node.left, context, node),
        context,
        environment,
        depth + 1,
      );
      validateExpression(
        requireAstNode(node.right, context, node),
        context,
        environment,
        depth + 1,
      );
      return;
    }
    case "UnaryExpression":
      if (node.operator !== "!" && node.operator !== "+" && node.operator !== "-") break;
      validateExpression(
        requireAstNode(node.argument, context, node),
        context,
        environment,
        depth + 1,
      );
      return;
    case "ConditionalExpression":
      validateExpression(
        requireAstNode(node.test, context, node),
        context,
        environment,
        depth + 1,
      );
      validateExpression(
        requireAstNode(node.consequent, context, node),
        context,
        environment,
        depth + 1,
      );
      validateExpression(
        requireAstNode(node.alternate, context, node),
        context,
        environment,
        depth + 1,
      );
      return;
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
      return validateExpression(
        requireAstNode(node.expression, context, node),
        context,
        environment,
        depth + 1,
      );
    case "ArrowFunctionExpression":
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ObjectMethod":
      return throwEvaluationError(
        "unsupported-hosted-feature",
        "validate",
        "function-value",
        context,
        node,
      );
  }

  return throwEvaluationError(
    node.type === "NewExpression" ||
      node.type === "MemberExpression" ||
      node.type === "OptionalCallExpression" ||
      node.type === "OptionalMemberExpression"
      ? "forbidden-capability"
      : "unsupported-syntax",
    "validate",
    node.type === "NewExpression" ||
      node.type === "MemberExpression" ||
      node.type === "OptionalCallExpression" ||
      node.type === "OptionalMemberExpression"
      ? "unsupported-call"
      : "unsupported-expression",
    context,
    node,
  );
}

function isRuntimeRecord(value: RuntimeValue): value is RuntimeRecord {
  return typeof value === "object" &&
    value !== null &&
    !ArrayIsArray(value) &&
    ObjectGetPrototypeOf(value) === null;
}

function runtimeRecordKeys(
  value: RuntimeRecord,
  context: EvaluationContext,
  node: ASTNode,
): string[] {
  const keys = ReflectOwnKeys(value);
  const output = new IntrinsicArray<string>();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== "string") {
      return throwEvaluationError(
        "invalid-result",
        "evaluate",
        "result-not-snapshot-safe",
        context,
        node,
      );
    }
    pushValue(output, key);
  }
  return output;
}

function runtimeRecordValue(
  value: RuntimeRecord,
  key: string,
): RuntimeValue {
  const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
  if (!descriptor || !hasOwn(descriptor, "value")) {
    throw new TypeError("Runtime record invariant failed");
  }
  return descriptor.value as RuntimeValue;
}

/**
 * Primordial-hardened parity with isBoundedCorsOrigin in
 * utils/cors-policy-limits.ts. Calling the shared helper directly would
 * reintroduce mutable String/Array prototype dispatch at this trust boundary.
 */
function isHostedCorsOrigin(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > MAX_CORS_ORIGIN_LENGTH ||
    (ReflectApply(StringPrototypeTrim, value, []) as string) !== value
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
    if (code <= 0x1f || code === 0x7f || code > 0xff) return false;
  }
  return true;
}

function isHostedCorsOriginList(value: readonly RuntimeValue[]): boolean {
  if (value.length === 0 || value.length > MAX_CORS_ORIGIN_COUNT) return false;
  let serializedLength = (value.length - 1) * 2;
  for (let index = 0; index < value.length; index += 1) {
    const origin = value[index];
    if (typeof origin !== "string" || !isHostedCorsOrigin(origin)) return false;
    serializedLength += origin.length;
    if (serializedLength > MAX_CORS_ORIGIN_LIST_LENGTH) return false;
  }
  return true;
}

function isHostedExtensionDisableDirective(value: RuntimeValue): boolean {
  if (!isRuntimeRecord(value)) return false;
  const keys = ReflectOwnKeys(value);
  if (
    keys.length !== 2 ||
    !hasOwn(value, "name") ||
    !hasOwn(value, "enabled")
  ) {
    return false;
  }
  const name = runtimeRecordValue(value, "name");
  const enabled = runtimeRecordValue(value, "enabled");
  return typeof name === "string" &&
    isHostedExtensionName(name) &&
    enabled === false;
}

function isHostedExtensionName(name: string): boolean {
  if (
    name.length === 0 ||
    name.length > MAX_HOSTED_EXTENSION_NAME_LENGTH ||
    (ReflectApply(StringPrototypeTrim, name, []) as string) !== name
  ) {
    return false;
  }
  for (let index = 0; index < name.length; index += 1) {
    const code = ReflectApply(StringPrototypeCharCodeAt, name, [index]) as number;
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

function enforceHostedResultPolicy(
  result: RuntimeRecord,
  context: EvaluationContext,
  program: ASTNode,
): void {
  if (hasOwn(result, "extensions")) {
    const extensions = runtimeRecordValue(result, "extensions");
    if (!ArrayIsArray(extensions)) {
      return throwEvaluationError(
        "unsupported-hosted-feature",
        "result",
        "hosted-extensions",
        context,
        program,
      );
    }
    for (let index = 0; index < extensions.length; index += 1) {
      if (!isHostedExtensionDisableDirective(extensions[index])) {
        return throwEvaluationError(
          "unsupported-hosted-feature",
          "result",
          "hosted-extensions",
          context,
          program,
        );
      }
    }
  }

  if (hasOwn(result, "middleware")) {
    const middleware = runtimeRecordValue(result, "middleware");
    if (isRuntimeRecord(middleware) && hasOwn(middleware, "custom")) {
      const custom = runtimeRecordValue(middleware, "custom");
      if (!ArrayIsArray(custom) || custom.length !== 0) {
        return throwEvaluationError(
          "unsupported-hosted-feature",
          "result",
          "hosted-custom-middleware",
          context,
          program,
        );
      }
    }
  }

  if (!hasOwn(result, "security")) return;
  const security = runtimeRecordValue(result, "security");
  if (!isRuntimeRecord(security) || !hasOwn(security, "cors")) return;
  const cors = runtimeRecordValue(security, "cors");
  if (!isRuntimeRecord(cors) || !hasOwn(cors, "origin")) return;
  const origin = runtimeRecordValue(cors, "origin");
  if (
    (typeof origin === "string" && isHostedCorsOrigin(origin)) ||
    (ArrayIsArray(origin) && isHostedCorsOriginList(origin))
  ) {
    return;
  }
  return throwEvaluationError(
    "unsupported-hosted-feature",
    "result",
    "hosted-cors-origin",
    context,
    program,
  );
}

function defineRuntimeProperty(
  target: Record<string, RuntimeValue>,
  key: string,
  value: RuntimeValue,
  context: EvaluationContext,
  node: ASTNode,
  currentCount: number,
): number {
  const exists = hasOwn(target, key);
  if (!exists && currentCount >= DECLARATIVE_CONFIG_LIMITS.maxObjectProperties) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "evaluate",
      "object-properties",
      context,
      node,
    );
  }
  defineDataProperty(target, key, value, true, false, true);
  return exists ? currentCount : currentCount + 1;
}

function copyRuntimeRecord(
  target: Record<string, RuntimeValue>,
  source: RuntimeRecord,
  context: EvaluationContext,
  node: ASTNode,
  currentCount: number,
): number {
  const keys = runtimeRecordKeys(source, context, node);
  let count = currentCount;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = ObjectGetOwnPropertyDescriptor(source, key);
    if (!descriptor || !hasOwn(descriptor, "value")) {
      return throwEvaluationError(
        "invalid-result",
        "evaluate",
        "result-not-snapshot-safe",
        context,
        node,
      );
    }
    addSpreadCopy(context, node);
    count = defineRuntimeProperty(
      target,
      key,
      descriptor.value as RuntimeValue,
      context,
      node,
      count,
    );
  }
  return count;
}

function evaluateObjectExpression(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): RuntimeRecord {
  const properties = node.properties as unknown[];
  const output = ObjectCreate(null) as Record<string, RuntimeValue>;
  let keyCount = 0;
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index] as ASTNode;
    if (property.type === "SpreadElement") {
      const spread = evaluateExpression(
        property.argument as ASTNode,
        context,
        environment,
        depth + 1,
      );
      if (!isRuntimeRecord(spread)) {
        return throwEvaluationError(
          "evaluation-type-error",
          "evaluate",
          "operand-type",
          context,
          property,
        );
      }
      keyCount = copyRuntimeRecord(output, spread, context, property, keyCount);
      continue;
    }

    const key = staticObjectKey(property, context);
    const value = evaluateExpression(
      property.value as ASTNode,
      context,
      environment,
      depth + 1,
    );
    addEvaluationStep(context, property);
    keyCount = defineRuntimeProperty(
      output,
      key,
      value,
      context,
      property,
      keyCount,
    );
  }
  return ObjectFreeze(output);
}

function appendArrayValue(
  output: RuntimeValue[],
  value: RuntimeValue,
  context: EvaluationContext,
  node: ASTNode,
): void {
  if (output.length >= DECLARATIVE_CONFIG_LIMITS.maxArrayElements) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "evaluate",
      "array-elements",
      context,
      node,
    );
  }
  pushValue(output, value);
}

function evaluateArrayExpression(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): readonly RuntimeValue[] {
  const elements = node.elements as unknown[];
  const output = new IntrinsicArray<RuntimeValue>();
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index] as ASTNode;
    if (element.type === "SpreadElement") {
      const spread = evaluateExpression(
        element.argument as ASTNode,
        context,
        environment,
        depth + 1,
      );
      if (!ArrayIsArray(spread)) {
        return throwEvaluationError(
          "evaluation-type-error",
          "evaluate",
          "operand-type",
          context,
          element,
        );
      }
      for (let spreadIndex = 0; spreadIndex < spread.length; spreadIndex += 1) {
        addSpreadCopy(context, element);
        appendArrayValue(output, spread[spreadIndex], context, element);
      }
    } else {
      appendArrayValue(
        output,
        evaluateExpression(element, context, environment, depth + 1),
        context,
        element,
      );
    }
  }
  return ObjectFreeze(output);
}

function primitiveTemplateString(
  value: RuntimeValue,
  context: EvaluationContext,
  node: ASTNode,
): string {
  switch (typeof value) {
    case "string":
      return value;
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return `${value}`;
    case "undefined":
      return throwEvaluationError(
        "invalid-result",
        "evaluate",
        "result-not-snapshot-safe",
        context,
        node,
      );
    case "object":
      if (value === null) return "null";
      break;
  }
  return throwEvaluationError(
    "evaluation-type-error",
    "evaluate",
    "operand-type",
    context,
    node,
  );
}

function appendBoundedString(
  current: string,
  addition: string,
  context: EvaluationContext,
  node: ASTNode,
): string {
  if (addition.length > CONFIG_SNAPSHOT_LIMITS.maxStringLength - current.length) {
    return throwEvaluationError(
      "invalid-result",
      "evaluate",
      "result-not-snapshot-safe",
      context,
      node,
    );
  }
  const next = `${current}${addition}`;
  chargeString(context, next.length, node);
  return next;
}

function evaluateTemplateLiteral(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): string {
  const expressions = node.expressions as ASTNode[];
  const quasis = node.quasis as ASTNode[];
  let output = "";
  for (let index = 0; index < quasis.length; index += 1) {
    const cooked = (quasis[index]!.value as Record<string, unknown>).cooked as string;
    output = appendBoundedString(output, cooked, context, quasis[index]!);
    if (index < expressions.length) {
      const value = evaluateExpression(
        expressions[index]!,
        context,
        environment,
        depth + 1,
      );
      output = appendBoundedString(
        output,
        primitiveTemplateString(value, context, expressions[index]!),
        context,
        expressions[index]!,
      );
    }
  }
  return output;
}

function runtimeTruthy(value: RuntimeValue): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length !== 0;
  return true;
}

function requireNumber(
  value: RuntimeValue,
  context: EvaluationContext,
  node: ASTNode,
): number {
  if (typeof value !== "number") {
    return throwEvaluationError(
      "evaluation-type-error",
      "evaluate",
      "operand-type",
      context,
      node,
    );
  }
  return value;
}

function finiteResult(
  value: number,
  context: EvaluationContext,
  node: ASTNode,
): number {
  if (!NumberIsFinite(value)) {
    return throwEvaluationError(
      "non-finite-number",
      "evaluate",
      "non-finite-result",
      context,
      node,
    );
  }
  return value;
}

function isComparisonPrimitive(
  value: RuntimeValue,
): value is RuntimePrimitive {
  return value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string";
}

function evaluateBinaryExpression(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): RuntimeValue {
  const left = evaluateExpression(
    node.left as ASTNode,
    context,
    environment,
    depth + 1,
  );
  const right = evaluateExpression(
    node.right as ASTNode,
    context,
    environment,
    depth + 1,
  );
  const operator = node.operator;

  if (operator === "===" || operator === "!==") {
    if (!isComparisonPrimitive(left) || !isComparisonPrimitive(right)) {
      return throwEvaluationError(
        "evaluation-type-error",
        "evaluate",
        "operand-type",
        context,
        node,
      );
    }
    const equal = left === right;
    return operator === "===" ? equal : !equal;
  }
  if (
    operator === "<" ||
    operator === "<=" ||
    operator === ">" ||
    operator === ">="
  ) {
    if (
      (typeof left !== "number" || typeof right !== "number") &&
      (typeof left !== "string" || typeof right !== "string")
    ) {
      return throwEvaluationError(
        "evaluation-type-error",
        "evaluate",
        "operand-type",
        context,
        node,
      );
    }
    if (operator === "<") return left < right;
    if (operator === "<=") return left <= right;
    if (operator === ">") return left > right;
    return left >= right;
  }

  if (operator === "+") {
    if (typeof left === "string" && typeof right === "string") {
      return appendBoundedString(left, right, context, node);
    }
    if (typeof left === "string" || typeof right === "string") {
      return throwEvaluationError(
        "evaluation-type-error",
        "evaluate",
        "operand-type",
        context,
        node,
      );
    }
  }

  const leftNumber = requireNumber(left, context, node);
  const rightNumber = requireNumber(right, context, node);
  switch (operator) {
    case "+":
      return finiteResult(leftNumber + rightNumber, context, node);
    case "-":
      return finiteResult(leftNumber - rightNumber, context, node);
    case "*":
      return finiteResult(leftNumber * rightNumber, context, node);
    case "/":
      return finiteResult(leftNumber / rightNumber, context, node);
    case "%":
      return finiteResult(leftNumber % rightNumber, context, node);
  }
  return throwEvaluationError(
    "unsupported-syntax",
    "evaluate",
    "unsupported-expression",
    context,
    node,
  );
}

function evaluateLogicalExpression(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): RuntimeValue {
  const left = evaluateExpression(
    node.left as ASTNode,
    context,
    environment,
    depth + 1,
  );
  if (node.operator === "&&") {
    return runtimeTruthy(left)
      ? evaluateExpression(node.right as ASTNode, context, environment, depth + 1)
      : left;
  }
  if (node.operator === "||") {
    return runtimeTruthy(left)
      ? left
      : evaluateExpression(node.right as ASTNode, context, environment, depth + 1);
  }
  return left !== null && left !== undefined
    ? left
    : evaluateExpression(node.right as ASTNode, context, environment, depth + 1);
}

function evaluateEnvironmentFactory(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): RuntimeRecord {
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSTypeAssertion"
  ) {
    return evaluateEnvironmentFactory(
      node.expression as ASTNode,
      context,
      environment,
      depth + 1,
    );
  }

  const parameter = (node.params as ASTNode[])[0]!;
  const child = createEnvironment(environment);
  declareBinding(
    context,
    child,
    parameter.name as string,
    ObjectFreeze({ kind: "value", value: context.environmentName }),
    parameter,
    false,
  );
  const value = evaluateExpression(
    node.body as ASTNode,
    context,
    child,
    depth + 1,
  );
  if (!isRuntimeRecord(value)) {
    return throwEvaluationError(
      "invalid-helper-usage",
      "evaluate",
      "helper-arguments",
      context,
      node,
    );
  }
  return value;
}

function evaluateCallExpression(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): RuntimeValue {
  const helper = resolveCalledHelper(node, context, environment);
  const args = node.arguments as ASTNode[];
  if (helper === "defineConfigWithEnv") {
    return evaluateEnvironmentFactory(args[0]!, context, environment, depth + 1);
  }

  const values = new IntrinsicArray<RuntimeValue>();
  for (let index = 0; index < args.length; index += 1) {
    pushValue(
      values,
      evaluateExpression(args[index]!, context, environment, depth + 1),
    );
  }

  switch (helper) {
    case "defineConfig": {
      const value = values[0];
      if (!isRuntimeRecord(value)) {
        return throwEvaluationError(
          "invalid-helper-usage",
          "evaluate",
          "helper-arguments",
          context,
          node,
        );
      }
      return value;
    }
    case "getEnv": {
      const key = values[0];
      if (
        typeof key !== "string" ||
        key.length > DECLARATIVE_CONFIG_LIMITS.maxEnvironmentKeyLength ||
        !isEnvironmentKey(key)
      ) {
        return throwEvaluationError(
          "invalid-helper-usage",
          "evaluate",
          "helper-arguments",
          context,
          node,
        );
      }
      const descriptor = ObjectGetOwnPropertyDescriptor(context.tenantEnvironment, key);
      if (!descriptor || !hasOwn(descriptor, "value")) return undefined;
      chargeString(context, (descriptor.value as string).length, node);
      return descriptor.value as string;
    }
    case "mergeConfigs": {
      const output = ObjectCreate(null) as Record<string, RuntimeValue>;
      let keyCount = 0;
      for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!isRuntimeRecord(value)) {
          return throwEvaluationError(
            "invalid-helper-usage",
            "evaluate",
            "helper-arguments",
            context,
            node,
          );
        }
        keyCount = copyRuntimeRecord(output, value, context, node, keyCount);
      }
      return ObjectFreeze(output);
    }
  }
  return throwEvaluationError(
    "invalid-helper-usage",
    "evaluate",
    "helper-arguments",
    context,
    node,
  );
}

function evaluateExpression(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
  depth: number,
): RuntimeValue {
  assertEvaluationDepth(context, node, depth);
  addEvaluationStep(context, node);
  switch (node.type) {
    case "StringLiteral":
      chargeString(context, (node.value as string).length, node);
      return node.value as string;
    case "NumericLiteral":
    case "BooleanLiteral":
      return node.value as number | boolean;
    case "NullLiteral":
      return null;
    case "Identifier": {
      const binding = lookupBinding(environment, node.name as string);
      if (!binding || binding.kind !== "value") {
        return throwEvaluationError(
          "invalid-binding",
          "evaluate",
          "unbound-identifier",
          context,
          node,
        );
      }
      return binding.value;
    }
    case "ObjectExpression":
      return evaluateObjectExpression(node, context, environment, depth);
    case "ArrayExpression":
      return evaluateArrayExpression(node, context, environment, depth);
    case "TemplateLiteral":
      return evaluateTemplateLiteral(node, context, environment, depth);
    case "CallExpression":
      return evaluateCallExpression(node, context, environment, depth);
    case "LogicalExpression":
      return evaluateLogicalExpression(node, context, environment, depth);
    case "BinaryExpression":
      return evaluateBinaryExpression(node, context, environment, depth);
    case "UnaryExpression": {
      const value = evaluateExpression(
        node.argument as ASTNode,
        context,
        environment,
        depth + 1,
      );
      if (node.operator === "!") return !runtimeTruthy(value);
      const numeric = requireNumber(value, context, node);
      return node.operator === "+"
        ? finiteResult(numeric, context, node)
        : finiteResult(-numeric, context, node);
    }
    case "ConditionalExpression":
      return runtimeTruthy(
          evaluateExpression(
            node.test as ASTNode,
            context,
            environment,
            depth + 1,
          ),
        )
        ? evaluateExpression(
          node.consequent as ASTNode,
          context,
          environment,
          depth + 1,
        )
        : evaluateExpression(
          node.alternate as ASTNode,
          context,
          environment,
          depth + 1,
        );
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
      return evaluateExpression(
        node.expression as ASTNode,
        context,
        environment,
        depth + 1,
      );
  }
  return throwEvaluationError(
    "unsupported-syntax",
    "evaluate",
    "unsupported-expression",
    context,
    node,
  );
}

function validateVariableDeclaration(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
): void {
  if (
    node.kind !== "const" ||
    node.declare === true ||
    !ArrayIsArray(node.declarations)
  ) {
    return throwEvaluationError(
      "unsupported-syntax",
      "validate",
      "unsupported-statement",
      context,
      node,
    );
  }
  for (let index = 0; index < node.declarations.length; index += 1) {
    const declarator = requireAstNode(node.declarations[index], context, node);
    const id = requireAstNode(declarator.id, context, declarator);
    const init = requireAstNode(declarator.init, context, declarator);
    if (declarator.type !== "VariableDeclarator" || id.type !== "Identifier") {
      return throwEvaluationError(
        "invalid-binding",
        "validate",
        "unbound-identifier",
        context,
        declarator,
      );
    }
    validateExpression(init, context, environment, 0);
    declareBinding(
      context,
      environment,
      identifierName(id, context),
      ObjectFreeze({ kind: "value", value: undefined }),
      id,
    );
  }
}

function evaluateVariableDeclaration(
  node: ASTNode,
  context: EvaluationContext,
  environment: LexicalEnvironment,
): void {
  const declarations = node.declarations as ASTNode[];
  for (let index = 0; index < declarations.length; index += 1) {
    const declarator = declarations[index]!;
    const id = declarator.id as ASTNode;
    const init = declarator.init as ASTNode;
    const value = evaluateExpression(init, context, environment, 0);
    declareBinding(
      context,
      environment,
      identifierName(id, context),
      ObjectFreeze({ kind: "value", value }),
      id,
      false,
    );
  }
}

function processProgram(
  program: ASTNode,
  context: EvaluationContext,
): RuntimeValue {
  const body = program.body as unknown[];
  if (body.length > DECLARATIVE_CONFIG_LIMITS.maxTopLevelStatements) {
    return throwEvaluationError(
      "resource-limit-exceeded",
      "validate",
      "statement-count",
      context,
      program,
    );
  }

  const validationEnvironment = createEnvironment();
  let importCount = 0;
  let defaultCount = 0;

  for (let index = 0; index < body.length; index += 1) {
    const statement = requireAstNode(body[index], context, program);
    if (statement.type === "ImportDeclaration") {
      importCount += 1;
      if (importCount > DECLARATIVE_CONFIG_LIMITS.maxImports) {
        return throwEvaluationError(
          "resource-limit-exceeded",
          "validate",
          "unsupported-import",
          context,
          statement,
        );
      }
      processImport(statement, context, validationEnvironment);
    }
    if (statement.type === "ExportDefaultDeclaration") defaultCount += 1;
    if (statement.type === "ExportNamedDeclaration" || statement.type === "ExportAllDeclaration") {
      return throwEvaluationError(
        "unsupported-syntax",
        "validate",
        "unsupported-export",
        context,
        statement,
      );
    }
  }

  if (defaultCount === 0) {
    return throwEvaluationError(
      "invalid-result",
      "validate",
      "missing-default-export",
      context,
      program,
    );
  }
  if (defaultCount > 1) {
    return throwEvaluationError(
      "invalid-result",
      "validate",
      "duplicate-default-export",
      context,
      program,
    );
  }

  for (let index = 0; index < body.length; index += 1) {
    const statement = body[index] as ASTNode;
    if (statement.type === "ImportDeclaration" || isTypeOnlyDeclaration(statement)) {
      continue;
    }
    if (statement.type === "VariableDeclaration") {
      validateVariableDeclaration(statement, context, validationEnvironment);
      continue;
    }
    if (statement.type === "ExportDefaultDeclaration") {
      validateExpression(
        requireAstNode(statement.declaration, context, statement),
        context,
        validationEnvironment,
        0,
      );
      continue;
    }
    return throwEvaluationError(
      "unsupported-syntax",
      "validate",
      "unsupported-statement",
      context,
      statement,
    );
  }

  const evaluationEnvironment = createEnvironment();
  for (let index = 0; index < body.length; index += 1) {
    const statement = body[index] as ASTNode;
    if (statement.type === "ImportDeclaration") {
      processImport(statement, context, evaluationEnvironment, false);
    }
  }

  let result: RuntimeValue;
  let hasResult = false;
  for (let index = 0; index < body.length; index += 1) {
    const statement = body[index] as ASTNode;
    if (statement.type === "ImportDeclaration" || isTypeOnlyDeclaration(statement)) {
      continue;
    }
    if (statement.type === "VariableDeclaration") {
      evaluateVariableDeclaration(statement, context, evaluationEnvironment);
      continue;
    }
    if (statement.type === "ExportDefaultDeclaration") {
      const declaration = requireAstNode(statement.declaration, context, statement);
      result = evaluateExpression(declaration, context, evaluationEnvironment, 0);
      hasResult = true;
      continue;
    }
  }

  if (!hasResult) {
    return throwEvaluationError(
      "invalid-result",
      "validate",
      "missing-default-export",
      context,
      program,
    );
  }
  return result!;
}

function resolveEvaluationState(
  options: CapturedEvaluationOptions,
): PreparedContextState {
  if (options.preparedContext.present) {
    if (options.environment.present || options.environmentName.present) {
      throw new DeclarativeConfigEvaluationError({
        code: "input-invalid",
        phase: "input",
        reason: "prepared-context",
      });
    }
    const state = getPreparedContextState(options.preparedContext.value);
    if (!state) {
      throw new DeclarativeConfigEvaluationError({
        code: "input-invalid",
        phase: "input",
        reason: "prepared-context",
      });
    }
    return state;
  }

  const state = ObjectCreate(null) as PreparedContextState;
  defineDataProperty(
    state,
    "environmentName",
    validateEnvironmentName(options.environmentName.value),
    true,
    false,
    false,
  );
  defineDataProperty(
    state,
    "tenantEnvironment",
    snapshotTenantEnvironment(options.environment.value),
    true,
    false,
    false,
  );
  return ObjectFreeze(state);
}

interface CapturedEvaluationInput {
  readonly source: string;
  readonly preparedState: PreparedContextState;
}

function captureEvaluationInput(
  options: DeclarativeConfigEvaluationOptions,
): CapturedEvaluationInput {
  const capturedOptions = captureEvaluationOptions(options);
  if (typeof capturedOptions.source.value !== "string") {
    throw new DeclarativeConfigEvaluationError({
      code: "input-invalid",
      phase: "input",
      reason: "source-bytes",
    });
  }
  const source = capturedOptions.source.value;
  if (countUtf8BytesBounded(source) > DECLARATIVE_CONFIG_LIMITS.maxSourceBytes) {
    throw new DeclarativeConfigEvaluationError({
      code: "source-too-large",
      phase: "input",
      reason: "source-bytes",
    });
  }
  const preparedState = resolveEvaluationState(capturedOptions);
  return ObjectFreeze({ source, preparedState });
}

async function evaluateCapturedInput(
  input: CapturedEvaluationInput,
  parser: TrustedCodeParser,
): Promise<ConfigSnapshotRecord> {
  const { source, preparedState } = input;
  let parsedAst: unknown;
  try {
    parsedAst = await parser.parse({
      code: source,
      filePath: CONFIG_FILE_NAME,
    });
  } catch (error) {
    const reason = parserErrorReason(error);
    throw new DeclarativeConfigEvaluationError({
      code: reason === "duplicate-binding"
        ? "invalid-binding"
        : reason === "duplicate-default-export"
        ? "invalid-result"
        : "syntax-error",
      phase: reason === "duplicate-binding" ||
          reason === "duplicate-default-export"
        ? "validate"
        : "parse",
      reason,
      location: parseErrorLocation(source, error),
    });
  }

  if (!isAstNode(parsedAst)) {
    throw new DeclarativeConfigEvaluationError({
      code: "parser-contract-violation",
      phase: "validate",
      reason: "ast-shape",
    });
  }
  const ast = parsedAst;
  preflightAst(ast, source);
  const program = extractProgram(ast, source);
  const context: EvaluationContext = {
    source,
    tenantEnvironment: preparedState.tenantEnvironment,
    environmentName: preparedState.environmentName,
    bindingCount: 0,
    evaluationSteps: 0,
    spreadOperations: 0,
    spreadCopies: 0,
    intermediateStringUnits: 0,
  };
  const result = processProgram(program, context);
  if (!isRuntimeRecord(result)) {
    return throwEvaluationError(
      "invalid-result",
      "result",
      "result-not-record",
      context,
      program,
    );
  }
  enforceHostedResultPolicy(result, context, program);

  try {
    const snapshot: ConfigSnapshotValue = canonicalizeConfigSnapshot(result);
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      ArrayIsArray(snapshot)
    ) {
      return throwEvaluationError(
        "invalid-result",
        "result",
        "result-not-record",
        context,
        program,
      );
    }
    return snapshot as ConfigSnapshotRecord;
  } catch (error) {
    if (error instanceof DeclarativeConfigEvaluationError) throw error;
    if (error instanceof ConfigSnapshotError) {
      return throwEvaluationError(
        "invalid-result",
        "result",
        error.code === "dangerous-key" ? "dangerous-key" : "result-not-snapshot-safe",
        context,
        program,
      );
    }
    throw error;
  }
}

/**
 * Evaluate with a parser statically loaded in the initial module graph of a
 * worker created with no permissions.
 *
 * @internal The worker must statically import the trusted parser while being
 * created with `permissions: "none"`; this entry never falls back to dynamic
 * loading. Structured clone does not preserve frozen descriptors or null
 * prototypes, so a receiver must recanonicalize and deeply freeze the worker
 * result before exposing it as a trusted snapshot.
 */
export async function evaluateDeclarativeConfigWithParser(
  options: DeclarativeConfigEvaluationOptions,
  parser: unknown,
): Promise<ConfigSnapshotRecord> {
  const input = captureEvaluationInput(options);
  return await evaluateCapturedInput(input, captureTrustedParser(parser));
}

/**
 * Parse and evaluate hosted configuration source without executing it.
 *
 * The returned root is a detached, deeply frozen, null-prototype record.
 * Environment lookups never fall through to host process state.
 */
export async function evaluateDeclarativeConfig(
  options: DeclarativeConfigEvaluationOptions,
): Promise<ConfigSnapshotRecord> {
  const input = captureEvaluationInput(options);
  return await evaluateCapturedInput(input, await getTrustedParser());
}

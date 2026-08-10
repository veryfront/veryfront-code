/**
 * Plain-data protocol for the isolated declarative configuration evaluator.
 *
 * Neither side trusts structured clone to preserve prototypes, descriptors, or
 * frozen state. Every received envelope is inspected through own property
 * descriptors, rebuilt with a null prototype, and frozen before use.
 *
 * @module
 */

import {
  DECLARATIVE_CONFIG_FILE_NAME,
  DECLARATIVE_CONFIG_POLICY_VERSION,
  type DeclarativeConfigErrorCode,
  type DeclarativeConfigErrorPhase,
  type DeclarativeConfigErrorReason,
  DeclarativeConfigEvaluationError,
  type DeclarativeConfigFileName,
  type DeclarativeConfigSourceLocation,
  isDeclarativeConfigFileName,
  type PreparedDeclarativeConfigWorkerPayload,
} from "./declarative-evaluator.ts";
import { canonicalizeConfigSnapshot, type ConfigSnapshotRecord } from "./snapshot.ts";

const ArrayIsArray = Array.isArray;
const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;

const CACHE_FINGERPRINT_PREFIX = "ctx1:";
const CACHE_FINGERPRINT_DIGEST_LENGTH = 64;

/** Version of the worker request/response envelope contract. */
export const DECLARATIVE_CONFIG_WORKER_PROTOCOL_VERSION = 2;

/** The already-coupled cache identity and evaluator input sent to the worker. */
export type DeclarativeConfigWorkerRequest = PreparedDeclarativeConfigWorkerPayload;

/** Serializable fields retained from a typed evaluator failure. */
export interface DeclarativeConfigWorkerErrorDTO {
  readonly code: DeclarativeConfigErrorCode;
  readonly phase: DeclarativeConfigErrorPhase;
  readonly reason: DeclarativeConfigErrorReason;
  readonly location: DeclarativeConfigSourceLocation | null;
  readonly retryable: boolean;
}

/** Successful worker response. */
export interface DeclarativeConfigWorkerSuccessResponse {
  readonly ok: true;
  readonly snapshot: ConfigSnapshotRecord;
}

/** Failed worker response. */
export interface DeclarativeConfigWorkerErrorResponse {
  readonly ok: false;
  readonly error: DeclarativeConfigWorkerErrorDTO;
}

/** Exact one-shot response emitted by the evaluator worker. */
export type DeclarativeConfigWorkerResponse =
  | DeclarativeConfigWorkerSuccessResponse
  | DeclarativeConfigWorkerErrorResponse;

/** Infrastructure failures that can be created outside the evaluator. */
export type DeclarativeConfigWorkerInfrastructureReason =
  | "worker-aborted"
  | "worker-overloaded"
  | "worker-protocol"
  | "worker-memory-limit-unavailable"
  | "worker-timeout"
  | "worker-unavailable";

type CapturedRecord = Readonly<Record<string, unknown>>;

const ERROR_CODE_TABLE = ObjectFreeze(
  {
    "evaluation-type-error": true,
    "evaluator-unavailable": true,
    "forbidden-capability": true,
    "input-invalid": true,
    "invalid-binding": true,
    "invalid-helper-usage": true,
    "invalid-result": true,
    "non-finite-number": true,
    "parser-contract-violation": true,
    "parser-unavailable": true,
    "resource-limit-exceeded": true,
    "source-too-large": true,
    "syntax-error": true,
    "unsupported-hosted-feature": true,
    "unsupported-syntax": true,
  } as const satisfies Readonly<Record<DeclarativeConfigErrorCode, true>>,
);

const ERROR_PHASE_TABLE = ObjectFreeze(
  {
    input: true,
    parse: true,
    validate: true,
    evaluate: true,
    result: true,
    worker: true,
  } as const satisfies Readonly<Record<DeclarativeConfigErrorPhase, true>>,
);

const ERROR_REASON_TABLE = ObjectFreeze(
  {
    arguments: true,
    "array-elements": true,
    "ast-nodes": true,
    "ast-shape": true,
    "binding-count": true,
    "config-file-name": true,
    "crypto-unavailable": true,
    "dangerous-key": true,
    "duplicate-binding": true,
    "duplicate-default-export": true,
    "duplicate-key": true,
    "environment-accessor": true,
    "environment-bytes": true,
    "environment-entries": true,
    "environment-key": true,
    "environment-name": true,
    "environment-prototype": true,
    "environment-symbol": true,
    "environment-value": true,
    "evaluation-depth": true,
    "evaluation-steps": true,
    "function-value": true,
    "helper-arguments": true,
    "helper-as-value": true,
    "host-global": true,
    "hosted-bundle-manifest-backend": true,
    "hosted-cache-directory": true,
    "hosted-cache-option": true,
    "hosted-cors-origin": true,
    "hosted-custom-middleware": true,
    "hosted-extensions": true,
    "hosted-render-cache-backend": true,
    "hosted-render-cache-capacity": true,
    "import-form": true,
    "intermediate-string": true,
    "missing-default-export": true,
    "non-finite-result": true,
    "object-key": true,
    "object-properties": true,
    "operand-type": true,
    "options-accessor": true,
    "options-prototype": true,
    "parser-load": true,
    "parser-shape": true,
    "prepared-context": true,
    "result-not-record": true,
    "result-not-snapshot-safe": true,
    "source-bytes": true,
    "spread-copies": true,
    "spread-operations": true,
    "statement-count": true,
    "syntax-error": true,
    "template-expressions": true,
    "unbound-identifier": true,
    "unsupported-call": true,
    "unsupported-export": true,
    "unsupported-expression": true,
    "unsupported-import": true,
    "unsupported-statement": true,
    "worker-aborted": true,
    "worker-overloaded": true,
    "worker-protocol": true,
    "worker-memory-limit-unavailable": true,
    "worker-timeout": true,
    "worker-unavailable": true,
  } as const satisfies Readonly<Record<DeclarativeConfigErrorReason, true>>,
);

function hasOwn(value: object, key: PropertyKey): boolean {
  return ReflectApply(ObjectPrototypeHasOwnProperty, value, [key]) as boolean;
}

function defineDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  const descriptor = ObjectCreate(null) as PropertyDescriptor;
  descriptor.value = value;
  descriptor.enumerable = true;
  descriptor.configurable = false;
  descriptor.writable = false;
  ObjectDefineProperty(target, key, descriptor);
}

function protocolError(): DeclarativeConfigEvaluationError {
  return createDeclarativeConfigWorkerInfrastructureError("worker-protocol");
}

function failProtocol(): never {
  throw protocolError();
}

function inspectPrototype(value: object): object | null {
  try {
    return ObjectGetPrototypeOf(value);
  } catch {
    return failProtocol();
  }
}

function inspectIsArray(value: object): boolean {
  try {
    return ArrayIsArray(value);
  } catch {
    return failProtocol();
  }
}

function inspectOwnKeys(value: object): PropertyKey[] {
  try {
    return ReflectOwnKeys(value);
  } catch {
    return failProtocol();
  }
}

function inspectDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ObjectGetOwnPropertyDescriptor(value, key);
  } catch {
    return failProtocol();
  }
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !hasOwn(descriptor, "value")
  ) {
    return failProtocol();
  }
  return descriptor;
}

function isExpectedKey(
  key: string,
  expectedKeys: readonly string[],
): boolean {
  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (key === expectedKeys[index]) return true;
  }
  return false;
}

function captureExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): CapturedRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    inspectIsArray(value)
  ) {
    return failProtocol();
  }

  const prototype = inspectPrototype(value);
  if (prototype !== null && prototype !== ObjectPrototype) {
    return failProtocol();
  }

  const ownKeys = inspectOwnKeys(value);
  if (ownKeys.length !== expectedKeys.length) return failProtocol();

  const captured = ObjectCreate(null) as Record<string, unknown>;
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index];
    if (typeof key !== "string" || !isExpectedKey(key, expectedKeys)) {
      return failProtocol();
    }
    defineDataProperty(captured, key, inspectDescriptor(value, key).value);
  }
  return ObjectFreeze(captured);
}

function captureStringMap(value: unknown): Readonly<Record<string, string>> {
  if (
    typeof value !== "object" ||
    value === null ||
    inspectIsArray(value)
  ) {
    return failProtocol();
  }

  const prototype = inspectPrototype(value);
  if (prototype !== null && prototype !== ObjectPrototype) {
    return failProtocol();
  }

  const ownKeys = inspectOwnKeys(value);
  const captured = ObjectCreate(null) as Record<string, string>;
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = ownKeys[index];
    if (typeof key !== "string") return failProtocol();
    const entry = inspectDescriptor(value, key).value;
    if (typeof entry !== "string") return failProtocol();
    defineDataProperty(captured, key, entry);
  }
  return ObjectFreeze(captured);
}

function isKnownEnumValue(value: unknown, table: object): value is string {
  if (typeof value !== "string") return false;
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ObjectGetOwnPropertyDescriptor(table, value);
  } catch {
    return false;
  }
  return descriptor !== undefined &&
    hasOwn(descriptor, "value") &&
    descriptor.value === true;
}

function isErrorCode(value: unknown): value is DeclarativeConfigErrorCode {
  return isKnownEnumValue(value, ERROR_CODE_TABLE);
}

function isErrorPhase(value: unknown): value is DeclarativeConfigErrorPhase {
  return isKnownEnumValue(value, ERROR_PHASE_TABLE);
}

function isErrorReason(value: unknown): value is DeclarativeConfigErrorReason {
  return isKnownEnumValue(value, ERROR_REASON_TABLE);
}

function isWorkerReason(
  value: DeclarativeConfigErrorReason,
): value is DeclarativeConfigWorkerInfrastructureReason {
  return value === "worker-aborted" ||
    value === "worker-overloaded" ||
    value === "worker-protocol" ||
    value === "worker-memory-limit-unavailable" ||
    value === "worker-timeout" ||
    value === "worker-unavailable";
}

function isOneOf(
  value: DeclarativeConfigErrorReason,
  expected: readonly DeclarativeConfigErrorReason[],
): boolean {
  for (let index = 0; index < expected.length; index += 1) {
    if (value === expected[index]) return true;
  }
  return false;
}

/**
 * Preserve the evaluator error as a value object rather than trusting four
 * independently valid enum members to form a meaningful classification.
 */
function isLegalErrorTuple(
  code: DeclarativeConfigErrorCode,
  phase: DeclarativeConfigErrorPhase,
  reason: DeclarativeConfigErrorReason,
  retryable: boolean,
): boolean {
  if (code === "evaluator-unavailable") {
    if (phase === "input") {
      return reason === "crypto-unavailable" && retryable;
    }
    if (phase !== "worker" || !isWorkerReason(reason)) return false;
    return retryable === (
      reason === "worker-overloaded" ||
      reason === "worker-memory-limit-unavailable" ||
      reason === "worker-timeout" ||
      reason === "worker-unavailable"
    );
  }
  if (code === "parser-unavailable") {
    return phase === "parse" && reason === "parser-load" && retryable;
  }
  if (retryable || phase === "worker" || isWorkerReason(reason)) return false;

  switch (code) {
    case "evaluation-type-error":
      return phase === "evaluate" && reason === "operand-type";
    case "forbidden-capability":
      return phase === "validate" &&
        isOneOf(reason, [
          "dangerous-key",
          "host-global",
          "unsupported-call",
        ]);
    case "input-invalid":
      return phase === "input" &&
        isOneOf(reason, [
          "config-file-name",
          "environment-accessor",
          "environment-key",
          "environment-name",
          "environment-prototype",
          "environment-symbol",
          "environment-value",
          "options-accessor",
          "options-prototype",
          "prepared-context",
          "source-bytes",
        ]);
    case "invalid-binding":
      return (phase === "evaluate" && reason === "unbound-identifier") ||
        (phase === "validate" &&
          isOneOf(reason, ["duplicate-binding", "unbound-identifier"]));
    case "invalid-helper-usage":
      return (phase === "evaluate" && reason === "helper-arguments") ||
        (phase === "validate" &&
          isOneOf(reason, ["helper-arguments", "helper-as-value"]));
    case "invalid-result":
      return (phase === "evaluate" && reason === "result-not-snapshot-safe") ||
        (phase === "result" &&
          isOneOf(reason, [
            "dangerous-key",
            "result-not-record",
            "result-not-snapshot-safe",
          ])) ||
        (phase === "validate" &&
          isOneOf(reason, [
            "duplicate-default-export",
            "duplicate-key",
            "missing-default-export",
          ]));
    case "non-finite-number":
      return (phase === "evaluate" || phase === "validate") &&
        reason === "non-finite-result";
    case "parser-contract-violation":
      return (phase === "input" && reason === "parser-shape") ||
        (phase === "validate" && reason === "ast-shape");
    case "resource-limit-exceeded":
      return (phase === "input" &&
        isOneOf(reason, ["environment-bytes", "environment-entries"])) ||
        (phase === "evaluate" &&
          isOneOf(reason, [
            "array-elements",
            "evaluation-depth",
            "evaluation-steps",
            "intermediate-string",
            "object-properties",
            "spread-copies",
          ])) ||
        (phase === "validate" &&
          isOneOf(reason, [
            "arguments",
            "array-elements",
            "ast-nodes",
            "binding-count",
            "evaluation-depth",
            "object-key",
            "object-properties",
            "spread-operations",
            "statement-count",
            "template-expressions",
            "unsupported-import",
          ]));
    case "source-too-large":
      return phase === "input" && reason === "source-bytes";
    case "syntax-error":
      return phase === "parse" && reason === "syntax-error";
    case "unsupported-hosted-feature":
      return (phase === "validate" && reason === "function-value") ||
        (phase === "result" &&
          isOneOf(reason, [
            "hosted-bundle-manifest-backend",
            "hosted-cache-directory",
            "hosted-cache-option",
            "hosted-cors-origin",
            "hosted-custom-middleware",
            "hosted-extensions",
            "hosted-render-cache-backend",
            "hosted-render-cache-capacity",
          ]));
    case "unsupported-syntax":
      return (phase === "evaluate" && reason === "unsupported-expression") ||
        (phase === "validate" &&
          isOneOf(reason, [
            "array-elements",
            "import-form",
            "object-key",
            "unsupported-call",
            "unsupported-export",
            "unsupported-expression",
            "unsupported-import",
            "unsupported-statement",
          ]));
  }
  return false;
}

function isCacheFingerprint(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length !==
      CACHE_FINGERPRINT_PREFIX.length + CACHE_FINGERPRINT_DIGEST_LENGTH
  ) {
    return false;
  }

  for (let index = 0; index < CACHE_FINGERPRINT_PREFIX.length; index += 1) {
    if (
      (ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number) !==
        (ReflectApply(
          StringPrototypeCharCodeAt,
          CACHE_FINGERPRINT_PREFIX,
          [index],
        ) as number)
    ) {
      return false;
    }
  }

  for (
    let index = CACHE_FINGERPRINT_PREFIX.length;
    index < value.length;
    index += 1
  ) {
    const code = ReflectApply(
      StringPrototypeCharCodeAt,
      value,
      [index],
    ) as number;
    const isDigit = code >= 48 && code <= 57;
    const isLowerHex = code >= 97 && code <= 102;
    if (!isDigit && !isLowerHex) return false;
  }
  return true;
}

function captureLocation(
  value: unknown,
  maximumOffset = Number.MAX_SAFE_INTEGER,
  expectedFileName?: DeclarativeConfigFileName,
): DeclarativeConfigSourceLocation | null {
  if (value === null) return null;

  const captured = captureExactRecord(value, [
    "line",
    "column",
    "offset",
    "fileName",
  ]);
  const line = captured.line;
  const column = captured.column;
  const offset = captured.offset;
  if (
    !NumberIsSafeInteger(line) ||
    typeof line !== "number" ||
    line < 1 ||
    !NumberIsSafeInteger(column) ||
    typeof column !== "number" ||
    column < 0 ||
    !NumberIsSafeInteger(offset) ||
    typeof offset !== "number" ||
    offset < 0 ||
    offset > maximumOffset ||
    line > offset + 1 ||
    column > offset ||
    !isDeclarativeConfigFileName(captured.fileName) ||
    (expectedFileName !== undefined && captured.fileName !== expectedFileName)
  ) {
    return failProtocol();
  }

  const location = ObjectCreate(null) as {
    line: number;
    column: number;
    offset: number;
    fileName: DeclarativeConfigFileName;
  };
  defineDataProperty(location, "line", line);
  defineDataProperty(location, "column", column);
  defineDataProperty(location, "offset", offset);
  defineDataProperty(
    location,
    "fileName",
    captured.fileName,
  );
  return ObjectFreeze(location);
}

function createErrorDTO(
  code: DeclarativeConfigErrorCode,
  phase: DeclarativeConfigErrorPhase,
  reason: DeclarativeConfigErrorReason,
  location: DeclarativeConfigSourceLocation | null,
  retryable: boolean,
): DeclarativeConfigWorkerErrorDTO {
  const dto = ObjectCreate(null) as {
    code: DeclarativeConfigErrorCode;
    phase: DeclarativeConfigErrorPhase;
    reason: DeclarativeConfigErrorReason;
    location: DeclarativeConfigSourceLocation | null;
    retryable: boolean;
  };
  defineDataProperty(dto, "code", code);
  defineDataProperty(dto, "phase", phase);
  defineDataProperty(dto, "reason", reason);
  defineDataProperty(dto, "location", location);
  defineDataProperty(dto, "retryable", retryable);
  return ObjectFreeze(dto);
}

function createUnavailableErrorDTO(): DeclarativeConfigWorkerErrorDTO {
  return createErrorDTO(
    "evaluator-unavailable",
    "worker",
    "worker-unavailable",
    null,
    true,
  );
}

function captureEvaluationError(
  error: DeclarativeConfigEvaluationError,
): DeclarativeConfigWorkerErrorDTO {
  const code = inspectDescriptor(error, "code").value;
  const phase = inspectDescriptor(error, "phase").value;
  const reason = inspectDescriptor(error, "reason").value;
  const location = inspectDescriptor(error, "location").value;
  const retryable = inspectDescriptor(error, "retryable").value;
  if (
    !isErrorCode(code) ||
    !isErrorPhase(phase) ||
    !isErrorReason(reason) ||
    typeof retryable !== "boolean"
  ) {
    return failProtocol();
  }
  const capturedLocation = captureLocation(location);
  if (!isLegalErrorTuple(code, phase, reason, retryable)) {
    return failProtocol();
  }
  return createErrorDTO(
    code,
    phase,
    reason,
    capturedLocation,
    retryable,
  );
}

/**
 * Build a typed failure for worker lifecycle and protocol errors.
 *
 * The caller owns the retry policy because aborts and host availability have
 * different retry semantics.
 */
export function createDeclarativeConfigWorkerInfrastructureError(
  reason: DeclarativeConfigWorkerInfrastructureReason,
): DeclarativeConfigEvaluationError {
  if (!isWorkerReason(reason)) {
    throw new TypeError("Invalid declarative configuration worker failure");
  }
  const retryable = reason !== "worker-aborted" &&
    reason !== "worker-protocol";
  return new DeclarativeConfigEvaluationError({
    code: "evaluator-unavailable",
    phase: "worker",
    reason,
    location: null,
    retryable,
  });
}

/**
 * Validate and detach one worker request.
 *
 * Resource and language semantics remain the evaluator's responsibility; this
 * boundary only accepts the exact direct-input shape and plain string data.
 */
export function decodeDeclarativeConfigWorkerRequest(
  value: unknown,
): DeclarativeConfigWorkerRequest {
  const request = captureExactRecord(value, [
    "cacheFingerprint",
    "policyVersion",
    "evaluationOptions",
  ]);
  if (
    !isCacheFingerprint(request.cacheFingerprint) ||
    request.policyVersion !== DECLARATIVE_CONFIG_POLICY_VERSION
  ) {
    return failProtocol();
  }

  const evaluationOptions = captureExactRecord(request.evaluationOptions, [
    "source",
    "fileName",
    "environmentName",
    "environment",
  ]);
  if (
    typeof evaluationOptions.source !== "string" ||
    !isDeclarativeConfigFileName(evaluationOptions.fileName) ||
    typeof evaluationOptions.environmentName !== "string"
  ) {
    return failProtocol();
  }

  const detachedOptions = ObjectCreate(null) as {
    source: string;
    fileName: DeclarativeConfigFileName;
    environmentName: string;
    environment: Readonly<Record<string, string>>;
  };
  defineDataProperty(detachedOptions, "source", evaluationOptions.source);
  defineDataProperty(detachedOptions, "fileName", evaluationOptions.fileName);
  defineDataProperty(
    detachedOptions,
    "environmentName",
    evaluationOptions.environmentName,
  );
  defineDataProperty(
    detachedOptions,
    "environment",
    captureStringMap(evaluationOptions.environment),
  );
  ObjectFreeze(detachedOptions);

  const detachedRequest = ObjectCreate(null) as {
    cacheFingerprint: string;
    policyVersion: typeof DECLARATIVE_CONFIG_POLICY_VERSION;
    evaluationOptions: typeof detachedOptions;
  };
  defineDataProperty(
    detachedRequest,
    "cacheFingerprint",
    request.cacheFingerprint,
  );
  defineDataProperty(
    detachedRequest,
    "policyVersion",
    DECLARATIVE_CONFIG_POLICY_VERSION,
  );
  defineDataProperty(
    detachedRequest,
    "evaluationOptions",
    detachedOptions,
  );
  return ObjectFreeze(detachedRequest);
}

/** Create the exact success envelope emitted by the worker. */
export function createDeclarativeConfigWorkerSuccessResponse(
  snapshot: unknown,
): DeclarativeConfigWorkerSuccessResponse {
  let canonicalSnapshot: ReturnType<typeof canonicalizeConfigSnapshot>;
  try {
    canonicalSnapshot = canonicalizeConfigSnapshot(snapshot);
  } catch {
    return failProtocol();
  }
  if (
    typeof canonicalSnapshot !== "object" ||
    canonicalSnapshot === null ||
    ArrayIsArray(canonicalSnapshot)
  ) {
    return failProtocol();
  }

  const response = ObjectCreate(null) as {
    ok: true;
    snapshot: ConfigSnapshotRecord;
  };
  defineDataProperty(response, "ok", true);
  defineDataProperty(
    response,
    "snapshot",
    canonicalSnapshot as ConfigSnapshotRecord,
  );
  return ObjectFreeze(response);
}

/**
 * Create the exact failure envelope emitted by the worker.
 *
 * Unknown or malformed failures are deliberately collapsed to a retryable
 * availability error; arbitrary names, messages, stacks, and prototypes never
 * cross the boundary.
 */
export function createDeclarativeConfigWorkerErrorResponse(
  error: unknown,
): DeclarativeConfigWorkerErrorResponse {
  let dto: DeclarativeConfigWorkerErrorDTO;
  if (error instanceof DeclarativeConfigEvaluationError) {
    try {
      dto = captureEvaluationError(error);
    } catch {
      dto = createUnavailableErrorDTO();
    }
  } else {
    dto = createUnavailableErrorDTO();
  }

  const response = ObjectCreate(null) as {
    ok: false;
    error: DeclarativeConfigWorkerErrorDTO;
  };
  defineDataProperty(response, "ok", false);
  defineDataProperty(response, "error", dto);
  return ObjectFreeze(response);
}

function decodeErrorDTO(
  value: unknown,
  maximumSourceOffset: number,
  expectedFileName: DeclarativeConfigFileName,
): DeclarativeConfigWorkerErrorDTO {
  const error = captureExactRecord(value, [
    "code",
    "phase",
    "reason",
    "location",
    "retryable",
  ]);
  if (
    !isErrorCode(error.code) ||
    !isErrorPhase(error.phase) ||
    !isErrorReason(error.reason) ||
    typeof error.retryable !== "boolean"
  ) {
    return failProtocol();
  }

  const location = captureLocation(
    error.location,
    maximumSourceOffset,
    expectedFileName,
  );
  if (
    !isLegalErrorTuple(
      error.code,
      error.phase,
      error.reason,
      error.retryable,
    )
  ) {
    return failProtocol();
  }
  return createErrorDTO(
    error.code,
    error.phase,
    error.reason,
    location,
    error.retryable,
  );
}

/**
 * Decode one worker response.
 *
 * A valid failure envelope is rethrown as a fresh local typed error. A success
 * is recanonicalized so callers never observe structured-clone prototypes or
 * mutable descriptors.
 */
export function decodeDeclarativeConfigWorkerResponse(
  value: unknown,
  maximumSourceOffset: number,
  expectedFileName: DeclarativeConfigFileName = DECLARATIVE_CONFIG_FILE_NAME,
): DeclarativeConfigWorkerSuccessResponse {
  if (
    !NumberIsSafeInteger(maximumSourceOffset) ||
    maximumSourceOffset < 0 ||
    !isDeclarativeConfigFileName(expectedFileName)
  ) {
    return failProtocol();
  }
  if (
    typeof value !== "object" ||
    value === null ||
    inspectIsArray(value)
  ) {
    return failProtocol();
  }
  const prototype = inspectPrototype(value);
  if (prototype !== null && prototype !== ObjectPrototype) {
    return failProtocol();
  }

  const ok = inspectDescriptor(value, "ok").value;
  if (ok === true) {
    const response = captureExactRecord(value, ["ok", "snapshot"]);
    return createDeclarativeConfigWorkerSuccessResponse(response.snapshot);
  }

  if (ok !== false) return failProtocol();
  const errorResponse = captureExactRecord(value, ["ok", "error"]);
  const error = decodeErrorDTO(
    errorResponse.error,
    maximumSourceOffset,
    expectedFileName,
  );
  throw new DeclarativeConfigEvaluationError(error);
}

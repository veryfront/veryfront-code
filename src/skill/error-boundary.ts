/**
 * Skill-owned throwable boundary.
 *
 * Skill adapters and executors may throw project-owned values. Detach them
 * through the shared framework boundary before applying path redaction so no
 * accessor, proxy, cause, stack, or custom field can cross the tool boundary.
 */

import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
  sanitizeDiagnosticText,
} from "../errors/safe-diagnostics.ts";
import { redactPathFromText } from "../utils/logger/redact.ts";
import { SkillOperationTimeoutError } from "./operation-budget.ts";

const DEFAULT_SKILL_FAILURE_MESSAGE = "Skill operation failed";
const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const defineProperty = Object.defineProperty;
const numberIsSafeInteger = Number.isSafeInteger;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const NativeError = Error;
const NativeTypeError = TypeError;
const NativeRangeError = RangeError;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringSlice = String.prototype.slice;
const NativeDOMException = typeof DOMException === "function" ? DOMException : undefined;
const DOM_EXCEPTION_MESSAGE_GETTER = NativeDOMException
  ? readOwnDescriptorGetter(NativeDOMException.prototype, "message")
  : undefined;
const DOM_EXCEPTION_NAME_GETTER = NativeDOMException
  ? readOwnDescriptorGetter(NativeDOMException.prototype, "name")
  : undefined;
const NativeDOMExceptionPrototype = NativeDOMException?.prototype;
const NativeTypeErrorPrototype = NativeTypeError.prototype;
const NativeRangeErrorPrototype = NativeRangeError.prototype;
const NativeErrorPrototype = NativeError.prototype;
const SkillOperationTimeoutErrorPrototype = SkillOperationTimeoutError.prototype;

interface CapturedDomException {
  readonly message: string;
  readonly name: string;
}

const LOCAL_PATH_REPLACEMENT = "<local-path>";
const FORWARD_SLASH = 47;
const BACKSLASH = 92;
const COLON = 58;
const GREATER_THAN = 62;

function codeUnitAt(value: string, index: number): number {
  return apply(stringCharCodeAt, value, [index]) as number;
}

function slice(value: string, start: number, end?: number): string {
  return end === undefined
    ? apply(stringSlice, value, [start]) as string
    : apply(stringSlice, value, [start, end]) as string;
}

function isSeparator(codeUnit: number): boolean {
  return codeUnit === FORWARD_SLASH || codeUnit === BACKSLASH;
}

function isAsciiLetter(codeUnit: number): boolean {
  return (codeUnit >= 65 && codeUnit <= 90) || (codeUnit >= 97 && codeUnit <= 122);
}

function asciiLowercase(codeUnit: number): number {
  return codeUnit >= 65 && codeUnit <= 90 ? codeUnit + 32 : codeUnit;
}

function isPathTerminator(codeUnit: number): boolean {
  return codeUnit <= 32 ||
    codeUnit === 34 ||
    codeUnit === 39 ||
    codeUnit === 44 ||
    codeUnit === 59 ||
    codeUnit === 60 ||
    codeUnit === GREATER_THAN ||
    codeUnit === 93 ||
    codeUnit === 96 ||
    codeUnit === 125;
}

function isPathBoundary(value: string, index: number): boolean {
  if (index === 0) return true;
  const previous = codeUnitAt(value, index - 1);
  return isPathTerminator(previous) ||
    previous === 40 ||
    previous === COLON ||
    previous === 61 ||
    previous === 91 ||
    previous === 123;
}

function isLocalFileUrlStart(value: string, index: number): boolean {
  return isPathBoundary(value, index) &&
    asciiLowercase(codeUnitAt(value, index)) === 102 &&
    asciiLowercase(codeUnitAt(value, index + 1)) === 105 &&
    asciiLowercase(codeUnitAt(value, index + 2)) === 108 &&
    asciiLowercase(codeUnitAt(value, index + 3)) === 101 &&
    codeUnitAt(value, index + 4) === COLON &&
    isSeparator(codeUnitAt(value, index + 5));
}

function isAbsoluteLocalPathStart(value: string, index: number): boolean {
  if (!isPathBoundary(value, index)) return false;
  const first = codeUnitAt(value, index);
  const second = codeUnitAt(value, index + 1);
  const third = codeUnitAt(value, index + 2);
  if (
    isAsciiLetter(first) && second === COLON && isSeparator(third)
  ) {
    return true;
  }
  if (isSeparator(first) && isSeparator(second)) {
    if (index > 0 && codeUnitAt(value, index - 1) === COLON) return false;
    return !isPathTerminator(third) && !isSeparator(third);
  }
  if (first !== FORWARD_SLASH || isSeparator(second) || isPathTerminator(second)) {
    return false;
  }
  return index === 0 || codeUnitAt(value, index - 1) !== GREATER_THAN;
}

function redactAbsoluteLocalPaths(value: string): string {
  let result = "";
  let copyStart = 0;
  let index = 0;
  while (index < value.length) {
    const fileUrl = isLocalFileUrlStart(value, index);
    if (!fileUrl && !isAbsoluteLocalPathStart(value, index)) {
      index += 1;
      continue;
    }
    let end = index + (fileUrl ? 6 : 1);
    while (end < value.length && !isPathTerminator(codeUnitAt(value, end))) {
      end += 1;
    }
    result += slice(value, copyStart, index);
    result += LOCAL_PATH_REPLACEMENT;
    copyStart = end;
    index = end;
  }
  return copyStart === 0 ? value : result + slice(value, copyStart);
}

function sanitizeSkillDiagnosticText(value: string, skillRoot: string): string {
  const rootRedacted = skillRoot.length === 0
    ? value
    : redactPathFromText(value, skillRoot, "<skill-root>");
  return sanitizeDiagnosticText(redactAbsoluteLocalPaths(rootRedacted));
}

function hasOwn(object: object, property: PropertyKey): boolean {
  return apply(objectHasOwnProperty, object, [property]) as boolean;
}

function readOwnDescriptorGetter(
  value: object,
  property: PropertyKey,
): ((this: unknown) => unknown) | undefined {
  const descriptor = getOwnPropertyDescriptor(value, property);
  if (!descriptor || !hasOwn(descriptor, "get")) return undefined;
  const getter = descriptor.get;
  return typeof getter === "function" ? getter : undefined;
}

function ownString(value: object, property: PropertyKey): string | undefined {
  const descriptor = getOwnPropertyDescriptor(value, property);
  return descriptor && hasOwn(descriptor, "value") && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function hasCapturedPrototype(error: unknown, target: object | undefined): boolean {
  if (!target || (typeof error !== "object" && typeof error !== "function") || error === null) {
    return false;
  }
  if (isProxyWithoutHooks(error)) return false;
  try {
    let prototype = getPrototypeOf(error);
    let depth = 0;
    while (prototype !== null && depth < 16) {
      if (prototype === target) return true;
      if (isProxyWithoutHooks(prototype)) return false;
      prototype = getPrototypeOf(prototype);
      depth += 1;
    }
  } catch {
    return false;
  }
  return false;
}

function captureDomException(error: unknown): CapturedDomException | undefined {
  if (
    !DOM_EXCEPTION_MESSAGE_GETTER || !DOM_EXCEPTION_NAME_GETTER ||
    !hasCapturedPrototype(error, NativeDOMExceptionPrototype)
  ) {
    return undefined;
  }
  try {
    const message = apply(DOM_EXCEPTION_MESSAGE_GETTER, error, []);
    const name = apply(DOM_EXCEPTION_NAME_GETTER, error, []);
    return typeof message === "string" && typeof name === "string" ? { message, name } : undefined;
  } catch {
    return undefined;
  }
}

function captureRawMessage(
  error: unknown,
  domException: CapturedDomException | undefined,
): string | undefined {
  if (typeof error === "string") return error;
  if (domException) return domException.message;
  if (!isNativeErrorWithoutHooks(error)) return undefined;
  try {
    return ownString(error, "message");
  } catch {
    return undefined;
  }
}

interface CapturedErrorIdentity {
  readonly kind:
    | "DOMException"
    | "Error"
    | "RangeError"
    | "SkillOperationTimeoutError"
    | "TypeError";
  readonly name: string;
  readonly timeoutMs?: number;
}

function captureErrorIdentity(
  error: unknown,
  domException: CapturedDomException | undefined,
): CapturedErrorIdentity {
  if (domException) return { kind: "DOMException", name: domException.name };
  if (!isNativeErrorWithoutHooks(error)) return { kind: "Error", name: "Error" };

  try {
    const ownName = ownString(error, "name");
    let name = ownName || "Error";
    let capturedPrototypeName = false;
    let kind: CapturedErrorIdentity["kind"] = "Error";
    let prototype: object | null = getPrototypeOf(error);
    let depth = 0;
    while (prototype !== null && depth < 16) {
      if (prototype === NativeTypeErrorPrototype) kind = "TypeError";
      if (prototype === NativeRangeErrorPrototype) kind = "RangeError";
      if (prototype === SkillOperationTimeoutErrorPrototype) {
        const timeoutDescriptor = getOwnPropertyDescriptor(error, "timeoutMs");
        const timeoutMs = timeoutDescriptor && hasOwn(timeoutDescriptor, "value") &&
            numberIsSafeInteger(timeoutDescriptor.value) && timeoutDescriptor.value > 0
          ? timeoutDescriptor.value as number
          : undefined;
        if (timeoutMs !== undefined) {
          return {
            kind: "SkillOperationTimeoutError",
            name: ownName || "SkillOperationTimeoutError",
            timeoutMs,
          };
        }
      }
      if (!ownName && !capturedPrototypeName) {
        if (isProxyWithoutHooks(prototype)) return { kind: "Error", name: "Error" };
        const prototypeName = ownString(prototype, "name");
        if (prototypeName) {
          name = prototypeName;
          capturedPrototypeName = true;
        }
      } else if (isProxyWithoutHooks(prototype)) {
        break;
      }
      if (prototype === NativeErrorPrototype) break;
      prototype = getPrototypeOf(prototype);
      depth += 1;
    }
    return { kind, name };
  } catch {
    return { kind: "Error", name: "Error" };
  }
}

function createDetachedError(
  message: string,
  identity: CapturedErrorIdentity,
  domExceptionName?: string,
): Error {
  const error = identity.kind === "TypeError"
    ? new NativeTypeError(message)
    : identity.kind === "RangeError"
    ? new NativeRangeError(message)
    : identity.kind === "SkillOperationTimeoutError" && identity.timeoutMs !== undefined
    ? new SkillOperationTimeoutError(identity.timeoutMs)
    : identity.kind === "DOMException" && NativeDOMException
    ? new NativeDOMException(message, domExceptionName)
    : new NativeError(message);

  if (identity.kind !== "DOMException" && identity.kind !== "SkillOperationTimeoutError") {
    defineProperty(error, "name", {
      configurable: true,
      value: identity.name,
      writable: true,
    });
  }
  return error;
}

/**
 * Return a framework-owned error whose only source-derived fields are bounded
 * strings captured by the shared error boundary and redacted for the skill
 * root. The original stack, cause, context, and custom properties are dropped.
 */
export function sanitizeSkillBoundaryFailure(
  error: unknown,
  skillRoot: string,
): Error {
  const domException = captureDomException(error);
  const rawMessage = captureRawMessage(error, domException);
  const message = rawMessage
    ? sanitizeSkillDiagnosticText(rawMessage, skillRoot)
    : DEFAULT_SKILL_FAILURE_MESSAGE;
  const domExceptionName = domException
    ? sanitizeSkillDiagnosticText(domException.name, skillRoot)
    : undefined;
  const identity = captureErrorIdentity(error, domException);
  return createDetachedError(
    message,
    {
      ...identity,
      name: sanitizeSkillDiagnosticText(identity.name, skillRoot),
    },
    domExceptionName,
  );
}

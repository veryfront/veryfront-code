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
import { SkillOperationTimeoutError } from "./operation-budget.ts";

const DEFAULT_SKILL_FAILURE_MESSAGE = "Skill operation failed";
const apply = Reflect.apply;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const defineProperty = Object.defineProperty;
const replaceAll = String.prototype.replaceAll;
const numberIsSafeInteger = Number.isSafeInteger;
const NativeError = Error;
const NativeTypeError = TypeError;
const NativeRangeError = RangeError;
const NativeDOMException = typeof DOMException === "function" ? DOMException : undefined;
const DOM_EXCEPTION_MESSAGE_GETTER = NativeDOMException
  ? getOwnPropertyDescriptor(NativeDOMException.prototype, "message")?.get
  : undefined;
const DOM_EXCEPTION_NAME_GETTER = NativeDOMException
  ? getOwnPropertyDescriptor(NativeDOMException.prototype, "name")?.get
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

function redactSkillRoot(text: string, skillRoot: string): string {
  if (skillRoot.length === 0) return text;
  const slashRoot = apply(replaceAll, skillRoot, ["\\", "/"]) as string;
  const backslashRoot = apply(replaceAll, skillRoot, ["/", "\\"]) as string;
  let redacted = apply(replaceAll, text, [skillRoot, "<skill-root>"]) as string;
  redacted = apply(replaceAll, redacted, [slashRoot, "<skill-root>"]) as string;
  return apply(replaceAll, redacted, [backslashRoot, "<skill-root>"]) as string;
}

function ownString(value: object, property: PropertyKey): string | undefined {
  const descriptor = getOwnPropertyDescriptor(value, property);
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
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
        const timeoutMs = timeoutDescriptor && "value" in timeoutDescriptor &&
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
  // Redact before the shared diagnostic policy truncates. Otherwise a root
  // that crosses the truncation boundary can survive as a private prefix.
  const message = rawMessage
    ? sanitizeDiagnosticText(redactSkillRoot(rawMessage, skillRoot))
    : DEFAULT_SKILL_FAILURE_MESSAGE;
  const domExceptionName = domException
    ? sanitizeDiagnosticText(redactSkillRoot(domException.name, skillRoot))
    : undefined;
  const identity = captureErrorIdentity(error, domException);
  return createDetachedError(
    message,
    {
      ...identity,
      name: sanitizeDiagnosticText(redactSkillRoot(identity.name, skillRoot)),
    },
    domExceptionName,
  );
}

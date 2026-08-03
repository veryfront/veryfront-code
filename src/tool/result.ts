import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const ArrayIsArray = Array.isArray;
const JSONStringify = JSON.stringify;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const StringPrototypeTrim = String.prototype.trim;

/**
 * Sentinel returned when an untrusted tool-result property cannot be
 * established as an own data property without invoking a property accessor.
 */
export const UNREADABLE_TOOL_RESULT_PROPERTY = Symbol(
  "veryfront.tool-result.unreadable-property",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Read an own data property without invoking an accessor.
 *
 * Missing properties return `undefined`. Accessor-backed properties and
 * descriptor failures return {@link UNREADABLE_TOOL_RESULT_PROPERTY}, so
 * security-sensitive callers can distinguish absence from an unsafe value.
 */
export function readToolResultOwnDataProperty(
  value: unknown,
  key: PropertyKey,
): unknown | typeof UNREADABLE_TOOL_RESULT_PROPERTY {
  if (!isRecord(value)) {
    return undefined;
  }
  if (isProxyWithoutHooks(value)) {
    return UNREADABLE_TOOL_RESULT_PROPERTY;
  }

  try {
    const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      value,
      key,
    ]) as PropertyDescriptor | undefined;
    if (!descriptor) {
      return undefined;
    }
    if (
      !ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, [
        "value",
      ])
    ) {
      return UNREADABLE_TOOL_RESULT_PROPERTY;
    }
    return descriptor.value;
  } catch {
    return UNREADABLE_TOOL_RESULT_PROPERTY;
  }
}

function isNonArrayRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  try {
    return !ArrayIsArray(value);
  } catch {
    return false;
  }
}

function hasNonBlankString(value: unknown): value is string {
  return typeof value === "string" &&
    (ReflectApply(StringPrototypeTrim, value, []) as string).length > 0;
}

/** Check whether tool execution error marker is present. */
export function hasToolExecutionErrorMarker(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const error = readToolResultOwnDataProperty(value, "error");
  if (error === UNREADABLE_TOOL_RESULT_PROPERTY || typeof error === "string") {
    return true;
  }

  const isError = readToolResultOwnDataProperty(value, "isError");
  return isError === UNREADABLE_TOOL_RESULT_PROPERTY || isError === true;
}

function hasIntegrationAuthenticationActionError(value: unknown): value is Record<string, unknown> {
  if (!isNonArrayRecord(value)) {
    return false;
  }

  const error = readToolResultOwnDataProperty(value, "error");
  return error === "authentication_required" || error === "reconnect_required";
}

/** Check whether a tool result contains a complete deferred OAuth action. */
export function isIntegrationAuthenticationActionResult(value: unknown): boolean {
  if (!hasIntegrationAuthenticationActionError(value)) {
    return false;
  }

  const integration = readToolResultOwnDataProperty(value, "integration");
  const connectUrl = readToolResultOwnDataProperty(value, "connectUrl");
  return hasNonBlankString(integration) && hasNonBlankString(connectUrl);
}

function getMcpToolErrorMessage(result: unknown): string | undefined {
  if (!isNonArrayRecord(result)) {
    return undefined;
  }

  const error = readToolResultOwnDataProperty(result, "error");
  if (
    error === UNREADABLE_TOOL_RESULT_PROPERTY ||
    typeof error !== "string" ||
    error.length === 0
  ) {
    return undefined;
  }

  const message = readToolResultOwnDataProperty(result, "message");
  if (hasNonBlankString(message)) {
    return message;
  }

  return error;
}

/** Return the displayable error for a failed tool result. */
export function getToolResultError(result: unknown): string | undefined {
  if (isIntegrationAuthenticationActionResult(result)) {
    return undefined;
  }

  if (!hasToolExecutionErrorMarker(result)) {
    return undefined;
  }

  if (hasIntegrationAuthenticationActionError(result)) {
    const message = readToolResultOwnDataProperty(result, "message");
    if (hasNonBlankString(message)) {
      return message;
    }
    return "Integration authentication response is incomplete";
  }

  const mcpToolErrorMessage = getMcpToolErrorMessage(result);
  if (mcpToolErrorMessage !== undefined) {
    return mcpToolErrorMessage;
  }

  const error = readToolResultOwnDataProperty(result, "error");
  if (typeof error === "string") {
    return error.length > 0 ? error : JSONStringify(error);
  }

  const message = readToolResultOwnDataProperty(result, "message");
  if (hasNonBlankString(message)) {
    return message;
  }

  return "Tool execution failed";
}

/** Result returned from is errored tool execution. */
export function isErroredToolExecutionResult(result: unknown): boolean {
  if (hasToolExecutionErrorMarker(result)) {
    return true;
  }

  if (!isRecord(result)) {
    return false;
  }

  const output = readToolResultOwnDataProperty(result, "output");
  return output === UNREADABLE_TOOL_RESULT_PROPERTY ||
    hasToolExecutionErrorMarker(output);
}

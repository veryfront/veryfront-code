function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getOwnDataProperty(value: Record<string, unknown>, property: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, property);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Check whether tool execution error marker is present. */
export function hasToolExecutionErrorMarker(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return typeof getOwnDataProperty(value, "error") === "string" ||
    getOwnDataProperty(value, "isError") === true;
}

function hasIntegrationAuthenticationActionError(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) return false;
  const error = getOwnDataProperty(value, "error");
  return error === "authentication_required" || error === "reconnect_required";
}

const MAX_INTEGRATION_ID_LENGTH = 128;
const MAX_CONNECT_URL_LENGTH = 4_096;

function hasUnsafeControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isSafeIntegrationId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim() === value &&
    value.length <= MAX_INTEGRATION_ID_LENGTH && !hasUnsafeControlCharacters(value);
}

function isSafeConnectUrl(value: unknown): value is string {
  if (
    typeof value !== "string" || value.trim().length === 0 || value.trim() !== value ||
    value.length > MAX_CONNECT_URL_LENGTH || hasUnsafeControlCharacters(value)
  ) {
    return false;
  }

  try {
    const url = new URL(value, "https://veryfront.invalid/");
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length === 0 && url.password.length === 0;
  } catch {
    return false;
  }
}

/** Check whether a tool result contains a complete deferred OAuth action. */
export function isIntegrationAuthenticationActionResult(value: unknown): boolean {
  return hasIntegrationAuthenticationActionError(value) &&
    isSafeIntegrationId(getOwnDataProperty(value, "integration")) &&
    isSafeConnectUrl(getOwnDataProperty(value, "connectUrl"));
}

function getMcpToolErrorMessage(result: unknown): string | undefined {
  if (!isRecord(result) || Array.isArray(result)) {
    return undefined;
  }

  const error = getOwnDataProperty(result, "error");
  if (typeof error !== "string" || error.trim().length === 0) {
    return undefined;
  }

  const message = getOwnDataProperty(result, "message");
  if (typeof message === "string" && message.trim().length > 0) {
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
    const message = getOwnDataProperty(result, "message");
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
    return "Integration authentication response is incomplete";
  }

  const mcpToolErrorMessage = getMcpToolErrorMessage(result);
  if (mcpToolErrorMessage !== undefined) {
    return mcpToolErrorMessage;
  }

  const record = result as Record<string, unknown>;
  const error = getOwnDataProperty(record, "error");
  if (typeof error === "string") {
    return error.trim().length > 0 ? error : "Tool execution failed";
  }

  const message = getOwnDataProperty(record, "message");
  if (typeof message === "string" && message.trim().length > 0) {
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

  return hasToolExecutionErrorMarker(getOwnDataProperty(result, "output"));
}

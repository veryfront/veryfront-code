function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Check whether tool execution error marker is present. */
export function hasToolExecutionErrorMarker(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.error === "string" || value.isError === true;
}

function hasIntegrationAuthenticationActionError(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value) &&
    (value.error === "authentication_required" || value.error === "reconnect_required");
}

/** Check whether a tool result contains a complete deferred OAuth action. */
export function isIntegrationAuthenticationActionResult(value: unknown): boolean {
  return hasIntegrationAuthenticationActionError(value) &&
    typeof value.integration === "string" &&
    value.integration.trim().length > 0 &&
    typeof value.connectUrl === "string" &&
    value.connectUrl.trim().length > 0;
}

function getMcpToolErrorMessage(result: unknown): string | undefined {
  if (!isRecord(result) || Array.isArray(result)) {
    return undefined;
  }

  if (typeof result.error !== "string" || result.error.length === 0) {
    return undefined;
  }

  if (typeof result.message === "string" && result.message.trim().length > 0) {
    return result.message;
  }

  return result.error;
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
    if (typeof result.message === "string" && result.message.trim().length > 0) {
      return result.message;
    }
    return "Integration authentication response is incomplete";
  }

  const mcpToolErrorMessage = getMcpToolErrorMessage(result);
  if (mcpToolErrorMessage !== undefined) {
    return mcpToolErrorMessage;
  }

  const record = result as Record<string, unknown>;
  if (typeof record.error === "string") {
    return record.error.length > 0 ? record.error : JSON.stringify(record.error);
  }

  if (typeof record.message === "string" && record.message.trim().length > 0) {
    return record.message;
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

  return hasToolExecutionErrorMarker(result.output);
}

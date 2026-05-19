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

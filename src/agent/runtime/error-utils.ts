export function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  return new DOMException(
    typeof reason === "string" && reason.length > 0 ? reason : "The operation was aborted",
    "AbortError",
  );
}

export function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw createAbortError(abortSignal.reason);
  }
}

export function stringifyToolError(error: unknown): string {
  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  if (error instanceof Error && typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

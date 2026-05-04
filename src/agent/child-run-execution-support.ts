export function toChildRunToolInputRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function createChildRunAbortError(abortSignal?: AbortSignal): Error {
  if (abortSignal?.reason instanceof Error) {
    return abortSignal.reason;
  }

  return new DOMException("The operation was aborted.", "AbortError");
}

export function throwIfChildRunAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw createChildRunAbortError(abortSignal);
  }
}

export function isChildRunAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function formatChildRunStreamPartError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

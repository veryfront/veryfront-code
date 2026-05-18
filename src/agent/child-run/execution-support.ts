/** Record shape for to child run tool input. */
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

/** Throw if child run aborted helper. */
export function throwIfChildRunAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw createChildRunAbortError(abortSignal);
  }
}

/** Error shape for is child run abort. */
export function isChildRunAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Error shape for format child run stream part. */
export function formatChildRunStreamPartError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

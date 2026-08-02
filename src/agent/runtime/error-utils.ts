export { createAbortError, throwIfAborted } from "#veryfront/utils/abort.ts";

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

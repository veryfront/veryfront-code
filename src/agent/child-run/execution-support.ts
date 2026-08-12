import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";
import { throwIfAborted } from "#veryfront/utils/abort.ts";

/** Record shape for to child run tool input. */
export function toChildRunToolInputRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

/**
 * Throw if child run aborted helper.
 *
 * The cancellation reason a caller attached is the only record of why a child
 * run stopped, so it is rethrown as-is; this delegates to the framework's one
 * abort normalizer rather than repeating that decision here.
 */
export function throwIfChildRunAborted(abortSignal?: AbortSignal): void {
  throwIfAborted(abortSignal);
}

/** Error shape for is child run abort. */
export function isChildRunAbortError(error: unknown): boolean {
  return isErrorAcrossRealms(error) && error.name === "AbortError";
}

/** Error shape for format child run stream part. */
export function formatChildRunStreamPartError(error: unknown): string {
  return isErrorAcrossRealms(error) ? error.message : String(error);
}

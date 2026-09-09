import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";
import { throwIfAborted } from "#veryfront/utils/abort.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";

const isArray = Array.isArray;
const objectEntries = Object.entries;

/** Record shape for to child run tool input. */
export function toChildRunToolInputRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || isArray(value)) {
    return {};
  }

  const result: Record<string, unknown> = {};
  const entries = objectEntries(value);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    defineOwnDataProperty(result, entry[0], entry[1], {
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
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

import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelCallRecorder } from "./model-call-context.ts";

const modelCallRecorderStorage = new AsyncLocalStorage<ModelCallRecorder>();

/** Return the recorder installed for the active request scope, if any. */
export function getActiveModelCallRecorder(): ModelCallRecorder | undefined {
  return modelCallRecorderStorage.getStore();
}

/** Run an operation with a request-scoped model-call recorder. */
export function runWithModelCallRecorder<T>(recorder: ModelCallRecorder, operation: () => T): T {
  return modelCallRecorderStorage.run(recorder, operation);
}

/** Select the request-scoped recorder before an agent-configured recorder. */
export function resolveModelCallRecorder(
  configuredRecorder: ModelCallRecorder | undefined,
): ModelCallRecorder | undefined {
  return getActiveModelCallRecorder() ?? configuredRecorder;
}

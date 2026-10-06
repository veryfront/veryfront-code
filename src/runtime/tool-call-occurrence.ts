import { AsyncLocalStorage } from "node:async_hooks";
import {
  bindToolCallStartOccurrence,
  getToolCallOccurrence,
} from "./tool-call-occurrence-carrier.ts";
export {
  bindToolCallStartOccurrence,
  getToolCallOccurrence,
  retainToolCallOccurrence,
} from "./tool-call-occurrence-carrier.ts";

const enabled = new AsyncLocalStorage<true>();
const dispatch = new AsyncLocalStorage<Readonly<{ occurrenceId: string; toolCallId: string }>>();

/** Internal hosted streaming opt-in. No application context can enable admissions. */
export function runWithToolCallOccurrences<T>(operation: () => T): T {
  return enabled.run(true, operation);
}

export function isToolCallOccurrenceScopeEnabled(): boolean {
  return enabled.getStore() === true;
}

export function introduceToolCallOccurrence(call: object): string | undefined {
  if (!enabled.getStore()) return undefined;
  const existing = getToolCallOccurrence(call);
  if (existing) return existing;
  const occurrenceId = crypto.randomUUID();
  bindToolCallStartOccurrence(call, occurrenceId);
  return occurrenceId;
}

/** Internal correlation survives wrappers without entering enumerable application context. */
export function runWithToolCallOccurrenceDispatch<T>(
  call: { id: string },
  operation: () => T,
): T {
  const occurrenceId = getToolCallOccurrence(call);
  return occurrenceId
    ? dispatch.run(Object.freeze({ occurrenceId, toolCallId: call.id }), operation)
    : operation();
}

export function getCurrentToolCallOccurrence(): string | undefined {
  return dispatch.getStore()?.occurrenceId;
}

export function getCurrentToolCallOccurrenceIdentity():
  | Readonly<{ occurrenceId: string; toolCallId: string }>
  | undefined {
  return dispatch.getStore();
}

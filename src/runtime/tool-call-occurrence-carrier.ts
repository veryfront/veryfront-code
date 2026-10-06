import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";

const occurrences = createPrivateWeakStore<object, string>();
const observedProviderStarts = createPrivateWeakStore<object, true>();
const getOccurrenceSchema = defineSchema((v) => v.string().uuid());

export function getToolCallOccurrence(call: object): string | undefined {
  return occurrences.get(call);
}

/** Copy only the private identity of the same introduced call when its input finalizes. */
export function retainToolCallOccurrence(previous: object | undefined, call: object): void {
  const occurrenceId = previous && occurrences.get(previous);
  if (occurrenceId) occurrences.set(call, occurrenceId);
}

/** Associate a validated private sidecar with its exact normal start object. */
export function bindToolCallStartOccurrence(chunk: object, occurrenceId: string): void {
  if (isObservedProviderToolStart(chunk)) {
    throw new TypeError("Observed provider result cannot carry dispatch admission");
  }
  occurrences.set(chunk, getOccurrenceSchema().parse(occurrenceId).toLowerCase());
}

/** A retrospective provider-result lifecycle grants no SDK dispatch admission. */
export function bindObservedProviderToolStart(chunk: object): void {
  if (getToolCallOccurrence(chunk)) {
    throw new TypeError("Dispatch start cannot become a provider-result observation");
  }
  observedProviderStarts.set(chunk, true);
}

export function isObservedProviderToolStart(chunk: object): boolean {
  return observedProviderStarts.get(chunk) === true;
}

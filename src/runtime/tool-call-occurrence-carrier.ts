import type { ToolCall } from "#veryfront/agent/schemas/agent.schema.ts";
import type { ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";

export type ToolCallOccurrenceCall = Pick<ToolCall, "id">;
type ToolCallOccurrenceCarrier =
  | ToolCallOccurrenceCall
  | Extract<ChatUiMessageChunk, { type: "tool-input-start" }>;

const occurrences = createPrivateWeakStore<ToolCallOccurrenceCarrier, string>();
const observedToolResultStarts = createPrivateWeakStore<ToolCallOccurrenceCarrier, true>();
const getOccurrenceSchema = defineSchema((v) => v.string().uuid());

export function getToolCallOccurrence(call: ToolCallOccurrenceCarrier): string | undefined {
  return occurrences.get(call);
}

/** Copy only the private identity of the same introduced call when its input finalizes. */
export function retainToolCallOccurrence(
  previous: ToolCallOccurrenceCall | undefined,
  call: ToolCallOccurrenceCall,
): void {
  const occurrenceId = previous && occurrences.get(previous);
  if (occurrenceId) occurrences.set(call, occurrenceId);
}

/** Associate a validated private sidecar with its exact normal start object. */
export function bindToolCallStartOccurrence(
  chunk: ToolCallOccurrenceCarrier,
  occurrenceId: string,
): void {
  if (isObservedToolResultStart(chunk)) {
    throw new TypeError("Observed tool result cannot carry dispatch admission");
  }
  occurrences.set(chunk, getOccurrenceSchema().parse(occurrenceId).toLowerCase());
}

/** A retrospective tool-result lifecycle grants no SDK dispatch admission. */
export function bindObservedToolResultStart(chunk: ToolCallOccurrenceCarrier): void {
  if (getToolCallOccurrence(chunk)) {
    throw new TypeError("Dispatch start cannot become a tool-result observation");
  }
  observedToolResultStarts.set(chunk, true);
}

export function isObservedToolResultStart(chunk: ToolCallOccurrenceCarrier): boolean {
  return observedToolResultStarts.get(chunk) === true;
}

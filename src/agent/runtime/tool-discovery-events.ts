import type { ConversationRunEvent } from "../conversation/run-events.ts";
import type { RuntimeToolDiscoveryContext } from "./tool-discovery-context.ts";

/**
 * CUSTOM event name for successful tool activation.
 * Emitted as a durable conversation run event so that a resumed run can
 * rehydrate its activated-tool set from the event stream.
 */
export const TOOLS_ACTIVATED_EVENT_NAME = "tools_activated" as const;

/**
 * CUSTOM event name for rejected activation (validation or budget overflow).
 * Persisted for diagnostics; rejected tools are NOT added to the activated set
 * on replay.
 */
export const TOOLS_ACTIVATION_REJECTED_EVENT_NAME = "tools_activation_rejected" as const;

/** Payload shape for a tools_activated CUSTOM event. */
export type ToolsActivatedEventValue = {
  kind: "tools_activated";
  names: string[];
};

/** Payload shape for a tools_activation_rejected CUSTOM event. */
export type ToolsActivationRejectedEventValue = {
  kind: "tools_activation_rejected";
  names: string[];
  reasons: Record<string, string>;
};

/**
 * Build a CUSTOM conversation run event that records successful activation.
 * The host layer should emit this as a `data-tools_activated` stream chunk so
 * that `encodeCustomDataEvent` stores it durably.
 */
export function buildToolsActivatedEvent(names: string[]): Omit<ConversationRunEvent, never> {
  return {
    type: "CUSTOM",
    name: TOOLS_ACTIVATED_EVENT_NAME,
    value: {
      kind: "tools_activated",
      names,
    } satisfies ToolsActivatedEventValue,
  };
}

/**
 * Build a CUSTOM conversation run event that records a rejected activation.
 * Stored for diagnostics; replay must not activate the listed tools.
 */
export function buildToolsActivationRejectedEvent(
  names: string[],
  reasons: Record<string, string>,
): Omit<ConversationRunEvent, never> {
  return {
    type: "CUSTOM",
    name: TOOLS_ACTIVATION_REJECTED_EVENT_NAME,
    value: {
      kind: "tools_activation_rejected",
      names,
      reasons,
    } satisfies ToolsActivationRejectedEventValue,
  };
}

/**
 * Rehydrate a `RuntimeToolDiscoveryContext` by replaying durable conversation
 * run events. Called during run resume so the activated-tool set is restored
 * without re-invoking `load_tools`.
 *
 * Only `tools_activated` events are applied; rejected events are skipped.
 */
export function hydrateToolDiscoveryFromEvents(
  events: readonly ConversationRunEvent[],
  context: RuntimeToolDiscoveryContext,
): void {
  for (const event of events) {
    if (event.type !== "CUSTOM" || event.name !== TOOLS_ACTIVATED_EVENT_NAME) {
      continue;
    }

    const value = event.value as Partial<ToolsActivatedEventValue> | null;
    if (!value || !Array.isArray(value.names)) {
      continue;
    }

    if (!context.activatedRemoteToolNames) {
      context.activatedRemoteToolNames = new Set();
    }

    for (const name of value.names) {
      if (typeof name === "string" && name.length > 0) {
        context.activatedRemoteToolNames.add(name);
      }
    }
  }
}

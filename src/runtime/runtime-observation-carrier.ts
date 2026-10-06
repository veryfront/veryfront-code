import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type { ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";

const freezeRuntimeObservationCapability = Object.freeze;

export const getPrivateRuntimeObservationSchema = defineSchema((v) => {
  const uuid = v.string().uuid().transform((value) => value.toLowerCase());
  return v.discriminatedUnion("kind", [
    v.object({
      version: v.literal(1),
      kind: v.literal("execution_entry"),
      occurrenceId: uuid,
    }).strict(),
    v.object({
      version: v.literal(1),
      kind: v.literal("step_started"),
      stepId: uuid,
    }).strict(),
    v.object({
      version: v.literal(1),
      kind: v.literal("step_ended"),
      stepId: uuid,
    }).strict(),
    v.object({
      version: v.literal(1),
      kind: v.literal("step_message"),
      stepId: uuid,
      messageSpanId: uuid,
    }).strict(),
  ]);
});

export type PrivateRuntimeObservation = InferSchema<
  ReturnType<typeof getPrivateRuntimeObservationSchema>
>;

export const getRuntimeObservationWireEntrySchema = defineSchema((v) => {
  const uuid = v.string().uuid().transform((value) => value.toLowerCase());
  const eventIndex = v.number().int().min(0).max(99);
  return v.discriminatedUnion("kind", [
    v.object({
      kind: v.literal("execution_entry"),
      occurrence_id: uuid,
      event_index: eventIndex,
    }).strict(),
    v.object({
      kind: v.literal("step_started"),
      step_id: uuid,
      event_index: eventIndex,
    }).strict(),
    v.object({
      kind: v.literal("step_ended"),
      step_id: uuid,
      event_index: eventIndex,
    }).strict(),
    v.object({
      kind: v.literal("step_message"),
      step_id: uuid,
      message_span_id: uuid,
      event_index: eventIndex,
    }).strict(),
  ]);
});

export type RuntimeObservationWireEntry = InferSchema<
  ReturnType<typeof getRuntimeObservationWireEntrySchema>
>;

export interface ConversationRunRuntimeObservation {
  observation: PrivateRuntimeObservation;
  eventIndex: number;
}

/** @internal Opaque authority required before a runtime may emit private observation sidecars. */
export interface RuntimeObservationCapability {
  readonly kind: "runtime-observation-capability";
}

type RuntimeObservationCarrierKey = ChatUiMessageChunk<unknown>;

const runtimeObservations = createPrivateWeakStore<
  RuntimeObservationCarrierKey,
  PrivateRuntimeObservation
>();
const runtimeObservationCapabilities = createPrivateWeakStore<
  RuntimeObservationCapability,
  true
>();

/** @internal Create host-owned runtime-observation authority. Do not expose on public request shapes. */
export function createRuntimeObservationCapability(): RuntimeObservationCapability {
  const capability = freezeRuntimeObservationCapability({
    __proto__: null,
    kind: "runtime-observation-capability" as const,
  });
  runtimeObservationCapabilities.set(capability, true);
  return capability;
}

/** @internal Check whether a value is the exact host-owned capability created by this module. */
export function hasRuntimeObservationCapability(
  capability: RuntimeObservationCapability | undefined,
): boolean {
  return capability !== undefined && runtimeObservationCapabilities.get(capability) === true;
}

export function bindRuntimeObservation(
  chunk: RuntimeObservationCarrierKey,
  observation: PrivateRuntimeObservation,
): void {
  runtimeObservations.set(chunk, getPrivateRuntimeObservationSchema().parse(observation));
}

export function getRuntimeObservation(
  chunk: RuntimeObservationCarrierKey,
): PrivateRuntimeObservation | undefined {
  return runtimeObservations.get(chunk);
}

export function retainRuntimeObservation(
  previous: RuntimeObservationCarrierKey,
  next: RuntimeObservationCarrierKey,
): void {
  const observation = runtimeObservations.get(previous);
  if (observation) runtimeObservations.set(next, observation);
}

export function toWireRuntimeObservation(
  input: ConversationRunRuntimeObservation,
): RuntimeObservationWireEntry {
  const observation = getPrivateRuntimeObservationSchema().parse(input.observation);
  switch (observation.kind) {
    case "execution_entry":
      return getRuntimeObservationWireEntrySchema().parse({
        kind: "execution_entry",
        occurrence_id: observation.occurrenceId,
        event_index: input.eventIndex,
      });
    case "step_started":
      return getRuntimeObservationWireEntrySchema().parse({
        kind: "step_started",
        step_id: observation.stepId,
        event_index: input.eventIndex,
      });
    case "step_ended":
      return getRuntimeObservationWireEntrySchema().parse({
        kind: "step_ended",
        step_id: observation.stepId,
        event_index: input.eventIndex,
      });
    case "step_message":
      return getRuntimeObservationWireEntrySchema().parse({
        kind: "step_message",
        step_id: observation.stepId,
        message_span_id: observation.messageSpanId,
        event_index: input.eventIndex,
      });
    default: {
      const _exhaustive: never = observation;
      return _exhaustive;
    }
  }
}

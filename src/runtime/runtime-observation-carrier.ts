import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type { ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import type { AgentRunEventSink } from "./model-call-context.ts";

const freezeRuntimeObservationCapability = Object.freeze;
export const RUNTIME_OBSERVATION_MAX_EVENTS_PER_APPEND = 100;

const getRuntimeObservationWriterScopeSchema = defineSchema((v) => {
  const uuid = v.string().uuid().transform((value) => value.toLowerCase());
  return v.object({
    runId: v.string().min(1),
    canonicalRunId: uuid,
    projectId: uuid,
  }).strict();
});

export type RuntimeObservationWriterScope = InferSchema<
  ReturnType<typeof getRuntimeObservationWriterScopeSchema>
>;

/** @internal Opaque host-owned opt-in for exact model-call capture. */
export interface RuntimeObservationCaptureOptIn {
  readonly kind: "runtime-observation-capture-opt-in";
}

/** @internal Opaque authority that binds an exact private writer to a runtime sink. */
export interface RuntimeObservationWriterCapability {
  readonly kind: "runtime-observation-writer-capability";
}

type RuntimeObservationWriterCapabilityState = {
  readonly scope: Readonly<RuntimeObservationWriterScope>;
  active: boolean;
  liveness?: () => void;
};

type RuntimeObservationWriterBinding = {
  readonly scope: Readonly<RuntimeObservationWriterScope>;
  assertActive: () => void;
};

const runtimeObservationCaptureOptIns = createPrivateWeakStore<
  RuntimeObservationCaptureOptIn,
  true
>();
const runtimeObservationWriterCapabilities = createPrivateWeakStore<
  RuntimeObservationWriterCapability,
  RuntimeObservationWriterCapabilityState
>();
const runtimeObservationWriterSinkCapabilities = createPrivateWeakStore<
  AgentRunEventSink,
  RuntimeObservationWriterCapability
>();

function assertRuntimeObservationWriterStateActive(
  state: RuntimeObservationWriterCapabilityState | undefined,
): asserts state is RuntimeObservationWriterCapabilityState {
  if (!state?.active) {
    throw new Error("Runtime observation writer capability is no longer active");
  }
  state.liveness?.();
}

/** @internal Create service-owned opt-in authority. Do not expose on request shapes. */
export function createRuntimeObservationCaptureOptIn(): RuntimeObservationCaptureOptIn {
  const optIn = freezeRuntimeObservationCapability({
    __proto__: null,
    kind: "runtime-observation-capture-opt-in" as const,
  });
  runtimeObservationCaptureOptIns.set(optIn, true);
  return optIn;
}

/** @internal Check that capture was explicitly enabled by the host process. */
export function hasRuntimeObservationCaptureOptIn(
  optIn: RuntimeObservationCaptureOptIn | undefined,
): boolean {
  return optIn !== undefined && runtimeObservationCaptureOptIns.get(optIn) === true;
}

/** @internal Create exact private writer authority from a validated durable run. */
export function createRuntimeObservationWriterCapability(input: {
  scope: RuntimeObservationWriterScope;
  assertActive?: () => void;
}): RuntimeObservationWriterCapability {
  const capability = freezeRuntimeObservationCapability({
    __proto__: null,
    kind: "runtime-observation-writer-capability" as const,
  });
  runtimeObservationWriterCapabilities.set(capability, {
    scope: freezeRuntimeObservationCapability(
      getRuntimeObservationWriterScopeSchema().parse(input.scope),
    ),
    active: true,
    ...(input.assertActive ? { liveness: input.assertActive } : {}),
  });
  return capability;
}

/** @internal Add live host state checks after the default hosted runtime creates its task context. */
export function attachRuntimeObservationWriterLiveness(
  capability: RuntimeObservationWriterCapability | undefined,
  liveness: () => void,
): void {
  if (capability === undefined) return;
  const state = runtimeObservationWriterCapabilities.get(capability);
  assertRuntimeObservationWriterStateActive(state);
  const previous = state.liveness;
  state.liveness = previous === undefined ? liveness : () => {
    previous();
    liveness();
  };
}

/** @internal Revoke capture authority on project/run/writer lifetime changes. */
export function revokeRuntimeObservationWriterCapability(
  capability: RuntimeObservationWriterCapability | undefined,
): void {
  if (capability === undefined) return;
  const state = runtimeObservationWriterCapabilities.get(capability);
  if (state) state.active = false;
}

/** @internal Bind the real canonical persistence sink to the host's validated capability. */
export function bindRuntimeObservationWriterCapability(
  sink: AgentRunEventSink,
  capability: RuntimeObservationWriterCapability,
): void {
  const state = runtimeObservationWriterCapabilities.get(capability);
  assertRuntimeObservationWriterStateActive(state);
  runtimeObservationWriterSinkCapabilities.set(sink, capability);
}

/** @internal Public callback fields cannot supply runtime-observation writer authority. */
export function getRuntimeObservationWriterBinding(
  sink: AgentRunEventSink | undefined,
): RuntimeObservationWriterBinding | undefined {
  if (sink === undefined) return undefined;
  const capability = runtimeObservationWriterSinkCapabilities.get(sink);
  if (capability === undefined) return undefined;
  const state = runtimeObservationWriterCapabilities.get(capability);
  if (state === undefined) return undefined;
  return {
    scope: state.scope,
    assertActive: () => assertRuntimeObservationWriterStateActive(state),
  };
}

/** @internal Read the exact writer scope without granting authority. */
export function getRuntimeObservationWriterScope(
  sink: AgentRunEventSink | undefined,
): Readonly<RuntimeObservationWriterScope> | undefined {
  return getRuntimeObservationWriterBinding(sink)?.scope;
}

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
  const eventIndex = v.number().int().min(0).max(RUNTIME_OBSERVATION_MAX_EVENTS_PER_APPEND - 1);
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

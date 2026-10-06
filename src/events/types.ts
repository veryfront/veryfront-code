/**
 * Public Agent Events Protocol types.
 *
 * The runtime decoder validates the full CloudEvents envelope and payload
 * against the committed target JSON Schemas. These types expose the stable
 * discriminants consumers use after parsing.
 *
 * @module events/types
 */

import type {
  EventAttemptScopeEnvelopeRequiredByType,
  EventEnvelopeRequiredByType,
  EventJsonObject,
  EventJsonValue,
  EventPayload,
  EventPayloadByType,
} from "./payload-types.generated.ts";

/** Any JSON value carried in an Agent Events Protocol payload. */
export type JsonValue = EventJsonValue;

/** Any JSON object carried in an Agent Events Protocol payload. */
export type JsonObject = EventJsonObject;

export const EVENT_TYPES = [
  "com.veryfront.run.requested",
  "com.veryfront.run.enqueued",
  "com.veryfront.run.started",
  "com.veryfront.run.succeeded",
  "com.veryfront.run.failed",
  "com.veryfront.run.cancelled",
  "com.veryfront.run.log.captured",
  "com.veryfront.child-run.reported",
  "com.veryfront.step.started",
  "com.veryfront.step.succeeded",
  "com.veryfront.step.failed",
  "com.veryfront.step.cancelled",
  "com.veryfront.step.ended",
  "com.veryfront.tool-call.started",
  "com.veryfront.tool-call.arguments.delta.emitted",
  "com.veryfront.tool-call.arguments.ended",
  "com.veryfront.tool-call.refused",
  "com.veryfront.tool-call.status.reported",
  "com.veryfront.tool-call.result.recorded",
  "com.veryfront.tool-call.result.submitted",
  "com.veryfront.tool-call.result.delivery.failed",
  "com.veryfront.model-call.input.captured",
  "com.veryfront.model-call.usage.recorded",
  "com.veryfront.input-request.created",
  "com.veryfront.input-request.updated",
  "com.veryfront.message.text.started",
  "com.veryfront.message.text.delta.emitted",
  "com.veryfront.message.text.ended",
  "com.veryfront.message.reasoning.started",
  "com.veryfront.message.reasoning.delta.emitted",
  "com.veryfront.message.reasoning.ended",
  "com.veryfront.message.url.referenced",
  "com.veryfront.message.document.referenced",
  "com.veryfront.message.file.attached",
  "com.veryfront.stream.heartbeat.emitted",
  "com.veryfront.stream.closed",
] as const;

export type EventType = typeof EVENT_TYPES[number];

export const EVENT_SCHEMA_BY_TYPE = {
  "com.veryfront.run.requested": "urn:veryfront:run-events:target:payloads:1#/$defs/RunRequested",
  "com.veryfront.run.enqueued": "urn:veryfront:run-events:target:payloads:1#/$defs/RunEnqueued",
  "com.veryfront.run.started": "urn:veryfront:run-events:target:payloads:1#/$defs/RunStarted",
  "com.veryfront.run.succeeded": "urn:veryfront:run-events:target:payloads:1#/$defs/RunSucceeded",
  "com.veryfront.run.failed": "urn:veryfront:run-events:target:payloads:1#/$defs/RunFailed",
  "com.veryfront.run.cancelled": "urn:veryfront:run-events:target:payloads:1#/$defs/RunCancelled",
  "com.veryfront.run.log.captured":
    "urn:veryfront:run-events:target:payloads:1#/$defs/RunLogCaptured",
  "com.veryfront.child-run.reported":
    "urn:veryfront:run-events:target:payloads:1#/$defs/ChildRunReported",
  "com.veryfront.step.started": "urn:veryfront:run-events:target:payloads:1#/$defs/StepStarted",
  "com.veryfront.step.succeeded": "urn:veryfront:run-events:target:payloads:1#/$defs/StepSucceeded",
  "com.veryfront.step.failed": "urn:veryfront:run-events:target:payloads:1#/$defs/StepFailed",
  "com.veryfront.step.cancelled": "urn:veryfront:run-events:target:payloads:1#/$defs/StepCancelled",
  "com.veryfront.step.ended": "urn:veryfront:run-events:target:payloads:1#/$defs/StepEnded",
  "com.veryfront.tool-call.started":
    "urn:veryfront:run-events:target:payloads:1#/$defs/ToolCallStarted",
  "com.veryfront.tool-call.arguments.delta.emitted":
    "urn:veryfront:run-events:target:payloads:1#/$defs/ToolCallArgumentsDeltaEmitted",
  "com.veryfront.tool-call.arguments.ended":
    "urn:veryfront:run-events:target:payloads:1#/$defs/ToolCallArgumentsEnded",
  "com.veryfront.tool-call.refused":
    "urn:veryfront:run-events:target:payloads:1#/$defs/ToolCallRefused",
  "com.veryfront.tool-call.status.reported":
    "urn:veryfront:run-events:target:payloads:1#/$defs/ToolCallStatusReported",
  "com.veryfront.tool-call.result.recorded":
    "urn:veryfront:run-events:target:payloads:1#/$defs/ToolCallResultRecorded",
  "com.veryfront.tool-call.result.submitted":
    "urn:veryfront:run-events:target:payloads:1#/$defs/ToolCallResultSubmitted",
  "com.veryfront.tool-call.result.delivery.failed":
    "urn:veryfront:run-events:target:payloads:1#/$defs/ToolCallResultDeliveryFailed",
  "com.veryfront.model-call.input.captured":
    "urn:veryfront:run-events:target:payloads:1#/$defs/ModelCallInputCaptured",
  "com.veryfront.model-call.usage.recorded":
    "urn:veryfront:run-events:target:payloads:1#/$defs/ModelCallUsageRecorded",
  "com.veryfront.input-request.created":
    "urn:veryfront:run-events:target:payloads:1#/$defs/InputRequestCreated",
  "com.veryfront.input-request.updated":
    "urn:veryfront:run-events:target:payloads:1#/$defs/InputRequestUpdated",
  "com.veryfront.message.text.started":
    "urn:veryfront:run-events:target:payloads:1#/$defs/MessageTextStarted",
  "com.veryfront.message.text.delta.emitted":
    "urn:veryfront:run-events:target:payloads:1#/$defs/MessageTextDeltaEmitted",
  "com.veryfront.message.text.ended":
    "urn:veryfront:run-events:target:payloads:1#/$defs/MessageTextEnded",
  "com.veryfront.message.reasoning.started":
    "urn:veryfront:run-events:target:payloads:1#/$defs/MessageReasoningStarted",
  "com.veryfront.message.reasoning.delta.emitted":
    "urn:veryfront:run-events:target:payloads:1#/$defs/MessageReasoningDeltaEmitted",
  "com.veryfront.message.reasoning.ended":
    "urn:veryfront:run-events:target:payloads:1#/$defs/MessageReasoningEnded",
  "com.veryfront.message.url.referenced":
    "urn:veryfront:run-events:target:payloads:1#/$defs/MessageUrlReferenced",
  "com.veryfront.message.document.referenced":
    "urn:veryfront:run-events:target:payloads:1#/$defs/MessageDocumentReferenced",
  "com.veryfront.message.file.attached":
    "urn:veryfront:run-events:target:payloads:1#/$defs/MessageFileAttached",
  "com.veryfront.stream.heartbeat.emitted":
    "urn:veryfront:run-events:target:payloads:1#/$defs/StreamHeartbeatEmitted",
  "com.veryfront.stream.closed": "urn:veryfront:run-events:target:payloads:1#/$defs/StreamClosed",
} as const satisfies Record<EventType, string>;

export type EventDataschema<T extends EventType> = typeof EVENT_SCHEMA_BY_TYPE[T];

export type CloudEventsExtensionAttribute = string | boolean | number;

interface EventEnvelopeCore<
  TType extends EventType,
  TDataschema extends string,
> {
  readonly specversion: "1.0";
  readonly id: string;
  readonly source: string;
  readonly type: TType;
  readonly datacontenttype: "application/json";
  readonly dataschema: TDataschema;
  readonly data: EventPayload<TType>;
  readonly subject?: string;
  readonly time?: string;
  readonly recordedat?: string;
  readonly runid?: string;
  readonly runkind?: "agent" | "workflow" | "task";
  readonly conversationid?: string;
  readonly modelcallid?: string;
  readonly attemptid?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
}

export type EventExtensionAttributes<
  TAttributes extends Record<string, CloudEventsExtensionAttribute> = Record<never, never>,
> = {
  readonly [K in keyof TAttributes]: TAttributes[K];
};

export type EventEnvelope<
  TType extends EventType,
  TDataschema extends string,
  TExtensionAttributes extends Record<string, CloudEventsExtensionAttribute> = Record<
    never,
    never
  >,
> =
  & EventEnvelopeCore<TType, TDataschema>
  & EventExtensionAttributes<TExtensionAttributes>;

type EventBase<
  TType extends EventType,
  TExtensionAttributes extends Record<string, CloudEventsExtensionAttribute> = Record<
    never,
    never
  >,
> = EventEnvelope<TType, EventDataschema<TType>, TExtensionAttributes>;

type EventCoreBase<TType extends EventType> = EventEnvelopeCore<
  TType,
  EventDataschema<TType>
>;

interface EventEnvelopeFieldTypes {
  readonly runid: string;
  readonly modelcallid: string;
  readonly attemptid: string;
}

type EventEnvelopeRequiredKey<TType extends EventType> = TType extends
  keyof EventEnvelopeRequiredByType ? EventEnvelopeRequiredByType[TType]
  : never;

type EventEnvelopeRequirements<TType extends EventType> = [EventEnvelopeRequiredKey<TType>] extends
  [never] ? unknown
  : Pick<EventEnvelopeFieldTypes, EventEnvelopeRequiredKey<TType>>;

type ModelCallUsageAttemptEnvelopeKey =
  EventAttemptScopeEnvelopeRequiredByType["com.veryfront.model-call.usage.recorded"];

type ModelCallUsagePayload<TScope extends "attempt" | "call"> =
  & Omit<EventPayloadByType["com.veryfront.model-call.usage.recorded"], "scope">
  & {
    readonly scope: TScope;
  };

type ModelCallUsageEvent<
  TExtensionAttributes extends Record<string, CloudEventsExtensionAttribute> = Record<
    never,
    never
  >,
> =
  | Omit<EventCoreBase<"com.veryfront.model-call.usage.recorded">, "data" | "attemptid">
    & EventExtensionAttributes<TExtensionAttributes>
    & Pick<EventEnvelopeFieldTypes, ModelCallUsageAttemptEnvelopeKey>
    & {
      readonly modelcallid: string;
      readonly data: ModelCallUsagePayload<"attempt">;
    }
  | Omit<EventCoreBase<"com.veryfront.model-call.usage.recorded">, "data" | "attemptid">
    & EventExtensionAttributes<TExtensionAttributes>
    & {
      readonly modelcallid: string;
      readonly attemptid?: never;
      readonly data: ModelCallUsagePayload<"call">;
    };

type EventForType<
  TType extends EventType,
  TExtensionAttributes extends Record<string, CloudEventsExtensionAttribute> = Record<
    never,
    never
  >,
> = TType extends "com.veryfront.model-call.usage.recorded"
  ? ModelCallUsageEvent<TExtensionAttributes>
  : EventBase<TType, TExtensionAttributes> & EventEnvelopeRequirements<TType>;

export type EventRecord<TType extends EventType = EventType> = TType extends EventType
  ? EventForType<TType>
  : never;

export type EventWithExtensions<
  TType extends EventType = EventType,
  TExtensionAttributes extends Record<string, CloudEventsExtensionAttribute> = Record<
    never,
    never
  >,
> = TType extends EventType ? EventForType<TType, TExtensionAttributes> : never;

export type { EventPayload, EventPayloadByType };

export interface EventParseIssue {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly message?: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type EventParseResult =
  | { readonly success: true; readonly data: EventRecord }
  | {
    readonly success: false;
    readonly issues: readonly EventParseIssue[];
  };

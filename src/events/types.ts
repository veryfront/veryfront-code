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
  AgentEventAttemptScopeEnvelopeRequiredByType,
  AgentEventEnvelopeRequiredByType,
  AgentEventJsonObject,
  AgentEventJsonValue,
  AgentEventPayload,
  AgentEventPayloadByType,
} from "./payload-types.generated.ts";

/** Any JSON value carried in an Agent Events Protocol payload. */
export type JsonValue = AgentEventJsonValue;

/** Any JSON object carried in an Agent Events Protocol payload. */
export type JsonObject = AgentEventJsonObject;

export const AGENT_EVENT_TYPES = [
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

export type AgentEventType = typeof AGENT_EVENT_TYPES[number];

export const AGENT_EVENT_SCHEMA_BY_TYPE = {
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
} as const satisfies Record<AgentEventType, string>;

export type AgentEventDataschema<T extends AgentEventType> = typeof AGENT_EVENT_SCHEMA_BY_TYPE[T];

export type CloudEventsExtensionAttribute = string | boolean | number;

interface AgentEventEnvelopeCore<
  TType extends AgentEventType,
  TDataschema extends string,
> {
  readonly specversion: "1.0";
  readonly id: string;
  readonly source: string;
  readonly type: TType;
  readonly datacontenttype: "application/json";
  readonly dataschema: TDataschema;
  readonly data: AgentEventPayload<TType>;
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

export type AgentEventExtensionAttributes<
  TAttributes extends Record<string, CloudEventsExtensionAttribute> = Record<never, never>,
> = {
  readonly [K in keyof TAttributes]: TAttributes[K];
};

export type AgentEventEnvelope<
  TType extends AgentEventType,
  TDataschema extends string,
  TExtensionAttributes extends Record<string, CloudEventsExtensionAttribute> = Record<
    never,
    never
  >,
> =
  & AgentEventEnvelopeCore<TType, TDataschema>
  & AgentEventExtensionAttributes<TExtensionAttributes>;

type AgentEventBase<
  TType extends AgentEventType,
  TExtensionAttributes extends Record<string, CloudEventsExtensionAttribute> = Record<
    never,
    never
  >,
> = AgentEventEnvelope<TType, AgentEventDataschema<TType>, TExtensionAttributes>;

type AgentEventCoreBase<TType extends AgentEventType> = AgentEventEnvelopeCore<
  TType,
  AgentEventDataschema<TType>
>;

interface AgentEventEnvelopeFieldTypes {
  readonly runid: string;
  readonly modelcallid: string;
  readonly attemptid: string;
}

type AgentEventEnvelopeRequiredKey<TType extends AgentEventType> = TType extends
  keyof AgentEventEnvelopeRequiredByType ? AgentEventEnvelopeRequiredByType[TType]
  : never;

type AgentEventEnvelopeRequirements<TType extends AgentEventType> =
  [AgentEventEnvelopeRequiredKey<TType>] extends [never] ? unknown
    : Pick<AgentEventEnvelopeFieldTypes, AgentEventEnvelopeRequiredKey<TType>>;

type ModelCallUsageAttemptEnvelopeKey =
  AgentEventAttemptScopeEnvelopeRequiredByType["com.veryfront.model-call.usage.recorded"];

type ModelCallUsagePayload<TScope extends "attempt" | "call"> =
  & Omit<AgentEventPayloadByType["com.veryfront.model-call.usage.recorded"], "scope">
  & {
    readonly scope: TScope;
  };

type ModelCallUsageAgentEvent<
  TExtensionAttributes extends Record<string, CloudEventsExtensionAttribute> = Record<
    never,
    never
  >,
> =
  | Omit<AgentEventCoreBase<"com.veryfront.model-call.usage.recorded">, "data" | "attemptid">
    & AgentEventExtensionAttributes<TExtensionAttributes>
    & Pick<AgentEventEnvelopeFieldTypes, ModelCallUsageAttemptEnvelopeKey>
    & {
      readonly modelcallid: string;
      readonly data: ModelCallUsagePayload<"attempt">;
    }
  | Omit<AgentEventCoreBase<"com.veryfront.model-call.usage.recorded">, "data" | "attemptid">
    & AgentEventExtensionAttributes<TExtensionAttributes>
    & {
      readonly modelcallid: string;
      readonly attemptid?: never;
      readonly data: ModelCallUsagePayload<"call">;
    };

type AgentEventForType<
  TType extends AgentEventType,
  TExtensionAttributes extends Record<string, CloudEventsExtensionAttribute> = Record<
    never,
    never
  >,
> = TType extends "com.veryfront.model-call.usage.recorded"
  ? ModelCallUsageAgentEvent<TExtensionAttributes>
  : AgentEventBase<TType, TExtensionAttributes> & AgentEventEnvelopeRequirements<TType>;

export type AgentEvent<TType extends AgentEventType = AgentEventType> = TType extends AgentEventType
  ? AgentEventForType<TType>
  : never;

export type AgentEventWithExtensions<
  TType extends AgentEventType = AgentEventType,
  TExtensionAttributes extends Record<string, CloudEventsExtensionAttribute> = Record<
    never,
    never
  >,
> = TType extends AgentEventType ? AgentEventForType<TType, TExtensionAttributes> : never;

export type { AgentEventPayload, AgentEventPayloadByType };

export interface AgentEventParseIssue {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly message?: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type AgentEventParseResult =
  | { readonly success: true; readonly data: AgentEvent }
  | {
    readonly success: false;
    readonly issues: readonly AgentEventParseIssue[];
  };

/**
 * Agent Events Protocol decoder and public types.
 *
 * This module validates target Agent Events Protocol CloudEvents with the
 * committed target catalog, envelope schema and payload schemas. It is
 * additive to the released `veryfront/run-events` surface.
 *
 * @example Validate one event with an injected JSON Schema validator.
 * ```ts
 * import { createAgentEventParser } from "veryfront/events";
 * import { createZodAdapter } from "@veryfront/ext-schema-zod";
 *
 * const parser = createAgentEventParser(createZodAdapter());
 *
 * export function parseEvent(rawEvent: unknown) {
 *   const event = parser.parseAgentEvent(rawEvent);
 *   console.log(event.type, event.data);
 *   return event;
 * }
 * ```
 *
 * @module events
 */

export {
  AGENT_EVENT_TARGET_CATALOG,
  AGENT_EVENT_TARGET_ENVELOPE_SCHEMA,
  AGENT_EVENT_TARGET_PAYLOAD_EXAMPLES,
  AGENT_EVENT_TARGET_PAYLOAD_SCHEMAS,
} from "./contracts.ts";
export { createAgentEventParser, parseAgentEvent, safeParseAgentEvent } from "./parser.ts";
export type { AgentEventParser } from "./parser.ts";
export type {
  AgentEventJsonObject,
  AgentEventJsonValue,
  AgentEventPayload,
  AgentEventPayloadByType,
  ChildRun,
  ChildRunReported,
  ErrorInfo,
  Extensions,
  InputField,
  InputRequestChanges,
  InputRequestCreated,
  InputRequestReference,
  InputRequestSnapshot,
  InputRequestUpdated,
  MessageDocumentReferenced,
  MessageFileAttached,
  MessageReasoningDeltaEmitted,
  MessageReasoningEnded,
  MessageReasoningStarted,
  MessageTextDeltaEmitted,
  MessageTextEnded,
  MessageTextStarted,
  MessageUrlReferenced,
  ModelCallInputCaptured,
  ModelCallUsageRecorded,
  ModelDescriptor,
  ModelInput,
  RunCancelled,
  RunEnqueued,
  RunFailed,
  RunLogCaptured,
  RunRequested,
  RunStarted,
  RunSucceeded,
  StepCancelled,
  StepEnded,
  StepFailed,
  StepStarted,
  StepSucceeded,
  StreamClosed,
  StreamHeartbeatEmitted,
  TokenUsage,
  ToolCallArgumentsDeltaEmitted,
  ToolCallArgumentsEnded,
  ToolCallRefused,
  ToolCallResultDeliveryFailed,
  ToolCallResultRecorded,
  ToolCallResultSubmitted,
  ToolCallStarted,
  ToolCallStatusReported,
} from "./payload-types.generated.ts";
export {
  AGENT_EVENT_SCHEMA_VALIDATOR_CONTRACT,
  AGENT_EVENT_SCHEMA_VALIDATOR_PACKAGE,
  assertAgentEventSchemaValidator,
  registerAgentEventSchemaValidator,
  tryResolveAgentEventSchemaValidator,
  unregisterAgentEventSchemaValidator,
} from "./schema-validator.ts";
export {
  AGENT_EVENT_SCHEMA_BY_TYPE,
  AGENT_EVENT_TYPES,
  type AgentEvent,
  type AgentEventDataschema,
  type AgentEventEnvelope,
  type AgentEventExtensionAttributes,
  type AgentEventParseIssue,
  type AgentEventParseResult,
  type AgentEventType,
  type AgentEventWithExtensions,
  type CloudEventsExtensionAttribute,
  type JsonObject,
  type JsonValue,
} from "./types.ts";

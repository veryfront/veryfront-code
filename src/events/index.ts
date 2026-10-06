/**
 * Agent Events Protocol decoder and public types.
 *
 * This module validates target Agent Events Protocol CloudEvents with the
 * committed target catalog, envelope schema and payload schemas. It is
 * additive to the released `veryfront/run-events` surface.
 *
 * @example Validate one event with an injected JSON Schema validator.
 * ```ts
 * import { createEventParser } from "veryfront/events";
 * import { createZodAdapter } from "@veryfront/ext-schema-zod";
 *
 * const parser = createEventParser(createZodAdapter());
 *
 * export function parseEvent(rawEvent: unknown) {
 *   const event = parser.parseEvent(rawEvent);
 *   console.log(event.type, event.data);
 *   return event;
 * }
 * ```
 *
 * @module events
 */

export {
  EVENT_TARGET_CATALOG,
  EVENT_TARGET_ENVELOPE_SCHEMA,
  EVENT_TARGET_PAYLOAD_EXAMPLES,
  EVENT_TARGET_PAYLOAD_SCHEMAS,
} from "./contracts.ts";
export { createEventParser, parseEvent, safeParseEvent } from "./parser.ts";
export type { EventParser } from "./parser.ts";
export {
  acceptAgUiEvent,
  type AcceptAgUiEventInput,
  type AcceptAgUiEventResult,
  acceptNativeEvent,
  type AcceptNativeEventInput,
  AG_UI_CORE_PACKAGE,
  AG_UI_CORE_VERSION,
  AG_UI_EVENT_SCHEMA,
  AG_UI_EVENT_TYPES,
  AG_UI_PROTOCOL_VERSION,
  AG_UI_RELEASE,
  AG_UI_RELEASE_COMMIT,
  type AgUiAcceptedEvent,
  type AgUiAcceptedEventCommand,
  type AgUiEvent,
  type AgUiEventType,
  type AgUiExpandedEventCommand,
  type AgUiJsonValue,
  type AgUiMissingFactRequirementCommand,
  type AgUiNormalizationCommand,
  type AgUiNormalizationState,
  type AgUiParseIssue,
  type AgUiParser,
  type AgUiParseResult,
  type AgUiPendingStream,
  type AgUiProducerOccurrence,
  createAgUiParser,
  parseAgUiEvent,
  projectAgUiEvent,
  type ProjectAgUiEventInput,
  projectNativeEvent,
  type ProjectNativeEventInput,
  safeParseAgUiEvent,
} from "./ag-ui/index.ts";

export type {
  ChildRun,
  ChildRunReported,
  ErrorInfo,
  EventJsonObject,
  EventJsonValue,
  EventPayload,
  EventPayloadByType,
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
  assertEventSchemaValidator,
  EVENT_SCHEMA_VALIDATOR_CONTRACT,
  EVENT_SCHEMA_VALIDATOR_PACKAGE,
  registerEventSchemaValidator,
  tryResolveEventSchemaValidator,
  unregisterEventSchemaValidator,
} from "./schema-validator.ts";
export {
  type CloudEventsExtensionAttribute,
  EVENT_SCHEMA_BY_TYPE,
  EVENT_TYPES,
  type EventDataschema,
  type EventEnvelope,
  type EventExtensionAttributes,
  type EventParseIssue,
  type EventParseResult,
  type EventRecord,
  type EventType,
  type EventWithExtensions,
  type JsonObject,
  type JsonValue,
} from "./types.ts";

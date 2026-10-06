/**
 * Public AG-UI interoperability helpers.
 *
 * This entry point exposes the pinned AG-UI 1.0 parser, pure/stateful
 * normalization helpers, and the schema-validated native-profile dispatcher
 * used by API and Studio integration. Durable persistence belongs to API
 * receipt checkpoints. Lower-level family helpers and generated read-frame
 * constructors stay internal while the profile contracts settle.
 *
 * @module events/ag-ui
 */

export { acceptAgUiEvent, projectAgUiEvent } from "#veryfront/events/ag-ui/normalization.ts";
export {
  createAgUiParser,
  parseAgUiEvent,
  safeParseAgUiEvent,
} from "#veryfront/events/ag-ui/parser.ts";
export {
  parseNativeProfileRecord,
  projectAgUiNativeProfileEvent,
  projectNativeProfileEvent,
} from "#veryfront/events/ag-ui/native-profile.ts";
export {
  AG_UI_CORE_PACKAGE,
  AG_UI_CORE_VERSION,
  AG_UI_EVENT_SCHEMA,
  AG_UI_EVENT_TYPES,
  AG_UI_PROTOCOL_VERSION,
  AG_UI_RELEASE,
  AG_UI_RELEASE_COMMIT,
  type AgUiEventType,
} from "#veryfront/events/ag-ui/schema.ts";
export type {
  AcceptAgUiEventInput,
  AcceptAgUiEventResult,
  AgUiAcceptedEvent,
  AgUiAcceptedEventCommand,
  AgUiEvent,
  AgUiEventByType,
  AgUiEventOf,
  AgUiEventWithExtensions,
  AgUiExpandedEventCommand,
  AgUiJsonValue,
  AgUiMissingFactRequirementCommand,
  AgUiNormalizationCommand,
  AgUiNormalizationState,
  AgUiParseIssue,
  AgUiParser,
  AgUiParseResult,
  AgUiPendingStream,
  AgUiProducerOccurrence,
  ProjectAgUiEventInput,
} from "#veryfront/events/ag-ui/types.ts";
export type {
  AgUiNativeProfileContext,
  AgUiNativeProfileFamily,
  AgUiNativeProfileProjectionCommand,
  AgUiNativeProfileRecord,
  AgUiNativeProfileSupportedEvent,
  ProjectAgUiNativeProfileInput,
  ProjectNativeProfileInput,
} from "#veryfront/events/ag-ui/native-profile.ts";

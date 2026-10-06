import type { JsonSchemaValidationIssue } from "#veryfront/extensions/schema/index.ts";
import type { EventRecord } from "../types.ts";
import type { AG_UI_PROTOCOL_VERSION } from "./schema.ts";
import type {
  AgUiNativeProfileContext,
  AgUiNativeProfileFamily,
  AgUiNativeProfileRecord,
} from "./native-profile.ts";
import type { AgUiEvent, AgUiEventOf } from "./types.generated.ts";

export type {
  AgUiBaseEvent,
  AgUiEvent,
  AgUiEventByType,
  AgUiEventOf,
  AgUiEventWithExtensions,
  AgUiJsonValue,
  AgUiMetadata,
  AgUiProtocolExtensionFields,
  AgUiRunAgentInput,
} from "./types.generated.ts";

export type AgUiParseIssue = JsonSchemaValidationIssue;

export type AgUiParseResult =
  | { readonly success: true; readonly data: AgUiEvent }
  | { readonly success: false; readonly issues: readonly AgUiParseIssue[] };

export interface AgUiParser {
  safeParseAgUiEvent(input: unknown): AgUiParseResult;
  parseAgUiEvent(input: unknown): AgUiEvent;
}

export interface AgUiProducerOccurrence {
  readonly source: string;
  readonly id: string;
}

export interface AgUiAcceptedEvent {
  readonly protocol: "ag-ui";
  readonly protocolVersion: typeof AG_UI_PROTOCOL_VERSION;
  readonly producerOccurrence: AgUiProducerOccurrence;
  readonly event: AgUiEvent;
}

export interface AgUiExpandedEventCommand {
  readonly kind: "expanded-ag-ui-event";
  readonly producerOccurrence: AgUiProducerOccurrence;
  readonly expansionId: string;
  readonly ordinal: number;
  readonly event: AgUiEvent;
}

export interface AgUiAcceptedEventCommand {
  readonly kind: "accepted-ag-ui-event";
  readonly producerOccurrence: AgUiProducerOccurrence;
  readonly event: AgUiEvent;
}

export interface AgUiNativeProfileEventCommand {
  readonly kind: "canonical-native-event";
  readonly producerOccurrence: AgUiProducerOccurrence;
  readonly family: AgUiNativeProfileFamily;
  readonly event: AgUiNativeProfileRecord;
}

export interface AgUiMissingFactRequirementCommand {
  readonly kind: "missing-fact-requirement";
  readonly producerOccurrence: AgUiProducerOccurrence;
  readonly requirement:
    | "native-run-suspension-outcome"
    | "native-run-cancellation-outcome"
    | "native-state-synchronization"
    | "native-message-snapshot-synchronization"
    | "native-activity-synchronization"
    | "native-raw-protocol-signal"
    | "native-custom-protocol-signal"
    | "native-reasoning-context-boundary"
    | "native-opaque-reasoning-continuation"
    | "native-subagent-invocation-boundary"
    | "native-ag-ui-projection-context"
    | "native-unsupported-target-event"
    | "native-lossy-target-event"
    | "unambiguous-shorthand-context"
    | "conflicting-shorthand-context";
  readonly reason: string;
}

export type AgUiNormalizationCommand =
  | AgUiAcceptedEventCommand
  | AgUiExpandedEventCommand
  | AgUiNativeProfileEventCommand
  | AgUiMissingFactRequirementCommand;

export interface AcceptAgUiEventInput {
  readonly event: unknown;
  readonly producerOccurrence: AgUiProducerOccurrence;
  readonly normalizationState?: AgUiNormalizationState;
  readonly nativeProfileContext?: AgUiNativeProfileContext;
}

export interface AcceptAgUiEventResult {
  readonly accepted: AgUiAcceptedEvent;
  readonly commands: readonly AgUiNormalizationCommand[];
  readonly normalizationState: AgUiNormalizationState;
}

export type AgUiNativeMessageProjection =
  | {
    readonly kind: "text";
    readonly nativeMessageId: string;
    readonly nativeContentId: string;
    readonly agUiMessageId: string;
  }
  | {
    readonly kind: "reasoning";
    readonly nativeMessageId: string;
    readonly nativeContentId: string;
    readonly agUiMessageId: string;
  };

export interface AgUiNativeToolCallProjection {
  readonly nativeToolCallId: string;
  readonly agUiToolCallId: string;
  readonly resultMessageId?: string;
}

export interface AgUiNativeStepProjection {
  readonly nativeStepId: string;
  readonly agUiStepName: string;
}

export interface AgUiNativeRunProjection {
  readonly threadId: string;
}

export interface AgUiNativeProjectionContext {
  readonly run?: AgUiNativeRunProjection;
  readonly messages?: readonly AgUiNativeMessageProjection[];
  readonly toolCalls?: readonly AgUiNativeToolCallProjection[];
  readonly steps?: readonly AgUiNativeStepProjection[];
}

export interface AcceptNativeEventInput {
  readonly event: unknown;
  readonly projectionContext?: AgUiNativeProjectionContext;
}

export interface ProjectAgUiEventInput {
  readonly accepted: AgUiAcceptedEvent;
  readonly normalizationState?: AgUiNormalizationState;
}

export interface ProjectNativeEventInput {
  readonly event: EventRecord;
  readonly projectionContext?: AgUiNativeProjectionContext;
}

export type AgUiPendingStream =
  | {
    readonly kind: "text";
    readonly lane: string | undefined;
    readonly messageId: string;
    readonly role: NonNullable<AgUiEventOf<"TEXT_MESSAGE_CHUNK">["role"]>;
    readonly name?: string;
    readonly subagentRunId?: string;
  }
  | {
    readonly kind: "tool";
    readonly lane: string | undefined;
    readonly toolCallId: string;
    readonly toolCallName: string;
    readonly parentMessageId?: string;
    readonly subagentRunId?: string;
  }
  | {
    readonly kind: "reasoning";
    readonly lane: string | undefined;
    readonly messageId: string;
    readonly subagentRunId?: string;
  };

export interface AgUiNormalizationState {
  readonly pendingStreams: readonly AgUiPendingStream[];
}

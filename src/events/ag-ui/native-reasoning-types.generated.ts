/**
 * Generated internal AG-UI reasoning record types.
 *
 * Source: src/events/ag-ui/native-reasoning-contract.ts AG_UI_NATIVE_REASONING_RECORD_SCHEMA.
 * Regenerate with: deno run -A src/events/ag-ui/generate-native-reasoning-types.ts
 */

import type { AgUiEventOf, AgUiProtocolExtensionFields } from "#veryfront/events/ag-ui/types.ts";

export type AgUiNativeReasoningType =
  | "com.veryfront.reasoning.context.started"
  | "com.veryfront.reasoning.context.ended"
  | "com.veryfront.reasoning.continuation.recorded";

export interface AgUiNativeReasoningDataschemaByType {
  readonly "com.veryfront.reasoning.context.started":
    "urn:veryfront:ag-ui:internal:reasoning:payloads:1#/$defs/ReasoningContextStarted";
  readonly "com.veryfront.reasoning.context.ended":
    "urn:veryfront:ag-ui:internal:reasoning:payloads:1#/$defs/ReasoningContextEnded";
  readonly "com.veryfront.reasoning.continuation.recorded":
    "urn:veryfront:ag-ui:internal:reasoning:payloads:1#/$defs/ReasoningContinuationRecorded";
}

export type AgUiNativeReasoningDataschema<TType extends AgUiNativeReasoningType> =
  AgUiNativeReasoningDataschemaByType[TType];

export interface AgUiReasoningAttribution {
  readonly invocation?: {
    readonly subagentRunId: string;
  };
}

export type AgUiReasoningEventType =
  | "REASONING_START"
  | "REASONING_END"
  | "REASONING_ENCRYPTED_VALUE";

export interface AgUiReasoningEventByType {
  readonly REASONING_START: AgUiEventOf<"REASONING_START">;
  readonly REASONING_END: AgUiEventOf<"REASONING_END">;
  readonly REASONING_ENCRYPTED_VALUE: AgUiEventOf<"REASONING_ENCRYPTED_VALUE">;
}

export type AgUiNativeReasoningContextStartedPayload = {
  readonly "context": {
    readonly "messageId": AgUiEventOf<"REASONING_START">["messageId"];
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "REASONING_START";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"REASONING_START">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"REASONING_START">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "invocation"?: {
          readonly "subagentRunId": string;
        };
      };
    };
  };
};

export type AgUiNativeReasoningContextEndedPayload = {
  readonly "context": {
    readonly "messageId": AgUiEventOf<"REASONING_END">["messageId"];
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "REASONING_END";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"REASONING_END">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"REASONING_END">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "invocation"?: {
          readonly "subagentRunId": string;
        };
      };
    };
  };
};

export type AgUiNativeReasoningContinuationRecordedPayload = {
  readonly "continuation": {
    readonly "subtype": AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["subtype"];
    readonly "entityId": AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["entityId"];
    readonly "encryptedValue": AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["encryptedValue"];
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "REASONING_ENCRYPTED_VALUE";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "invocation"?: {
          readonly "subagentRunId": string;
        };
      };
    };
  };
};

export interface AgUiNativeReasoningPayloadByType {
  readonly "com.veryfront.reasoning.context.started": AgUiNativeReasoningContextStartedPayload;
  readonly "com.veryfront.reasoning.context.ended": AgUiNativeReasoningContextEndedPayload;
  readonly "com.veryfront.reasoning.continuation.recorded":
    AgUiNativeReasoningContinuationRecordedPayload;
}

type AgUiReasoningProtocolMetadataUnion = {
  readonly [TType in AgUiNativeReasoningType]: AgUiNativeReasoningPayloadByType[TType] extends {
    readonly protocol: { readonly agui: infer TProtocol };
  } ? TProtocol
    : never;
}[AgUiNativeReasoningType];

export type AgUiReasoningProtocolMetadata<
  TEventType extends AgUiReasoningEventType = AgUiReasoningEventType,
> = Extract<AgUiReasoningProtocolMetadataUnion, { readonly eventType: TEventType }>;

export type AgUiNativeReasoningPayload<TType extends AgUiNativeReasoningType> =
  AgUiNativeReasoningPayloadByType[TType];

export type AgUiNativeReasoningAnyPayload = {
  readonly [TType in AgUiNativeReasoningType]: AgUiNativeReasoningPayload<TType>;
}[AgUiNativeReasoningType];

export type AgUiNativeReasoningRecord<TType extends AgUiNativeReasoningType> = {
  readonly "specversion": "1.0";
  readonly "id": string;
  readonly "source": string;
  readonly "type": TType;
  readonly "dataschema": AgUiNativeReasoningDataschema<TType>;
  readonly "datacontenttype": "application/json";
  readonly "data": AgUiNativeReasoningPayload<TType>;
  readonly "runid"?: string;
  readonly "runkind"?: "agent" | "workflow" | "task";
  readonly "conversationid"?: string;
  readonly "subject"?: string;
  readonly "time"?: string;
  readonly "recordedat"?: string;
  readonly "traceparent"?: string;
  readonly "tracestate"?: string;
};

export type AgUiNativeReasoningAnyRecord = {
  readonly [TType in AgUiNativeReasoningType]: AgUiNativeReasoningRecord<TType>;
}[AgUiNativeReasoningType];

/**
 * Generated internal AG-UI synchronization record types.
 *
 * Source: src/events/ag-ui/native-synchronization-contract.ts AG_UI_NATIVE_SYNCHRONIZATION_RECORD_SCHEMA.
 * Regenerate with: deno run -A src/events/ag-ui/generate-native-synchronization-types.ts
 */

import type { AgUiEventOf, AgUiProtocolExtensionFields } from "#veryfront/events/ag-ui/types.ts";

export type AgUiNativeSynchronizationType =
  | "com.veryfront.synchronization.state.snapshot.recorded"
  | "com.veryfront.synchronization.state.delta.recorded"
  | "com.veryfront.synchronization.transcript.snapshot.recorded"
  | "com.veryfront.synchronization.activity.snapshot.recorded"
  | "com.veryfront.synchronization.activity.delta.recorded";

export interface AgUiNativeSynchronizationDataschemaByType {
  readonly "com.veryfront.synchronization.state.snapshot.recorded":
    "urn:veryfront:ag-ui:internal:synchronization:payloads:1#/$defs/StateSnapshotRecorded";
  readonly "com.veryfront.synchronization.state.delta.recorded":
    "urn:veryfront:ag-ui:internal:synchronization:payloads:1#/$defs/StateDeltaRecorded";
  readonly "com.veryfront.synchronization.transcript.snapshot.recorded":
    "urn:veryfront:ag-ui:internal:synchronization:payloads:1#/$defs/TranscriptSnapshotRecorded";
  readonly "com.veryfront.synchronization.activity.snapshot.recorded":
    "urn:veryfront:ag-ui:internal:synchronization:payloads:1#/$defs/ActivitySnapshotRecorded";
  readonly "com.veryfront.synchronization.activity.delta.recorded":
    "urn:veryfront:ag-ui:internal:synchronization:payloads:1#/$defs/ActivityDeltaRecorded";
}

export type AgUiNativeSynchronizationDataschema<TType extends AgUiNativeSynchronizationType> =
  AgUiNativeSynchronizationDataschemaByType[TType];

export interface AgUiSynchronizationAttribution {
  readonly invocation?: {
    readonly subagentRunId: string;
  };
}

export type AgUiSynchronizationEventType =
  | "STATE_SNAPSHOT"
  | "STATE_DELTA"
  | "MESSAGES_SNAPSHOT"
  | "ACTIVITY_SNAPSHOT"
  | "ACTIVITY_DELTA";

export interface AgUiSynchronizationEventByType {
  readonly STATE_SNAPSHOT: AgUiEventOf<"STATE_SNAPSHOT">;
  readonly STATE_DELTA: AgUiEventOf<"STATE_DELTA">;
  readonly MESSAGES_SNAPSHOT: AgUiEventOf<"MESSAGES_SNAPSHOT">;
  readonly ACTIVITY_SNAPSHOT: AgUiEventOf<"ACTIVITY_SNAPSHOT">;
  readonly ACTIVITY_DELTA: AgUiEventOf<"ACTIVITY_DELTA">;
}

export type AgUiNativeStateSnapshotRecordedPayload = {
  readonly "state": {
    readonly "snapshot": AgUiEventOf<"STATE_SNAPSHOT">["snapshot"];
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "STATE_SNAPSHOT";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"STATE_SNAPSHOT">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"STATE_SNAPSHOT">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "invocation"?: {
          readonly "subagentRunId": string;
        };
      };
    };
  };
};

export type AgUiNativeStateDeltaRecordedPayload = {
  readonly "state": {
    readonly "delta": AgUiEventOf<"STATE_DELTA">["delta"];
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "STATE_DELTA";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"STATE_DELTA">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"STATE_DELTA">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "invocation"?: {
          readonly "subagentRunId": string;
        };
      };
    };
  };
};

export type AgUiNativeTranscriptSnapshotRecordedPayload = {
  readonly "transcript": {
    readonly "messages": AgUiEventOf<"MESSAGES_SNAPSHOT">["messages"];
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "MESSAGES_SNAPSHOT";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"MESSAGES_SNAPSHOT">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"MESSAGES_SNAPSHOT">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "invocation"?: {
          readonly "subagentRunId": string;
        };
      };
    };
  };
};

export type AgUiNativeActivitySnapshotRecordedPayload = {
  readonly "activity": {
    readonly "messageId": AgUiEventOf<"ACTIVITY_SNAPSHOT">["messageId"];
    readonly "activityType": AgUiEventOf<"ACTIVITY_SNAPSHOT">["activityType"];
    readonly "content": AgUiEventOf<"ACTIVITY_SNAPSHOT">["content"];
    readonly "replace"?: AgUiEventOf<"ACTIVITY_SNAPSHOT">["replace"];
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "ACTIVITY_SNAPSHOT";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"ACTIVITY_SNAPSHOT">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"ACTIVITY_SNAPSHOT">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "invocation"?: {
          readonly "subagentRunId": string;
        };
      };
    };
  };
};

export type AgUiNativeActivityDeltaRecordedPayload = {
  readonly "activity": {
    readonly "messageId": AgUiEventOf<"ACTIVITY_DELTA">["messageId"];
    readonly "activityType": AgUiEventOf<"ACTIVITY_DELTA">["activityType"];
    readonly "patch": AgUiEventOf<"ACTIVITY_DELTA">["patch"];
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "ACTIVITY_DELTA";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"ACTIVITY_DELTA">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"ACTIVITY_DELTA">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "invocation"?: {
          readonly "subagentRunId": string;
        };
      };
    };
  };
};

export interface AgUiNativeSynchronizationPayloadByType {
  readonly "com.veryfront.synchronization.state.snapshot.recorded":
    AgUiNativeStateSnapshotRecordedPayload;
  readonly "com.veryfront.synchronization.state.delta.recorded":
    AgUiNativeStateDeltaRecordedPayload;
  readonly "com.veryfront.synchronization.transcript.snapshot.recorded":
    AgUiNativeTranscriptSnapshotRecordedPayload;
  readonly "com.veryfront.synchronization.activity.snapshot.recorded":
    AgUiNativeActivitySnapshotRecordedPayload;
  readonly "com.veryfront.synchronization.activity.delta.recorded":
    AgUiNativeActivityDeltaRecordedPayload;
}

type AgUiSynchronizationProtocolMetadataUnion = {
  readonly [TType in AgUiNativeSynchronizationType]:
    AgUiNativeSynchronizationPayloadByType[TType] extends {
      readonly protocol: { readonly agui: infer TProtocol };
    } ? TProtocol
      : never;
}[AgUiNativeSynchronizationType];

export type AgUiSynchronizationProtocolMetadata<
  TEventType extends AgUiSynchronizationEventType = AgUiSynchronizationEventType,
> = Extract<AgUiSynchronizationProtocolMetadataUnion, { readonly eventType: TEventType }>;

export type AgUiNativeSynchronizationPayload<TType extends AgUiNativeSynchronizationType> =
  AgUiNativeSynchronizationPayloadByType[TType];

export type AgUiNativeSynchronizationAnyPayload = {
  readonly [TType in AgUiNativeSynchronizationType]: AgUiNativeSynchronizationPayload<TType>;
}[AgUiNativeSynchronizationType];

export type AgUiNativeSynchronizationRecord<TType extends AgUiNativeSynchronizationType> = {
  readonly "specversion": "1.0";
  readonly "id": string;
  readonly "source": string;
  readonly "type": TType;
  readonly "dataschema": AgUiNativeSynchronizationDataschema<TType>;
  readonly "datacontenttype": "application/json";
  readonly "data": AgUiNativeSynchronizationPayload<TType>;
};

export type AgUiNativeSynchronizationAnyRecord = {
  readonly [TType in AgUiNativeSynchronizationType]: AgUiNativeSynchronizationRecord<TType>;
}[AgUiNativeSynchronizationType];

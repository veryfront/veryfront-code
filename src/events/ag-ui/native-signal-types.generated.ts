/**
 * Generated internal AG-UI signal record types.
 *
 * Source: src/events/ag-ui/native-signal-contract.ts AG_UI_NATIVE_SIGNAL_RECORD_SCHEMA.
 * Regenerate with: deno run -A src/events/ag-ui/generate-native-signal-types.ts
 */

import type { AgUiEventOf, AgUiProtocolExtensionFields } from "#veryfront/events/ag-ui/types.ts";

export type AgUiNativeSignalType =
  | "com.veryfront.signal.raw.recorded"
  | "com.veryfront.signal.custom.recorded";

export interface AgUiNativeSignalDataschemaByType {
  readonly "com.veryfront.signal.raw.recorded":
    "urn:veryfront:ag-ui:internal:signals:payloads:1#/$defs/RawSignalRecorded";
  readonly "com.veryfront.signal.custom.recorded":
    "urn:veryfront:ag-ui:internal:signals:payloads:1#/$defs/CustomSignalRecorded";
}

export type AgUiNativeSignalDataschema<TType extends AgUiNativeSignalType> =
  AgUiNativeSignalDataschemaByType[TType];

export interface AgUiSignalAttribution {
  readonly invocation?: {
    readonly subagentRunId: string;
  };
}

export type AgUiSignalEventType =
  | "RAW"
  | "CUSTOM";

export interface AgUiSignalEventByType {
  readonly RAW: AgUiEventOf<"RAW">;
  readonly CUSTOM: AgUiEventOf<"CUSTOM">;
}

export type AgUiNativeRawSignalRecordedPayload = {
  readonly "signal": {
    readonly "event": AgUiEventOf<"RAW">["event"];
    readonly "source"?: AgUiEventOf<"RAW">["source"];
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "RAW";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"RAW">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"RAW">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "invocation"?: {
          readonly "subagentRunId": string;
        };
      };
    };
  };
};

export type AgUiNativeCustomSignalRecordedPayload = {
  readonly "signal": {
    readonly "name": AgUiEventOf<"CUSTOM">["name"];
    readonly "value": AgUiEventOf<"CUSTOM">["value"];
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "CUSTOM";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"CUSTOM">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"CUSTOM">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "invocation"?: {
          readonly "subagentRunId": string;
        };
      };
    };
  };
};

export interface AgUiNativeSignalPayloadByType {
  readonly "com.veryfront.signal.raw.recorded": AgUiNativeRawSignalRecordedPayload;
  readonly "com.veryfront.signal.custom.recorded": AgUiNativeCustomSignalRecordedPayload;
}

type AgUiSignalProtocolMetadataUnion = {
  readonly [TType in AgUiNativeSignalType]: AgUiNativeSignalPayloadByType[TType] extends {
    readonly protocol: { readonly agui: infer TProtocol };
  } ? TProtocol
    : never;
}[AgUiNativeSignalType];

export type AgUiSignalProtocolMetadata<
  TEventType extends AgUiSignalEventType = AgUiSignalEventType,
> = Extract<AgUiSignalProtocolMetadataUnion, { readonly eventType: TEventType }>;

export type AgUiNativeSignalPayload<TType extends AgUiNativeSignalType> =
  AgUiNativeSignalPayloadByType[TType];

export type AgUiNativeSignalAnyPayload = {
  readonly [TType in AgUiNativeSignalType]: AgUiNativeSignalPayload<TType>;
}[AgUiNativeSignalType];

export type AgUiNativeSignalRecord<TType extends AgUiNativeSignalType> = {
  readonly "specversion": "1.0";
  readonly "id": string;
  readonly "source": string;
  readonly "type": TType;
  readonly "dataschema": AgUiNativeSignalDataschema<TType>;
  readonly "datacontenttype": "application/json";
  readonly "data": AgUiNativeSignalPayload<TType>;
  readonly "runid"?: string;
  readonly "runkind"?: "agent" | "workflow" | "task";
  readonly "conversationid"?: string;
  readonly "subject"?: string;
  readonly "time"?: string;
  readonly "recordedat"?: string;
  readonly "traceparent"?: string;
  readonly "tracestate"?: string;
};

export type AgUiNativeSignalAnyRecord = {
  readonly [TType in AgUiNativeSignalType]: AgUiNativeSignalRecord<TType>;
}[AgUiNativeSignalType];

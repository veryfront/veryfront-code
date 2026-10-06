/**
 * Generated internal AG-UI invocation record types.
 *
 * Source: src/events/ag-ui/native-invocation-contract.ts AG_UI_NATIVE_INVOCATION_RECORD_SCHEMA.
 * Regenerate with: deno run -A src/events/ag-ui/generate-native-invocation-types.ts
 */

import type { AgUiEventOf, AgUiProtocolExtensionFields } from "./types.ts";

export type AgUiNativeInvocationType =
  | "com.veryfront.invocation.started"
  | "com.veryfront.invocation.succeeded"
  | "com.veryfront.invocation.paused"
  | "com.veryfront.invocation.failed";

export interface AgUiNativeInvocationDataschemaByType {
  readonly "com.veryfront.invocation.started":
    "urn:veryfront:ag-ui:internal:invocation:payloads:1#/$defs/InvocationStarted";
  readonly "com.veryfront.invocation.succeeded":
    "urn:veryfront:ag-ui:internal:invocation:payloads:1#/$defs/InvocationSucceeded";
  readonly "com.veryfront.invocation.paused":
    "urn:veryfront:ag-ui:internal:invocation:payloads:1#/$defs/InvocationPaused";
  readonly "com.veryfront.invocation.failed":
    "urn:veryfront:ag-ui:internal:invocation:payloads:1#/$defs/InvocationFailed";
}

export type AgUiNativeInvocationDataschema<TType extends AgUiNativeInvocationType> =
  AgUiNativeInvocationDataschemaByType[TType];

export interface AgUiInvocationParentAttribution {
  readonly parent?: {
    readonly invocation?: { readonly subagentRunId: string };
    readonly tool?: { readonly toolCallId: string };
    readonly message?: { readonly messageId: string };
  };
}

export type AgUiInvocationEventType =
  | "SUBAGENT_STARTED"
  | "SUBAGENT_FINISHED"
  | "SUBAGENT_ERROR";

export interface AgUiInvocationEventByType {
  readonly SUBAGENT_STARTED: AgUiEventOf<"SUBAGENT_STARTED">;
  readonly SUBAGENT_FINISHED: AgUiEventOf<"SUBAGENT_FINISHED">;
  readonly SUBAGENT_ERROR: AgUiEventOf<"SUBAGENT_ERROR">;
}

export type AgUiNativeInvocationStartedPayload = {
  readonly "invocation": {
    readonly "subagentRunId": AgUiEventOf<"SUBAGENT_STARTED">["subagentRunId"];
    readonly "name": AgUiEventOf<"SUBAGENT_STARTED">["name"];
    readonly "description"?: AgUiEventOf<"SUBAGENT_STARTED">["description"];
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "SUBAGENT_STARTED";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"SUBAGENT_STARTED">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"SUBAGENT_STARTED">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "parent"?: {
          readonly "invocation"?: {
            readonly "subagentRunId": string;
          };
          readonly "tool"?: {
            readonly "toolCallId": string;
          };
          readonly "message"?: {
            readonly "messageId": string;
          };
        };
      };
    };
  };
};

export type AgUiNativeInvocationSucceededPayload = {
  readonly "invocation": {
    readonly "subagentRunId": AgUiEventOf<"SUBAGENT_FINISHED">["subagentRunId"];
    readonly "result"?: AgUiEventOf<"SUBAGENT_FINISHED">["result"];
    readonly "outcome"?: Extract<
      NonNullable<AgUiEventOf<"SUBAGENT_FINISHED">["outcome"]>,
      { readonly type: "success" }
    >;
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "SUBAGENT_FINISHED";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"SUBAGENT_FINISHED">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"SUBAGENT_FINISHED">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "parent"?: {
          readonly "invocation"?: {
            readonly "subagentRunId": string;
          };
          readonly "tool"?: {
            readonly "toolCallId": string;
          };
          readonly "message"?: {
            readonly "messageId": string;
          };
        };
      };
    };
  };
};

export type AgUiNativeInvocationPausedPayload = {
  readonly "invocation": {
    readonly "subagentRunId": AgUiEventOf<"SUBAGENT_FINISHED">["subagentRunId"];
    readonly "result"?: AgUiEventOf<"SUBAGENT_FINISHED">["result"];
    readonly "outcome": Extract<
      NonNullable<AgUiEventOf<"SUBAGENT_FINISHED">["outcome"]>,
      { readonly type: "suspended" }
    >;
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "SUBAGENT_FINISHED";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"SUBAGENT_FINISHED">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"SUBAGENT_FINISHED">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "parent"?: {
          readonly "invocation"?: {
            readonly "subagentRunId": string;
          };
          readonly "tool"?: {
            readonly "toolCallId": string;
          };
          readonly "message"?: {
            readonly "messageId": string;
          };
        };
      };
    };
  };
};

export type AgUiNativeInvocationFailedPayload = {
  readonly "invocation": {
    readonly "subagentRunId": AgUiEventOf<"SUBAGENT_ERROR">["subagentRunId"];
    readonly "message": AgUiEventOf<"SUBAGENT_ERROR">["message"];
    readonly "code"?: AgUiEventOf<"SUBAGENT_ERROR">["code"];
  };
  readonly "protocol": {
    readonly "agui": {
      readonly "name": "ag-ui";
      readonly "version": "1.0";
      readonly "eventType": "SUBAGENT_ERROR";
      readonly "timestamp"?: number;
      readonly "rawEvent"?: AgUiEventOf<"SUBAGENT_ERROR">["rawEvent"];
      readonly "metadata"?: AgUiEventOf<"SUBAGENT_ERROR">["metadata"];
      readonly "extensions"?: AgUiProtocolExtensionFields;
      readonly "attribution"?: {
        readonly "parent"?: {
          readonly "invocation"?: {
            readonly "subagentRunId": string;
          };
          readonly "tool"?: {
            readonly "toolCallId": string;
          };
          readonly "message"?: {
            readonly "messageId": string;
          };
        };
      };
    };
  };
};

export interface AgUiNativeInvocationPayloadByType {
  readonly "com.veryfront.invocation.started": AgUiNativeInvocationStartedPayload;
  readonly "com.veryfront.invocation.succeeded": AgUiNativeInvocationSucceededPayload;
  readonly "com.veryfront.invocation.paused": AgUiNativeInvocationPausedPayload;
  readonly "com.veryfront.invocation.failed": AgUiNativeInvocationFailedPayload;
}

type AgUiInvocationProtocolMetadataUnion = {
  readonly [TType in AgUiNativeInvocationType]: AgUiNativeInvocationPayloadByType[TType] extends {
    readonly protocol: { readonly agui: infer TProtocol };
  } ? TProtocol
    : never;
}[AgUiNativeInvocationType];

export type AgUiInvocationProtocolMetadata<
  TEventType extends AgUiInvocationEventType = AgUiInvocationEventType,
> = Extract<AgUiInvocationProtocolMetadataUnion, { readonly eventType: TEventType }>;

export type AgUiNativeInvocationPayload<TType extends AgUiNativeInvocationType> =
  AgUiNativeInvocationPayloadByType[TType];

export type AgUiNativeInvocationAnyPayload = {
  readonly [TType in AgUiNativeInvocationType]: AgUiNativeInvocationPayload<TType>;
}[AgUiNativeInvocationType];

export type AgUiNativeInvocationRecord<TType extends AgUiNativeInvocationType> = {
  readonly "specversion": "1.0";
  readonly "id": string;
  readonly "source": string;
  readonly "type": TType;
  readonly "dataschema": AgUiNativeInvocationDataschema<TType>;
  readonly "datacontenttype": "application/json";
  readonly "data": AgUiNativeInvocationPayload<TType>;
  readonly "runid"?: string;
  readonly "runkind"?: "agent" | "workflow" | "task";
  readonly "conversationid"?: string;
  readonly "subject"?: string;
  readonly "time"?: string;
  readonly "recordedat"?: string;
  readonly "traceparent"?: string;
  readonly "tracestate"?: string;
};

export type AgUiNativeInvocationAnyRecord = {
  readonly [TType in AgUiNativeInvocationType]: AgUiNativeInvocationRecord<TType>;
}[AgUiNativeInvocationType];

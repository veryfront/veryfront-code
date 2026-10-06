/**
 * Generated internal AG-UI run.paused record types.
 *
 * Source: src/events/ag-ui/native-run-paused-contract.ts AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA.
 * Regenerate with: deno run -A src/events/ag-ui/generate-native-run-paused-types.ts
 */

import type { AgUiEventOf, AgUiProtocolExtensionFields } from "#veryfront/events/ag-ui/types.ts";

export type AgUiNativeRunPausedType = "com.veryfront.run.paused";
export type AgUiNativeRunPausedDataschema =
  "urn:veryfront:ag-ui:internal:run-paused:1#/$defs/RunPaused";

export type AgUiNativeRunPausedPayload = {
  readonly "pause": {
    readonly "interrupts": Extract<
      NonNullable<AgUiEventOf<"RUN_FINISHED">["outcome"]>,
      { readonly type: "interrupt" }
    >["interrupts"];
  };
  readonly "extensions": AgUiProtocolExtensionFields & {
    readonly "urn:veryfront:ag-ui:protocol:run-lifecycle:1": AgUiNativeRunPausedProtocolMetadata;
  };
};

export type AgUiNativeRunPausedProtocolMetadata = {
  readonly "name": "ag-ui";
  readonly "version": "1.0";
  readonly "eventType": "RUN_FINISHED";
  readonly "timestamp"?: number;
  readonly "rawEvent"?: AgUiEventOf<"RUN_FINISHED">["rawEvent"];
  readonly "metadata"?: AgUiEventOf<"RUN_FINISHED">["metadata"];
  readonly "extensions"?: AgUiProtocolExtensionFields;
  readonly "attribution"?: {
    readonly "invocation"?: {
      readonly "subagentRunId": string;
    };
  };
  readonly "run": {
    readonly "threadId": string;
    readonly "runId": string;
    readonly "result"?: AgUiEventOf<"RUN_FINISHED">["result"];
  };
  readonly "outcome": Extract<
    NonNullable<AgUiEventOf<"RUN_FINISHED">["outcome"]>,
    { readonly type: "interrupt" }
  >;
  readonly "usage"?: AgUiEventOf<"RUN_FINISHED">["usage"];
};

export type AgUiNativeRunPausedRecord = {
  readonly "specversion": "1.0";
  readonly "id": string;
  readonly "source": string;
  readonly "type": "com.veryfront.run.paused";
  readonly "dataschema": "urn:veryfront:ag-ui:internal:run-paused:1#/$defs/RunPaused";
  readonly "datacontenttype": "application/json";
  readonly "data": {
    readonly "pause": {
      readonly "interrupts": Extract<
        NonNullable<AgUiEventOf<"RUN_FINISHED">["outcome"]>,
        { readonly type: "interrupt" }
      >["interrupts"];
    };
    readonly "extensions": AgUiProtocolExtensionFields & {
      readonly "urn:veryfront:ag-ui:protocol:run-lifecycle:1": AgUiNativeRunPausedProtocolMetadata;
    };
  };
  readonly "runid": string;
  readonly "runkind"?: "agent" | "workflow" | "task";
  readonly "conversationid"?: string;
  readonly "subject"?: string;
  readonly "time"?: string;
  readonly "recordedat"?: string;
  readonly "traceparent"?: string;
  readonly "tracestate"?: string;
};

/**
 * Generated Agent Events Protocol payload types.
 *
 * Source: src/events/contracts/target-payload-schemas.json.
 * Regenerate with: deno run -A src/events/generate-payload-types.mjs
 */

type EventAtLeastOne<T extends object> = {
  readonly [K in keyof T]-?: T & { readonly [P in K]-?: T[P] };
}[keyof T];

export type EventJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly EventJsonValue[]
  | EventJsonObject;

export type EventJsonObject = { readonly [key: string]: EventJsonValue };

/**
 * Optional producer-owned absolute URI namespaces, such as https://example.test/extensions or urn:org.example:telemetry. Each value is a JSON object; core fields remain closed. Publishing extensions still requires authorization.
 */
export type Extensions = { readonly [namespace: string]: EventJsonObject };

export type ErrorInfo = EventAtLeastOne<{
  readonly "code"?: string;
  readonly "message"?: string;
}>;

export type ModelDescriptor = {
  readonly "provider": string;
  readonly "name": string;
};

/**
 * Full captured model input or an explicit authorized redaction. Redaction is not missing-input recovery.
 */
export type ModelInput =
  | {
    readonly "messages": readonly EventJsonValue[];
    readonly "tools"?: readonly EventJsonValue[];
    readonly "parameters"?: EventJsonObject;
  }
    & {
      readonly "redacted"?: never;
    }
  | {
    readonly "redacted": true;
  }
    & {
      readonly "messages"?: never;
      readonly "tools"?: never;
      readonly "parameters"?: never;
    };

/**
 * Input/output token counts are the base counters. cacheRead and cacheWrite are subsets of input; reasoning is a subset of output. These counters are not additive charges and must not be added to input/output or total. Optional total is actually reported, not synthesized. Cross-field subset bounds are semantic conformance checks.
 */
export type TokenUsage = {
  readonly "input": number;
  readonly "output": number;
  readonly "total"?: number;
  readonly "cacheRead"?: number;
  readonly "cacheWrite"?: number;
  readonly "reasoning"?: number;
};

export type InputField = {
  readonly "name": string;
  readonly "type": string;
  readonly "label"?: string;
  readonly "required"?: boolean;
  readonly "options"?: readonly EventJsonValue[];
};

export type InputRequestSnapshot = {
  readonly "id": string;
  readonly "status": "open" | "submitted" | "cancelled" | "expired";
  readonly "title"?: string;
  readonly "description"?: string;
  readonly "fields"?: readonly InputField[];
  readonly "schema"?: EventJsonObject;
  readonly "response"?: EventJsonValue;
  readonly "expiresAt"?: string;
  readonly "toolCallId"?: string;
};

export type InputRequestReference = {
  readonly "id": string;
  readonly "uri": string;
  readonly "toolCallId"?: string;
};

export type InputRequestChanges = EventAtLeastOne<{
  readonly "status"?: "open" | "submitted" | "cancelled" | "expired";
  readonly "title"?: string;
  readonly "description"?: string | null;
  readonly "fields"?: readonly InputField[];
  readonly "schema"?: EventJsonObject;
  readonly "response"?: EventJsonValue;
  readonly "expiresAt"?: string | null;
}>;

export type ChildRun = {
  readonly "id": string;
  readonly "status":
    | "queued"
    | "running"
    | "waiting"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "unknown";
  readonly "kind"?: string;
  readonly "conversationId"?: string;
};

export type RunRequested = {
  readonly "extensions"?: Extensions;
};

export type RunEnqueued = {
  readonly "extensions"?: Extensions;
};

export type RunStarted = {
  readonly "extensions"?: Extensions;
};

export type RunSucceeded = {
  readonly "extensions"?: Extensions;
};

export type RunFailed = {
  readonly "error"?: ErrorInfo;
  readonly "extensions"?: Extensions;
};

export type RunCancelled = {
  readonly "reason"?: string;
  readonly "extensions"?: Extensions;
};

export type RunLogCaptured = {
  readonly "text": string;
  readonly "extensions"?: Extensions;
};

export type ChildRunReported = {
  readonly "childRun": ChildRun;
  readonly "toolCallId"?: string;
  readonly "extensions"?: Extensions;
};

export type StepStarted = {
  readonly "stepId": string;
  readonly "name"?: string;
  readonly "extensions"?: Extensions;
};

export type StepSucceeded = {
  readonly "stepId": string;
  readonly "name"?: string;
  readonly "extensions"?: Extensions;
};

export type StepFailed = {
  readonly "stepId": string;
  readonly "name"?: string;
  readonly "error"?: ErrorInfo;
  readonly "extensions"?: Extensions;
};

export type StepCancelled = {
  readonly "stepId": string;
  readonly "name"?: string;
  readonly "reason"?: string;
  readonly "extensions"?: Extensions;
};

export type StepEnded = {
  readonly "stepId": string;
  readonly "name"?: string;
  readonly "extensions"?: Extensions;
};

export type ToolCallStarted = {
  readonly "toolCallId": string;
  readonly "messageId"?: string;
  readonly "input"?: EventJsonValue;
  readonly "extensions"?: Extensions;
  readonly "toolName": string;
};

export type ToolCallArgumentsDeltaEmitted = {
  readonly "toolCallId": string;
  readonly "delta": string;
  readonly "extensions"?: Extensions;
};

export type ToolCallArgumentsEnded = {
  readonly "toolCallId": string;
  readonly "input"?: EventJsonValue;
  readonly "extensions"?: Extensions;
};

export type ToolCallRefused = {
  readonly "toolCallId": string;
  readonly "reason":
    | (
      | "missing_integration_connection"
      | "permission_denied"
      | "budget_exhausted"
      | "invalid_input"
    )
    | string;
  readonly "integration"?: string;
  readonly "message"?: string;
  readonly "extensions"?: Extensions;
  readonly "toolName"?: string;
};

export type ToolCallStatusReported = {
  readonly "toolCallId": string;
  readonly "status":
    | "introduced"
    | "argumentsReady"
    | "queued"
    | "running"
    | "waiting"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "refused"
    | "unknown";
  readonly "message"?: string;
  readonly "extensions"?: Extensions;
};

export type ToolCallResultRecordedBase = {
  readonly "toolCallId": string;
  readonly "output"?: EventJsonValue;
  readonly "outputRedacted"?: true;
  readonly "isError"?: boolean;
  readonly "extensions"?: Extensions;
};
export type ToolCallResultRecorded =
  & Omit<ToolCallResultRecordedBase, "output" | "outputRedacted">
  & (
    | { readonly output: EventJsonValue; readonly outputRedacted?: never }
    | { readonly outputRedacted: true; readonly output?: never }
  );

export type ToolCallResultSubmittedBase = {
  readonly "toolCallId": string;
  readonly "output"?: EventJsonValue;
  readonly "outputRedacted"?: true;
  readonly "isError"?: boolean;
  readonly "extensions"?: Extensions;
};
export type ToolCallResultSubmitted =
  & Omit<ToolCallResultSubmittedBase, "output" | "outputRedacted">
  & (
    | { readonly output: EventJsonValue; readonly outputRedacted?: never }
    | { readonly outputRedacted: true; readonly output?: never }
  );

export type ToolCallResultDeliveryFailed = {
  readonly "toolCallId": string;
  readonly "error"?: ErrorInfo;
  readonly "extensions"?: Extensions;
};

export type ModelCallInputCaptured = {
  readonly "model": ModelDescriptor;
  readonly "input": ModelInput;
  readonly "extensions"?: Extensions;
};

export type ModelCallUsageRecorded = {
  readonly "model": ModelDescriptor;
  readonly "tokens": TokenUsage;
  readonly "durationMs"?: number;
  readonly "extensions"?: Extensions;
  readonly "scope": "attempt" | "call";
};

export type InputRequestCreated = {
  readonly inputRequest:
    | InputRequestReference
      & {
        readonly "status"?: never;
        readonly "title"?: never;
        readonly "description"?: never;
        readonly "fields"?: never;
        readonly "schema"?: never;
        readonly "response"?: never;
        readonly "expiresAt"?: never;
      }
    | (Omit<InputRequestSnapshot, "status"> & { readonly status: "open" } & {
      readonly "uri"?: never;
    });
  readonly extensions?: Extensions;
};

export type InputRequestUpdated =
  | {
    readonly inputRequest:
      & InputRequestReference
      & {
        readonly "status"?: never;
        readonly "title"?: never;
        readonly "description"?: never;
        readonly "fields"?: never;
        readonly "schema"?: never;
        readonly "response"?: never;
        readonly "expiresAt"?: never;
      };
    readonly changes: InputRequestChanges;
    readonly extensions?: Extensions;
  }
  | {
    readonly inputRequest:
      & InputRequestSnapshot
      & {
        readonly "uri"?: never;
      };
    readonly changes?: never;
    readonly extensions?: Extensions;
  };

export type MessageTextStarted = {
  readonly "messageId": string;
  readonly "contentId": string;
  readonly "role"?: "assistant" | "user" | "system" | "developer" | "tool";
  readonly "extensions"?: Extensions;
};

export type MessageTextDeltaEmittedBase = {
  readonly "messageId": string;
  readonly "contentId": string;
  readonly "delta"?: string;
  readonly "contentRedacted"?: true;
  readonly "extensions"?: Extensions;
};
export type MessageTextDeltaEmitted =
  & Omit<MessageTextDeltaEmittedBase, "delta" | "contentRedacted">
  & (
    | { readonly delta: string; readonly contentRedacted?: never }
    | { readonly contentRedacted: true; readonly delta?: never }
  );

export type MessageTextEnded = {
  readonly "messageId": string;
  readonly "contentId": string;
  readonly "extensions"?: Extensions;
};

export type MessageReasoningStarted = {
  readonly "messageId": string;
  readonly "contentId": string;
  readonly "extensions"?: Extensions;
};

export type MessageReasoningDeltaEmittedBase = {
  readonly "messageId": string;
  readonly "contentId": string;
  readonly "delta"?: string;
  readonly "contentRedacted"?: true;
  readonly "extensions"?: Extensions;
};
export type MessageReasoningDeltaEmitted =
  & Omit<MessageReasoningDeltaEmittedBase, "delta" | "contentRedacted">
  & (
    | { readonly delta: string; readonly contentRedacted?: never }
    | { readonly contentRedacted: true; readonly delta?: never }
  );

export type MessageReasoningEnded = {
  readonly "messageId": string;
  readonly "contentId": string;
  readonly "extensions"?: Extensions;
};

export type MessageUrlReferenced = {
  readonly "messageId": string;
  readonly "contentId"?: string;
  readonly "sourceId": string;
  readonly "url": string;
  readonly "title"?: string;
  readonly "extensions"?: Extensions;
};

export type MessageDocumentReferenced = {
  readonly "messageId": string;
  readonly "contentId"?: string;
  readonly "sourceId": string;
  readonly "mediaType": string;
  readonly "title"?: string;
  readonly "filename"?: string;
  readonly "extensions"?: Extensions;
};

export type MessageFileAttached = {
  readonly "messageId": string;
  readonly "contentId"?: string;
  readonly "mediaType": string;
  readonly "url"?: string;
  readonly "filename"?: string;
  readonly "extensions"?: Extensions;
};

export type StreamHeartbeatEmitted = {
  readonly "extensions"?: Extensions;
};

export type StreamClosed = {
  readonly "reason": string | string;
  readonly "extensions"?: Extensions;
};

export interface EventEnvelopeRequiredByType {
  readonly "com.veryfront.run.requested": "runid";
  readonly "com.veryfront.run.enqueued": "runid";
  readonly "com.veryfront.run.started": "runid";
  readonly "com.veryfront.run.succeeded": "runid";
  readonly "com.veryfront.run.failed": "runid";
  readonly "com.veryfront.run.cancelled": "runid";
  readonly "com.veryfront.run.log.captured": "runid";
  readonly "com.veryfront.child-run.reported": "runid";
  readonly "com.veryfront.step.started": "runid";
  readonly "com.veryfront.step.succeeded": "runid";
  readonly "com.veryfront.step.failed": "runid";
  readonly "com.veryfront.step.cancelled": "runid";
  readonly "com.veryfront.step.ended": "runid";
  readonly "com.veryfront.model-call.input.captured": "modelcallid";
  readonly "com.veryfront.model-call.usage.recorded": "modelcallid";
}

export interface EventAttemptScopeEnvelopeRequiredByType {
  readonly "com.veryfront.model-call.usage.recorded": "attemptid";
}

export interface EventPayloadByType {
  readonly "com.veryfront.run.requested": RunRequested;
  readonly "com.veryfront.run.enqueued": RunEnqueued;
  readonly "com.veryfront.run.started": RunStarted;
  readonly "com.veryfront.run.succeeded": RunSucceeded;
  readonly "com.veryfront.run.failed": RunFailed;
  readonly "com.veryfront.run.cancelled": RunCancelled;
  readonly "com.veryfront.run.log.captured": RunLogCaptured;
  readonly "com.veryfront.child-run.reported": ChildRunReported;
  readonly "com.veryfront.step.started": StepStarted;
  readonly "com.veryfront.step.succeeded": StepSucceeded;
  readonly "com.veryfront.step.failed": StepFailed;
  readonly "com.veryfront.step.cancelled": StepCancelled;
  readonly "com.veryfront.step.ended": StepEnded;
  readonly "com.veryfront.tool-call.started": ToolCallStarted;
  readonly "com.veryfront.tool-call.arguments.delta.emitted": ToolCallArgumentsDeltaEmitted;
  readonly "com.veryfront.tool-call.arguments.ended": ToolCallArgumentsEnded;
  readonly "com.veryfront.tool-call.refused": ToolCallRefused;
  readonly "com.veryfront.tool-call.status.reported": ToolCallStatusReported;
  readonly "com.veryfront.tool-call.result.recorded": ToolCallResultRecorded;
  readonly "com.veryfront.tool-call.result.submitted": ToolCallResultSubmitted;
  readonly "com.veryfront.tool-call.result.delivery.failed": ToolCallResultDeliveryFailed;
  readonly "com.veryfront.model-call.input.captured": ModelCallInputCaptured;
  readonly "com.veryfront.model-call.usage.recorded": ModelCallUsageRecorded;
  readonly "com.veryfront.input-request.created": InputRequestCreated;
  readonly "com.veryfront.input-request.updated": InputRequestUpdated;
  readonly "com.veryfront.message.text.started": MessageTextStarted;
  readonly "com.veryfront.message.text.delta.emitted": MessageTextDeltaEmitted;
  readonly "com.veryfront.message.text.ended": MessageTextEnded;
  readonly "com.veryfront.message.reasoning.started": MessageReasoningStarted;
  readonly "com.veryfront.message.reasoning.delta.emitted": MessageReasoningDeltaEmitted;
  readonly "com.veryfront.message.reasoning.ended": MessageReasoningEnded;
  readonly "com.veryfront.message.url.referenced": MessageUrlReferenced;
  readonly "com.veryfront.message.document.referenced": MessageDocumentReferenced;
  readonly "com.veryfront.message.file.attached": MessageFileAttached;
  readonly "com.veryfront.stream.heartbeat.emitted": StreamHeartbeatEmitted;
  readonly "com.veryfront.stream.closed": StreamClosed;
}

export type EventPayload<TType extends keyof EventPayloadByType> = EventPayloadByType[TType];

import type {
  CloudEventsExtensionAttribute,
  ErrorInfo,
  EventDataschema,
  EventEnvelope,
  EventPayloadByType,
  EventRecord,
  EventWithExtensions,
  ModelInput,
} from "./index.ts";

function readNarrowedEvent(event: EventRecord): string {
  switch (event.type) {
    case "com.veryfront.message.text.delta.emitted":
      if (event.data.delta !== undefined) {
        const delta: string = event.data.delta;
        // @ts-expect-error the redaction branch cannot also expose contentRedacted
        const redacted: true = event.data.contentRedacted;
        void redacted;
        return delta;
      }
      return event.data.contentRedacted ? "" : "";
    case "com.veryfront.tool-call.result.recorded":
      if (event.data.outputRedacted === true) {
        const redacted: true = event.data.outputRedacted;
        // @ts-expect-error output is absent on the redaction branch
        const output: string = event.data.output;
        void output;
        return redacted ? "" : "";
      }
      return JSON.stringify(event.data.output);
    case "com.veryfront.model-call.usage.recorded": {
      const provider: string = event.data.model.provider;
      const inputTokens: number = event.data.tokens.input;
      const scope: "attempt" | "call" = event.data.scope;
      return `${provider}:${scope}:${inputTokens}`;
    }
    default:
      return event.id;
  }
}

const textDelta: EventPayloadByType["com.veryfront.message.text.delta.emitted"] = {
  messageId: "message-a",
  contentId: "text-a",
  delta: "hello",
};

const textRedacted: EventPayloadByType["com.veryfront.message.text.delta.emitted"] = {
  messageId: "message-a",
  contentId: "text-a",
  contentRedacted: true,
};

const eventWithExtension: EventWithExtensions<
  "com.veryfront.run.started",
  { customtag: boolean }
> = {
  specversion: "1.0",
  id: "event-a",
  source: "https://example.test/events",
  type: "com.veryfront.run.started",
  datacontenttype: "application/json",
  dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/RunStarted",
  runid: "run-a",
  data: {},
  customtag: true,
};

if (typeof eventWithExtension.customtag === "boolean") {
  const extensionAttribute: CloudEventsExtensionAttribute = eventWithExtension.customtag;
  void extensionAttribute;
}

const runStartedWithoutExtensions: EventWithExtensions<"com.veryfront.run.started"> = {
  specversion: "1.0",
  id: "event-a",
  source: "https://example.test/events",
  type: "com.veryfront.run.started",
  datacontenttype: "application/json",
  dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/RunStarted",
  runid: "run-a",
  data: {},
};
void runStartedWithoutExtensions;

const runStartedEnvelope: EventEnvelope<
  "com.veryfront.run.started",
  EventDataschema<"com.veryfront.run.started">
> = runStartedWithoutExtensions;
void runStartedEnvelope;

const runStartedEnvelopeWithExtensions: EventEnvelope<
  "com.veryfront.run.started",
  EventDataschema<"com.veryfront.run.started">,
  { customtag: boolean }
> = eventWithExtension;
void runStartedEnvelopeWithExtensions;

const runStartedEnvelopeWithUnknownSchema: EventEnvelope<
  "com.veryfront.run.started",
  // @ts-expect-error an envelope schema must match its event type
  "urn:example:wrong-schema"
> = { ...runStartedWithoutExtensions, dataschema: "urn:example:wrong-schema" };
void runStartedEnvelopeWithUnknownSchema;

const runStartedEnvelopeWithOtherEventSchema: EventEnvelope<
  "com.veryfront.run.started",
  // @ts-expect-error another catalog event's schema cannot describe run.started
  EventDataschema<"com.veryfront.run.succeeded">
> = {
  ...runStartedWithoutExtensions,
  dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/RunSucceeded",
};
void runStartedEnvelopeWithOtherEventSchema;

const eventWithObjectExtension: EventWithExtensions<
  "com.veryfront.run.started",
  { customtag: boolean }
> = {
  specversion: "1.0",
  id: "event-a",
  source: "https://example.test/events",
  type: "com.veryfront.run.started",
  datacontenttype: "application/json",
  dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/RunStarted",
  runid: "run-a",
  data: {},
  // @ts-expect-error custom CloudEvents extension attributes must be scalar values
  customtag: {},
};

const textBoth: EventPayloadByType["com.veryfront.message.text.delta.emitted"] = {
  messageId: "message-a",
  contentId: "text-a",
  delta: "hello",
  // @ts-expect-error a text delta cannot carry both content and redaction
  contentRedacted: true,
};

const modelInput: ModelInput = {
  messages: [],
};

const modelInputRedacted: ModelInput = {
  redacted: true,
};

// @ts-expect-error captured model input cannot also carry explicit redaction
const modelInputMixed: ModelInput = {
  messages: [],
  redacted: true,
};

const errorInfoWithCode: ErrorInfo = {
  code: "failed",
};
void errorInfoWithCode;

// @ts-expect-error at least-one selections cannot satisfy a selected key with explicit undefined
const errorInfoWithUndefinedCode: ErrorInfo = {
  code: undefined,
};
void errorInfoWithUndefinedCode;

const createdSnapshot: EventPayloadByType["com.veryfront.input-request.created"] = {
  inputRequest: {
    id: "request-a",
    status: "open",
  },
};

const createdSubmitted: EventPayloadByType["com.veryfront.input-request.created"] = {
  inputRequest: {
    id: "request-a",
    // @ts-expect-error created snapshots must be open
    status: "submitted",
  },
};

const createdWithToolCall: EventPayloadByType["com.veryfront.input-request.created"] = {
  inputRequest: {
    id: "request-a",
    status: "open",
    toolCallId: "tool-call-a",
  },
};

const createdMixedReferenceSnapshot: EventPayloadByType["com.veryfront.input-request.created"] = {
  inputRequest: {
    id: "request-a",
    uri: "https://example.test/input-requests/request-a",
    // @ts-expect-error input request references cannot also carry snapshot status
    status: "open",
  },
};

const updatedReference: EventPayloadByType["com.veryfront.input-request.updated"] = {
  inputRequest: {
    id: "request-a",
    uri: "https://example.test/input-requests/request-a",
  },
  changes: {
    status: "submitted",
  },
};

// @ts-expect-error reference-based updates require typed changes
const updatedReferenceWithoutChanges: EventPayloadByType["com.veryfront.input-request.updated"] = {
  inputRequest: {
    id: "request-a",
    uri: "https://example.test/input-requests/request-a",
  },
};

// @ts-expect-error snapshot-based updates cannot also carry changes
const updatedSnapshotWithChanges: EventPayloadByType["com.veryfront.input-request.updated"] = {
  inputRequest: {
    id: "request-a",
    status: "submitted",
  },
  changes: {
    title: "Changed",
  },
};

const updatedMixedSnapshotReference: EventPayloadByType["com.veryfront.input-request.updated"] = {
  // @ts-expect-error input request snapshots cannot also carry reference uri
  inputRequest: {
    id: "request-a",
    status: "submitted",
    uri: "https://example.test/input-requests/request-a",
  },
};

const updatedChangesWithToolCall: EventPayloadByType["com.veryfront.input-request.updated"] = {
  inputRequest: {
    id: "request-a",
    uri: "https://example.test/input-requests/request-a",
  },
  changes: {
    status: "submitted",
    // @ts-expect-error toolCallId is immutable and belongs on the request snapshot or reference
    toolCallId: "tool-call-b",
  },
};

const updatedReferenceEmptyChanges: EventPayloadByType["com.veryfront.input-request.updated"] = {
  inputRequest: {
    id: "request-a",
    uri: "https://example.test/input-requests/request-a",
  },
  // @ts-expect-error input request reference updates must include at least one typed change
  changes: {},
};

const updatedReferenceUndefinedStatus: EventPayloadByType["com.veryfront.input-request.updated"] = {
  inputRequest: {
    id: "request-a",
    uri: "https://example.test/input-requests/request-a",
  },
  // @ts-expect-error undefined does not satisfy the required changed field
  changes: { status: undefined },
};
void updatedReferenceUndefinedStatus;

// @ts-expect-error run lifecycle events require the envelope runid
const runStartedWithoutRunId: EventRecord<"com.veryfront.run.started"> = {
  specversion: "1.0",
  id: "event-a",
  source: "https://example.test/events",
  type: "com.veryfront.run.started",
  datacontenttype: "application/json",
  dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/RunStarted",
  data: {},
};

const modelCallUsageAttempt: EventRecord<"com.veryfront.model-call.usage.recorded"> = {
  specversion: "1.0",
  id: "event-a",
  source: "https://example.test/events",
  type: "com.veryfront.model-call.usage.recorded",
  datacontenttype: "application/json",
  dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/ModelCallUsageRecorded",
  modelcallid: "model-call-a",
  attemptid: "attempt-a",
  data: {
    model: { provider: "openai", name: "gpt-5" },
    tokens: { input: 1, output: 2 },
    scope: "attempt",
  },
};

// @ts-expect-error attempt-scoped model usage requires envelope attemptid
const modelCallUsageAttemptWithoutAttemptId: EventRecord<
  "com.veryfront.model-call.usage.recorded"
> = {
  specversion: "1.0",
  id: "event-a",
  source: "https://example.test/events",
  type: "com.veryfront.model-call.usage.recorded",
  datacontenttype: "application/json",
  dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/ModelCallUsageRecorded",
  modelcallid: "model-call-a",
  data: {
    model: { provider: "openai", name: "gpt-5" },
    tokens: { input: 1, output: 2 },
    scope: "attempt",
  },
};

const modelCallUsageCall: EventRecord<"com.veryfront.model-call.usage.recorded"> = {
  specversion: "1.0",
  id: "event-a",
  source: "https://example.test/events",
  type: "com.veryfront.model-call.usage.recorded",
  datacontenttype: "application/json",
  dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/ModelCallUsageRecorded",
  modelcallid: "model-call-a",
  data: {
    model: { provider: "openai", name: "gpt-5" },
    tokens: { input: 1, output: 2 },
    scope: "call",
  },
};

// @ts-expect-error call-scoped model usage omits envelope attemptid
const modelCallUsageCallWithAttemptId: EventRecord<"com.veryfront.model-call.usage.recorded"> = {
  specversion: "1.0",
  id: "event-a",
  source: "https://example.test/events",
  type: "com.veryfront.model-call.usage.recorded",
  datacontenttype: "application/json",
  dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/ModelCallUsageRecorded",
  modelcallid: "model-call-a",
  attemptid: "attempt-a",
  data: {
    model: { provider: "openai", name: "gpt-5" },
    tokens: { input: 1, output: 2 },
    scope: "call",
  },
};

// @ts-expect-error model call input events require the envelope modelcallid
const modelInputWithoutModelCallId: EventRecord<"com.veryfront.model-call.input.captured"> = {
  specversion: "1.0",
  id: "event-a",
  source: "https://example.test/events",
  type: "com.veryfront.model-call.input.captured",
  datacontenttype: "application/json",
  dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/ModelCallInputCaptured",
  data: {
    model: { provider: "openai", name: "gpt-5" },
    input: { redacted: true },
  },
};

void readNarrowedEvent;
void textDelta;
void textRedacted;
void eventWithExtension;
void eventWithObjectExtension;
void textBoth;
void modelInput;
void modelInputRedacted;
void modelInputMixed;
void createdSnapshot;
void createdSubmitted;
void createdWithToolCall;
void createdMixedReferenceSnapshot;
void updatedReference;
void updatedReferenceWithoutChanges;
void updatedSnapshotWithChanges;
void updatedMixedSnapshotReference;
void updatedChangesWithToolCall;
void updatedReferenceEmptyChanges;
void runStartedWithoutRunId;
void modelCallUsageAttempt;
void modelCallUsageAttemptWithoutAttemptId;
void modelCallUsageCall;
void modelCallUsageCallWithAttemptId;
void modelInputWithoutModelCallId;

import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";

export const AG_UI_PROTOCOL_VERSION = "1.0";
export const AG_UI_CORE_PACKAGE = "@ag-ui/core";
export const AG_UI_CORE_VERSION = "1.0.2";
export const AG_UI_RELEASE = "release/2026-10-05";
export const AG_UI_RELEASE_COMMIT = "e776b21027bef590905fb75f004e995dbe0941f4";

export const AG_UI_EVENT_TYPES = [
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "TEXT_MESSAGE_CHUNK",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_END",
  "TOOL_CALL_CHUNK",
  "TOOL_CALL_RESULT",
  "STATE_SNAPSHOT",
  "STATE_DELTA",
  "MESSAGES_SNAPSHOT",
  "ACTIVITY_SNAPSHOT",
  "ACTIVITY_DELTA",
  "RAW",
  "CUSTOM",
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "STEP_STARTED",
  "STEP_FINISHED",
  "REASONING_START",
  "REASONING_MESSAGE_START",
  "REASONING_MESSAGE_CONTENT",
  "REASONING_MESSAGE_END",
  "REASONING_MESSAGE_CHUNK",
  "REASONING_END",
  "REASONING_ENCRYPTED_VALUE",
  "SUBAGENT_STARTED",
  "SUBAGENT_FINISHED",
  "SUBAGENT_ERROR",
] as const;

export type AgUiEventType = typeof AG_UI_EVENT_TYPES[number];

const safeInteger = {
  type: "integer",
  minimum: Number.MIN_SAFE_INTEGER,
  maximum: Number.MAX_SAFE_INTEGER,
} satisfies JsonSchema;

const nonNull = { not: { type: "null" } } satisfies JsonSchema;
const jsonObject = {
  type: "object",
  additionalProperties: true,
} satisfies JsonSchema;

const metadata = jsonObject;
const commonEventProperties = {
  timestamp: safeInteger,
  rawEvent: nonNull,
  metadata,
  subagentRunId: { type: "string" },
} satisfies Record<string, JsonSchema>;

const textMessageRole = {
  enum: ["developer", "system", "assistant", "user"],
} satisfies JsonSchema;

const jsonPointer = {
  type: "string",
  pattern: "^(/([^/~]|~[01])*)*$",
} satisfies JsonSchema;

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: readonly string[],
): JsonSchema {
  return {
    type: "object",
    additionalProperties: true,
    properties,
    required: [...required],
  };
}

function eventSchema(
  type: AgUiEventType,
  properties: Record<string, JsonSchema>,
  required: readonly string[],
): JsonSchema {
  return objectSchema(
    {
      ...commonEventProperties,
      type: { const: type },
      ...properties,
    },
    ["type", ...required],
  );
}

const dataSource = objectSchema(
  {
    type: { const: "data" },
    value: { type: "string" },
    mimeType: { type: "string" },
  },
  ["type", "value", "mimeType"],
);

const urlSource = objectSchema(
  {
    type: { const: "url" },
    value: { type: "string" },
    mimeType: { type: "string" },
  },
  ["type", "value"],
);

const fileSource = objectSchema(
  {
    type: { const: "file" },
    value: { type: "string" },
    provider: { type: "string" },
    mimeType: { type: "string" },
  },
  ["type", "value"],
);

const partSource = { oneOf: [dataSource, urlSource, fileSource] } satisfies JsonSchema;
const partMetadata = nonNull;
const textPart = objectSchema(
  {
    type: { const: "text" },
    id: { type: "string" },
    text: { type: "string" },
    metadata: partMetadata,
  },
  ["type", "text"],
);

function mediaPart(type: "image" | "audio" | "video" | "document"): JsonSchema {
  return objectSchema(
    {
      type: { const: type },
      id: { type: "string" },
      source: partSource,
      metadata: partMetadata,
    },
    ["type", "source"],
  );
}

const contentPart = {
  oneOf: [
    textPart,
    mediaPart("image"),
    mediaPart("audio"),
    mediaPart("video"),
    mediaPart("document"),
  ],
} satisfies JsonSchema;

const stringOrParts = {
  oneOf: [{ type: "string" }, { type: "array", items: contentPart }],
} satisfies JsonSchema;

const functionCall = objectSchema(
  {
    name: { type: "string" },
    arguments: { type: "string" },
  },
  ["name", "arguments"],
);

const toolCall = objectSchema(
  {
    id: { type: "string" },
    type: { const: "function" },
    function: functionCall,
    encryptedValue: { type: "string" },
    metadata,
  },
  ["id", "type", "function"],
);

function baseMessage(
  messageRole: string,
  properties: Record<string, JsonSchema>,
  required: readonly string[],
): JsonSchema {
  return objectSchema(
    {
      subagentRunId: { type: "string" },
      id: { type: "string" },
      role: { const: messageRole },
      name: { type: "string" },
      encryptedValue: { type: "string" },
      metadata,
      ...properties,
    },
    ["id", "role", ...required],
  );
}

const message = {
  oneOf: [
    baseMessage("developer", { content: { type: "string" } }, ["content"]),
    baseMessage("system", { content: { type: "string" } }, ["content"]),
    baseMessage("assistant", {
      content: { type: "string" },
      toolCalls: { type: "array", items: toolCall },
    }, []),
    baseMessage("user", { content: stringOrParts }, ["content"]),
    objectSchema({
      subagentRunId: { type: "string" },
      id: { type: "string" },
      role: { const: "tool" },
      content: stringOrParts,
      toolCallId: { type: "string" },
      error: { type: "string" },
      encryptedValue: { type: "string" },
      metadata,
    }, ["id", "role", "content", "toolCallId"]),
    objectSchema({
      subagentRunId: { type: "string" },
      id: { type: "string" },
      role: { const: "activity" },
      activityType: { type: "string" },
      content: jsonObject,
      metadata,
    }, ["id", "role", "activityType", "content"]),
    objectSchema({
      subagentRunId: { type: "string" },
      id: { type: "string" },
      role: { const: "reasoning" },
      content: { type: "string" },
      encryptedValue: { type: "string" },
      metadata,
    }, ["id", "role", "content"]),
  ],
} satisfies JsonSchema;

const jsonPatchOperation = {
  oneOf: [
    objectSchema({ op: { const: "add" }, path: jsonPointer, value: {} }, ["op", "path", "value"]),
    objectSchema({ op: { const: "remove" }, path: jsonPointer }, ["op", "path"]),
    objectSchema({ op: { const: "replace" }, path: jsonPointer, value: {} }, [
      "op",
      "path",
      "value",
    ]),
    objectSchema({ op: { const: "move" }, from: jsonPointer, path: jsonPointer }, [
      "op",
      "from",
      "path",
    ]),
    objectSchema({ op: { const: "copy" }, from: jsonPointer, path: jsonPointer }, [
      "op",
      "from",
      "path",
    ]),
    objectSchema({ op: { const: "test" }, path: jsonPointer, value: {} }, ["op", "path", "value"]),
  ],
} satisfies JsonSchema;

const jsonPatch = { type: "array", items: jsonPatchOperation } satisfies JsonSchema;
const tokenUsage = objectSchema({
  provider: { type: "string" },
  model: { type: "string" },
  inputTokens: { ...safeInteger, minimum: 0 },
  outputTokens: { ...safeInteger, minimum: 0 },
  totalTokens: { ...safeInteger, minimum: 0 },
  reasoningTokens: { ...safeInteger, minimum: 0 },
  cachedInputTokens: { ...safeInteger, minimum: 0 },
  cacheWriteInputTokens: { ...safeInteger, minimum: 0 },
}, []);
const tokenUsageArray = { type: "array", items: tokenUsage } satisfies JsonSchema;

const tool = objectSchema({
  name: { type: "string" },
  description: { type: "string" },
  parameters: nonNull,
  metadata,
}, ["name", "description"]);

const context = objectSchema({
  description: { type: "string" },
  value: { type: "string" },
}, ["description", "value"]);

const resumeEntry = objectSchema({
  interruptId: { type: "string" },
  status: { enum: ["resolved", "cancelled"] },
  payload: nonNull,
  metadata,
}, ["interruptId", "status"]);

const runAgentInput = objectSchema({
  threadId: { type: "string" },
  runId: { type: "string" },
  protocolVersion: { type: "string" },
  parentRunId: { type: "string" },
  state: {},
  messages: { type: "array", items: message },
  tools: { type: "array", items: tool },
  context: { type: "array", items: context },
  forwardedProps: nonNull,
  resume: { type: "array", items: resumeEntry },
}, ["threadId", "runId", "messages"]);

const interrupt = objectSchema({
  subagentRunId: { type: "string" },
  id: { type: "string" },
  reason: { type: "string" },
  message: { type: "string" },
  toolCallId: { type: "string" },
  responseSchema: jsonObject,
  expiresAt: { type: "string" },
  metadata,
}, ["id", "reason"]);

const runFinishedOutcome = {
  oneOf: [
    objectSchema({
      type: { const: "success" },
      pendingToolCallIds: { type: "array", items: { type: "string" } },
    }, ["type"]),
    objectSchema({
      type: { const: "interrupt" },
      interrupts: { type: "array", minItems: 1, items: interrupt },
    }, ["type", "interrupts"]),
    objectSchema({ type: { const: "cancelled" } }, ["type"]),
  ],
} satisfies JsonSchema;

const subagentFinishedOutcome = {
  oneOf: [
    objectSchema({ type: { const: "success" } }, ["type"]),
    objectSchema({
      type: { const: "suspended" },
      interruptIds: { type: "array", items: { type: "string" } },
    }, ["type"]),
  ],
} satisfies JsonSchema;

export const AG_UI_EVENT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `urn:veryfront:ag-ui:${AG_UI_PROTOCOL_VERSION}:event`,
  oneOf: [
    eventSchema("TEXT_MESSAGE_START", {
      messageId: { type: "string" },
      role: textMessageRole,
      name: { type: "string" },
    }, ["messageId"]),
    eventSchema("TEXT_MESSAGE_CONTENT", {
      messageId: { type: "string" },
      delta: { type: "string" },
    }, ["messageId", "delta"]),
    eventSchema("TEXT_MESSAGE_END", { messageId: { type: "string" } }, ["messageId"]),
    eventSchema("TEXT_MESSAGE_CHUNK", {
      messageId: { type: "string" },
      role: textMessageRole,
      delta: { type: "string" },
      name: { type: "string" },
    }, []),
    eventSchema("TOOL_CALL_START", {
      toolCallId: { type: "string" },
      toolCallName: { type: "string" },
      parentMessageId: { type: "string" },
    }, ["toolCallId", "toolCallName"]),
    eventSchema("TOOL_CALL_ARGS", {
      toolCallId: { type: "string" },
      delta: { type: "string" },
    }, ["toolCallId", "delta"]),
    eventSchema("TOOL_CALL_END", { toolCallId: { type: "string" } }, ["toolCallId"]),
    eventSchema("TOOL_CALL_CHUNK", {
      toolCallId: { type: "string" },
      toolCallName: { type: "string" },
      parentMessageId: { type: "string" },
      delta: { type: "string" },
    }, []),
    eventSchema("TOOL_CALL_RESULT", {
      messageId: { type: "string" },
      toolCallId: { type: "string" },
      content: stringOrParts,
      role: { const: "tool" },
    }, ["messageId", "toolCallId", "content"]),
    eventSchema("STATE_SNAPSHOT", { snapshot: {} }, ["snapshot"]),
    eventSchema("STATE_DELTA", { delta: jsonPatch }, ["delta"]),
    eventSchema("MESSAGES_SNAPSHOT", { messages: { type: "array", items: message } }, [
      "messages",
    ]),
    eventSchema("ACTIVITY_SNAPSHOT", {
      messageId: { type: "string" },
      activityType: { type: "string" },
      content: jsonObject,
      replace: { type: "boolean" },
    }, ["messageId", "activityType", "content"]),
    eventSchema("ACTIVITY_DELTA", {
      messageId: { type: "string" },
      activityType: { type: "string" },
      patch: jsonPatch,
    }, ["messageId", "activityType", "patch"]),
    eventSchema("RAW", { event: {}, source: { type: "string" } }, ["event"]),
    eventSchema("CUSTOM", { name: { type: "string" }, value: {} }, ["name", "value"]),
    eventSchema("RUN_STARTED", {
      threadId: { type: "string" },
      runId: { type: "string" },
      protocolVersion: { type: "string" },
      parentRunId: { type: "string" },
      input: runAgentInput,
    }, ["threadId", "runId"]),
    eventSchema("RUN_FINISHED", {
      threadId: { type: "string" },
      runId: { type: "string" },
      result: nonNull,
      outcome: runFinishedOutcome,
      usage: tokenUsageArray,
    }, ["threadId", "runId"]),
    eventSchema("RUN_ERROR", {
      message: { type: "string" },
      code: { type: "string" },
      usage: tokenUsageArray,
    }, ["message"]),
    eventSchema("STEP_STARTED", { stepName: { type: "string" } }, ["stepName"]),
    eventSchema("STEP_FINISHED", { stepName: { type: "string" } }, ["stepName"]),
    eventSchema("REASONING_START", { messageId: { type: "string" } }, ["messageId"]),
    eventSchema("REASONING_MESSAGE_START", {
      messageId: { type: "string" },
      role: { const: "reasoning" },
    }, ["messageId", "role"]),
    eventSchema("REASONING_MESSAGE_CONTENT", {
      messageId: { type: "string" },
      delta: { type: "string" },
    }, ["messageId", "delta"]),
    eventSchema("REASONING_MESSAGE_END", { messageId: { type: "string" } }, ["messageId"]),
    eventSchema("REASONING_MESSAGE_CHUNK", {
      messageId: { type: "string" },
      delta: { type: "string" },
    }, []),
    eventSchema("REASONING_END", { messageId: { type: "string" } }, ["messageId"]),
    eventSchema("REASONING_ENCRYPTED_VALUE", {
      subtype: { enum: ["tool-call", "message"] },
      entityId: { type: "string" },
      encryptedValue: { type: "string" },
    }, ["subtype", "entityId", "encryptedValue"]),
    eventSchema("SUBAGENT_STARTED", {
      subagentRunId: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      parentSubagentRunId: { type: "string" },
      parentToolCallId: { type: "string" },
      parentMessageId: { type: "string" },
    }, ["subagentRunId", "name"]),
    eventSchema("SUBAGENT_FINISHED", {
      subagentRunId: { type: "string" },
      result: nonNull,
      outcome: subagentFinishedOutcome,
    }, ["subagentRunId"]),
    eventSchema("SUBAGENT_ERROR", {
      subagentRunId: { type: "string" },
      message: { type: "string" },
      code: { type: "string" },
    }, ["subagentRunId", "message"]),
  ],
} satisfies JsonSchema;

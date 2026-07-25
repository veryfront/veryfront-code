/**
 * Runtime Bridge
 *
 * Centralizes the framework's current runtime edge behind one internal
 * module. Higher-level framework code imports framework-owned runtime
 * types and calls into this bridge at the edge.
 */
import type { TextGenerationRuntimeMessage } from "#veryfront/agent/runtime/text-generation-runtime-message-types.ts";
import type {
  RuntimeGenerateTextResult,
  RuntimeQuarantinedToolResult,
  RuntimeRepairToolCall,
  RuntimeStreamPart,
  RuntimeStreamResult,
  RuntimeToolCallRepairFunction,
  RuntimeToolSet,
} from "#veryfront/agent/runtime/runtime-tool-types.ts";
import type {
  JsonSchemaValidationFunction,
  JsonSchemaValidationIssue,
  JsonSchemaValidationResult,
} from "#veryfront/extensions/schema/index.ts";
import {
  createInvalidToolInputError,
  createInvalidToolResultError,
  createMissingToolResultError,
  createNoSuchToolError,
  createToolCallRepairError,
  createToolInputLimitError,
  isInvalidToolInputError,
  isNoSuchToolError,
} from "#veryfront/agent/runtime/runtime-tool-errors.ts";
import { awaitAbortable, createAbortError, throwIfAborted } from "#veryfront/utils/abort.ts";
import type {
  ModelRuntime,
  ModelRuntimeCallOptions,
  ModelRuntimeGenerateResult,
  ModelRuntimeToolDefinition,
  RuntimePromptMessage,
  RuntimeReasoningOption,
} from "#veryfront/provider/types.ts";
import {
  MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH,
  normalizeRuntimeFinishReason,
  parseRuntimeStreamPart,
} from "./runtime-stream-part.ts";
import {
  parseRuntimeDirectGenerateResult,
  type RuntimeDirectContentPart,
} from "./runtime-direct-content.ts";
import { normalizeRuntimeUsage, projectRuntimeStreamUsage } from "./runtime-usage.ts";
import {
  MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES,
  MAX_RUNTIME_TOOL_CALLS,
  MAX_RUNTIME_TOOL_INPUT_BYTES,
  MAX_RUNTIME_TOOL_INPUT_DELTAS,
  runtimeToolInputByteLength,
  snapshotRuntimeToolInput,
} from "./runtime-tool-input-budget.ts";

type GenerateTextOptions = {
  model: ModelRuntime;
  system?: unknown;
  messages: TextGenerationRuntimeMessage[];
  tools?: RuntimeToolSet;
  experimental_repairToolCall?: RuntimeToolCallRepairFunction;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  toolChoice?: unknown;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
  reasoning?: RuntimeReasoningOption;
  abortSignal?: AbortSignal;
  quarantineUnpairedToolResults?: boolean;
};

type StreamTextOptions = {
  model: ModelRuntime;
  system?: unknown;
  messages: TextGenerationRuntimeMessage[];
  tools?: RuntimeToolSet;
  experimental_repairToolCall?: RuntimeToolCallRepairFunction;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  toolChoice?: unknown;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
  reasoning?: RuntimeReasoningOption;
  includeRawChunks?: boolean;
  abortSignal?: AbortSignal;
};

type DirectTextOptions = GenerateTextOptions | StreamTextOptions;

type RuntimeJsonSchema = {
  jsonSchema: unknown;
  modelJsonSchema?: unknown;
  validate: JsonSchemaValidationFunction;
};

type ResolvedRuntimeTool = {
  kind: "function" | "dynamic" | "provider";
  inputSchema: RuntimeJsonSchema;
  outputSchema?: RuntimeJsonSchema;
  supportsDeferredResults?: boolean;
};

type ResolvedRuntimeTools = {
  directTools: ModelRuntimeToolDefinition[] | undefined;
  byName: Map<string, ResolvedRuntimeTool>;
};

type ToolCallProcessingContext = {
  abortSignal?: AbortSignal;
  messages: TextGenerationRuntimeMessage[];
  repairToolCall?: RuntimeToolCallRepairFunction;
  resolvedTools: ResolvedRuntimeTools;
  system?: string;
  tools: RuntimeToolSet;
  priorProviderToolCalls: Map<string, RuntimeRepairToolCall>;
  quarantinedToolResults?: RuntimeQuarantinedToolResult[];
};

type ProcessedToolCall = {
  call: RuntimeRepairToolCall;
  rawInput: unknown;
  inputByteLength: number;
  error?: unknown;
};

class RuntimeToolInputLimitExceededError extends Error {
  readonly toolCall: RuntimeRepairToolCall;

  constructor(toolCall: RuntimeRepairToolCall) {
    super("Runtime tool input exceeded the configured resource limit");
    this.name = "RuntimeToolInputLimitExceededError";
    this.toolCall = toolCall;
  }
}

const MISSING_RUNTIME_DATA_PROPERTY = Symbol("missing runtime data property");
const MAX_RUNTIME_VALIDATION_ISSUES = 1_024;
const MAX_RUNTIME_VALIDATION_PARAMS_BYTES = 65_536;
const MAX_RUNTIME_VALIDATION_ERROR_BYTES = 1_048_576;
const MAX_RUNTIME_VALIDATION_TEXT_LENGTH = 4_096;
const MAX_RUNTIME_SYSTEM_PROMPT_PARTS = 1_024;
const MAX_RUNTIME_SYSTEM_PROMPT_CHARACTERS = 1_048_576;

class RuntimeSystemPromptTypeError extends TypeError {
  constructor(reason: string) {
    super(`Runtime system prompt ${reason}`);
    this.name = "TypeError";
  }
}

function invalidSystemPrompt(reason: string): never {
  throw new RuntimeSystemPromptTypeError(reason);
}

function isRuntimeRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  try {
    return !Array.isArray(value);
  } catch {
    throw new TypeError("Runtime boundary value could not be safely inspected");
  }
}

function readRuntimeDataProperty(
  record: object,
  key: PropertyKey,
): unknown | typeof MISSING_RUNTIME_DATA_PROPERTY {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw new TypeError("Runtime boundary value could not be safely inspected");
  }
  if (descriptor === undefined) return MISSING_RUNTIME_DATA_PROPERTY;
  if (!Object.hasOwn(descriptor, "value")) {
    throw new TypeError("Runtime boundary values must use data properties");
  }
  return descriptor.value;
}

const MAX_QUARANTINED_TOOL_RESULTS = 128;
const MAX_QUARANTINED_TOOL_IDENTIFIER_LENGTH = 1_024;

function quarantineUnpairedToolResult(
  context: ToolCallProcessingContext,
  toolCallId: unknown,
  toolName: unknown,
): void {
  const quarantined = context.quarantinedToolResults;
  if (!quarantined || quarantined.length >= MAX_QUARANTINED_TOOL_RESULTS) return;
  if (
    typeof toolCallId !== "string" || toolCallId.length === 0 ||
    typeof toolName !== "string" || toolName.length === 0
  ) {
    return;
  }

  const metadata = {
    toolCallId: toolCallId.slice(0, MAX_QUARANTINED_TOOL_IDENTIFIER_LENGTH),
    toolName: toolName.slice(0, MAX_QUARANTINED_TOOL_IDENTIFIER_LENGTH),
  };
  if (quarantined.some((result) => result.toolCallId === metadata.toolCallId)) return;
  quarantined.push(metadata);
}

function normalizeSystemPrompt(system: GenerateTextOptions["system"]): string | undefined {
  if (system === undefined || system === null) {
    return undefined;
  }
  if (typeof system === "string") {
    if (system.length > MAX_RUNTIME_SYSTEM_PROMPT_CHARACTERS) {
      return invalidSystemPrompt(
        `must not exceed ${MAX_RUNTIME_SYSTEM_PROMPT_CHARACTERS} characters`,
      );
    }
    return system;
  }

  try {
    if (Array.isArray(system)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(system, "length");
      const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, "value")
        ? lengthDescriptor.value
        : undefined;
      if (
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_RUNTIME_SYSTEM_PROMPT_PARTS
      ) {
        return invalidSystemPrompt(
          `arrays must contain at most ${MAX_RUNTIME_SYSTEM_PROMPT_PARTS} entries`,
        );
      }
      const parts: string[] = [];
      let characterCount = 0;
      for (let index = 0; index < length; index++) {
        const entryDescriptor = Object.getOwnPropertyDescriptor(system, String(index));
        const entry = entryDescriptor && Object.hasOwn(entryDescriptor, "value")
          ? entryDescriptor.value
          : undefined;
        if (
          !entry || typeof entry !== "object" || Array.isArray(entry)
        ) {
          return invalidSystemPrompt("array entries must contain string content");
        }
        const contentDescriptor = Object.getOwnPropertyDescriptor(entry, "content");
        if (
          !contentDescriptor || !Object.hasOwn(contentDescriptor, "value") ||
          typeof contentDescriptor.value !== "string"
        ) {
          return invalidSystemPrompt("array entries must contain string content");
        }
        const nextCharacterCount = characterCount +
          contentDescriptor.value.length +
          (parts.length > 0 ? 1 : 0);
        if (nextCharacterCount > MAX_RUNTIME_SYSTEM_PROMPT_CHARACTERS) {
          return invalidSystemPrompt(
            `must not exceed ${MAX_RUNTIME_SYSTEM_PROMPT_CHARACTERS} characters`,
          );
        }
        characterCount = nextCharacterCount;
        parts.push(contentDescriptor.value);
      }
      return parts.length > 0 ? parts.join("\n") : undefined;
    }

    if (typeof system === "object") {
      const contentDescriptor = Object.getOwnPropertyDescriptor(system, "content");
      if (
        contentDescriptor && Object.hasOwn(contentDescriptor, "value") &&
        typeof contentDescriptor.value === "string"
      ) {
        if (contentDescriptor.value.length > MAX_RUNTIME_SYSTEM_PROMPT_CHARACTERS) {
          return invalidSystemPrompt(
            `must not exceed ${MAX_RUNTIME_SYSTEM_PROMPT_CHARACTERS} characters`,
          );
        }
        return contentDescriptor.value;
      }
      if (contentDescriptor && !Object.hasOwn(contentDescriptor, "value")) {
        return invalidSystemPrompt("content must be a data property");
      }
    }
  } catch (error) {
    if (error instanceof RuntimeSystemPromptTypeError) {
      throw error;
    }
    return invalidSystemPrompt("could not be safely inspected");
  }

  return invalidSystemPrompt(
    "must be a string, a content object, or an array of content objects",
  );
}

function getProviderRequestMessages(
  messages: TextGenerationRuntimeMessage[],
): TextGenerationRuntimeMessage[] {
  const requestMessages = [...messages];

  while (requestMessages.at(-1)?.role === "assistant") {
    requestMessages.pop();
  }

  return requestMessages;
}

function toRuntimePrompt(
  system: string | undefined,
  messages: TextGenerationRuntimeMessage[],
): RuntimePromptMessage[] {
  const prompt: RuntimePromptMessage[] = [];

  if (system && system.length > 0) {
    prompt.push({ role: "system", content: system });
  }

  for (const message of messages) {
    switch (message.role) {
      case "system":
        prompt.push({ role: "system", content: message.content });
        break;
      case "user":
        prompt.push({
          role: "user",
          content: typeof message.content === "string"
            ? [{ type: "text", text: message.content }]
            : message.content,
        });
        break;
      case "assistant":
        prompt.push({
          role: "assistant",
          content: message.content.map((part) => {
            if (part.type === "text") {
              return { type: "text" as const, text: part.text };
            }
            if (part.type === "reasoning") {
              return {
                type: "reasoning" as const,
                ...(part.text ? { text: part.text } : {}),
                ...(part.signature ? { signature: part.signature } : {}),
                ...(part.redactedData ? { redactedData: part.redactedData } : {}),
              };
            }
            return {
              type: "tool-call" as const,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            };
          }),
          ...(message.providerToolCalls ? { providerToolCalls: message.providerToolCalls } : {}),
          ...(message.providerMetadata ? { providerMetadata: message.providerMetadata } : {}),
        });
        break;
      case "tool":
        prompt.push({
          role: "tool",
          content: message.content.map((part) => ({
            type: "tool-result" as const,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: part.output,
          })),
        });
        break;
    }
  }

  return prompt;
}

function isProviderResultContinuationBoundary(finishReason: string | null | undefined): boolean {
  return finishReason === "tool-calls" || finishReason === "pause_turn";
}

function shouldGenerateViaStream(model: ModelRuntime): boolean {
  return model._generateViaStream === true;
}

function parseToolCallInput(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return input;
  }
  const snapshot = snapshotRuntimeToolInput(parsed);
  if (snapshot.exceedsLimit) {
    throw new TypeError("Runtime tool input exceeded its structured snapshot limit");
  }
  return snapshot.input;
}

function parseToolCallInputStrict(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }

  if (input.trim().length === 0) {
    return {};
  }

  return JSON.parse(input);
}

function isRuntimeProviderToolDefinition(
  value: unknown,
): value is {
  type: "provider";
  id: `${string}.${string}`;
  args: Record<string, unknown>;
  inputSchema: () => unknown;
  outputSchema?: () => unknown;
  supportsDeferredResults?: boolean;
} {
  return !!value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "provider" &&
    "id" in value &&
    typeof value.id === "string" &&
    "args" in value &&
    typeof value.args === "object" &&
    value.args !== null &&
    !Array.isArray(value.args) &&
    "inputSchema" in value &&
    typeof value.inputSchema === "function";
}

function isRuntimeFunctionToolDefinition(
  value: unknown,
): value is {
  description?: string;
  type?: "function" | "dynamic";
  inputSchema: unknown;
} {
  if (!value || typeof value !== "object" || !("inputSchema" in value)) {
    return false;
  }
  const type = "type" in value ? value.type : undefined;
  return type === undefined || type === "function" || type === "dynamic";
}

async function resolveRuntimeJsonSchema(
  value: unknown,
  toolName: string,
  abortSignal?: AbortSignal,
): Promise<RuntimeJsonSchema> {
  const resolved = await awaitAbortable(value, abortSignal);
  if (
    !resolved || typeof resolved !== "object" || !("jsonSchema" in resolved) ||
    !("validate" in resolved) || typeof resolved.validate !== "function"
  ) {
    throw new TypeError(
      `Runtime tool "${toolName}" input schema must provide jsonSchema and validate`,
    );
  }

  const jsonSchema = await awaitAbortable(resolved.jsonSchema, abortSignal);
  const modelJsonSchema = "modelJsonSchema" in resolved && resolved.modelJsonSchema !== undefined
    ? await awaitAbortable(resolved.modelJsonSchema, abortSignal)
    : undefined;

  return {
    jsonSchema,
    ...(modelJsonSchema === undefined ? {} : { modelJsonSchema }),
    validate: resolved.validate.bind(resolved) as JsonSchemaValidationFunction,
  };
}

async function resolveRuntimeTools(
  tools: RuntimeToolSet | undefined,
  abortSignal?: AbortSignal,
): Promise<ResolvedRuntimeTools> {
  throwIfAborted(abortSignal);
  if (!tools) {
    return { directTools: undefined, byName: new Map() };
  }

  const directTools: ModelRuntimeToolDefinition[] = [];
  const byName = new Map<string, ResolvedRuntimeTool>();

  for (const [name, definition] of Object.entries(tools)) {
    throwIfAborted(abortSignal);
    if (isRuntimeProviderToolDefinition(definition)) {
      const inputSchema = await resolveRuntimeJsonSchema(
        definition.inputSchema(),
        name,
        abortSignal,
      );
      const outputSchema = typeof definition.outputSchema === "function"
        ? await resolveRuntimeJsonSchema(definition.outputSchema(), name, abortSignal)
        : undefined;
      directTools.push({
        type: "provider",
        name,
        id: definition.id,
        args: definition.args,
      });
      byName.set(name, {
        kind: "provider",
        inputSchema,
        ...(outputSchema ? { outputSchema } : {}),
        ...(definition.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
      });
      continue;
    }

    if (!isRuntimeFunctionToolDefinition(definition)) {
      throw new TypeError(`Runtime tool "${name}" has an unsupported definition`);
    }

    const inputSchema = await resolveRuntimeJsonSchema(definition.inputSchema, name, abortSignal);
    directTools.push({
      type: "function",
      name,
      ...(typeof definition.description === "string"
        ? { description: definition.description }
        : {}),
      inputSchema: inputSchema.modelJsonSchema ?? inputSchema.jsonSchema,
    });
    byName.set(name, {
      kind: definition.type === "dynamic" ? "dynamic" : "function",
      inputSchema,
    });
  }

  throwIfAborted(abortSignal);

  return {
    directTools: directTools.length > 0 ? directTools : undefined,
    byName,
  };
}

function validationFailureCause(errors: readonly JsonSchemaValidationIssue[]): Error {
  const details = errors.map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message ?? `failed ${error.keyword}`}`;
  }).join("; ");
  return Object.assign(
    new Error(details.length > 0 ? details : "JSON Schema validation failed"),
    { errors: [...errors] },
  );
}

function readValidationIssueString(
  issue: Record<string, unknown>,
  key: "instancePath" | "schemaPath" | "keyword" | "message",
  budget: { bytes: number },
): string;
function readValidationIssueString(
  issue: Record<string, unknown>,
  key: "instancePath" | "schemaPath" | "keyword" | "message",
  budget: { bytes: number },
  optional: true,
): string | undefined;
function readValidationIssueString(
  issue: Record<string, unknown>,
  key: "instancePath" | "schemaPath" | "keyword" | "message",
  budget: { bytes: number },
  optional = false,
): string | undefined {
  const value = readRuntimeDataProperty(issue, key);
  if (
    optional &&
    (value === MISSING_RUNTIME_DATA_PROPERTY || value === undefined)
  ) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError(`Runtime JSON Schema validation issue ${key} must be a string`);
  }
  if (value.length > MAX_RUNTIME_VALIDATION_TEXT_LENGTH) {
    throw new TypeError(
      `Runtime JSON Schema validation issue ${key} exceeded its text limit`,
    );
  }
  const remaining = MAX_RUNTIME_VALIDATION_ERROR_BYTES - budget.bytes;
  const measured = snapshotRuntimeToolInput(value, remaining);
  if (measured.exceedsLimit) {
    throw new TypeError("Runtime JSON Schema validation errors exceeded their aggregate limit");
  }
  budget.bytes += measured.byteLength;
  return value;
}

function inspectValidationIssues(value: unknown): readonly JsonSchemaValidationIssue[] {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    throw new TypeError("Runtime JSON Schema validation errors could not be safely inspected");
  }
  if (!isArray) {
    throw new TypeError("Runtime JSON Schema validation errors must be an array");
  }
  const errors = value as unknown[];
  const length = readRuntimeDataProperty(errors, "length");
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_RUNTIME_VALIDATION_ISSUES
  ) {
    throw new TypeError(
      `Runtime JSON Schema validation errors must contain at most ${MAX_RUNTIME_VALIDATION_ISSUES} issues`,
    );
  }

  const issues: JsonSchemaValidationIssue[] = [];
  const budget = { bytes: 0 };
  for (let index = 0; index < length; index++) {
    const rawIssue = readRuntimeDataProperty(errors, String(index));
    if (!isRuntimeRecord(rawIssue)) {
      throw new TypeError("Runtime JSON Schema validation issues must be objects");
    }
    const rawParams = readRuntimeDataProperty(rawIssue, "params");
    if (!isRuntimeRecord(rawParams)) {
      throw new TypeError("Runtime JSON Schema validation issue params must be an object");
    }
    const remainingBudget = MAX_RUNTIME_VALIDATION_ERROR_BYTES - budget.bytes;
    const paramsSnapshot = snapshotRuntimeToolInput(
      rawParams,
      Math.min(MAX_RUNTIME_VALIDATION_PARAMS_BYTES, remainingBudget),
    );
    if (paramsSnapshot.exceedsLimit || !isRuntimeRecord(paramsSnapshot.input)) {
      throw new TypeError(
        "Runtime JSON Schema validation issue params exceeded their aggregate or per-issue limit",
      );
    }
    budget.bytes += paramsSnapshot.byteLength;
    const instancePath = readValidationIssueString(
      rawIssue,
      "instancePath",
      budget,
    );
    const schemaPath = readValidationIssueString(
      rawIssue,
      "schemaPath",
      budget,
    );
    const keyword = readValidationIssueString(rawIssue, "keyword", budget);
    const message = readValidationIssueString(
      rawIssue,
      "message",
      budget,
      true,
    );
    issues.push(Object.freeze({
      instancePath,
      schemaPath,
      keyword,
      params: paramsSnapshot.input,
      ...(message !== undefined ? { message } : {}),
    }));
  }
  return Object.freeze(issues);
}

function inspectJsonSchemaValidationResult(
  value: unknown,
): JsonSchemaValidationResult {
  if (!isRuntimeRecord(value)) {
    throw new TypeError("Runtime JSON Schema validator returned a non-object result");
  }
  const success = readRuntimeDataProperty(value, "success");
  if (success === true) {
    const accepted = readRuntimeDataProperty(value, "value");
    if (accepted === MISSING_RUNTIME_DATA_PROPERTY) {
      throw new TypeError("Runtime JSON Schema validator omitted its accepted value");
    }
    return { success: true, value: accepted };
  }
  if (success === false) {
    const errors = readRuntimeDataProperty(value, "errors");
    if (errors === MISSING_RUNTIME_DATA_PROPERTY) {
      throw new TypeError("Runtime JSON Schema validator omitted its errors");
    }
    return { success: false, errors: inspectValidationIssues(errors) };
  }
  throw new TypeError("Runtime JSON Schema validator returned an invalid success flag");
}

async function validateProviderToolResult(
  toolCall: RuntimeRepairToolCall,
  result: unknown,
  context: ToolCallProcessingContext,
): Promise<{ result: unknown; isError?: true }> {
  const outputSchema = context.resolvedTools.byName.get(toolCall.toolName)?.outputSchema;
  if (!outputSchema) return { result };

  try {
    let validation: JsonSchemaValidationResult;
    try {
      const rawValidation = await awaitAbortable(
        outputSchema.validate(result),
        context.abortSignal,
      );
      validation = inspectJsonSchemaValidationResult(rawValidation);
    } catch {
      throwIfAborted(context.abortSignal);
      throw new TypeError(
        "Runtime JSON Schema validator failed or returned an unsafe result",
      );
    }
    if (!validation.success) {
      throw validationFailureCause(validation.errors);
    }
    return { result: validation.value };
  } catch (cause) {
    throwIfAborted(context.abortSignal);
    return {
      result: createInvalidToolResultError({
        cause,
        result,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
      }),
      isError: true,
    };
  }
}

type CanonicalToolMetadata = {
  providerExecuted?: true;
  dynamic?: true;
  supportsDeferredResults?: true;
};

function canonicalToolMetadata(
  tool: ResolvedRuntimeTool | undefined,
  untrusted: { providerExecuted?: boolean; dynamic?: boolean },
): CanonicalToolMetadata {
  if (tool) {
    return {
      ...(tool.kind === "provider" ? { providerExecuted: true as const } : {}),
      ...(tool.kind === "dynamic" ? { dynamic: true as const } : {}),
      ...(tool.supportsDeferredResults === true ? { supportsDeferredResults: true as const } : {}),
    };
  }

  // Unknown calls are accepted only for the narrow provider-owned dynamic
  // shape. A single raw flag is not sufficient to bypass the registered tool
  // inventory or local execution policy.
  return untrusted.providerExecuted === true && untrusted.dynamic === true
    ? { providerExecuted: true, dynamic: true }
    : {};
}

function withResolvedToolMetadata(
  toolCall: RuntimeRepairToolCall,
  tool: ResolvedRuntimeTool | undefined,
): RuntimeRepairToolCall {
  const {
    providerExecuted: untrustedProviderExecuted,
    dynamic: untrustedDynamic,
    supportsDeferredResults: _untrustedSupportsDeferredResults,
    ...call
  } = toolCall;
  return {
    ...call,
    ...canonicalToolMetadata(tool, {
      providerExecuted: untrustedProviderExecuted,
      dynamic: untrustedDynamic,
    }),
  };
}

function readRepairTrueFlag(
  record: Record<string, unknown>,
  key: "providerExecuted" | "dynamic" | "supportsDeferredResults",
): true | undefined {
  const value = readRuntimeDataProperty(record, key);
  if (
    value === MISSING_RUNTIME_DATA_PROPERTY ||
    value === undefined ||
    value === false
  ) {
    return undefined;
  }
  if (value !== true) {
    throw new TypeError(`A repaired tool call ${key} must be a boolean`);
  }
  return true;
}

function inspectRuntimeRepairToolCall(value: unknown): RuntimeRepairToolCall {
  if (!isRuntimeRecord(value)) {
    throw new TypeError('A repair callback must return a complete "tool-call"');
  }
  const type = readRuntimeDataProperty(value, "type");
  const toolCallId = readRuntimeDataProperty(value, "toolCallId");
  const toolName = readRuntimeDataProperty(value, "toolName");
  const input = readRuntimeDataProperty(value, "input");
  if (
    type !== "tool-call" ||
    typeof toolCallId !== "string" ||
    toolCallId.length === 0 ||
    toolCallId.length > MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH ||
    typeof toolName !== "string" ||
    toolName.length === 0 ||
    toolName.length > MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH ||
    input === MISSING_RUNTIME_DATA_PROPERTY
  ) {
    throw new TypeError(
      `A repair callback must return a complete "tool-call" with identifiers no longer than ${MAX_RUNTIME_STREAM_IDENTIFIER_LENGTH} characters`,
    );
  }

  const providerExecuted = readRepairTrueFlag(value, "providerExecuted");
  const dynamic = readRepairTrueFlag(value, "dynamic");
  const supportsDeferredResults = readRepairTrueFlag(
    value,
    "supportsDeferredResults",
  );
  return {
    type: "tool-call",
    toolCallId,
    toolName,
    input,
    ...(providerExecuted ? { providerExecuted } : {}),
    ...(dynamic ? { dynamic } : {}),
    ...(supportsDeferredResults ? { supportsDeferredResults } : {}),
  };
}

function requireToolInputSnapshot(
  toolCall: RuntimeRepairToolCall,
): {
  input: unknown;
  byteLength: number;
} {
  const snapshot = snapshotRuntimeToolInput(toolCall.input);
  if (snapshot.exceedsLimit) {
    throw new RuntimeToolInputLimitExceededError(toolCall);
  }
  return snapshot;
}

function canonicalParsedToolInput(
  toolCall: RuntimeRepairToolCall,
): unknown {
  if (typeof toolCall.input !== "string") {
    return toolCall.input;
  }
  const parsed = parseToolCallInputStrict(toolCall.input);
  const snapshot = snapshotRuntimeToolInput(parsed);
  if (snapshot.exceedsLimit) {
    throw new RuntimeToolInputLimitExceededError(toolCall);
  }
  return snapshot.input;
}

async function validateToolCallOnce(
  toolCall: RuntimeRepairToolCall,
  inputByteLength: number,
  context: ToolCallProcessingContext,
): Promise<ProcessedToolCall> {
  throwIfAborted(context.abortSignal);
  const tool = context.resolvedTools.byName.get(toolCall.toolName);
  const normalizedCall = withResolvedToolMetadata(toolCall, tool);

  if (!tool) {
    if (normalizedCall.providerExecuted === true && normalizedCall.dynamic === true) {
      try {
        const parsedInput = canonicalParsedToolInput(normalizedCall);
        return {
          call: { ...normalizedCall, input: parsedInput },
          rawInput: normalizedCall.input,
          inputByteLength,
        };
      } catch (cause) {
        if (cause instanceof RuntimeToolInputLimitExceededError) throw cause;
        throw createInvalidToolInputError({
          cause,
          toolInput: normalizedCall.input,
          toolName: normalizedCall.toolName,
        });
      }
    }

    throw createNoSuchToolError({
      toolName: normalizedCall.toolName,
      availableTools: [...context.resolvedTools.byName.keys()],
    });
  }

  let parsedInput: unknown;
  try {
    parsedInput = canonicalParsedToolInput(normalizedCall);
  } catch (cause) {
    if (cause instanceof RuntimeToolInputLimitExceededError) throw cause;
    throw createInvalidToolInputError({
      cause,
      toolInput: normalizedCall.input,
      toolName: normalizedCall.toolName,
    });
  }

  let validation: JsonSchemaValidationResult;
  try {
    const rawValidation = await awaitAbortable(
      tool.inputSchema.validate(parsedInput),
      context.abortSignal,
    );
    validation = inspectJsonSchemaValidationResult(rawValidation);
  } catch {
    throwIfAborted(context.abortSignal);
    throw createInvalidToolInputError({
      cause: new TypeError(
        "Runtime JSON Schema validator failed or returned an unsafe result",
      ),
      toolInput: normalizedCall.input,
      toolName: normalizedCall.toolName,
    });
  }
  if (!validation.success) {
    throw createInvalidToolInputError({
      cause: validationFailureCause(validation.errors),
      toolInput: normalizedCall.input,
      toolName: normalizedCall.toolName,
    });
  }

  if (validation.value === parsedInput) {
    return {
      call: { ...normalizedCall, input: parsedInput },
      rawInput: normalizedCall.input,
      inputByteLength,
    };
  }

  let transformed: { input: unknown; byteLength: number };
  try {
    transformed = requireToolInputSnapshot({
      ...normalizedCall,
      input: validation.value,
    });
  } catch (cause) {
    if (cause instanceof RuntimeToolInputLimitExceededError) throw cause;
    throw createInvalidToolInputError({
      cause,
      toolInput: normalizedCall.input,
      toolName: normalizedCall.toolName,
    });
  }
  return {
    call: { ...normalizedCall, input: transformed.input },
    rawInput: transformed.input,
    inputByteLength: transformed.byteLength,
  };
}

function toolNameFromSchemaRequest(args: unknown[]): string {
  const request = args[0];
  if (typeof request === "string" && request.length > 0) return request;
  if (
    request && typeof request === "object" && "toolName" in request &&
    typeof request.toolName === "string" && request.toolName.length > 0
  ) {
    return request.toolName;
  }
  throw new TypeError("inputSchema() requires a toolName");
}

type RuntimeAbortScope = {
  abort(reason?: unknown): void;
  dispose(): void;
  signal: AbortSignal;
};

function createRuntimeAbortScope(parentSignal?: AbortSignal): RuntimeAbortScope {
  const controller = new AbortController();
  let disposed = false;
  const forwardParentAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason);
    }
  };

  if (parentSignal?.aborted) {
    forwardParentAbort();
  } else {
    parentSignal?.addEventListener("abort", forwardParentAbort, { once: true });
  }

  return {
    abort(reason?: unknown) {
      if (!controller.signal.aborted) {
        controller.abort(reason ?? createAbortError());
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      parentSignal?.removeEventListener("abort", forwardParentAbort);
    },
    signal: controller.signal,
  };
}

function observePromise(value: void | PromiseLike<unknown>): void {
  if (value === undefined) return;
  void Promise.resolve(value).catch(() => {});
}

/**
 * Await provider startup without orphaning a stream that resolves after the
 * caller has already stopped waiting.
 */
async function awaitRuntimeStreamStart<
  T extends { stream: ReadableStream<unknown> },
>(
  value: T | PromiseLike<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  const startup = Promise.resolve(value);
  try {
    return await awaitAbortable(startup, abortSignal);
  } catch (error) {
    if (abortSignal?.aborted) {
      const reason = createAbortError(abortSignal.reason);
      observePromise(
        startup.then(
          ({ stream }) => stream.cancel(reason),
          () => undefined,
        ),
      );
    }
    throw error;
  }
}

function invalidToolCallOutcome(
  toolCall: RuntimeRepairToolCall,
  inputByteLength: number,
  error: unknown,
  context: ToolCallProcessingContext,
): ProcessedToolCall {
  const tool = context.resolvedTools.byName.get(toolCall.toolName);
  let parsedInput = toolCall.input;
  try {
    parsedInput = canonicalParsedToolInput(toolCall);
  } catch {
    // Preserve malformed raw strings in the correlated error result. All
    // structured candidates have already crossed the snapshot boundary.
  }
  return {
    call: {
      ...withResolvedToolMetadata(toolCall, tool),
      input: parsedInput,
    },
    rawInput: toolCall.input,
    inputByteLength,
    error,
  };
}

async function processToolCall(
  toolCall: RuntimeRepairToolCall,
  inputByteLength: number,
  context: ToolCallProcessingContext,
): Promise<ProcessedToolCall> {
  let originalError: Parameters<typeof createToolCallRepairError>[0]["originalError"];
  try {
    return await validateToolCallOnce(toolCall, inputByteLength, context);
  } catch (error) {
    if (!isInvalidToolInputError(error) && !isNoSuchToolError(error)) throw error;
    originalError = error;
  }

  if (!context.repairToolCall) {
    return invalidToolCallOutcome(toolCall, inputByteLength, originalError, context);
  }

  throwIfAborted(context.abortSignal);
  let repaired: unknown;
  try {
    repaired = await awaitAbortable(
      context.repairToolCall({
        error: originalError,
        inputSchema: async (...args: unknown[]) => {
          throwIfAborted(context.abortSignal);
          const requestedToolName = toolNameFromSchemaRequest(args);
          const requestedTool = context.resolvedTools.byName.get(requestedToolName);
          if (!requestedTool) {
            throw createNoSuchToolError({
              toolName: requestedToolName,
              availableTools: [...context.resolvedTools.byName.keys()],
            });
          }
          throwIfAborted(context.abortSignal);
          return requestedTool.inputSchema.jsonSchema;
        },
        messages: context.messages,
        system: context.system,
        toolCall: withResolvedToolMetadata(
          toolCall,
          context.resolvedTools.byName.get(toolCall.toolName),
        ),
        tools: context.tools,
      }),
      context.abortSignal,
    );
  } catch (cause) {
    throwIfAborted(context.abortSignal);
    return invalidToolCallOutcome(
      toolCall,
      inputByteLength,
      createToolCallRepairError({ cause, originalError }),
      context,
    );
  }
  throwIfAborted(context.abortSignal);

  if (repaired === null) {
    return invalidToolCallOutcome(toolCall, inputByteLength, originalError, context);
  }

  let inspectedRepair: RuntimeRepairToolCall;
  try {
    inspectedRepair = inspectRuntimeRepairToolCall(repaired);
  } catch (cause) {
    return invalidToolCallOutcome(
      toolCall,
      inputByteLength,
      createToolCallRepairError({
        cause,
        originalError,
      }),
      context,
    );
  }

  const invalidRepair = inspectedRepair.toolCallId !== toolCall.toolCallId
    ? "A repaired tool call must preserve toolCallId"
    : isInvalidToolInputError(originalError) && inspectedRepair.toolName !== toolCall.toolName
    ? "A repaired invalid-input tool call must preserve toolName"
    : null;
  if (invalidRepair) {
    return invalidToolCallOutcome(
      toolCall,
      inputByteLength,
      createToolCallRepairError({ cause: new TypeError(invalidRepair), originalError }),
      context,
    );
  }

  let repairedCall = inspectedRepair;
  let repairedInputByteLength = inputByteLength;
  if (inspectedRepair.input !== toolCall.input) {
    try {
      const snapshot = requireToolInputSnapshot(inspectedRepair);
      repairedCall = { ...inspectedRepair, input: snapshot.input };
      repairedInputByteLength = snapshot.byteLength;
    } catch (cause) {
      if (cause instanceof RuntimeToolInputLimitExceededError) throw cause;
      return invalidToolCallOutcome(
        toolCall,
        inputByteLength,
        createToolCallRepairError({ cause, originalError }),
        context,
      );
    }
  }

  try {
    return await validateToolCallOnce(
      repairedCall,
      repairedInputByteLength,
      context,
    );
  } catch (error) {
    if (!isInvalidToolInputError(error) && !isNoSuchToolError(error)) throw error;
    return invalidToolCallOutcome(
      repairedCall,
      repairedInputByteLength,
      error,
      context,
    );
  }
}

function buildDirectModelOptions(
  options: DirectTextOptions,
  tools: ModelRuntimeToolDefinition[] | undefined,
  system: string | undefined,
): ModelRuntimeCallOptions {
  return {
    prompt: toRuntimePrompt(
      system,
      getProviderRequestMessages(options.messages),
    ),
    maxOutputTokens: options.maxOutputTokens,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    topP: options.topP,
    topK: options.topK,
    stopSequences: options.stopSequences,
    ...(tools ? { tools } : {}),
    ...(options.toolChoice === undefined ? {} : { toolChoice: options.toolChoice }),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.presencePenalty !== undefined ? { presencePenalty: options.presencePenalty } : {}),
    ...(options.frequencyPenalty !== undefined
      ? { frequencyPenalty: options.frequencyPenalty }
      : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
    ...(options.reasoning ? { reasoning: options.reasoning } : {}),
    ...("includeRawChunks" in options && options.includeRawChunks !== undefined
      ? { includeRawChunks: options.includeRawChunks }
      : {}),
    abortSignal: options.abortSignal,
  };
}

async function buildDirectGenerateResult(
  result: ModelRuntimeGenerateResult,
  context: ToolCallProcessingContext,
): Promise<RuntimeGenerateTextResult> {
  throwIfAborted(context.abortSignal);
  const directResult = parseRuntimeDirectGenerateResult(result);
  const content = directResult.content;
  const finishReason = normalizeRuntimeFinishReason(directResult.finishReason);
  const textParts: string[] = [];
  const toolCalls = new Map<
    string,
    NonNullable<RuntimeGenerateTextResult["toolCalls"]>[number]
  >();
  const toolResults: RuntimeGenerateTextResult["toolResults"] = [];
  const terminalToolCallIds = new Set<string>();
  const providerResultToolCallIds = new Set<string>();
  const seenToolCallIds = new Set<string>();
  const directToolResults: Array<
    Extract<RuntimeDirectContentPart, { type: "tool-result" }>
  > = [];
  let aggregateToolInputBytes = 0;
  let aggregateToolInputLimitExceeded = false;
  let toolCallLimitExceeded = false;

  const appendLimitError = (
    part: RuntimeRepairToolCall,
    limitKind: "bytes" | "toolCalls",
    limit: number,
  ): void => {
    terminalToolCallIds.add(part.toolCallId);
    toolResults.push({
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      result: createToolInputLimitError({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        limitKind,
        limit,
      }),
      isError: true,
      ...canonicalToolMetadata(
        context.resolvedTools.byName.get(part.toolName),
        part,
      ),
    });
  };

  // Snapshot every accepted direct-call input before the first validator can
  // suspend. Providers retain their result objects, so staging closes the
  // mutation window between validating an early call and inspecting a later
  // call from the same response.
  const stagedToolInputs = new Map<
    Extract<RuntimeDirectContentPart, { type: "tool-call" }>,
    ReturnType<typeof snapshotRuntimeToolInput>
  >();
  const stagedToolCallIds = new Set<string>();
  let stagedAggregateInputBytes = 0;
  let stagedAggregateLimitPart:
    | Extract<RuntimeDirectContentPart, { type: "tool-call" }>
    | undefined;
  for (const part of content) {
    if (
      part.type !== "tool-call" ||
      stagedToolCallIds.has(part.toolCallId) ||
      stagedToolCallIds.size >= MAX_RUNTIME_TOOL_CALLS
    ) {
      continue;
    }
    stagedToolCallIds.add(part.toolCallId);
    const snapshot = snapshotRuntimeToolInput(part.input);
    if (
      !snapshot.exceedsLimit &&
      stagedAggregateInputBytes + snapshot.byteLength >
        MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES
    ) {
      stagedAggregateLimitPart = part;
      break;
    }
    stagedToolInputs.set(part, snapshot);
    if (!snapshot.exceedsLimit) {
      stagedAggregateInputBytes += snapshot.byteLength;
    }
  }

  for (const part of content) {
    if (part.type === "text") {
      textParts.push(part.text);
      continue;
    }

    if (part.type === "tool-call") {
      if (terminalToolCallIds.has(part.toolCallId) || toolCalls.has(part.toolCallId)) continue;
      if (seenToolCallIds.has(part.toolCallId)) continue;
      if (seenToolCallIds.size >= MAX_RUNTIME_TOOL_CALLS) {
        if (!toolCallLimitExceeded) {
          toolCallLimitExceeded = true;
          appendLimitError(part, "toolCalls", MAX_RUNTIME_TOOL_CALLS);
        }
        continue;
      }
      seenToolCallIds.add(part.toolCallId);

      const stagedInput = stagedToolInputs.get(part);
      if (!stagedInput) {
        if (part === stagedAggregateLimitPart) {
          if (!aggregateToolInputLimitExceeded) {
            aggregateToolInputLimitExceeded = true;
            appendLimitError(
              part,
              "bytes",
              MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES,
            );
          }
          continue;
        }
        if (stagedAggregateLimitPart) continue;
        throw new TypeError("Runtime tool input was not staged before validation");
      }
      if (stagedInput.exceedsLimit) {
        appendLimitError(part, "bytes", MAX_RUNTIME_TOOL_INPUT_BYTES);
        continue;
      }
      if (
        aggregateToolInputBytes + stagedInput.byteLength >
          MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES
      ) {
        if (!aggregateToolInputLimitExceeded) {
          aggregateToolInputLimitExceeded = true;
          appendLimitError(
            part,
            "bytes",
            MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES,
          );
        }
        continue;
      }

      let processed: ProcessedToolCall;
      try {
        processed = await processToolCall(
          {
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: stagedInput.input,
            ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
            ...(part.dynamic === true ? { dynamic: true } : {}),
            ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
          },
          stagedInput.byteLength,
          context,
        );
      } catch (error) {
        if (!(error instanceof RuntimeToolInputLimitExceededError)) throw error;
        appendLimitError(error.toolCall, "bytes", MAX_RUNTIME_TOOL_INPUT_BYTES);
        continue;
      }
      if (
        aggregateToolInputBytes + processed.inputByteLength >
          MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES
      ) {
        if (!aggregateToolInputLimitExceeded) {
          aggregateToolInputLimitExceeded = true;
          appendLimitError(
            processed.call,
            "bytes",
            MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES,
          );
        }
        continue;
      }
      aggregateToolInputBytes += processed.inputByteLength;
      toolCalls.set(processed.call.toolCallId, {
        toolCallId: processed.call.toolCallId,
        toolName: processed.call.toolName,
        input: processed.call.input,
        ...(processed.call.providerExecuted === true ? { providerExecuted: true } : {}),
        ...(processed.call.dynamic === true ? { dynamic: true } : {}),
        ...(processed.call.supportsDeferredResults === true
          ? { supportsDeferredResults: true }
          : {}),
      });
      if (processed.error !== undefined) {
        terminalToolCallIds.add(processed.call.toolCallId);
        toolResults.push({
          toolCallId: processed.call.toolCallId,
          toolName: processed.call.toolName,
          result: processed.error,
          isError: true,
          ...(processed.call.providerExecuted === true ? { providerExecuted: true } : {}),
          ...(processed.call.dynamic === true ? { dynamic: true } : {}),
          ...(processed.call.supportsDeferredResults === true
            ? { supportsDeferredResults: true }
            : {}),
        });
      }
      continue;
    }

    if (part.type === "tool-result") {
      directToolResults.push(part);
    }
  }

  for (const part of directToolResults) {
    if (terminalToolCallIds.has(part.toolCallId)) continue;
    if (
      part.toolCallId.length > MAX_QUARANTINED_TOOL_IDENTIFIER_LENGTH ||
      part.toolName.length > MAX_QUARANTINED_TOOL_IDENTIFIER_LENGTH
    ) {
      quarantineUnpairedToolResult(context, part.toolCallId, part.toolName);
      continue;
    }
    const correlatedCall = toolCalls.get(part.toolCallId) ??
      context.priorProviderToolCalls.get(part.toolCallId);
    if (!correlatedCall) {
      quarantineUnpairedToolResult(context, part.toolCallId, part.toolName);
      continue;
    }
    if (correlatedCall.providerExecuted !== true) continue;
    const toolName = correlatedCall.toolName;
    const validated = part.isError === true
      ? { result: part.result, isError: true as const }
      : await validateProviderToolResult(
        {
          type: "tool-call",
          ...correlatedCall,
        },
        part.result,
        context,
      );
    toolResults.push({
      toolCallId: part.toolCallId,
      toolName,
      result: validated.result,
      ...(validated.isError === true ? { isError: true } : {}),
      providerExecuted: true,
      ...(correlatedCall.dynamic === true ? { dynamic: true } : {}),
      ...(correlatedCall.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
    });
    providerResultToolCallIds.add(part.toolCallId);
    terminalToolCallIds.add(part.toolCallId);
  }

  const providerCallsRequiringResult = new Map(context.priorProviderToolCalls);
  for (const toolCall of toolCalls.values()) {
    if (toolCall.providerExecuted === true) {
      providerCallsRequiringResult.set(toolCall.toolCallId, {
        type: "tool-call",
        ...toolCall,
      });
    }
  }

  for (const toolCall of providerCallsRequiringResult.values()) {
    if (
      toolCall.providerExecuted !== true || providerResultToolCallIds.has(toolCall.toolCallId) ||
      terminalToolCallIds.has(toolCall.toolCallId) ||
      toolCall.supportsDeferredResults === true &&
        isProviderResultContinuationBoundary(finishReason)
    ) {
      continue;
    }
    const error = createMissingToolResultError(toolCall);
    toolResults.push({
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      result: error,
      isError: true,
      providerExecuted: true,
      ...(toolCall.dynamic === true ? { dynamic: true } : {}),
    });
    terminalToolCallIds.add(toolCall.toolCallId);
  }

  const finalToolCalls = [...toolCalls.values()];
  throwIfAborted(context.abortSignal);

  return {
    text: textParts.join(""),
    ...(finalToolCalls.length > 0 ? { toolCalls: finalToolCalls } : {}),
    ...(toolResults.length > 0 ? { toolResults } : {}),
    ...(context.quarantinedToolResults?.length
      ? { quarantinedToolResults: context.quarantinedToolResults }
      : {}),
    usage: normalizeRuntimeUsage(directResult.usage),
    finishReason,
    ...(directResult.providerMetadata ? { providerMetadata: directResult.providerMetadata } : {}),
  };
}

function streamUsageToGenerateUsage(
  totalUsage: Extract<RuntimeStreamPart, { type: "finish" }>["totalUsage"],
): RuntimeGenerateTextResult["usage"] {
  return normalizeRuntimeUsage(totalUsage);
}

async function buildGenerateResultFromStream(
  stream: ReadableStream<unknown>,
  context: ToolCallProcessingContext,
): Promise<RuntimeGenerateTextResult> {
  let text = "";
  let usage: RuntimeGenerateTextResult["usage"];
  let finishReason: string | null = null;
  let providerMetadata: Record<string, unknown> | undefined;
  const toolCalls = new Map<string, NonNullable<RuntimeGenerateTextResult["toolCalls"]>[number]>();
  const toolInputs = new Map<
    string,
    {
      toolCallId: string;
      toolName: string;
      input: string;
      providerExecuted?: boolean;
      dynamic?: boolean;
      supportsDeferredResults?: boolean;
    }
  >();
  const toolResults: NonNullable<RuntimeGenerateTextResult["toolResults"]> = [];
  const terminalToolCallIds = new Set<string>();

  for await (const rawPart of mapReadableStream(stream)) {
    if (!rawPart || typeof rawPart !== "object" || !("type" in rawPart)) {
      continue;
    }

    const part = rawPart as RuntimeStreamPart;

    switch (part.type) {
      case "text-delta":
        text += part.text;
        break;

      case "tool-input-start":
        toolInputs.set(part.id, {
          toolCallId: part.id,
          toolName: part.toolName,
          input: "",
          ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
          ...(part.dynamic === true ? { dynamic: true } : {}),
          ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
        });
        break;

      case "tool-input-delta": {
        const input = toolInputs.get(part.id);
        if (input) {
          input.input += part.delta;
        }
        break;
      }

      case "tool-input-end": {
        const input = toolInputs.get(part.id);
        if (input) {
          toolCalls.set(input.toolCallId, {
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            input: parseToolCallInput(input.input),
            ...(input.providerExecuted === true ? { providerExecuted: true } : {}),
            ...(input.dynamic === true ? { dynamic: true } : {}),
            ...(input.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
          });
        }
        break;
      }

      case "tool-input-available": {
        const toolCallId = part.toolCallId ?? part.id;
        if (toolCallId) {
          toolCalls.set(toolCallId, {
            toolCallId,
            toolName: part.toolName,
            input: parseToolCallInput(part.input),
            ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
            ...(part.dynamic === true ? { dynamic: true } : {}),
            ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
          });
        }
        break;
      }

      case "tool-call":
        toolCalls.set(part.toolCallId, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: parseToolCallInput(part.input),
          ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
          ...(part.dynamic === true ? { dynamic: true } : {}),
          ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
        });
        break;

      case "tool-result": {
        if (terminalToolCallIds.has(part.toolCallId)) break;
        const result = "result" in part ? part.result : "output" in part ? part.output : part.error;
        toolResults.push({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result,
          ...(part.isError === true || part.error !== undefined ? { isError: true } : {}),
          ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
          ...(part.dynamic === true ? { dynamic: true } : {}),
          ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
        });
        if (part.preliminary !== true) {
          terminalToolCallIds.add(part.toolCallId);
        }
        break;
      }

      case "tool-error":
        if (terminalToolCallIds.has(part.toolCallId)) break;
        if (!toolCalls.has(part.toolCallId)) {
          toolCalls.set(part.toolCallId, {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: parseToolCallInput(part.input),
            ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
            ...(part.dynamic === true ? { dynamic: true } : {}),
            ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
          });
        }
        toolResults.push({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result: part.error,
          isError: true,
          ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
          ...(part.dynamic === true ? { dynamic: true } : {}),
          ...(part.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
        });
        terminalToolCallIds.add(part.toolCallId);
        break;

      case "error":
        if (part.error instanceof Error) {
          throw part.error;
        }
        throw new Error("Model stream failed", { cause: part.error });

      case "finish":
        finishReason = part.finishReason ?? null;
        usage = streamUsageToGenerateUsage(part.totalUsage);
        providerMetadata = part.providerMetadata;
        break;
    }
  }

  const finalToolCalls = [...toolCalls.values()];

  return {
    text,
    ...(finalToolCalls.length > 0 ? { toolCalls: finalToolCalls } : {}),
    ...(toolResults.length > 0 ? { toolResults } : {}),
    ...(context.quarantinedToolResults?.length
      ? { quarantinedToolResults: context.quarantinedToolResults }
      : {}),
    usage,
    finishReason,
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}

function normalizeStreamPart(part: unknown): RuntimeStreamPart {
  return parseRuntimeStreamPart(part, {
    normalizeUsage(value) {
      const usage = normalizeRuntimeUsage(value);
      return usage ? projectRuntimeStreamUsage(usage) : undefined;
    },
  });
}

type PendingStreamToolCall = {
  id: string;
  toolName: string;
  inputChunks: string[];
  inputBytes: number;
  inputDeltaCount: number;
  ended: boolean;
  providerExecuted?: boolean;
  dynamic?: boolean;
  supportsDeferredResults?: boolean;
};

// These limits bound provider-controlled allocations while remaining well
// above practical function-call payloads and provider tool inventories.
function pendingStreamToolInput(toolCall: PendingStreamToolCall): string {
  return toolCall.inputChunks.join("");
}

function runtimeToolInputText(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    const serialized = JSON.stringify(input);
    if (typeof serialized !== "string") {
      throw new TypeError("Structured runtime tool input is not JSON data");
    }
    return serialized;
  } catch {
    throw new TypeError(
      "Owned runtime tool input could not be serialized",
    );
  }
}

async function* readRuntimeStreamParts(
  stream: ReadableStream<unknown>,
  abortSignal?: AbortSignal,
): AsyncIterable<unknown> {
  const reader = stream.getReader();
  let cancellation: void | PromiseLike<unknown> = undefined;
  let cancellationRequested = false;
  let reachedEnd = false;

  const cancelReader = (reason: unknown): void => {
    if (cancellationRequested) return;
    cancellationRequested = true;
    try {
      cancellation = reader.cancel(reason);
      observePromise(cancellation);
    } catch {
      cancellation = undefined;
    }
  };
  const onAbort = () => cancelReader(abortSignal?.reason);
  abortSignal?.addEventListener("abort", onAbort, { once: true });
  if (abortSignal?.aborted) onAbort();

  try {
    while (true) {
      const read = await awaitAbortable(reader.read(), abortSignal);
      if (read.done) {
        reachedEnd = true;
        return;
      }
      yield read.value;
    }
  } finally {
    abortSignal?.removeEventListener("abort", onAbort);
    if (!reachedEnd) {
      cancelReader(
        abortSignal?.aborted
          ? abortSignal.reason
          : createAbortError("Runtime stream consumer returned before completion"),
      );
    }
    try {
      reader.releaseLock();
    } catch {
      if (cancellation !== undefined) {
        observePromise(
          Promise.resolve(cancellation).finally(() => {
            try {
              reader.releaseLock();
            } catch {
              // Cancellation has already been observed. Preserve the primary
              // stream or validation failure if this source cannot release.
            }
          }),
        );
      }
    }
  }
}

async function* processRuntimeStream(
  stream: ReadableStream<unknown>,
  context: ToolCallProcessingContext,
): AsyncIterable<unknown> {
  const pending = new Map<string, PendingStreamToolCall>();
  const completedToolCalls = new Map<string, RuntimeRepairToolCall>(
    context.priorProviderToolCalls,
  );
  const terminalToolCallIds = new Set<string>();
  const providerResultToolCallIds = new Set<string>();
  const seenToolCallIds = new Set<string>();
  let aggregateToolInputBytes = 0;
  let aggregateToolInputLimitExceeded = false;
  let toolCallLimitExceeded = false;
  let bufferedFinish: Extract<RuntimeStreamPart, { type: "finish" }> | undefined;

  const releasePendingInputReservation = (
    toolCall: PendingStreamToolCall | undefined,
  ): void => {
    if (!toolCall) return;
    if (toolCall.inputBytes > aggregateToolInputBytes) {
      throw new TypeError("Runtime stream tool input reservation accounting became invalid");
    }
    aggregateToolInputBytes -= toolCall.inputBytes;
  };

  const bufferedLifecycle = (
    toolCall: PendingStreamToolCall,
    includeEnd: boolean,
  ): RuntimeStreamPart[] => [
    {
      type: "tool-input-start",
      id: toolCall.id,
      toolName: toolCall.toolName,
      ...(toolCall.providerExecuted === true ? { providerExecuted: true } : {}),
      ...(toolCall.dynamic === true ? { dynamic: true } : {}),
      ...(toolCall.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
    },
    ...toolCall.inputChunks.map((delta) => ({
      type: "tool-input-delta" as const,
      id: toolCall.id,
      delta,
    })),
    ...(includeEnd ? [{ type: "tool-input-end" as const, id: toolCall.id }] : []),
  ];

  const limitErrorPart = (
    toolCallId: string,
    toolName: string,
    limitKind: "bytes" | "deltas" | "toolCalls",
    limit: number,
    untrusted: { providerExecuted?: boolean; dynamic?: boolean } = {},
  ): RuntimeStreamPart => ({
    type: "tool-error",
    toolCallId,
    toolName,
    error: createToolInputLimitError({ toolCallId, toolName, limitKind, limit }),
    isError: true,
    ...canonicalToolMetadata(context.resolvedTools.byName.get(toolName), untrusted),
  });

  const reserveToolCall = (
    toolCallId: string,
    toolName: string,
    untrusted: { providerExecuted?: boolean; dynamic?: boolean },
  ): { accepted: boolean; error?: RuntimeStreamPart } => {
    if (seenToolCallIds.has(toolCallId)) return { accepted: false };
    if (seenToolCallIds.size >= MAX_RUNTIME_TOOL_CALLS) {
      if (toolCallLimitExceeded) return { accepted: false };
      toolCallLimitExceeded = true;
      return {
        accepted: false,
        error: limitErrorPart(
          toolCallId,
          toolName,
          "toolCalls",
          MAX_RUNTIME_TOOL_CALLS,
          untrusted,
        ),
      };
    }
    seenToolCallIds.add(toolCallId);
    return { accepted: true };
  };

  const finalize = async (
    candidate: RuntimeRepairToolCall,
    candidateInputByteLength: number,
    pendingToolCall?: PendingStreamToolCall,
  ): Promise<RuntimeStreamPart[]> => {
    let processed: ProcessedToolCall;
    try {
      processed = await processToolCall(
        candidate,
        candidateInputByteLength,
        context,
      );
    } catch (error) {
      if (!(error instanceof RuntimeToolInputLimitExceededError)) throw error;
      pending.delete(candidate.toolCallId);
      releasePendingInputReservation(pendingToolCall);
      terminalToolCallIds.add(candidate.toolCallId);
      return [
        ...(pendingToolCall ? bufferedLifecycle(pendingToolCall, false) : []),
        limitErrorPart(
          error.toolCall.toolCallId,
          error.toolCall.toolName,
          "bytes",
          MAX_RUNTIME_TOOL_INPUT_BYTES,
          error.toolCall,
        ),
      ];
    }
    pending.delete(candidate.toolCallId);
    const reservedInputBytes = pendingToolCall?.inputBytes ?? 0;
    const nextAggregateToolInputBytes = aggregateToolInputBytes -
      reservedInputBytes +
      processed.inputByteLength;
    if (
      aggregateToolInputLimitExceeded ||
      nextAggregateToolInputBytes > MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES
    ) {
      releasePendingInputReservation(pendingToolCall);
      terminalToolCallIds.add(processed.call.toolCallId);
      aggregateToolInputLimitExceeded = true;
      return [
        ...(pendingToolCall ? bufferedLifecycle(pendingToolCall, false) : []),
        limitErrorPart(
          processed.call.toolCallId,
          processed.call.toolName,
          "bytes",
          MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES,
          processed.call,
        ),
      ];
    }
    aggregateToolInputBytes = nextAggregateToolInputBytes;
    const lifecycle: RuntimeStreamPart[] = [];
    if (pendingToolCall) {
      const canonicalInput = runtimeToolInputText(processed.rawInput);
      const bufferedInput = pendingStreamToolInput(pendingToolCall);
      const deltas = canonicalInput === bufferedInput
        ? pendingToolCall.inputChunks
        : canonicalInput.length > 0
        ? [canonicalInput]
        : [];
      lifecycle.push({
        type: "tool-input-start",
        id: processed.call.toolCallId,
        toolName: processed.call.toolName,
        ...(processed.call.providerExecuted === true ? { providerExecuted: true } : {}),
        ...(processed.call.dynamic === true ? { dynamic: true } : {}),
        ...(processed.call.supportsDeferredResults === true
          ? { supportsDeferredResults: true }
          : {}),
      });
      lifecycle.push(...deltas.map((delta) => ({
        type: "tool-input-delta" as const,
        id: processed.call.toolCallId,
        delta,
      })));
      lifecycle.push({ type: "tool-input-end", id: processed.call.toolCallId });
    }

    if (processed.error !== undefined) {
      terminalToolCallIds.add(processed.call.toolCallId);
      return [...lifecycle, {
        type: "tool-error",
        toolCallId: processed.call.toolCallId,
        toolName: processed.call.toolName,
        input: processed.rawInput,
        error: processed.error,
        isError: true,
        ...(processed.call.providerExecuted === true ? { providerExecuted: true } : {}),
        ...(processed.call.dynamic === true ? { dynamic: true } : {}),
        ...(processed.call.supportsDeferredResults === true
          ? { supportsDeferredResults: true }
          : {}),
      }];
    }

    completedToolCalls.set(processed.call.toolCallId, processed.call);
    return [...lifecycle, {
      type: "tool-call",
      toolCallId: processed.call.toolCallId,
      toolName: processed.call.toolName,
      input: processed.rawInput,
      ...(processed.call.providerExecuted === true ? { providerExecuted: true } : {}),
      ...(processed.call.dynamic === true ? { dynamic: true } : {}),
      ...(processed.call.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
    }];
  };

  const flushEnded = async (exceptId?: string): Promise<RuntimeStreamPart[]> => {
    const parts: RuntimeStreamPart[] = [];
    for (const toolCall of [...pending.values()]) {
      if (!toolCall.ended || toolCall.id === exceptId) continue;
      parts.push(
        ...await finalize(
          {
            type: "tool-call",
            toolCallId: toolCall.id,
            toolName: toolCall.toolName,
            input: pendingStreamToolInput(toolCall),
            ...(toolCall.providerExecuted === true ? { providerExecuted: true } : {}),
            ...(toolCall.dynamic === true ? { dynamic: true } : {}),
            ...(toolCall.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
          },
          toolCall.inputBytes,
          toolCall,
        ),
      );
    }
    return parts;
  };

  const flushIncomplete = (): RuntimeStreamPart[] => {
    const parts: RuntimeStreamPart[] = [];
    for (const toolCall of [...pending.values()]) {
      if (toolCall.ended) continue;
      pending.delete(toolCall.id);
      releasePendingInputReservation(toolCall);
      parts.push(...bufferedLifecycle(toolCall, false));
    }
    return parts;
  };

  const missingProviderResults = (
    finishReason: string | null | undefined,
  ): RuntimeStreamPart[] => {
    const parts: RuntimeStreamPart[] = [];
    for (const toolCall of completedToolCalls.values()) {
      if (
        toolCall.providerExecuted !== true ||
        providerResultToolCallIds.has(toolCall.toolCallId) ||
        terminalToolCallIds.has(toolCall.toolCallId) ||
        toolCall.supportsDeferredResults === true &&
          isProviderResultContinuationBoundary(finishReason)
      ) {
        continue;
      }
      const error = createMissingToolResultError(toolCall);
      terminalToolCallIds.add(toolCall.toolCallId);
      parts.push({
        type: "tool-error",
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
        error,
        isError: true,
        providerExecuted: true,
        ...(toolCall.dynamic === true ? { dynamic: true } : {}),
      });
    }
    return parts;
  };

  const isAllowedAfterContinuationBoundary = (value: unknown): boolean => {
    if (
      !bufferedFinish ||
      !isProviderResultContinuationBoundary(bufferedFinish.finishReason) ||
      !value ||
      typeof value !== "object" ||
      !("type" in value) ||
      value.type !== "tool-result" && value.type !== "tool-error" ||
      !("toolCallId" in value) ||
      typeof value.toolCallId !== "string" ||
      terminalToolCallIds.has(value.toolCallId)
    ) {
      return false;
    }

    const correlated = completedToolCalls.get(value.toolCallId);
    return correlated?.providerExecuted === true &&
      correlated.supportsDeferredResults === true;
  };

  streamLoop:
  for await (const rawPart of readRuntimeStreamParts(stream, context.abortSignal)) {
    throwIfAborted(context.abortSignal);
    const normalized = normalizeStreamPart(rawPart);
    if (bufferedFinish && !isAllowedAfterContinuationBoundary(normalized)) {
      throw new TypeError(
        `Runtime stream emitted content after finish reason "${
          bufferedFinish.finishReason ?? "unknown"
        }"`,
      );
    }
    if (!normalized || typeof normalized !== "object" || !("type" in normalized)) {
      for (const flushed of await flushEnded()) yield flushed;
      yield normalized;
      continue;
    }

    const part = normalized as RuntimeStreamPart;
    switch (part.type) {
      case "tool-input-start": {
        for (const flushed of await flushEnded()) yield flushed;
        if (
          terminalToolCallIds.has(part.id) || completedToolCalls.has(part.id) ||
          pending.has(part.id)
        ) break;
        const reservation = reserveToolCall(part.id, part.toolName, part);
        if (!reservation.accepted) {
          if (reservation.error) yield reservation.error;
          break;
        }
        const metadata = canonicalToolMetadata(
          context.resolvedTools.byName.get(part.toolName),
          part,
        );
        pending.set(part.id, {
          id: part.id,
          toolName: part.toolName,
          inputChunks: [],
          inputBytes: 0,
          inputDeltaCount: 0,
          ended: false,
          ...metadata,
        });
        break;
      }

      case "tool-input-delta": {
        if (terminalToolCallIds.has(part.id) || completedToolCalls.has(part.id)) break;
        const toolCall = pending.get(part.id);
        if (toolCall) {
          if (aggregateToolInputLimitExceeded) {
            pending.delete(part.id);
            releasePendingInputReservation(toolCall);
            terminalToolCallIds.add(part.id);
            for (const lifecyclePart of bufferedLifecycle(toolCall, false)) yield lifecyclePart;
            break;
          }
          const deltaBytes = runtimeToolInputByteLength(part.delta);
          const nextDeltaCount = toolCall.inputDeltaCount + 1;
          const nextInputBytes = toolCall.inputBytes + deltaBytes;
          const exceededDeltaLimit = nextDeltaCount > MAX_RUNTIME_TOOL_INPUT_DELTAS;
          const exceededByteLimit = nextInputBytes > MAX_RUNTIME_TOOL_INPUT_BYTES;
          const exceededAggregateLimit = aggregateToolInputBytes + deltaBytes >
            MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES;
          if (exceededDeltaLimit || exceededByteLimit || exceededAggregateLimit) {
            pending.delete(part.id);
            releasePendingInputReservation(toolCall);
            terminalToolCallIds.add(part.id);
            for (const lifecyclePart of bufferedLifecycle(toolCall, false)) yield lifecyclePart;
            if (exceededAggregateLimit) {
              aggregateToolInputLimitExceeded = true;
            }
            yield limitErrorPart(
              toolCall.id,
              toolCall.toolName,
              exceededDeltaLimit ? "deltas" : "bytes",
              exceededDeltaLimit
                ? MAX_RUNTIME_TOOL_INPUT_DELTAS
                : exceededAggregateLimit
                ? MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES
                : MAX_RUNTIME_TOOL_INPUT_BYTES,
              toolCall,
            );
            break;
          }
          toolCall.inputChunks.push(part.delta);
          toolCall.inputBytes = nextInputBytes;
          toolCall.inputDeltaCount = nextDeltaCount;
          aggregateToolInputBytes += deltaBytes;
        }
        break;
      }

      case "tool-input-end": {
        if (terminalToolCallIds.has(part.id) || completedToolCalls.has(part.id)) break;
        const toolCall = pending.get(part.id);
        if (toolCall) toolCall.ended = true;
        break;
      }

      case "tool-input-available":
      case "tool-call": {
        const toolCallId = part.type === "tool-call" ? part.toolCallId : part.toolCallId ?? part.id;
        if (!toolCallId) break;
        const partInput = part.input;
        const stagedPartInput = partInput === undefined
          ? undefined
          : snapshotRuntimeToolInput(partInput);
        for (const flushed of await flushEnded(toolCallId)) yield flushed;
        if (terminalToolCallIds.has(toolCallId) || completedToolCalls.has(toolCallId)) break;
        const accumulated = pending.get(toolCallId);
        if (!accumulated) {
          const reservation = reserveToolCall(toolCallId, part.toolName, part);
          if (!reservation.accepted) {
            if (reservation.error) yield reservation.error;
            break;
          }
        }
        const accumulatedInput = accumulated ? pendingStreamToolInput(accumulated) : "";
        const useAccumulatedInput = accumulatedInput.length > 0 &&
          (partInput === undefined ||
            (typeof partInput === "string" && partInput.trim() === "{}"));
        const inputSnapshot = useAccumulatedInput
          ? snapshotRuntimeToolInput(accumulatedInput)
          : stagedPartInput ?? snapshotRuntimeToolInput(partInput);
        const reservedInputBytes = accumulated?.inputBytes ?? 0;
        if (inputSnapshot.exceedsLimit) {
          pending.delete(toolCallId);
          releasePendingInputReservation(accumulated);
          terminalToolCallIds.add(toolCallId);
          if (accumulated) {
            for (const lifecyclePart of bufferedLifecycle(accumulated, false)) yield lifecyclePart;
          }
          yield limitErrorPart(
            toolCallId,
            part.toolName,
            "bytes",
            MAX_RUNTIME_TOOL_INPUT_BYTES,
            part,
          );
          break;
        }
        const projectedAggregateInputBytes = aggregateToolInputBytes -
          reservedInputBytes +
          inputSnapshot.byteLength;
        const exceededAggregateLimit = aggregateToolInputLimitExceeded ||
          projectedAggregateInputBytes >
            MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES;
        if (exceededAggregateLimit) {
          pending.delete(toolCallId);
          releasePendingInputReservation(accumulated);
          terminalToolCallIds.add(toolCallId);
          if (accumulated) {
            for (const lifecyclePart of bufferedLifecycle(accumulated, false)) yield lifecyclePart;
          }
          if (!aggregateToolInputLimitExceeded) {
            yield limitErrorPart(
              toolCallId,
              part.toolName,
              "bytes",
              MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES,
              part,
            );
          }
          aggregateToolInputLimitExceeded = true;
          break;
        }
        const untrustedMetadata = {
          providerExecuted: part.providerExecuted === true ||
            accumulated?.providerExecuted === true,
          dynamic: part.dynamic === true || accumulated?.dynamic === true,
        };
        for (
          const finalized of await finalize(
            {
              type: "tool-call",
              toolCallId,
              toolName: part.toolName,
              input: inputSnapshot.input,
              ...untrustedMetadata,
            },
            inputSnapshot.byteLength,
            accumulated,
          )
        ) yield finalized;
        break;
      }

      case "tool-result":
      case "tool-error": {
        for (const flushed of await flushEnded()) yield flushed;
        if (terminalToolCallIds.has(part.toolCallId)) break;
        const completedToolCall = completedToolCalls.get(part.toolCallId);
        if (!completedToolCall) {
          quarantineUnpairedToolResult(context, part.toolCallId, part.toolName);
          break;
        }
        if (completedToolCall.providerExecuted !== true) break;
        const toolName = completedToolCall.toolName;
        const isError = part.type === "tool-error" || part.isError === true ||
          part.error !== undefined;
        const isTerminal = isError || part.preliminary !== true;
        const rawResult = "result" in part
          ? part.result
          : "output" in part
          ? part.output
          : part.error;
        const validated = isError || part.preliminary === true
          ? { result: rawResult, ...(isError ? { isError: true as const } : {}) }
          : await validateProviderToolResult(completedToolCall, rawResult, context);
        if (isTerminal) {
          terminalToolCallIds.add(part.toolCallId);
          providerResultToolCallIds.add(part.toolCallId);
        }
        const terminalPart = part as typeof part & {
          result?: unknown;
          output?: unknown;
        };
        const priorProviderCall = context.priorProviderToolCalls.get(part.toolCallId);
        const {
          providerExecuted: _untrustedProviderExecuted,
          dynamic: _untrustedDynamic,
          supportsDeferredResults: _untrustedSupportsDeferredResults,
          toolName: _untrustedToolName,
          result: _rawResult,
          output: _rawOutput,
          error: _rawError,
          input: _untrustedInput,
          isError: _rawIsError,
          ...trustedPart
        } = terminalPart;
        if (validated.isError === true) {
          yield {
            ...trustedPart,
            type: "tool-error",
            toolName,
            error: validated.result,
            isError: true,
            providerExecuted: true,
            ...(priorProviderCall ? { input: priorProviderCall.input } : {}),
            ...(completedToolCall.dynamic === true ? { dynamic: true } : {}),
            ...(completedToolCall.supportsDeferredResults === true
              ? { supportsDeferredResults: true }
              : {}),
          };
        } else {
          yield {
            ...trustedPart,
            type: "tool-result",
            toolName,
            result: validated.result,
            providerExecuted: true,
            ...(priorProviderCall ? { input: priorProviderCall.input } : {}),
            ...(completedToolCall.dynamic === true ? { dynamic: true } : {}),
            ...(completedToolCall.supportsDeferredResults === true
              ? { supportsDeferredResults: true }
              : {}),
          };
        }
        break;
      }

      default:
        for (const flushed of await flushEnded()) yield flushed;
        if (part.type === "finish" || part.type === "error") {
          for (const incomplete of flushIncomplete()) yield incomplete;
        }
        if (part.type === "finish") {
          bufferedFinish = part;
          if (!isProviderResultContinuationBoundary(part.finishReason)) {
            break streamLoop;
          }
          break;
        }
        if (part.type === "error") {
          yield part;
          return;
        }
        yield part;
        break;
    }
    throwIfAborted(context.abortSignal);
  }

  for (const flushed of await flushEnded()) yield flushed;
  for (const incomplete of flushIncomplete()) yield incomplete;
  for (const missingResult of missingProviderResults(bufferedFinish?.finishReason)) {
    yield missingResult;
  }
  throwIfAborted(context.abortSignal);
  if (!bufferedFinish) {
    throw new TypeError("Runtime stream ended without a terminal event");
  }
  yield bufferedFinish;
}

function createProcessedRuntimeStream(
  source: ReadableStream<unknown>,
  context: ToolCallProcessingContext,
  abortScope: RuntimeAbortScope,
): ReadableStream<unknown> {
  const iterator = processRuntimeStream(source, context)[Symbol.asyncIterator]();
  let cancelRequested = false;
  let settled = false;

  return new ReadableStream<unknown>(
    {
      async pull(controller) {
        if (settled) return;
        try {
          const next = await iterator.next();
          if (cancelRequested) return;
          if (next.done) {
            settled = true;
            abortScope.dispose();
            controller.close();
            return;
          }
          controller.enqueue(next.value);
        } catch (error) {
          if (cancelRequested) return;
          settled = true;
          abortScope.abort(error);
          abortScope.dispose();
          controller.error(error);
        }
      },
      cancel(reason) {
        if (settled || cancelRequested) return;
        cancelRequested = true;
        settled = true;
        abortScope.abort(reason);
        abortScope.dispose();
        observePromise(iterator.return?.());
      },
    },
    { highWaterMark: 0 },
  );
}

type RuntimeStreamProjection<T> =
  | { emit: true; value: T }
  | { emit: false };

function cancelViewReader(
  reader: ReadableStreamDefaultReader<unknown>,
  reason: unknown,
): void {
  let cancellation: void | PromiseLike<unknown>;
  try {
    cancellation = reader.cancel(reason);
    observePromise(cancellation);
  } catch {
    cancellation = undefined;
  }

  try {
    reader.releaseLock();
  } catch {
    if (cancellation !== undefined) {
      observePromise(
        Promise.resolve(cancellation).finally(() => {
          try {
            reader.releaseLock();
          } catch {
            // The source owns a broken reader implementation. Its cancellation
            // has already been observed, so no additional recovery is possible.
          }
        }),
      );
    }
  }
}

function createRuntimeStreamView<T>(
  acquire: () => Promise<ReadableStream<unknown>>,
  project: (part: unknown) => RuntimeStreamProjection<T>,
  onCancel: (reason: unknown) => void,
  abortSignal?: AbortSignal,
): AsyncIterable<T> {
  let claimed = false;

  return {
    [Symbol.asyncIterator](): AsyncIterableIterator<T> {
      if (claimed) {
        throw new TypeError("Runtime stream views can only be consumed once");
      }
      claimed = true;

      let acquisition: Promise<ReadableStreamDefaultReader<unknown>> | undefined;
      let cancelRequested = false;
      let reader: ReadableStreamDefaultReader<unknown> | undefined;
      let settled = false;
      let queue: Promise<void> = Promise.resolve();

      const acquireReader = (): Promise<ReadableStreamDefaultReader<unknown>> => {
        if (!acquisition) {
          acquisition = acquire().then((stream) => {
            const acquired = stream.getReader();
            reader = acquired;
            return acquired;
          });
        }
        return acquisition;
      };

      const cancelAcquiredReader = (reason: unknown): void => {
        if (reader) {
          cancelViewReader(reader, reason);
          return;
        }
        if (acquisition) {
          observePromise(
            acquisition.then(
              (acquired) => cancelViewReader(acquired, reason),
              () => {},
            ),
          );
        }
      };

      const cancel = (reason: unknown): void => {
        if (settled || cancelRequested) return;
        cancelRequested = true;
        settled = true;
        onCancel(reason);
        cancelAcquiredReader(reason);
      };

      const readNext = async (): Promise<IteratorResult<T>> => {
        if (settled || cancelRequested) {
          return { done: true, value: undefined };
        }
        try {
          throwIfAborted(abortSignal);
          const acquired = await acquireReader();
          while (!settled && !cancelRequested) {
            const next = await awaitAbortable(acquired.read(), abortSignal);
            if (settled || cancelRequested) {
              return { done: true, value: undefined };
            }
            if (next.done) {
              settled = true;
              try {
                acquired.releaseLock();
              } catch {
                // A completed reader has no remaining resource to recover.
              }
              return { done: true, value: undefined };
            }

            const projected = project(next.value);
            if (projected.emit) {
              return { done: false, value: projected.value };
            }
          }
          return { done: true, value: undefined };
        } catch (error) {
          if (cancelRequested) {
            return { done: true, value: undefined };
          }
          settled = true;
          onCancel(error);
          cancelAcquiredReader(error);
          throw error;
        }
      };

      const iterator: AsyncIterableIterator<T> = {
        next() {
          const result = queue.then(readNext, readNext);
          queue = result.then(
            () => {},
            () => {},
          );
          return result;
        },
        return(value?: T) {
          cancel(createAbortError("Runtime stream consumer returned before completion"));
          return Promise.resolve({ done: true, value: value as T });
        },
        throw(error?: unknown) {
          cancel(error);
          return Promise.reject(error);
        },
        [Symbol.asyncIterator]() {
          return iterator;
        },
      };
      return iterator;
    },
  };
}

async function* mapReadableStream(stream: ReadableStream<unknown>): AsyncIterable<unknown> {
  for await (const part of stream) {
    yield normalizeStreamPart(part);
  }
}

function projectTextStreamPart(part: unknown): RuntimeStreamProjection<string> {
  if (!part || typeof part !== "object" || !("type" in part)) {
    return { emit: false };
  }

  if (part.type === "error") {
    const error = "error" in part ? part.error : undefined;
    if (error instanceof Error) throw error;
    throw new Error("Model stream failed", { cause: error });
  }

  if (part.type !== "text-delta") return { emit: false };
  const normalized = normalizeStreamPart(part) as { type: "text-delta"; text: string };
  return { emit: true, value: normalized.text };
}

function createToolCallProcessingContext(
  options: DirectTextOptions,
  resolvedTools: ResolvedRuntimeTools,
  system: string | undefined,
): ToolCallProcessingContext {
  const priorProviderToolCalls = new Map<string, RuntimeRepairToolCall>();
  for (const message of options.messages) {
    if (message.role !== "assistant") continue;
    for (const toolCall of message.providerToolCalls ?? []) {
      const resolved = resolvedTools.byName.get(toolCall.toolName);
      if (resolved?.kind !== "provider") continue;
      priorProviderToolCalls.set(toolCall.toolCallId, {
        type: "tool-call",
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: parseToolCallInput(toolCall.input),
        providerExecuted: true,
        ...(resolved.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
      });
    }
  }

  return {
    abortSignal: options.abortSignal,
    messages: getProviderRequestMessages(options.messages),
    repairToolCall: options.experimental_repairToolCall,
    resolvedTools,
    system,
    tools: options.tools ?? {},
    priorProviderToolCalls,
    ...("quarantineUnpairedToolResults" in options &&
        options.quarantineUnpairedToolResults === true
      ? { quarantinedToolResults: [] }
      : {}),
  };
}

export function generateText(options: GenerateTextOptions): PromiseLike<RuntimeGenerateTextResult> {
  return (async () => {
    const system = normalizeSystemPrompt(options.system);
    const resolvedTools = await resolveRuntimeTools(options.tools, options.abortSignal);
    if (shouldGenerateViaStream(options.model)) {
      const abortScope = createRuntimeAbortScope(options.abortSignal);
      const scopedOptions: GenerateTextOptions = {
        ...options,
        abortSignal: abortScope.signal,
      };
      const processingContext = createToolCallProcessingContext(
        scopedOptions,
        resolvedTools,
        system,
      );
      try {
        throwIfAborted(abortScope.signal);
        const { stream } = await awaitRuntimeStreamStart(
          options.model.doStream(
            buildDirectModelOptions(scopedOptions, resolvedTools.directTools, system),
          ),
          abortScope.signal,
        );
        const processedStream = createProcessedRuntimeStream(
          stream,
          processingContext,
          abortScope,
        );
        return await buildGenerateResultFromStream(processedStream, processingContext);
      } finally {
        abortScope.dispose();
      }
    }

    const processingContext = createToolCallProcessingContext(
      options,
      resolvedTools,
      system,
    );
    throwIfAborted(options.abortSignal);
    const result = await awaitAbortable(
      options.model.doGenerate(
        buildDirectModelOptions(options, resolvedTools.directTools, system),
      ),
      options.abortSignal,
    );
    return await buildDirectGenerateResult(result, processingContext);
  })();
}

export function streamText(options: StreamTextOptions): RuntimeStreamResult {
  let abortScope: RuntimeAbortScope | undefined;
  let directResultPromise:
    | Promise<{ stream: ReadableStream<unknown>; warnings?: unknown[] }>
    | undefined;

  const getAbortScope = (): RuntimeAbortScope => {
    abortScope ??= createRuntimeAbortScope(options.abortSignal);
    return abortScope;
  };
  const getDirectResult = (): Promise<{
    stream: ReadableStream<unknown>;
    warnings?: unknown[];
  }> => {
    if (!directResultPromise) {
      const scope = getAbortScope();
      const scopedOptions: StreamTextOptions = {
        ...options,
        abortSignal: scope.signal,
      };
      directResultPromise = (async () => {
        try {
          const system = normalizeSystemPrompt(options.system);
          const resolvedTools = await resolveRuntimeTools(options.tools, scope.signal);
          throwIfAborted(scope.signal);
          const result = await awaitRuntimeStreamStart(
            options.model.doStream(
              buildDirectModelOptions(scopedOptions, resolvedTools.directTools, system),
            ),
            scope.signal,
          );
          return {
            ...result,
            stream: createProcessedRuntimeStream(
              result.stream,
              createToolCallProcessingContext(scopedOptions, resolvedTools, system),
              scope,
            ),
          };
        } catch (error) {
          scope.abort(error);
          scope.dispose();
          throw error;
        }
      })();
      // A consumer can return while startup is pending. Observe the startup
      // rejection even when no pending next call remains interested in it.
      directResultPromise.catch(() => {});
    }
    return directResultPromise;
  };

  const hasStarted: Record<"full" | "text", boolean> = { full: false, text: false };
  const hasCancelled: Record<"full" | "text", boolean> = { full: false, text: false };
  let mode: "full" | "text" | "dual" | null = null;
  let branches: [ReadableStream<unknown>, ReadableStream<unknown>] | null = null;

  const acquire = async (branch: "full" | "text"): Promise<ReadableStream<unknown>> => {
    hasStarted[branch] = true;
    const { stream } = await getDirectResult();

    if (mode === null) {
      if (hasStarted.full && hasStarted.text) {
        branches = stream.tee();
        mode = "dual";
      } else {
        // A single consumer reads the source directly, preserving backpressure
        // and allowing early cancellation without an unread tee branch.
        mode = branch;
      }
    }

    if (mode === "dual" && branches !== null) {
      return branch === "full" ? branches[0] : branches[1];
    }
    if (mode === branch) return stream;

    throw new Error("fullStream and textStream must start consumption concurrently");
  };

  const cancelBranch = (branch: "full" | "text", reason: unknown): void => {
    hasCancelled[branch] = true;
    const other = branch === "full" ? "text" : "full";
    const dualConsumption = mode === "dual" ||
      mode === null && hasStarted.full && hasStarted.text;

    if (dualConsumption) {
      if (hasCancelled[other]) abortScope?.abort(reason);
      return;
    }

    if (mode === branch || mode === null && !hasStarted[other]) {
      abortScope?.abort(reason);
    }
  };

  return {
    fullStream: createRuntimeStreamView(
      () => acquire("full"),
      (part) => ({ emit: true, value: part }),
      (reason) => cancelBranch("full", reason),
      options.abortSignal,
    ),
    textStream: createRuntimeStreamView(
      () => acquire("text"),
      projectTextStreamPart,
      (reason) => cancelBranch("text", reason),
      options.abortSignal,
    ),
  };
}

import {
  jsonValuesEqual,
  readProviderOptions,
  readRecord,
  unwrapToolInputSchema,
} from "veryfront/provider/shared";
import type {
  ModelRuntimeCallOptions,
  ModelRuntimePromptMessage,
  ModelRuntimeToolDefinition,
  RuntimeReasoningOption,
} from "veryfront/provider/shared";
import {
  createGoogleToolCallCorrelationRegistry,
  GOOGLE_CODE_EXECUTION_TOOL_NAME,
  googleCodeExecutionInput,
  googleCodeExecutionOutput,
  readGoogleCodeExecutionResult,
  readGoogleExecutableCode,
  readGooglePartDataField,
} from "./google-content-parts.ts";
import { readGoogleRawAssistantReplay } from "./google-thought-signatures.ts";

export interface OpenAICompatibleLanguageOptions extends ModelRuntimeCallOptions {
  requestLabels?: Record<string, string>;
  googleCachedContent?: string;
  googleSafetySettings?: ReadonlyArray<{
    category: string;
    threshold: string;
  }>;
}

/** @deprecated Import `ModelRuntimeToolDefinition` from `veryfront/provider/shared` instead. */
export type RuntimeToolDefinition = ModelRuntimeToolDefinition;

type WarningCollector = {
  push(warning: {
    type: "unsupported-setting" | "other";
    setting?: string;
    details?: string;
    provider: string;
  }): void;
  drain(): Array<{
    type: "unsupported-setting" | "other";
    setting?: string;
    details?: string;
    provider: string;
  }>;
};

type GoogleCompatibleContent = {
  role: "user" | "model";
  parts: readonly Record<string, unknown>[];
};

type GoogleCompatibleRequest = {
  contents: GoogleCompatibleContent[];
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  tools?: Array<Record<string, unknown>>;
  toolConfig?: {
    functionCallingConfig: Record<string, unknown>;
  };
  generationConfig?: Record<string, unknown>;
  [key: string]: unknown;
};

type CanonicalProviderCall = {
  id: string;
  name: string;
  input: unknown;
};

type CanonicalProviderResult = {
  id: string;
  name: string;
  result: unknown;
  isError: boolean;
};

type GoogleToolEventKind =
  | "ordinary-call"
  | "provider-call"
  | "provider-result";

type GoogleToolEvent = {
  kind: GoogleToolEventKind;
  id: string;
};

type GoogleRawToolHistory = {
  ordinaryCalls: CanonicalProviderCall[];
  legacyOrdinaryCalls: CanonicalProviderCall[];
  providerCalls: CanonicalProviderCall[];
  providerResults: CanonicalProviderResult[];
  toolEvents: GoogleToolEvent[];
  legacyToolEvents: GoogleToolEvent[];
};

function invalidGoogleProviderHistory(): TypeError {
  return new TypeError(
    "Google raw assistant metadata did not match canonical provider tool history",
  );
}

function readGoogleRawToolHistory(
  rawAssistantParts: readonly Record<string, unknown>[],
  rawAssistantPartIndexes: readonly number[],
): GoogleRawToolHistory {
  const registry = createGoogleToolCallCorrelationRegistry();
  const ordinaryCalls: CanonicalProviderCall[] = [];
  const legacyOrdinaryCalls: CanonicalProviderCall[] = [];
  const providerCalls: CanonicalProviderCall[] = [];
  const providerResults: CanonicalProviderResult[] = [];
  const toolEvents: GoogleToolEvent[] = [];
  const legacyToolEvents: GoogleToolEvent[] = [];
  let anonymousFunctionCallIndex = 0;

  for (let partIndex = 0; partIndex < rawAssistantParts.length; partIndex += 1) {
    const part = rawAssistantParts[partIndex];
    if (part === undefined) {
      throw invalidGoogleProviderHistory();
    }
    const dataField = readGooglePartDataField(part);
    if (dataField === "functionCall") {
      const functionCall = readRecord(part.functionCall);
      const functionCallArgs = functionCall?.args === undefined
        ? {}
        : readRecord(functionCall.args);
      if (
        !functionCall ||
        typeof functionCall.name !== "string" ||
        !functionCallArgs
      ) {
        throw invalidGoogleProviderHistory();
      }
      const providerId = typeof functionCall.id === "string" ? functionCall.id : undefined;
      const id = registry.registerFunctionCall(
        rawAssistantPartIndexes[partIndex] ?? partIndex,
        providerId,
      );
      // Histories persisted before raw-position ids used the anonymous-call
      // occurrence instead. Build both complete projections so validation
      // cannot accept a mixture that no implementation ever emitted.
      const legacyId = providerId === undefined ? `tool-${anonymousFunctionCallIndex++}` : id;
      const call = {
        name: functionCall.name,
        input: functionCallArgs,
      };
      ordinaryCalls.push({ id, ...call });
      legacyOrdinaryCalls.push({ id: legacyId, ...call });
      toolEvents.push({ kind: "ordinary-call", id });
      legacyToolEvents.push({ kind: "ordinary-call", id: legacyId });
      continue;
    }
    if (dataField === "executableCode") {
      const executableCode = readGoogleExecutableCode(part.executableCode);
      const id = registry.registerCodeExecution(executableCode.providerId);
      providerCalls.push({
        id,
        name: GOOGLE_CODE_EXECUTION_TOOL_NAME,
        input: googleCodeExecutionInput(executableCode),
      });
      toolEvents.push({ kind: "provider-call", id });
      legacyToolEvents.push({ kind: "provider-call", id });
      continue;
    }
    if (dataField !== "codeExecutionResult") {
      continue;
    }

    const result = readGoogleCodeExecutionResult(part.codeExecutionResult);
    const id = registry.resolveCodeExecutionResult(result.providerId);
    providerResults.push({
      id,
      name: GOOGLE_CODE_EXECUTION_TOOL_NAME,
      result: googleCodeExecutionOutput(result),
      isError: result.isError,
    });
    toolEvents.push({ kind: "provider-result", id });
    legacyToolEvents.push({ kind: "provider-result", id });
  }
  registry.assertSettled();
  return {
    ordinaryCalls,
    legacyOrdinaryCalls,
    providerCalls,
    providerResults,
    toolEvents,
    legacyToolEvents,
  };
}

function callsMatch(
  left: CanonicalProviderCall,
  right: CanonicalProviderCall,
): boolean {
  return left.id === right.id &&
    left.name === right.name &&
    jsonValuesEqual(left.input, right.input, true);
}

function resultsMatch(
  left: CanonicalProviderResult,
  right: CanonicalProviderResult,
): boolean {
  return left.id === right.id &&
    left.name === right.name &&
    left.isError === right.isError &&
    jsonValuesEqual(left.result, right.result);
}

function orderedProjectionMatches<T extends object>(
  left: readonly T[],
  right: readonly T[],
  entryMatches: (left: T, right: T) => boolean,
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const entry = left[index];
    const matchingEntry = right[index];
    if (
      entry === undefined ||
      matchingEntry === undefined ||
      !entryMatches(entry, matchingEntry)
    ) {
      return false;
    }
  }
  return true;
}

function rejectDuplicateIds(
  entries: readonly { id: string }[],
): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw invalidGoogleProviderHistory();
    }
    ids.add(entry.id);
  }
}

function survivingToolEvents(
  events: readonly GoogleToolEvent[],
  activeKinds: ReadonlySet<GoogleToolEventKind>,
): GoogleToolEvent[] {
  const surviving: GoogleToolEvent[] = [];
  for (const event of events) {
    if (activeKinds.has(event.kind)) {
      surviving.push(event);
    }
  }
  return surviving;
}

function validateGoogleToolReplay(
  message: Extract<ModelRuntimePromptMessage, { readonly role: "assistant" }>,
  rawAssistantParts: readonly Record<string, unknown>[],
  rawAssistantPartIndexes: readonly number[],
): void {
  const providerToolCalls = (message.providerToolCalls ?? []).map((call) => ({
    id: call.toolCallId,
    name: call.toolName,
    input: call.input,
  }));
  rejectDuplicateIds(providerToolCalls);

  const contentProviderCalls: CanonicalProviderCall[] = [];
  const ordinaryCalls: CanonicalProviderCall[] = [];
  const providerResults: CanonicalProviderResult[] = [];
  const contentToolEvents: GoogleToolEvent[] = [];
  const contentCallIds = new Set<string>();
  for (const part of message.content) {
    if (part.type === "tool-call") {
      if (contentCallIds.has(part.toolCallId)) {
        throw invalidGoogleProviderHistory();
      }
      contentCallIds.add(part.toolCallId);
      const call = {
        id: part.toolCallId,
        name: part.toolName,
        input: part.input,
      };
      const callKind = part.providerExecuted === true ? "provider" : "ordinary";
      (callKind === "provider" ? contentProviderCalls : ordinaryCalls).push(call);
      contentToolEvents.push({
        kind: callKind === "provider" ? "provider-call" : "ordinary-call",
        id: call.id,
      });
      continue;
    }
    if (part.type !== "tool-result" || part.providerExecuted !== true) {
      continue;
    }
    providerResults.push({
      id: part.toolCallId,
      name: part.toolName,
      result: part.result,
      isError: part.isError === true,
    });
    contentToolEvents.push({
      kind: "provider-result",
      id: part.toolCallId,
    });
  }
  rejectDuplicateIds(providerResults);

  let canonicalProviderCalls: CanonicalProviderCall[];
  if (providerToolCalls.length > 0 && contentProviderCalls.length > 0) {
    if (
      !orderedProjectionMatches(
        providerToolCalls,
        contentProviderCalls,
        callsMatch,
      )
    ) {
      throw invalidGoogleProviderHistory();
    }
    // `providerToolCalls` is the historical message-level projection of the
    // same provider-executed content. Validate both sources above, but compare
    // the replay only once.
    canonicalProviderCalls = providerToolCalls;
  } else {
    canonicalProviderCalls = providerToolCalls.length > 0
      ? providerToolCalls
      : contentProviderCalls;
  }
  rejectDuplicateIds([...ordinaryCalls, ...canonicalProviderCalls]);

  let rawHistory: GoogleRawToolHistory;
  try {
    rawHistory = readGoogleRawToolHistory(rawAssistantParts, rawAssistantPartIndexes);
  } catch {
    throw invalidGoogleProviderHistory();
  }

  // Exact wire history may outlive an absent canonical projection, for example
  // after compaction. Once any projection survives, however, it must correlate
  // one-for-one and in occurrence order; maps or sets would silently accept
  // reordered or duplicated calls/results.
  if (
    canonicalProviderCalls.length > 0 &&
    !orderedProjectionMatches(
      rawHistory.providerCalls,
      canonicalProviderCalls,
      callsMatch,
    )
  ) {
    throw invalidGoogleProviderHistory();
  }
  if (
    providerResults.length > 0 &&
    !orderedProjectionMatches(
      rawHistory.providerResults,
      providerResults,
      resultsMatch,
    )
  ) {
    throw invalidGoogleProviderHistory();
  }
  const activeContentEventKinds = new Set<GoogleToolEventKind>();
  if (ordinaryCalls.length > 0) {
    activeContentEventKinds.add("ordinary-call");
  }
  if (contentProviderCalls.length > 0) {
    activeContentEventKinds.add("provider-call");
  }
  if (providerResults.length > 0) {
    activeContentEventKinds.add("provider-result");
  }
  const currentRawSurvivingEvents = survivingToolEvents(
    rawHistory.toolEvents,
    activeContentEventKinds,
  );
  const legacyRawSurvivingEvents = survivingToolEvents(
    rawHistory.legacyToolEvents,
    activeContentEventKinds,
  );
  const canonicalSurvivingEvents = survivingToolEvents(
    contentToolEvents,
    activeContentEventKinds,
  );
  const currentIdsMatch = (
    ordinaryCalls.length === 0 ||
    orderedProjectionMatches(rawHistory.ordinaryCalls, ordinaryCalls, callsMatch)
  ) &&
    orderedProjectionMatches(
      currentRawSurvivingEvents,
      canonicalSurvivingEvents,
      (left, right) => left.kind === right.kind && left.id === right.id,
    );
  const legacyIdsMatch = (
    ordinaryCalls.length === 0 ||
    orderedProjectionMatches(
      rawHistory.legacyOrdinaryCalls,
      ordinaryCalls,
      callsMatch,
    )
  ) &&
    orderedProjectionMatches(
      legacyRawSurvivingEvents,
      canonicalSurvivingEvents,
      (left, right) => left.kind === right.kind && left.id === right.id,
    );
  if (!currentIdsMatch && !legacyIdsMatch) {
    throw invalidGoogleProviderHistory();
  }
}

function toGoogleContents(
  prompt: readonly ModelRuntimePromptMessage[],
): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GoogleCompatibleContent[];
} {
  const systemParts: string[] = [];
  const contents: GoogleCompatibleContent[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system":
        if (message.content.length > 0) {
          systemParts.push(message.content);
        }
        break;
      case "user":
        contents.push({
          role: "user",
          parts: toGoogleUserParts(message.content),
        });
        break;
      case "assistant": {
        const rawAssistantReplay = readGoogleRawAssistantReplay(message.providerMetadata);
        if (rawAssistantReplay) {
          validateGoogleToolReplay(
            message,
            rawAssistantReplay.parts,
            rawAssistantReplay.partIndexes,
          );
          contents.push({ role: "model", parts: rawAssistantReplay.parts });
          break;
        }

        const parts: Array<Record<string, unknown>> = [];
        for (const part of message.content) {
          if (part.type === "text") {
            parts.push({ text: part.text });
            continue;
          }
          if (part.type === "reasoning") {
            continue;
          }
          if (part.type === "tool-result") {
            throw new TypeError(
              "Google provider-executed assistant tool results require exact raw replay metadata",
            );
          }
          if (part.providerExecuted === true) {
            throw new TypeError(
              "Google provider-executed assistant tool calls require exact raw replay metadata",
            );
          }
          parts.push({
            functionCall: {
              id: part.toolCallId,
              name: part.toolName,
              args: part.input,
            },
          });
        }
        contents.push({ role: "model", parts });
        break;
      }
      case "tool":
        contents.push({
          role: "user",
          parts: message.content.map((part) => ({
            functionResponse: {
              id: part.toolCallId,
              name: part.toolName,
              response: {
                result: part.output.value,
              },
            },
          })),
        });
        break;
    }
  }

  return {
    ...(systemParts.length > 0
      ? { systemInstruction: { parts: systemParts.map((text) => ({ text })) } }
      : {}),
    contents,
  };
}

function toGoogleUserParts(
  parts: Extract<ModelRuntimePromptMessage, { readonly role: "user" }>["content"],
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];

  for (const part of parts) {
    if (part.type === "text") {
      if (part.text.length > 0) {
        content.push({ text: part.text });
      }
      continue;
    }

    if (part.type === "image" || part.mediaType.startsWith("image/")) {
      content.push({
        fileData: {
          mimeType: part.mediaType,
          fileUri: part.url,
        },
      });
    }
  }

  return content;
}

const GOOGLE_CODE_EXECUTION_TOOL_ID = "google.code_execution";
const GOOGLE_SEARCH_TOOL_ID = "google.google_search";
const GOOGLE_SEARCH_TOOL_NAME = "google_search";
const GOOGLE_SEARCH_ARGUMENT_KEYS = new Set(["searchTypes", "timeRangeFilter"]);
const GOOGLE_SEARCH_TYPE_KEYS = new Set(["webSearch", "imageSearch"]);
const GOOGLE_TIME_RANGE_KEYS = new Set(["startTime", "endTime"]);
const RFC_3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  subject: string,
): void {
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new TypeError(`${subject} contained an unsupported field`);
  }
}

function readEmptyGoogleToolObject(value: unknown, subject: string): Record<string, never> {
  const record = readRecord(value);
  if (!record || Object.keys(record).length > 0) {
    throw new TypeError(`${subject} must be an empty object`);
  }
  return {};
}

function readGoogleTimestamp(value: unknown, subject: string): string {
  const timestamp = typeof value === "string" ? value : undefined;
  const match = timestamp === undefined ? null : RFC_3339_TIMESTAMP.exec(timestamp);
  if (!match || timestamp === undefined) {
    throw new TypeError(`${subject} must be an RFC 3339 timestamp`);
  }
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  if (
    year < 1 ||
    daysInMonth === undefined ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    !Number.isFinite(Date.parse(timestamp))
  ) {
    throw new TypeError(`${subject} must be an RFC 3339 timestamp`);
  }
  return timestamp;
}

function readGoogleSearchArguments(value: unknown): Record<string, unknown> {
  const args = readRecord(value);
  if (!args) {
    throw new TypeError("google.google_search args must be an object");
  }
  rejectUnknownKeys(args, GOOGLE_SEARCH_ARGUMENT_KEYS, "google.google_search args");

  const normalized: Record<string, unknown> = {};
  if (args.searchTypes !== undefined) {
    const searchTypes = readRecord(args.searchTypes);
    if (!searchTypes) {
      throw new TypeError("google.google_search searchTypes must be an object");
    }
    rejectUnknownKeys(
      searchTypes,
      GOOGLE_SEARCH_TYPE_KEYS,
      "google.google_search searchTypes",
    );
    normalized.searchTypes = {
      ...(searchTypes.webSearch !== undefined
        ? {
          webSearch: readEmptyGoogleToolObject(
            searchTypes.webSearch,
            "google.google_search webSearch",
          ),
        }
        : {}),
      ...(searchTypes.imageSearch !== undefined
        ? {
          imageSearch: readEmptyGoogleToolObject(
            searchTypes.imageSearch,
            "google.google_search imageSearch",
          ),
        }
        : {}),
    };
  }

  if (args.timeRangeFilter !== undefined) {
    const timeRangeFilter = readRecord(args.timeRangeFilter);
    if (!timeRangeFilter) {
      throw new TypeError("google.google_search timeRangeFilter must be an object");
    }
    rejectUnknownKeys(
      timeRangeFilter,
      GOOGLE_TIME_RANGE_KEYS,
      "google.google_search timeRangeFilter",
    );
    const hasStart = timeRangeFilter.startTime !== undefined;
    const hasEnd = timeRangeFilter.endTime !== undefined;
    if (hasStart !== hasEnd) {
      throw new TypeError(
        "google.google_search timeRangeFilter requires both startTime and endTime",
      );
    }
    if (hasStart && hasEnd) {
      const startTime = readGoogleTimestamp(
        timeRangeFilter.startTime,
        "google.google_search startTime",
      );
      const endTime = readGoogleTimestamp(
        timeRangeFilter.endTime,
        "google.google_search endTime",
      );
      if (Date.parse(startTime) > Date.parse(endTime)) {
        throw new TypeError(
          "google.google_search timeRangeFilter startTime must not be after endTime",
        );
      }
      normalized.timeRangeFilter = { startTime, endTime };
    } else {
      normalized.timeRangeFilter = {};
    }
  }

  return normalized;
}

function toGoogleProviderTool(
  tool: Extract<ModelRuntimeToolDefinition, { type: "provider" }>,
): { id: string; wireTool: Record<string, unknown> } {
  if (typeof tool.id !== "string") {
    throw new TypeError("Google provider tool id must be a string");
  }

  switch (tool.id) {
    case GOOGLE_CODE_EXECUTION_TOOL_ID:
      if (tool.name !== GOOGLE_CODE_EXECUTION_TOOL_NAME) {
        throw new TypeError(
          "google.code_execution provider tool name must be code_execution",
        );
      }
      return {
        id: tool.id,
        wireTool: {
          codeExecution: readEmptyGoogleToolObject(
            tool.args,
            "google.code_execution args",
          ),
        },
      };
    case GOOGLE_SEARCH_TOOL_ID:
      if (tool.name !== GOOGLE_SEARCH_TOOL_NAME) {
        throw new TypeError(
          "google.google_search provider tool name must be google_search",
        );
      }
      return {
        id: tool.id,
        wireTool: { googleSearch: readGoogleSearchArguments(tool.args) },
      };
    default:
      throw new TypeError(
        tool.id.startsWith("google.")
          ? "Unsupported Google provider tool id"
          : "Google requests cannot contain a provider tool for another provider",
      );
  }
}

function toGoogleTools(
  tools: readonly ModelRuntimeToolDefinition[] | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!tools) {
    return undefined;
  }

  const functionDeclarations: Array<Record<string, unknown>> = [];
  const providerEntries: Array<Record<string, unknown>> = [];
  const providerToolIds = new Set<string>();

  for (const tool of tools) {
    if (tool.type === "function") {
      functionDeclarations.push({
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        parameters: unwrapToolInputSchema(tool.inputSchema),
      });
      continue;
    }
    if (tool.type !== "provider") {
      throw new TypeError("Google tool type must be function or provider");
    }

    const providerTool = toGoogleProviderTool(tool);
    if (providerToolIds.has(providerTool.id)) {
      throw new TypeError("Google provider tool id was duplicated");
    }
    providerToolIds.add(providerTool.id);
    providerEntries.push(providerTool.wireTool);
  }

  const result: Array<Record<string, unknown>> = [];
  if (functionDeclarations.length > 0) {
    result.push({ functionDeclarations });
  }
  result.push(...providerEntries);
  return result.length > 0 ? result : undefined;
}

function normalizeGoogleToolChoice(toolChoice: unknown):
  | GoogleCompatibleRequest["toolConfig"]
  | undefined {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (typeof toolChoice === "string") {
    switch (toolChoice) {
      case "none":
        return { functionCallingConfig: { mode: "NONE" } };
      case "any":
      case "required":
        return { functionCallingConfig: { mode: "ANY" } };
      default:
        return { functionCallingConfig: { mode: "AUTO" } };
    }
  }

  const record = readRecord(toolChoice);
  if (!record) return undefined;

  if (record.type === "tool" && typeof record.name === "string") {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [record.name],
      },
    };
  }

  if (record.type === "tools" && Array.isArray(record.names)) {
    const names = record.names.filter((n): n is string => typeof n === "string");
    if (names.length > 0) {
      return {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: names,
        },
      };
    }
  }

  if (record.type === "auto") {
    return { functionCallingConfig: { mode: "AUTO" } };
  }
  if (record.type === "none") {
    return { functionCallingConfig: { mode: "NONE" } };
  }
  if (record.type === "any" || record.type === "required") {
    return { functionCallingConfig: { mode: "ANY" } };
  }

  return undefined;
}

function resolveGoogleThinkingConfig(
  option: RuntimeReasoningOption | undefined,
): Record<string, unknown> | undefined {
  if (
    option?.budgetTokens !== undefined &&
    (!Number.isSafeInteger(option.budgetTokens) || option.budgetTokens < 0)
  ) {
    throw new TypeError(
      "Google reasoning budgetTokens must be a non-negative safe integer",
    );
  }
  if (!option || option.enabled !== true) {
    return undefined;
  }
  const config: Record<string, unknown> = { includeThoughts: true };
  if (option.budgetTokens !== undefined) {
    config.thinkingBudget = option.budgetTokens;
    return config;
  }
  switch (option.effort) {
    case "low":
      config.thinkingBudget = 512;
      break;
    case "high":
      config.thinkingBudget = 8192;
      break;
    case "max":
      config.thinkingBudget = -1;
      break;
    case "medium":
    default:
      config.thinkingBudget = 2048;
      break;
  }
  return config;
}

/**
 * Map a framework response format onto Gemini generation config keys.
 *
 * Gemini constrains generation with `responseMimeType` plus, for a schema,
 * `responseSchema`. It has no counterpart for the format name, description, or
 * strict flag, which are therefore not sent.
 */
function buildGoogleStructuredOutputConfig(
  responseFormat: OpenAICompatibleLanguageOptions["responseFormat"],
): Record<string, unknown> {
  if (!responseFormat || responseFormat.type === "text") return {};
  return {
    responseMimeType: "application/json",
    ...(responseFormat.type === "json_schema"
      ? { responseSchema: unwrapToolInputSchema(responseFormat.schema) }
      : {}),
  };
}

function buildGoogleGenerationConfig(
  options: OpenAICompatibleLanguageOptions,
): Record<string, unknown> | undefined {
  const thinkingConfig = resolveGoogleThinkingConfig(options.reasoning);
  const config: Record<string, unknown> = {
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.topP !== undefined ? { topP: options.topP } : {}),
    ...(options.topK !== undefined ? { topK: options.topK } : {}),
    ...(options.stopSequences && options.stopSequences.length > 0
      ? { stopSequences: options.stopSequences }
      : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(thinkingConfig ? { thinkingConfig } : {}),
    ...buildGoogleStructuredOutputConfig(options.responseFormat),
  };

  return Object.keys(config).length > 0 ? config : undefined;
}

export function buildGoogleGenerateContentRequest(
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  warnings: WarningCollector,
): GoogleCompatibleRequest {
  if (options.presencePenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "google",
      setting: "presencePenalty",
      details: "Gemini generateContent does not accept presencePenalty; the value was dropped.",
    });
  }
  if (options.frequencyPenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "google",
      setting: "frequencyPenalty",
      details: "Gemini generateContent does not accept frequencyPenalty; the value was dropped.",
    });
  }

  const { systemInstruction, contents } = toGoogleContents(options.prompt);
  const generationConfig = buildGoogleGenerationConfig(options);
  const tools = toGoogleTools(options.tools);
  const toolConfig = normalizeGoogleToolChoice(options.toolChoice);
  const labels = options.requestLabels && Object.keys(options.requestLabels).length > 0
    ? options.requestLabels
    : typeof options.userId === "string" && options.userId.length > 0
    ? { user_id: options.userId }
    : undefined;
  const body: GoogleCompatibleRequest = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(tools ? { tools } : {}),
    ...(toolConfig ? { toolConfig } : {}),
    ...(generationConfig ? { generationConfig } : {}),
    ...(labels ? { labels } : {}),
    ...(typeof options.googleCachedContent === "string" && options.googleCachedContent.length > 0
      ? { cachedContent: options.googleCachedContent }
      : {}),
    ...(options.googleSafetySettings && options.googleSafetySettings.length > 0
      ? { safetySettings: options.googleSafetySettings }
      : {}),
  };

  Object.assign(body, readProviderOptions(options.providerOptions, "google", providerName));
  // Provider options replace `generationConfig` wholesale, so re-pin the
  // runtime-owned structured-output keys the caller asked for.
  const structuredOutput = buildGoogleStructuredOutputConfig(options.responseFormat);
  if (Object.keys(structuredOutput).length > 0) {
    body.generationConfig = { ...body.generationConfig, ...structuredOutput };
  }
  return body;
}

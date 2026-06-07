import { historicalToolSummaries } from "../../integrations/_tool_summaries.ts";
import type { IntegrationEndpointHistoricalSummary } from "../../integrations/schema.ts";

type SummaryField = IntegrationEndpointHistoricalSummary["itemFields"][number];
type ToolStatus = "success" | "empty" | "error";

export type CurrentRunToolStateCall = {
  toolCallIds: string[];
  input: unknown;
  status: ToolStatus;
  summary: unknown;
  updatedAt: string;
};

export type CurrentRunToolState = Record<
  string,
  { calls: Record<string, CurrentRunToolStateCall> }
>;

export type RecordCurrentRunToolResultInput = {
  toolCallId: string;
  toolName: string;
  input: unknown;
  result: unknown;
  now?: Date;
};

export type CurrentRunToolStateHydrationMessage = {
  role?: string;
  parts?: readonly unknown[];
};

const MAX_FALLBACK_ITEMS = 5;
const MAX_FALLBACK_STRING_LENGTH = 300;
const MAX_OBJECT_ARRAY_ITEMS = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function normalizeForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForFingerprint);
  if (!isRecord(value)) return value;

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = normalizeForFingerprint(value[key]);
  }
  return normalized;
}

export function createToolInputFingerprint(input: unknown): string {
  return JSON.stringify(normalizeForFingerprint(input ?? {}));
}

function compactContactValue(value: unknown): Record<string, unknown> | string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;

  const compact: Record<string, unknown> = {};
  const emailAddress = value.emailAddress;

  if (isRecord(emailAddress)) {
    if (typeof emailAddress.name === "string") compact.name = emailAddress.name;
    if (typeof emailAddress.address === "string") compact.address = emailAddress.address;
  }

  for (const field of ["login", "name", "address", "email", "id"] as const) {
    if (typeof value[field] === "string" || typeof value[field] === "number") {
      compact[field] = value[field];
    }
  }

  return Object.keys(compact).length > 0 ? compact : null;
}

function compactObjectValue(value: unknown, depth = 2): unknown {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value === "string" ? truncate(value, MAX_FALLBACK_STRING_LENGTH) : value;
  }

  if (Array.isArray(value)) {
    const compacted = value.slice(0, MAX_OBJECT_ARRAY_ITEMS)
      .map((item) => compactObjectValue(item, depth - 1))
      .filter((item) => item !== null);
    return compacted.length > 0 ? compacted : null;
  }

  if (!isRecord(value) || depth < 0) return null;

  const compact: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const compacted = compactObjectValue(entry, depth - 1);
    if (compacted !== null) compact[key] = compacted;
  }
  return Object.keys(compact).length > 0 ? compact : null;
}

function compactField(field: SummaryField, value: unknown): unknown {
  if (field.kind === "contact") return compactContactValue(value);

  if (field.kind === "contact-array") {
    if (!Array.isArray(value)) return null;
    const contacts = value
      .map((item) => compactContactValue(item))
      .filter((item): item is Record<string, unknown> | string => item !== null);
    return contacts.length > 0 ? contacts : null;
  }

  if (field.kind === "string-array") {
    if (!Array.isArray(value)) return null;
    const strings = value.filter((item) => typeof item === "string");
    return strings.length > 0 ? strings : null;
  }

  if (field.kind === "object") {
    return compactObjectValue(value);
  }

  if (typeof value === "string") {
    return field.maxLength ? truncate(value, field.maxLength) : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const strings = value.filter((item) => typeof item === "string");
    return strings.length > 0 ? strings : null;
  }
  return null;
}

function compactItem(
  value: unknown,
  fields: readonly SummaryField[],
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;

  const compact: Record<string, unknown> = {};
  for (const field of fields) {
    const fieldValue = compactField(field, value[field.name]);
    if (fieldValue !== null) compact[field.name] = fieldValue;
  }

  return Object.keys(compact).length > 0 ? compact : null;
}

function getSummaryItems(
  result: unknown,
  contract: IntegrationEndpointHistoricalSummary,
): readonly unknown[] | null {
  if (Array.isArray(result)) return result;
  if (!isRecord(result)) return null;

  for (const key of contract.collectionKeys) {
    const value = result[key];
    if (Array.isArray(value)) return value;
  }

  if (contract.singleItem) return [result];
  return null;
}

function summarizeWithContract(
  result: unknown,
  contract: IntegrationEndpointHistoricalSummary,
): { summary: Record<string, unknown>; status: ToolStatus } | null {
  const sourceItems = getSummaryItems(result, contract);
  if (!sourceItems) return null;

  const items = sourceItems
    .map((item) => compactItem(item, contract.itemFields))
    .filter((item): item is Record<string, unknown> => item !== null);

  const summary: Record<string, unknown> = {
    [`${contract.collectionName}Count`]: sourceItems.length,
    [contract.collectionName]: items,
    omitted: contract.omitted,
  };

  if (isRecord(result) && contract.outputFields) {
    for (const field of contract.outputFields) {
      const fieldValue = compactField(field, result[field.name]);
      if (fieldValue !== null) summary[field.name] = fieldValue;
    }
  }

  return {
    summary,
    status: sourceItems.length === 0 ? "empty" : "success",
  };
}

function summarizeFallbackRecord(value: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") summary[key] = truncate(entry, MAX_FALLBACK_STRING_LENGTH);
    else if (typeof entry === "number" || typeof entry === "boolean") summary[key] = entry;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      summary[`${key}Count`] = entry.length;
      summary[key] = entry.slice(0, MAX_FALLBACK_ITEMS).map((item) =>
        isRecord(item) ? summarizeFallbackRecord(item) : item
      );
      if (entry.length > MAX_FALLBACK_ITEMS) {
        summary.omitted = `Only first ${MAX_FALLBACK_ITEMS} ${key} included`;
      }
      break;
    }
  }

  return Object.keys(summary).length > 0 ? summary : { keys: Object.keys(value).slice(0, 20) };
}

function summarizeFallback(result: unknown): { summary: unknown; status: ToolStatus } {
  if (Array.isArray(result)) {
    return {
      status: result.length === 0 ? "empty" : "success",
      summary: {
        itemsCount: result.length,
        items: result.slice(0, MAX_FALLBACK_ITEMS).map((item) =>
          isRecord(item) ? summarizeFallbackRecord(item) : item
        ),
        ...(result.length > MAX_FALLBACK_ITEMS
          ? { omitted: `Only first ${MAX_FALLBACK_ITEMS} items included` }
          : {}),
      },
    };
  }

  if (isRecord(result)) {
    if ("error" in result) {
      return { status: "error", summary: summarizeFallbackRecord(result) };
    }
    return { status: "success", summary: summarizeFallbackRecord(result) };
  }

  if (typeof result === "string") {
    return {
      status: result.length === 0 ? "empty" : "success",
      summary: truncate(result, MAX_FALLBACK_STRING_LENGTH),
    };
  }

  return { status: result == null ? "empty" : "success", summary: result };
}

export function summarizeToolResultForCurrentRunState(
  toolName: string,
  result: unknown,
): { summary: unknown; status: ToolStatus } {
  if (isRecord(result) && "error" in result) {
    return { status: "error", summary: summarizeFallbackRecord(result) };
  }

  const contract = historicalToolSummaries[toolName];
  if (contract) {
    const contracted = summarizeWithContract(result, contract);
    if (contracted) return contracted;
  }

  return summarizeFallback(result);
}

export function createCurrentRunToolState(): CurrentRunToolState {
  return {};
}

export function recordCurrentRunToolResult(
  state: CurrentRunToolState,
  input: RecordCurrentRunToolResultInput,
): void {
  const fingerprint = createToolInputFingerprint(input.input);
  const toolBucket = state[input.toolName] ?? { calls: {} };
  const existingCall = toolBucket.calls[fingerprint];
  const { summary, status } = summarizeToolResultForCurrentRunState(input.toolName, input.result);

  toolBucket.calls[fingerprint] = {
    toolCallIds: existingCall?.toolCallIds.includes(input.toolCallId)
      ? existingCall.toolCallIds
      : [...(existingCall?.toolCallIds ?? []), input.toolCallId],
    input: input.input ?? {},
    status,
    summary,
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
  state[input.toolName] = toolBucket;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getToolCallInput(part: Record<string, unknown>): unknown {
  if (isRecord(part.args)) return part.args;
  if (isRecord(part.input)) return part.input;
  if (typeof part.args === "string") return parseJsonRecord(part.args) ?? part.args;
  if (typeof part.input === "string") return parseJsonRecord(part.input) ?? part.input;
  if (typeof part.inputText === "string") return parseJsonRecord(part.inputText) ?? part.inputText;
  return {};
}

function getToolResultValue(part: Record<string, unknown>): unknown {
  if ("result" in part) return part.result;
  if ("output" in part) return part.output;
  return undefined;
}

function getToolCallIdentity(
  part: unknown,
): { toolCallId: string; toolName: string } | null {
  if (!isRecord(part)) return null;

  const toolCallId = typeof part.toolCallId === "string"
    ? part.toolCallId
    : typeof part.tool_call_id === "string"
    ? part.tool_call_id
    : typeof part.id === "string"
    ? part.id
    : null;
  const toolName = typeof part.toolName === "string"
    ? part.toolName
    : typeof part.tool_name === "string"
    ? part.tool_name
    : typeof part.name === "string"
    ? part.name
    : null;

  return toolCallId && toolName ? { toolCallId, toolName } : null;
}

function isToolCallPart(part: unknown): part is Record<string, unknown> {
  if (!isRecord(part)) return false;
  const type = typeof part.type === "string" ? part.type : "";
  if (type === "tool-result" || type === "tool_result") return false;
  if (type === "tool-call" || type === "tool_call" || type.startsWith("tool-")) {
    return getToolCallIdentity(part) !== null;
  }
  return false;
}

function isToolResultLikePart(part: unknown): part is Record<string, unknown> {
  if (!isRecord(part)) return false;
  const type = typeof part.type === "string" ? part.type : "";
  if (type !== "tool-result" && type !== "tool_result") return false;
  return getToolCallIdentity(part) !== null && ("result" in part || "output" in part);
}

export function hydrateCurrentRunToolStateFromMessages(
  state: CurrentRunToolState,
  messages: readonly CurrentRunToolStateHydrationMessage[],
  options?: { now?: Date },
): void {
  const toolCallInputs = new Map<string, { toolName: string; input: unknown }>();

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (isToolCallPart(part)) {
        const identity = getToolCallIdentity(part);
        if (!identity) continue;
        toolCallInputs.set(identity.toolCallId, {
          toolName: identity.toolName,
          input: getToolCallInput(part),
        });
        continue;
      }

      if (!isToolResultLikePart(part)) continue;

      const identity = getToolCallIdentity(part);
      if (!identity) continue;
      const call = toolCallInputs.get(identity.toolCallId);
      recordCurrentRunToolResult(state, {
        toolCallId: identity.toolCallId,
        toolName: identity.toolName,
        input: call?.input ?? {},
        result: getToolResultValue(part),
        now: options?.now,
      });
    }
  }
}

export function hasCurrentRunToolState(state: CurrentRunToolState): boolean {
  return Object.keys(state).some((toolName) =>
    Object.keys(state[toolName]?.calls ?? {}).length > 0
  );
}

type PromptToolState = Record<
  string,
  {
    calls: Record<string, { status: ToolStatus; summary: unknown }>;
    semanticCalls?: Record<string, PromptSemanticToolCall>;
  }
>;

type PromptSemanticToolCall = {
  status: ToolStatus;
  callCount: number;
  parameters: Record<string, string>;
  summary: unknown;
};

type PromptRunState = {
  tools: PromptToolState;
  actions?: Record<
    string,
    {
      status: ToolStatus;
      source: string;
      summary: unknown;
    }
  >;
};

function compactStringParameter(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function getSemanticToolCall(input: {
  toolName: string;
  call: CurrentRunToolStateCall;
}): { key: string; parameters: Record<string, string> } | null {
  if (!isRecord(input.call.input)) return null;

  switch (input.toolName) {
    case "load_skill": {
      const skillId = compactStringParameter(input.call.input.skillId) ??
        compactStringParameter(input.call.input.skill_id);
      return skillId ? { key: `skill:${skillId}`, parameters: { skillId } } : null;
    }

    case "invoke_agent": {
      const agentId = compactStringParameter(input.call.input.agent_id) ??
        compactStringParameter(input.call.input.agentId);
      if (!agentId) return null;

      const stepId = compactStringParameter(input.call.input.step_id) ??
        compactStringParameter(input.call.input.stepId);
      const idempotencyKey = compactStringParameter(input.call.input.idempotency_key) ??
        compactStringParameter(input.call.input.idempotencyKey);
      const keySuffix = stepId
        ? `:step:${stepId}`
        : idempotencyKey
        ? `:idempotency:${idempotencyKey}`
        : "";
      const parameters: Record<string, string> = { agent_id: agentId };
      if (stepId) parameters.step_id = stepId;
      if (idempotencyKey) parameters.idempotency_key = idempotencyKey;
      return { key: `agent:${agentId}${keySuffix}`, parameters };
    }

    case "studio_todo_write": {
      const taskId = compactStringParameter(input.call.input.taskId) ??
        compactStringParameter(input.call.input.task_id);
      return taskId ? { key: `todo:${taskId}`, parameters: { taskId } } : null;
    }

    default:
      return null;
  }
}

function mergeSemanticToolCall(
  existing: PromptSemanticToolCall | undefined,
  call: CurrentRunToolStateCall,
  parameters: Record<string, string>,
): PromptSemanticToolCall {
  return {
    status: call.status,
    callCount: (existing?.callCount ?? 0) + call.toolCallIds.length,
    parameters: existing?.parameters ?? parameters,
    summary: call.summary,
  };
}

function usesSemanticPromptKeys(toolName: string): boolean {
  return toolName === "load_skill" ||
    toolName === "invoke_agent" ||
    toolName === "studio_todo_write";
}

function createPromptCallKey(input: {
  toolName: string;
  fingerprint: string;
  index: number;
}): string {
  return usesSemanticPromptKeys(input.toolName) ? `call:${input.index + 1}` : input.fingerprint;
}

export function projectCurrentRunToolStateForPrompt(
  state: CurrentRunToolState,
): PromptRunState {
  const tools: PromptToolState = {};
  const actions: PromptRunState["actions"] = {};

  for (const [toolName, bucket] of Object.entries(state)) {
    const calls: PromptToolState[string]["calls"] = {};
    const semanticCalls: Record<string, PromptSemanticToolCall> = {};
    for (const [index, [fingerprint, call]] of Object.entries(bucket.calls).entries()) {
      calls[createPromptCallKey({ toolName, fingerprint, index })] = {
        status: call.status,
        summary: call.summary,
      };

      const semantic = getSemanticToolCall({ toolName, call });
      if (semantic) {
        semanticCalls[semantic.key] = mergeSemanticToolCall(
          semanticCalls[semantic.key],
          call,
          semantic.parameters,
        );
        actions[`${toolName}:${semantic.key}`] = {
          status: call.status,
          source: `tools.${toolName}.semanticCalls.${semantic.key}`,
          summary: call.summary,
        };
      }
    }

    if (Object.keys(calls).length > 0) {
      tools[toolName] = {
        calls,
        ...(Object.keys(semanticCalls).length > 0 ? { semanticCalls } : {}),
      };
    }
  }

  return {
    tools,
    ...(Object.keys(actions).length > 0 ? { actions } : {}),
  };
}

export function appendCurrentRunToolStateToSystemPrompt(
  systemPrompt: string,
  state: CurrentRunToolState,
): string {
  if (!hasCurrentRunToolState(state)) return systemPrompt;

  const promptState = projectCurrentRunToolStateForPrompt(state);
  return `${systemPrompt}\n\n<run_state current_run=\"true\">\n${
    JSON.stringify(promptState)
  }\n</run_state>`;
}

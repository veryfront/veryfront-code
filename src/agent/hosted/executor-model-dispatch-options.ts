import type { ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import {
  buildModelCallContextRequest,
  resolveModelCallProvider,
} from "#veryfront/runtime/model-call-context-request.ts";
import { DurableRunEventPersistenceError } from "../conversation/private-run-event.ts";
import type { ExecutorModelDispatch } from "./executor-model-bridge.ts";

// First-party builders shallow-merge these request-body fields. Hosted calls
// supply their persisted content and controls through the neutral contract.
const PERSISTED_REQUEST_FIELDS = new Set([
  "prompt",
  "messages",
  "system",
  "contents",
  "systeminstruction",
  "input",
  "instructions",
  "tools",
  "functions",
  "toolconfig",
  "toolchoice",
  "functioncall",
  "mcpservers",
  "maxtokens",
  "maxcompletiontokens",
  "maxoutputtokens",
  "temperature",
  "topp",
  "topk",
  "stop",
  "stopsequences",
  "seed",
  "presencepenalty",
  "frequencypenalty",
  "reasoning",
  "reasoningeffort",
  "cachedcontent",
  "previousresponseid",
  "conversation",
  "container",
  "contextmanagement",
  "stream",
  "streamoptions",
]);
const GOOGLE_CONTROL_FIELDS = [
  "maxOutputTokens",
  "temperature",
  "topP",
  "topK",
  "stopSequences",
  "seed",
  "thinkingConfig",
] as const;
const GOOGLE_SCHEMA_FIELDS = new Set(["responseMimeType", "responseSchema", "responseJsonSchema"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function refuseOverride(): never {
  throw new DurableRunEventPersistenceError(
    "Hosted provider options replace persisted model input",
  );
}

/** Check request configuration paths, never names inside schema/tool/replay data. */
export function assertPersistedModelOptions(call: ExecutorModelDispatch): void {
  const provider = resolveModelCallProvider(call.model);
  for (const [name, bucket] of Object.entries(call.options.providerOptions ?? {})) {
    if (!isRecord(bucket)) continue;
    for (const [field, value] of Object.entries(bucket)) {
      const normalized = field.replace(/[-_]/g, "").toLowerCase();
      if (PERSISTED_REQUEST_FIELDS.has(normalized)) refuseOverride();
      if (normalized === "generationconfig") {
        if (provider !== "google") refuseOverride();
        assertGoogleGenerationConfig(value, call.options);
      }
      if (normalized === "thinking" || normalized === "outputconfig") {
        // The shared durable projector represents the canonical Anthropic
        // bucket. Gateway aliases must not replace those represented values.
        if (provider !== "anthropic" || name !== "anthropic") refuseOverride();
        if (normalized === "outputconfig" && isRecord(value) && value.effort !== undefined) {
          const projected = buildModelCallContextRequest(call.model, call.options);
          if (value.effort !== projected?.reasoning?.effort) refuseOverride();
        }
      }
    }
  }
}

function expectedGoogleThinking(reasoning: ModelRuntimeCallOptions["reasoning"]): unknown {
  if (reasoning?.enabled !== true) return undefined;
  // Match the first-party Google builder's neutral reasoning mapping. The
  // offline provider-contract test checks this alongside the actual builder.
  const thinkingBudget = reasoning.budgetTokens ??
    (reasoning.effort === "low"
      ? 512
      : reasoning.effort === "high"
      ? 8192
      : reasoning.effort === "max"
      ? -1
      : 2048);
  return { includeThoughts: true, thinkingBudget };
}

function equalControl(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length &&
      expected.every((value, index) => actual[index] === value);
  }
  if (isRecord(expected)) {
    return isRecord(actual) && Object.keys(actual).length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, value]) => actual[key] === value);
  }
  return actual === expected;
}

function assertGoogleGenerationConfig(
  value: unknown,
  options: ExecutorModelDispatch["options"],
): void {
  if (!isRecord(value)) refuseOverride();
  // Google replaces the entire object. Missing controls erase neutral input
  // just as conflicting values override it. Permit an exact control match
  // while leaving native response schemas and their user-defined names intact.
  const expected: Record<typeof GOOGLE_CONTROL_FIELDS[number], unknown> = {
    maxOutputTokens: options.maxOutputTokens,
    temperature: options.temperature,
    topP: options.topP,
    topK: options.topK,
    stopSequences: options.stopSequences?.length ? options.stopSequences : undefined,
    seed: options.seed,
    thinkingConfig: expectedGoogleThinking(options.reasoning),
  };
  for (const field of GOOGLE_CONTROL_FIELDS) {
    if (!equalControl(value[field], expected[field])) refuseOverride();
  }
  for (const field of Object.keys(value)) {
    if (!Object.hasOwn(expected, field) && !GOOGLE_SCHEMA_FIELDS.has(field)) refuseOverride();
  }
}

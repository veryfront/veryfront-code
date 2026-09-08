import type { JsonValue } from "#veryfront/schemas/index.ts";
import type { ModelRuntimeToolDefinition } from "#veryfront/provider/types.ts";
import { createExecutorModelFailure } from "./executor-model-errors.ts";
import {
  buildModelCallContextRequest,
  resolveModelCallProvider,
} from "#veryfront/runtime/model-call-context-request.ts";
import type { ExecutorModelDispatch } from "./executor-model-bridge.ts";
import {
  executorModelIds,
  executorModelJson,
  getExecutorModelCallSchema,
  getExecutorModelOptionsSchema,
  parseExecutorModelData,
} from "./executor-model-schema.ts";

const numberIsSafeInteger = Number.isSafeInteger;

type ProviderTool = Extract<ModelRuntimeToolDefinition, { type: "provider" }>;

/** Broker-owned policy. No default quota or API billing authority is implied. */
export interface ExecutorModelGrant {
  /** Every admitted attempt counts, including failed audit, provider errors, and cancellation. */
  maxCalls: number;
  /** Held until original provider/handler cleanup settles, including cancellation. */
  maxConcurrentCalls: number;
  models: ReadonlyMap<string, {
    /** Total provider request output allowance, including additive reasoning tokens. */
    maxOutputTokens: number;
    providerTools: readonly ProviderTool[];
  }>;
}

function positiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Executor model grant requires positive safe integer limits");
  }
  return value;
}

function equalJson(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length &&
      left.every((item, index) => equalJson(item, right[index]!));
  }
  if (Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && equalJson(left[key]!, right[key]!));
}

const COMPLETION_MULTIPLIERS = new Set([
  "n",
  "bestof",
  "candidatecount",
  "numgenerations",
  "numreturnsequences",
]);

function assertSingleCompletion(options: ExecutorModelDispatch["options"]): void {
  const inspect = (value: unknown, generationConfig = false): void => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return;
    for (const [field, control] of Object.entries(value)) {
      const name = field.replace(/[-_]/g, "").toLowerCase();
      if (COMPLETION_MULTIPLIERS.has(name) && control !== 1) {
        throw createExecutorModelFailure("RESOURCE_LIMIT_EXCEEDED");
      }
      if (!generationConfig && name === "generationconfig") inspect(control, true);
    }
  };
  // Provider builders merge these buckets into request controls. Schema and
  // tool payloads are data, so their user-defined property names are untouched.
  for (const bucket of Object.values(options.providerOptions ?? {})) inspect(bucket);
}

/** Internal output allowance reserved by the effective provider thinking configuration. */
export function getExecutorModelAdditiveReasoningTokens(
  request: Pick<ExecutorModelDispatch, "model"> & {
    options: Pick<ExecutorModelDispatch["options"], "reasoning" | "providerOptions">;
  },
): number {
  if (resolveModelCallProvider(request.model) !== "anthropic") return 0;
  const reasoning = buildModelCallContextRequest(request.model, request.options)?.reasoning;
  if (request.options.reasoning?.enabled === true) {
    const budget = reasoning?.budgetTokens ??
      (reasoning?.effort === "low"
        ? 1024
        : reasoning?.effort === "high"
        ? 16384
        : reasoning?.effort === "max"
        ? 32768
        : 4096);
    // Match the first-party Anthropic builder; its offline contract matrix guards drift.
    if (!numberIsSafeInteger(budget) || budget < 1024) {
      throw createExecutorModelFailure("RESOURCE_LIMIT_EXCEEDED");
    }
    return budget;
  }
  // Canonical native thinking has precedence when neutral reasoning does not enable it.
  // Adaptive thinking stays within max_tokens and adds no separate budget.
  const anthropic = request.options.providerOptions?.anthropic;
  const thinking = anthropic && typeof anthropic === "object" && !Array.isArray(anthropic)
    ? (anthropic as Record<string, unknown>).thinking
    : undefined;
  if (
    thinking && typeof thinking === "object" && !Array.isArray(thinking) &&
    (thinking as Record<string, unknown>).type === "enabled"
  ) {
    const budget = reasoning?.budgetTokens;
    if (budget === undefined || !numberIsSafeInteger(budget) || budget < 1024) {
      throw createExecutorModelFailure("RESOURCE_LIMIT_EXCEEDED");
    }
    return budget;
  }
  return 0;
}

/** Construct once per invocation. Models share counters; child and API credit budgets are separate. */
export function createExecutorModelAdmission(
  grant: ExecutorModelGrant,
  allowedModelIds: ReadonlySet<string>,
) {
  if (!grant || !(grant.models instanceof Map)) {
    throw new TypeError("Executor model grant is required");
  }
  const maxCalls = positiveLimit(grant.maxCalls);
  const maxConcurrentCalls = positiveLimit(grant.maxConcurrentCalls);
  const allowed = executorModelIds(allowedModelIds);
  if (grant.models.size !== allowed.size) {
    throw new TypeError("Executor model grant must match allowed models");
  }
  const policies = new Map<string, { maxOutputTokens: number; providerTools: JsonValue[] }>();
  for (const id of allowed) {
    const policy = grant.models.get(id);
    if (!policy || !Array.isArray(policy.providerTools)) {
      throw new TypeError("Executor model grant must match allowed models");
    }
    const maxOutputTokens = positiveLimit(policy.maxOutputTokens);
    const options = parseExecutorModelData(
      getExecutorModelOptionsSchema(),
      executorModelJson({ prompt: [], tools: policy.providerTools }),
    );
    if (options.tools?.some((tool) => tool.type !== "provider")) {
      throw new TypeError("Executor model grant requires provider tool descriptors");
    }
    policies.set(id, {
      maxOutputTokens,
      providerTools: (options.tools ?? []).map((tool) => executorModelJson(tool)),
    });
  }
  let calls = 0;
  let active = 0;
  const admit = (input: JsonValue): { input: JsonValue; release(): void } => {
    const call = parseExecutorModelData(getExecutorModelCallSchema(), executorModelJson(input));
    const policy = policies.get(call.modelId);
    if (!policy) throw new TypeError("Executor model is not granted");
    const maxOutputTokens = call.options.maxOutputTokens ?? policy.maxOutputTokens;
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens > policy.maxOutputTokens) {
      throw createExecutorModelFailure("RESOURCE_LIMIT_EXCEEDED");
    }
    const usedTools = new Set<number>();
    for (const tool of call.options.tools ?? []) {
      if (tool.type !== "provider") continue;
      const snapshot = executorModelJson(tool);
      const index = policy.providerTools.findIndex((allowed) => equalJson(snapshot, allowed));
      if (index < 0 || usedTools.has(index)) {
        throw new TypeError("Executor provider tool is not granted");
      }
      usedTools.add(index);
    }
    const normalized = executorModelJson(call);
    if (calls >= maxCalls || active >= maxConcurrentCalls) {
      throw createExecutorModelFailure("RESOURCE_LIMIT_EXCEEDED");
    }
    // No await or external callback separates the check from reservation.
    calls++;
    active++;
    let released = false;
    return {
      input: normalized,
      release() {
        if (released) return;
        released = true;
        active--;
      },
    };
  };
  return {
    admit,
    normalize(request: ExecutorModelDispatch): ExecutorModelDispatch["options"] {
      const policy = policies.get(request.model.id);
      if (!policy) throw new TypeError("Executor model is not granted");
      assertSingleCompletion(request.options);
      const budget = getExecutorModelAdditiveReasoningTokens(request);
      const available = policy.maxOutputTokens - budget;
      const maxOutputTokens = request.options.maxOutputTokens ?? available;
      if (
        !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0 ||
        maxOutputTokens > available
      ) {
        throw createExecutorModelFailure("RESOURCE_LIMIT_EXCEEDED");
      }
      return {
        ...request.options,
        maxOutputTokens,
        // Make the builder's effective neutral default explicit in the audited request.
        ...(budget > 0 && request.options.reasoning?.enabled === true
          ? { reasoning: { ...request.options.reasoning, budgetTokens: budget } }
          : {}),
      };
    },
  };
}

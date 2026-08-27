#!/usr/bin/env -S deno run -A

import { dirname } from "#std/path.ts";
import { agent, type AgentResponse } from "#veryfront/agent";
import type { ModelRuntime } from "#veryfront/provider";
import { dynamicTool } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { AnthropicProvider } from "../extensions/ext-llm-anthropic/src/index.ts";
import { OpenAIProvider } from "../extensions/ext-llm-openai/src/index.ts";

export type ToolSearchLiveProof = {
  model: string;
  loadingPath: "framework-fallback";
  toolCalls: ["tool_search", "read_release_marker"];
  targetExecutionCount: 1;
  searchResultContainsSchema: false;
  completed: true;
};

export type HiMeasurement = {
  schemaVersion: 1;
  kind: "deferred-tool-discovery-hi";
  prompt: "hi";
  agentId: "veryfront-agent";
  agentConfiguration: "prd-all-scoped-example";
  catalogProfile: "deterministic-64-tool-verifier-fixture";
  provider: "anthropic" | "openai";
  model: string;
  measuredAt: string;
  provenance: "direct-provider-framework-fallback";
  usageSource: "paired-response.usage.promptTokens";
  baselineInputTokens: number;
  effectiveInputTokens: number;
  reductionPercent: number;
  baselineModelSteps: 1;
  baselineExposedToolCount: 64;
  modelSteps: 1;
  toolCalls: 0;
  authorizedToolCount: number;
  initiallyExposedTools: string[];
  thresholds: {
    maximumEffectiveInputTokens: 10_000;
    minimumReductionPercent: 60;
  };
  passed: true;
};

export type ToolSearchLiveArgs = {
  model: string;
  output: string;
  proof: "tool-search" | "hi";
};
export type DirectProviderEnvironment = {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  VERYFRONT_API_TOKEN?: string;
};

export type ExtractToolSearchLiveProofInput = {
  model: string;
  effectiveProvider: string;
  response: AgentResponse;
  requestCatalogs: string[][];
  targetExecutionCount: number;
};

type RunToolSearchLiveProofInput = {
  model: string;
  modelRuntime?: ModelRuntime;
  /** Test-only selector used to prove explicit maps remain eager. */
  selector?: "all-scoped" | "explicit";
};

type RunHiMeasurementInput = {
  model: string;
  modelRuntime?: ModelRuntime;
  measuredAt?: string;
};

export type ExtractHiMeasurementInput = {
  model: string;
  effectiveProvider: string;
  response: AgentResponse;
  baselineResponse: AgentResponse;
  requestCatalogs: string[][];
  baselineRequestCatalogs: string[][];
  modelSteps: number;
  baselineModelSteps: number;
  authorizedToolCount: number;
  measuredAt: string;
};

const TARGET_TOOL = "read_release_marker";
const TARGET_DESCRIPTION = "Read the release marker for this verification run.";
const EXPECTED_TOOL_CALLS = ["tool_search", TARGET_TOOL] as const;
const BOOTSTRAP_TOOL_NAMES = new Set([
  "form_input",
  "load_skill",
  "tool_search",
]);
const SEARCH_RESULT_KEYS = [
  "loadedCount",
  "matches",
  "miss",
  "nextStep",
  "resultCount",
] as const;
const SEARCH_MATCH_KEYS = ["description", "name", "status"] as const;
const PROOF_KEYS = [
  "completed",
  "loadingPath",
  "model",
  "searchResultContainsSchema",
  "targetExecutionCount",
  "toolCalls",
] as const;
const HI_MEASUREMENT_KEYS = [
  "agentConfiguration",
  "agentId",
  "authorizedToolCount",
  "baselineExposedToolCount",
  "baselineInputTokens",
  "baselineModelSteps",
  "catalogProfile",
  "effectiveInputTokens",
  "initiallyExposedTools",
  "kind",
  "measuredAt",
  "model",
  "modelSteps",
  "passed",
  "prompt",
  "provenance",
  "provider",
  "reductionPercent",
  "schemaVersion",
  "thresholds",
  "toolCalls",
  "usageSource",
] as const;
const MAXIMUM_EFFECTIVE_INPUT_TOKENS = 10_000;
const MINIMUM_REDUCTION_PERCENT = 60;
const HI_MEASUREMENT_CATALOG_SIZE = 64;
const CREDENTIAL_PATTERN =
  /(?:api[_-]?key|authorization|bearer\s+|sk-[A-Za-z0-9_-]{16,})/i;

function usageError(message: string): Error {
  return new Error(
    `${message}. Use a direct Anthropic or OpenAI model with --model <provider/model> --output <path> [--proof tool-search|hi]`,
  );
}

function parseDirectModel(model: string): {
  model: string;
  provider: "anthropic" | "openai";
  modelId: string;
} {
  const normalized = model.trim();
  const slashIndex = normalized.indexOf("/");
  const provider = normalized.slice(0, slashIndex).toLowerCase();
  const modelId = slashIndex < 0 ? "" : normalized.slice(slashIndex + 1).trim();
  if (
    (provider !== "anthropic" && provider !== "openai") ||
    !modelId
  ) {
    throw usageError(`Invalid model ${JSON.stringify(normalized || model)}`);
  }
  return { model: `${provider}/${modelId}`, provider, modelId };
}

export function parseToolSearchLiveArgs(
  args: readonly string[],
): ToolSearchLiveArgs {
  if (args.length !== 4 && args.length !== 6) {
    throw usageError("Expected --model and --output with optional --proof");
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag !== "--model" && flag !== "--output" && flag !== "--proof") {
      throw usageError(`Unknown argument ${JSON.stringify(flag)}`);
    }
    if (!value || value.startsWith("--") || values.has(flag)) {
      throw usageError(`Invalid value for ${flag}`);
    }
    values.set(flag, value);
  }
  const rawModel = values.get("--model");
  const output = values.get("--output")?.trim();
  if (!rawModel || !output) {
    throw usageError("Both --model and --output are required");
  }
  const proof = values.get("--proof") ?? "tool-search";
  if (proof !== "tool-search" && proof !== "hi") {
    throw usageError(`Invalid proof ${JSON.stringify(proof)}`);
  }
  return { model: parseDirectModel(rawModel).model, output, proof };
}

function directEnvironment(): DirectProviderEnvironment {
  return {
    ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY"),
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
  };
}

export function createDirectModelRuntime(
  model: string,
  environment: DirectProviderEnvironment = directEnvironment(),
): { model: string; provider: "anthropic" | "openai"; runtime: ModelRuntime } {
  const parsed = parseDirectModel(model);
  const variable = parsed.provider === "anthropic"
    ? "ANTHROPIC_API_KEY"
    : "OPENAI_API_KEY";
  const credential = environment[variable]?.trim();
  if (!credential) {
    throw new Error(`${variable} is required for direct provider verification`);
  }

  const runtime = parsed.provider === "anthropic"
    ? new AnthropicProvider().createModel(parsed.modelId, {
      credential,
      name: "anthropic",
    })
    : new OpenAIProvider().createModel(parsed.modelId, {
      credential,
      name: "openai",
      providerName: "openai",
    });
  if (runtime.provider !== parsed.provider) {
    throw new Error(
      `Unexpected effective provider ${String(runtime.provider)}`,
    );
  }
  return { ...parsed, runtime };
}

/** Explicit form of the comparator-less sort: UTF-16 code-unit order. */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function requestToolCatalog(options: unknown): string[] {
  const tools = (options as { tools?: unknown }).tools;
  if (Array.isArray(tools)) {
    return tools.map((entry) =>
      String((entry as { name?: unknown }).name ?? "")
    ).sort(compareCodeUnits);
  }
  return Object.keys((tools as Record<string, unknown> | undefined) ?? {})
    .sort(compareCodeUnits);
}

function observeGenerateCatalogs(
  runtime: ModelRuntime,
  requestCatalogs: string[][],
): ModelRuntime {
  return {
    ...runtime,
    doGenerate(options) {
      requestCatalogs.push(requestToolCatalog(options));
      return runtime.doGenerate(options);
    },
  };
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort(compareCodeUnits);
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

function validateSearchResult(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "tool_search must return the exact schema-free ToolSearchResult object",
    );
  }
  const result = value as Record<string, unknown>;
  const matches = result.matches;
  if (
    !hasExactKeys(result, SEARCH_RESULT_KEYS) ||
    !Array.isArray(matches) ||
    matches.length !== 1 ||
    result.resultCount !== 1 ||
    result.loadedCount !== 1 ||
    result.miss !== false ||
    typeof result.nextStep !== "string"
  ) {
    throw new Error(
      "tool_search must return the exact schema-free ToolSearchResult shape",
    );
  }
  const match = matches[0];
  if (
    !match || typeof match !== "object" || Array.isArray(match) ||
    !hasExactKeys(match as Record<string, unknown>, SEARCH_MATCH_KEYS) ||
    (match as Record<string, unknown>).name !== TARGET_TOOL ||
    (match as Record<string, unknown>).description !== TARGET_DESCRIPTION ||
    (match as Record<string, unknown>).status !== "loaded"
  ) {
    throw new Error(
      "tool_search must return the expected schema-free ToolSearchResult match",
    );
  }
}

export function extractToolSearchLiveProof(
  input: ExtractToolSearchLiveProofInput,
): ToolSearchLiveProof {
  const parsed = parseDirectModel(input.model);
  if (input.effectiveProvider !== parsed.provider) {
    throw new Error(`Unexpected effective provider ${input.effectiveProvider}`);
  }
  const firstCatalog = input.requestCatalogs[0] ?? [];
  if (
    !firstCatalog.includes("tool_search") ||
    firstCatalog.includes(TARGET_TOOL) ||
    firstCatalog.some((name) => !BOOTSTRAP_TOOL_NAMES.has(name))
  ) {
    throw new Error(
      "The first model request did not prove deferred framework fallback",
    );
  }
  const secondCatalog = input.requestCatalogs[1] ?? [];
  if (!secondCatalog.includes(TARGET_TOOL)) {
    throw new Error(
      "The second model request did not expose the searched target tool",
    );
  }

  const names = input.response.toolCalls.map(({ name }) => name);
  if (
    names.length !== EXPECTED_TOOL_CALLS.length ||
    names.some((name, index) => name !== EXPECTED_TOOL_CALLS[index])
  ) {
    throw new Error(
      `Expected exact fallback tool sequence ${
        EXPECTED_TOOL_CALLS.join(" -> ")
      }`,
    );
  }
  validateSearchResult(input.response.toolCalls[0]?.result);
  if (input.response.toolCalls.some(({ status }) => status !== "completed")) {
    throw new Error("Every fallback tool call must complete successfully");
  }
  if (input.targetExecutionCount !== 1) {
    throw new Error(
      `Expected one ${TARGET_TOOL} execution, received ${input.targetExecutionCount}`,
    );
  }
  if (input.response.status !== "completed") {
    throw new Error(
      `Expected a completed agent response, received ${input.response.status}`,
    );
  }

  return {
    model: parsed.model,
    loadingPath: "framework-fallback",
    toolCalls: ["tool_search", TARGET_TOOL],
    targetExecutionCount: 1,
    searchResultContainsSchema: false,
    completed: true,
  };
}

export async function runToolSearchLiveProof(
  input: RunToolSearchLiveProofInput,
): Promise<ToolSearchLiveProof> {
  const parsed = parseDirectModel(input.model);
  const resolved = input.modelRuntime
    ? {
      model: parsed.model,
      provider: parsed.provider,
      runtime: input.modelRuntime,
    }
    : createDirectModelRuntime(parsed.model);
  if (resolved.runtime.provider !== resolved.provider) {
    throw new Error(
      `Unexpected effective provider ${String(resolved.runtime.provider)}`,
    );
  }

  let targetExecutionCount = 0;
  const requestCatalogs: string[][] = [];
  const observedRuntime = observeGenerateCatalogs(
    resolved.runtime,
    requestCatalogs,
  );
  const targetTool = dynamicTool({
    id: TARGET_TOOL,
    description: TARGET_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: () => {
      targetExecutionCount += 1;
      return { marker: "framework-fallback-verified" };
    },
  });
  if (input.selector !== "explicit") {
    toolRegistry.register(TARGET_TOOL, targetTool);
  }
  try {
    const verifier = agent({
      id: "tool-search-live-verifier",
      model: resolved.model,
      system: [
        "Verify framework deferred tool loading.",
        "First call tool_search with the query release marker.",
        `On the next step call ${TARGET_TOOL} exactly once.`,
        "After the tool result, reply with a short confirmation and do not call more tools.",
      ].join(" "),
      skills: false,
      tools: input.selector === "explicit" ? { [TARGET_TOOL]: targetTool } : true,
      maxSteps: 4,
      resolveModelTransport: () => ({ model: observedRuntime }),
    });

    const response = await verifier.generate({
      input:
        `Use tool_search before ${TARGET_TOOL}, execute the marker tool once, then finish.`,
    });
    return extractToolSearchLiveProof({
      model: resolved.model,
      effectiveProvider: String(observedRuntime.provider),
      response,
      requestCatalogs,
      targetExecutionCount,
    });
  } finally {
    toolRegistry.delete(TARGET_TOOL);
  }
}

function calculateReductionPercent(
  baselineInputTokens: number,
  effectiveInputTokens: number,
): number {
  return Number(
    (((baselineInputTokens - effectiveInputTokens) / baselineInputTokens) * 100)
      .toFixed(3),
  );
}

function expectedHiMeasurementCatalog(): string[] {
  return [
    TARGET_TOOL,
    ...Array.from(
      { length: HI_MEASUREMENT_CATALOG_SIZE - 1 },
      (_, index) =>
        `hi_measurement_catalog_${String(index + 1).padStart(2, "0")}`,
    ),
  ].sort(compareCodeUnits);
}

export function extractHiMeasurement(input: ExtractHiMeasurementInput): HiMeasurement {
  const parsed = parseDirectModel(input.model);
  if (input.effectiveProvider !== parsed.provider) {
    throw new Error(`Unexpected effective provider ${input.effectiveProvider}`);
  }
  if (input.modelSteps !== 1 || input.requestCatalogs.length !== 1) {
    throw new Error("The exact hi measurement must complete in one model step");
  }
  if (
    input.baselineModelSteps !== 1 ||
    input.baselineRequestCatalogs.length !== 1
  ) {
    throw new Error(
      "The eager hi baseline must complete in one model step",
    );
  }
  if (input.response.toolCalls.length !== 0) {
    throw new Error("The exact hi measurement must make no tool calls");
  }
  if (input.baselineResponse.toolCalls.length !== 0) {
    throw new Error("The eager hi baseline must make no tool calls");
  }
  if (input.response.status !== "completed") {
    throw new Error(`Expected a completed agent response, received ${input.response.status}`);
  }
  if (input.baselineResponse.status !== "completed") {
    throw new Error(
      `Expected a completed eager baseline response, received ${input.baselineResponse.status}`,
    );
  }
  const initialCatalog = input.requestCatalogs[0] ?? [];
  if (initialCatalog.length !== 1 || initialCatalog[0] !== "tool_search") {
    throw new Error("The exact hi measurement must expose only tool_search initially");
  }
  const baselineCatalog = input.baselineRequestCatalogs[0] ?? [];
  const expectedBaselineCatalog = expectedHiMeasurementCatalog();
  if (
    baselineCatalog.length !== expectedBaselineCatalog.length ||
    baselineCatalog.some((name, index) => name !== expectedBaselineCatalog[index])
  ) {
    throw new Error(
      "The eager hi baseline must expose the exact 64-tool fixture",
    );
  }
  const effectiveInputTokens = input.response.usage?.promptTokens;
  if (effectiveInputTokens === undefined) {
    throw new Error("The exact hi measurement requires provider input-token usage");
  }
  const baselineInputTokens = input.baselineResponse.usage?.promptTokens;
  if (baselineInputTokens === undefined || baselineInputTokens < 1) {
    throw new Error("The eager hi baseline requires provider input-token usage");
  }
  const reductionPercent = calculateReductionPercent(
    baselineInputTokens,
    effectiveInputTokens,
  );
  if (
    effectiveInputTokens > MAXIMUM_EFFECTIVE_INPUT_TOKENS ||
    reductionPercent < MINIMUM_REDUCTION_PERCENT
  ) {
    throw new Error(
      `The exact hi measurement missed token acceptance thresholds: ${effectiveInputTokens} tokens, ${reductionPercent}% reduction`,
    );
  }
  if (input.authorizedToolCount !== HI_MEASUREMENT_CATALOG_SIZE) {
    throw new Error("The exact hi measurement requires exactly 64 authorized fixture tools");
  }
  if (
    Number.isNaN(Date.parse(input.measuredAt)) ||
    new Date(input.measuredAt).toISOString() !== input.measuredAt
  ) {
    throw new Error("The exact hi measurement requires an ISO timestamp");
  }

  return {
    schemaVersion: 1,
    kind: "deferred-tool-discovery-hi",
    prompt: "hi",
    agentId: "veryfront-agent",
    agentConfiguration: "prd-all-scoped-example",
    catalogProfile: "deterministic-64-tool-verifier-fixture",
    provider: parsed.provider,
    model: parsed.model,
    measuredAt: input.measuredAt,
    provenance: "direct-provider-framework-fallback",
    usageSource: "paired-response.usage.promptTokens",
    baselineInputTokens,
    effectiveInputTokens,
    reductionPercent,
    baselineModelSteps: 1,
    baselineExposedToolCount: HI_MEASUREMENT_CATALOG_SIZE,
    modelSteps: 1,
    toolCalls: 0,
    authorizedToolCount: input.authorizedToolCount,
    initiallyExposedTools: [...initialCatalog].sort(compareCodeUnits),
    thresholds: {
      maximumEffectiveInputTokens: MAXIMUM_EFFECTIVE_INPUT_TOKENS,
      minimumReductionPercent: MINIMUM_REDUCTION_PERCENT,
    },
    passed: true,
  };
}

export async function runHiMeasurement(
  input: RunHiMeasurementInput,
): Promise<HiMeasurement> {
  const parsed = parseDirectModel(input.model);
  const resolved = input.modelRuntime
    ? { model: parsed.model, provider: parsed.provider, runtime: input.modelRuntime }
    : createDirectModelRuntime(parsed.model);
  if (resolved.runtime.provider !== resolved.provider) {
    throw new Error(`Unexpected effective provider ${String(resolved.runtime.provider)}`);
  }

  const requestCatalogs: string[][] = [];
  const baselineRequestCatalogs: string[][] = [];
  const measurementTools = Array.from(
    { length: HI_MEASUREMENT_CATALOG_SIZE },
    (_, index) => {
      const id = index === 0
        ? TARGET_TOOL
        : `hi_measurement_catalog_${String(index).padStart(2, "0")}`;
      return dynamicTool({
        id,
        description: index === 0
          ? TARGET_DESCRIPTION
          : `Representative scoped project tool ${index} for greeting token verification.`,
        inputSchema: {
          type: "object",
          properties: {
            value: {
              type: "string",
              description: `Representative parameter ${index}.`,
            },
          },
          additionalProperties: false,
        },
        execute: () => ({ marker: "not-called-during-hi-measurement" }),
      });
    },
  );
  for (const tool of measurementTools) {
    toolRegistry.register(tool.id, tool);
  }
  try {
    const explicitTools = Object.fromEntries(
      measurementTools.map((tool) => [tool.id, tool]),
    );
    const baselineRuntime = observeGenerateCatalogs(
      resolved.runtime,
      baselineRequestCatalogs,
    );
    const baselineVerifier = agent({
      id: "veryfront-agent-hi-eager-baseline",
      model: resolved.model,
      system: "Help build and operate this Veryfront project.",
      skills: false,
      tools: explicitTools,
      maxSteps: 1,
      resolveModelTransport: () => ({ model: baselineRuntime }),
    });
    const baselineResponse = await baselineVerifier.generate({ input: "hi" });

    const observedRuntime = observeGenerateCatalogs(
      resolved.runtime,
      requestCatalogs,
    );
    const deferredVerifier = agent({
      id: "veryfront-agent",
      model: resolved.model,
      system: "Help build and operate this Veryfront project.",
      skills: false,
      tools: true,
      maxSteps: 1,
      resolveModelTransport: () => ({ model: observedRuntime }),
    });
    const response = await deferredVerifier.generate({ input: "hi" });
    return extractHiMeasurement({
      model: resolved.model,
      effectiveProvider: String(observedRuntime.provider),
      response,
      baselineResponse,
      requestCatalogs,
      baselineRequestCatalogs,
      modelSteps: requestCatalogs.length,
      baselineModelSteps: baselineRequestCatalogs.length,
      authorizedToolCount: measurementTools.length,
      measuredAt: input.measuredAt ?? new Date().toISOString(),
    });
  } finally {
    for (const tool of measurementTools) {
      toolRegistry.delete(tool.id);
    }
  }
}

function validateSanitizedReport(serialized: string): void {
  if (serialized.toLowerCase().includes("native")) {
    throw new Error(
      "Proof report must not contain native provider search evidence",
    );
  }
  if (CREDENTIAL_PATTERN.test(serialized)) {
    throw new Error("Proof report contains credential-like data");
  }
  const parsed = JSON.parse(serialized) as ToolSearchLiveProof;
  if (
    !hasExactKeys(parsed as unknown as Record<string, unknown>, PROOF_KEYS) ||
    parseDirectModel(parsed.model).model !== parsed.model ||
    parsed.loadingPath !== "framework-fallback" ||
    !Array.isArray(parsed.toolCalls) ||
    parsed.toolCalls.length !== EXPECTED_TOOL_CALLS.length ||
    parsed.toolCalls.some((name, index) =>
      name !== EXPECTED_TOOL_CALLS[index]
    ) ||
    parsed.targetExecutionCount !== 1 ||
    parsed.searchResultContainsSchema !== false ||
    parsed.completed !== true
  ) {
    throw new Error("Proof report must use the exact sanitized shape");
  }
}

export async function writeToolSearchLiveProof(
  output: string,
  proof: ToolSearchLiveProof,
): Promise<void> {
  const serialized = `${JSON.stringify(proof, null, 2)}\n`;
  validateSanitizedReport(serialized);
  await Deno.mkdir(dirname(output), { recursive: true });
  await Deno.writeTextFile(output, serialized);
}

function validateHiMeasurement(serialized: string): void {
  if (CREDENTIAL_PATTERN.test(serialized) || serialized.includes("inputSchema")) {
    throw new Error("Hi measurement contains credential-like or schema data");
  }
  const parsed = JSON.parse(serialized) as HiMeasurement;
  if (
    !hasExactKeys(parsed as unknown as Record<string, unknown>, HI_MEASUREMENT_KEYS) ||
    !hasExactKeys(parsed.thresholds as unknown as Record<string, unknown>, [
      "maximumEffectiveInputTokens",
      "minimumReductionPercent",
    ]) ||
    parsed.schemaVersion !== 1 ||
    parsed.kind !== "deferred-tool-discovery-hi" ||
    parsed.prompt !== "hi" ||
    parsed.agentId !== "veryfront-agent" ||
    parsed.agentConfiguration !== "prd-all-scoped-example" ||
    parsed.catalogProfile !== "deterministic-64-tool-verifier-fixture" ||
    parsed.provenance !== "direct-provider-framework-fallback" ||
    parsed.usageSource !== "paired-response.usage.promptTokens" ||
    parsed.baselineExposedToolCount !== HI_MEASUREMENT_CATALOG_SIZE ||
    parsed.baselineModelSteps !== 1 ||
    parsed.modelSteps !== 1 ||
    parsed.toolCalls !== 0 ||
    parsed.thresholds.maximumEffectiveInputTokens !== MAXIMUM_EFFECTIVE_INPUT_TOKENS ||
    parsed.thresholds.minimumReductionPercent !== MINIMUM_REDUCTION_PERCENT ||
    parsed.passed !== true
  ) {
    throw new Error("Hi measurement must use the exact sanitized shape");
  }
  extractHiMeasurement({
    model: parsed.model,
    effectiveProvider: parsed.provider,
    response: {
      text: "sanitized",
      messages: [],
      toolCalls: [],
      status: "completed",
      usage: {
        promptTokens: parsed.effectiveInputTokens,
        completionTokens: 0,
        totalTokens: parsed.effectiveInputTokens,
      },
    },
    baselineResponse: {
      text: "sanitized",
      messages: [],
      toolCalls: [],
      status: "completed",
      usage: {
        promptTokens: parsed.baselineInputTokens,
        completionTokens: 0,
        totalTokens: parsed.baselineInputTokens,
      },
    },
    requestCatalogs: [parsed.initiallyExposedTools],
    baselineRequestCatalogs: [expectedHiMeasurementCatalog()],
    modelSteps: parsed.modelSteps,
    baselineModelSteps: parsed.baselineModelSteps,
    authorizedToolCount: parsed.authorizedToolCount,
    measuredAt: parsed.measuredAt,
  });
}

export async function writeHiMeasurement(
  output: string,
  measurement: HiMeasurement,
): Promise<void> {
  const serialized = `${JSON.stringify(measurement, null, 2)}\n`;
  validateHiMeasurement(serialized);
  await Deno.mkdir(dirname(output), { recursive: true });
  await Deno.writeTextFile(output, serialized);
}

if (import.meta.main) {
  try {
    const { model, output, proof } = parseToolSearchLiveArgs(Deno.args);
    if (proof === "hi") {
      await writeHiMeasurement(output, await runHiMeasurement({ model }));
    } else {
      await writeToolSearchLiveProof(output, await runToolSearchLiveProof({ model }));
    }
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Tool search verification failed",
    );
    Deno.exit(1);
  }
}

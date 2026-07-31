#!/usr/bin/env -S deno run -A

import { dirname } from "#std/path.ts";
import { agent, type AgentResponse } from "#veryfront/agent";
import type { ModelRuntime } from "#veryfront/provider";
import { dynamicTool } from "#veryfront/tool";

export type ToolSearchLiveProof = {
  model: string;
  loadingPath: "framework-fallback";
  toolCalls: ["tool_search", "read_release_marker"];
  targetExecutionCount: 1;
  searchResultContainsSchema: false;
  completed: true;
};

export type ToolSearchLiveArgs = {
  model: string;
  output: string;
};

type RunToolSearchLiveProofInput = {
  model: string;
  modelRuntime?: ModelRuntime;
};

const EXPECTED_TOOL_CALLS = ["tool_search", "read_release_marker"] as const;
const PROOF_KEYS = [
  "completed",
  "loadingPath",
  "model",
  "searchResultContainsSchema",
  "targetExecutionCount",
  "toolCalls",
] as const;
const SCHEMA_KEYS = new Set([
  "$schema",
  "additionalProperties",
  "inputSchema",
  "parameters",
  "properties",
  "required",
  "schema",
]);
const CREDENTIAL_PATTERN = /(?:api[_-]?key|authorization|bearer\s+|sk-[A-Za-z0-9_-]{16,})/i;

function usageError(message: string): Error {
  return new Error(
    `${message}. Usage: deno run -A scripts/verify-tool-search-live.ts --model <provider/model> --output <path>`,
  );
}

export function parseToolSearchLiveArgs(args: readonly string[]): ToolSearchLiveArgs {
  if (args.length !== 4) {
    throw usageError("Expected exactly --model and --output");
  }

  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag !== "--model" && flag !== "--output") {
      throw usageError(`Unknown argument ${JSON.stringify(flag)}`);
    }
    if (!value || value.startsWith("--")) {
      throw usageError(`Missing value for ${flag}`);
    }
    if (values.has(flag)) {
      throw usageError(`Duplicate argument ${flag}`);
    }
    values.set(flag, value);
  }

  const model = values.get("--model");
  const output = values.get("--output");
  if (!model || !output) {
    throw usageError("Both --model and --output are required");
  }
  if (model.startsWith("veryfront-cloud/")) {
    throw usageError("Veryfront Cloud models are not allowed");
  }

  return { model, output };
}

function containsSchema(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSchema);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) =>
    SCHEMA_KEYS.has(key) || containsSchema(entry)
  );
}

function validateToolCalls(response: AgentResponse, targetExecutionCount: number): void {
  const toolCallNames = response.toolCalls.map(({ name }) => name);
  if (
    toolCallNames.length !== EXPECTED_TOOL_CALLS.length ||
    toolCallNames.some((name, index) => name !== EXPECTED_TOOL_CALLS[index])
  ) {
    throw new Error(
      `Expected exact fallback tool sequence ${EXPECTED_TOOL_CALLS.join(" -> ")}`,
    );
  }
  const searchResult = response.toolCalls[0]?.result;
  if (containsSchema(searchResult)) {
    throw new Error("The tool_search result contains schema data");
  }
  if (response.toolCalls.some(({ status }) => status !== "completed")) {
    throw new Error("Every fallback tool call must complete successfully");
  }
  if (targetExecutionCount !== 1) {
    throw new Error(`Expected one read_release_marker execution, received ${targetExecutionCount}`);
  }
  if (response.status !== "completed") {
    throw new Error(`Expected a completed agent response, received ${response.status}`);
  }
}

export async function runToolSearchLiveProof(
  input: RunToolSearchLiveProofInput,
): Promise<ToolSearchLiveProof> {
  if (input.model.startsWith("veryfront-cloud/")) {
    throw new Error("Veryfront Cloud models are not allowed");
  }

  let targetExecutionCount = 0;
  const modelRuntime = input.modelRuntime;
  const verifier = agent({
    id: "tool-search-live-verifier",
    model: input.model,
    system: [
      "Verify framework deferred tool loading.",
      "First call tool_search with the query release marker.",
      "On the next step call read_release_marker exactly once.",
      "After the tool result, reply with a short confirmation and do not call more tools.",
    ].join(" "),
    skills: false,
    tools: {
      read_release_marker: dynamicTool({
        id: "read_release_marker",
        description: "Read the release marker for this verification run.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        execute: () => {
          targetExecutionCount += 1;
          return { marker: "framework-fallback-verified" };
        },
      }),
    },
    maxSteps: 4,
    ...(modelRuntime ? { resolveModelTransport: () => ({ model: modelRuntime }) } : {}),
  });

  const response = await verifier.generate({
    input:
      "Run the requested verification now. Use tool_search before read_release_marker, execute the marker tool once, then finish.",
  });
  validateToolCalls(response, targetExecutionCount);

  return {
    model: input.model,
    loadingPath: "framework-fallback",
    toolCalls: ["tool_search", "read_release_marker"],
    targetExecutionCount: 1,
    searchResultContainsSchema: false,
    completed: true,
  };
}

function validateSanitizedReport(serialized: string): void {
  if (serialized.toLowerCase().includes("native")) {
    throw new Error("Proof report must not contain native provider search evidence");
  }
  if (CREDENTIAL_PATTERN.test(serialized)) {
    throw new Error("Proof report contains credential-like data");
  }
  const parsed = JSON.parse(serialized) as ToolSearchLiveProof;
  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== PROOF_KEYS.length ||
    keys.some((key, index) => key !== PROOF_KEYS[index])
  ) {
    throw new Error("Proof report must use the exact sanitized shape");
  }
  if (
    typeof parsed.model !== "string" ||
    parsed.loadingPath !== "framework-fallback" ||
    !Array.isArray(parsed.toolCalls) ||
    parsed.toolCalls.length !== EXPECTED_TOOL_CALLS.length ||
    parsed.toolCalls.some((name, index) => name !== EXPECTED_TOOL_CALLS[index]) ||
    parsed.completed !== true
  ) {
    throw new Error("Proof report must use the exact sanitized shape");
  }
  if (parsed.targetExecutionCount !== 1) {
    throw new Error("Proof report must contain exactly one target execution");
  }
  if (parsed.searchResultContainsSchema !== false) {
    throw new Error("Proof report must not contain a search-result schema");
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

if (import.meta.main) {
  try {
    const { model, output } = parseToolSearchLiveArgs(Deno.args);
    const proof = await runToolSearchLiveProof({ model });
    await writeToolSearchLiveProof(output, proof);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Tool search verification failed");
    Deno.exit(1);
  }
}

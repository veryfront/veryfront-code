import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { AgentResponse } from "#veryfront/agent";
import type { ModelRuntime } from "#veryfront/provider";
import {
  createDirectModelRuntime,
  extractHiMeasurement,
  extractToolSearchLiveProof,
  type HiMeasurement,
  parseToolSearchLiveArgs,
  runHiMeasurement,
  runToolSearchLiveProof,
  type ToolSearchLiveProof,
  writeHiMeasurement,
  writeToolSearchLiveProof,
} from "../../scripts/verify-tool-search-live.ts";

const TARGET_DESCRIPTION = "Read the release marker for this verification run.";

function scriptedFallbackModel(provider = "openai"): ModelRuntime {
  let step = 0;
  return {
    provider,
    modelId: "scripted",
    specificationVersion: "v3",
    async doGenerate() {
      step += 1;
      if (step === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "search-1",
            toolName: "tool_search",
            input: JSON.stringify({ query: "release marker" }),
          }],
          finishReason: "tool-calls",
        };
      }
      if (step === 2) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "marker-1",
            toolName: "read_release_marker",
            input: "{}",
          }],
          finishReason: "tool-calls",
        };
      }
      return {
        content: [{ type: "text", text: "Verification complete." }],
        finishReason: "stop",
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
}

function validSearchResult(): Record<string, unknown> {
  return {
    matches: [{
      name: "read_release_marker",
      description: TARGET_DESCRIPTION,
      status: "loaded",
    }],
    resultCount: 1,
    loadedCount: 1,
    miss: false,
    nextStep: "Continue to the next model step.",
  };
}

function completedResponse(
  searchResult: unknown = validSearchResult(),
): AgentResponse {
  return {
    text: "Verification complete.",
    messages: [],
    status: "completed",
    toolCalls: [
      {
        id: "search-1",
        name: "tool_search",
        args: { query: "release marker" },
        status: "completed",
        result: searchResult,
      },
      {
        id: "marker-1",
        name: "read_release_marker",
        args: {},
        status: "completed",
        result: { marker: "framework-fallback-verified" },
      },
    ],
  };
}

function extract(searchResult: unknown = validSearchResult()) {
  return extractToolSearchLiveProof({
    model: "openai/scripted",
    effectiveProvider: "openai",
    response: completedResponse(searchResult),
    requestCatalogs: [
      ["tool_search"],
      ["read_release_marker", "tool_search"],
      ["read_release_marker", "tool_search"],
    ],
    targetExecutionCount: 1,
  });
}

it("canonicalizes direct model input and parses exactly model/output", () => {
  assertEquals(
    parseToolSearchLiveArgs([
      "--model",
      "  OPENAI/gpt-5.4-nano  ",
      "--output",
      ".omx/logs/tool-exposure/direct-openai.json",
    ]),
    {
      model: "openai/gpt-5.4-nano",
      output: ".omx/logs/tool-exposure/direct-openai.json",
      proof: "tool-search",
    },
  );
  assertEquals(
    parseToolSearchLiveArgs([
      "--model",
      "anthropic/claude-opus-4-6",
      "--output",
      "docs/evidence/deferred-tool-discovery-hi.json",
      "--proof",
      "hi",
    ]),
    {
      model: "anthropic/claude-opus-4-6",
      output: "docs/evidence/deferred-tool-discovery-hi.json",
      proof: "hi",
    },
  );
});

it("rejects cloud, automatic, local, non-direct, malformed, and extra arguments", () => {
  const invalidModels = [
    "auto",
    "veryfront-cloud/openai/gpt-5.4-nano",
    "  veryfront-cloud/openai/gpt-5.4-nano  ",
    "local/qwen",
    "google/gemini-2.5-pro",
    "openai/",
  ];
  for (const model of invalidModels) {
    assertThrows(
      () => parseToolSearchLiveArgs(["--model", model, "--output", "proof.json"]),
      Error,
      "direct Anthropic or OpenAI",
    );
  }
  for (
    const args of [
      ["--model", "openai/gpt-5.4-nano", "--output", "proof.json", "--json"],
      ["--model", "openai/gpt-5.4-nano", "--output", "proof.json", "extra"],
      ["--model", "openai/gpt-5.4-nano", "--output"],
    ]
  ) {
    assertThrows(() => parseToolSearchLiveArgs(args));
  }
});

it("requires the matching direct provider key even when cloud credentials exist", () => {
  assertThrows(
    () =>
      createDirectModelRuntime("openai/gpt-5.4-nano", {
        VERYFRONT_API_TOKEN: "cloud-token-is-not-a-direct-key",
      }),
    Error,
    "OPENAI_API_KEY",
  );
});

it("proves deferred catalogs, exact schema-free search output, and one execution", async () => {
  assertEquals(
    await runToolSearchLiveProof({
      model: "openai/scripted",
      modelRuntime: scriptedFallbackModel(),
    }),
    {
      model: "openai/scripted",
      loadingPath: "framework-fallback",
      toolCalls: ["tool_search", "read_release_marker"],
      targetExecutionCount: 1,
      searchResultContainsSchema: false,
      completed: true,
    },
  );
});

it("rejects an explicit tool map because the first request exposes the target", async () => {
  await assertRejects(
    () =>
      runToolSearchLiveProof({
        model: "openai/scripted",
        modelRuntime: scriptedFallbackModel(),
        selector: "explicit",
      }),
    Error,
    "first model request",
  );
});

it("rejects a scripted runtime whose effective provider is not direct", async () => {
  await assertRejects(
    () =>
      runToolSearchLiveProof({
        model: "openai/scripted",
        modelRuntime: scriptedFallbackModel("veryfront-cloud"),
      }),
    Error,
    "effective provider",
  );
});

it("extracts a proof only from exact fallback evidence", () => {
  assertEquals(extract(), {
    model: "openai/scripted",
    loadingPath: "framework-fallback",
    toolCalls: ["tool_search", "read_release_marker"],
    targetExecutionCount: 1,
    searchResultContainsSchema: false,
    completed: true,
  });
});

it("rejects schema-shaped search output from otherwise completed responses", () => {
  const cases = [
    { ...validSearchResult(), properties: {} },
    {
      ...validSearchResult(),
      matches: [{
        name: "read_release_marker",
        description: TARGET_DESCRIPTION,
        status: "loaded",
        type: "object",
      }],
    },
    {
      ...validSearchResult(),
      matches: [{
        name: "read_release_marker",
        description: TARGET_DESCRIPTION,
        status: "loaded",
        input_schema: { type: "object" },
      }],
    },
    { ...validSearchResult(), schema: true },
  ];
  for (const result of cases) {
    assertThrows(() => extract(result), Error, "schema-free ToolSearchResult");
  }
});

it("writes only the exact sanitized proof shape", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const proof = extract();
    const output = `${directory}/proof.json`;
    await writeToolSearchLiveProof(output, proof);
    assertEquals(JSON.parse(await Deno.readTextFile(output)), proof);
    await assertRejects(
      () =>
        writeToolSearchLiveProof(
          output,
          {
            ...proof,
            debug: "not allowed",
          } as ToolSearchLiveProof & { debug: string },
        ),
      Error,
      "exact sanitized shape",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("extracts the exact hi acceptance measurement from provider usage", () => {
  assertEquals(
    extractHiMeasurement({
      model: "anthropic/claude-opus-4-6",
      effectiveProvider: "anthropic",
      response: {
        text: "Hello!",
        messages: [],
        status: "completed",
        toolCalls: [],
        usage: {
          promptTokens: 6_326,
          completionTokens: 2,
          totalTokens: 6_328,
        },
      },
      baselineResponse: {
        text: "Hello!",
        messages: [],
        status: "completed",
        toolCalls: [],
        usage: {
          promptTokens: 25_000,
          completionTokens: 2,
          totalTokens: 25_002,
        },
      },
      requestCatalogs: [["tool_search"]],
      baselineRequestCatalogs: [[
        ...Array.from(
          { length: 63 },
          (_, index) => `hi_measurement_catalog_${String(index + 1).padStart(2, "0")}`,
        ),
        "read_release_marker",
      ].sort()],
      modelSteps: 1,
      baselineModelSteps: 1,
      authorizedToolCount: 64,
      measuredAt: "2026-07-31T12:00:00.000Z",
    }),
    {
      schemaVersion: 1,
      kind: "deferred-tool-discovery-hi",
      prompt: "hi",
      agentId: "veryfront-agent",
      agentConfiguration: "prd-all-scoped-example",
      catalogProfile: "deterministic-64-tool-verifier-fixture",
      provider: "anthropic",
      model: "anthropic/claude-opus-4-6",
      measuredAt: "2026-07-31T12:00:00.000Z",
      provenance: "direct-provider-framework-fallback",
      usageSource: "paired-response.usage.promptTokens",
      baselineInputTokens: 25_000,
      effectiveInputTokens: 6_326,
      reductionPercent: 74.696,
      baselineModelSteps: 1,
      baselineExposedToolCount: 64,
      modelSteps: 1,
      toolCalls: 0,
      authorizedToolCount: 64,
      initiallyExposedTools: ["tool_search"],
      thresholds: {
        maximumEffectiveInputTokens: 10_000,
        minimumReductionPercent: 60,
      },
      passed: true,
    },
  );
});

it("rejects hi measurements that call tools, take extra steps, or miss token targets", () => {
  const response: AgentResponse = {
    text: "Hello!",
    messages: [],
    status: "completed",
    toolCalls: [],
    usage: {
      promptTokens: 6_326,
      completionTokens: 2,
      totalTokens: 6_328,
    },
  };
  const input = {
    model: "openai/gpt-5.4-nano",
    effectiveProvider: "openai",
    response,
    baselineResponse: {
      ...response,
      usage: {
        promptTokens: 25_000,
        completionTokens: 2,
        totalTokens: 25_002,
      },
    },
    requestCatalogs: [["tool_search"]],
    baselineRequestCatalogs: [[
      ...Array.from(
        { length: 63 },
        (_, index) => `hi_measurement_catalog_${String(index + 1).padStart(2, "0")}`,
      ),
      "read_release_marker",
    ].sort()],
    modelSteps: 1,
    baselineModelSteps: 1,
    authorizedToolCount: 64,
    measuredAt: "2026-07-31T12:00:00.000Z",
  };
  assertThrows(
    () => extractHiMeasurement({ ...input, modelSteps: 2 }),
    Error,
    "one model step",
  );
  assertThrows(
    () =>
      extractHiMeasurement({
        ...input,
        response: {
          ...response,
          toolCalls: [{
            id: "search-1",
            name: "tool_search",
            args: { query: "anything" },
            status: "completed",
          }],
        },
      }),
    Error,
    "no tool calls",
  );
  assertThrows(
    () =>
      extractHiMeasurement({
        ...input,
        response: {
          ...response,
          usage: {
            promptTokens: 10_001,
            completionTokens: 2,
            totalTokens: 10_003,
          },
        },
      }),
    Error,
    "token acceptance thresholds",
  );
  assertThrows(
    () => extractHiMeasurement({ ...input, authorizedToolCount: 63 }),
    Error,
    "exactly 64 authorized fixture tools",
  );
  assertThrows(
    () =>
      extractHiMeasurement({
        ...input,
        requestCatalogs: [["leaked_tool", "tool_search"]],
      }),
    Error,
    "only tool_search initially",
  );
});

it("runs and writes a sanitized exact hi measurement", async () => {
  let calls = 0;
  const runtime: ModelRuntime = {
    provider: "openai",
    modelId: "scripted",
    specificationVersion: "v3",
    async doGenerate() {
      calls += 1;
      const inputTokens = calls === 1 ? 2_500 : 900;
      return {
        content: [{ type: "text", text: "Hello!" }],
        finishReason: "stop",
        usage: { inputTokens, outputTokens: 2, totalTokens: inputTokens + 2 },
      };
    },
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
  const proof = await runHiMeasurement({
    model: "openai/scripted",
    modelRuntime: runtime,
    measuredAt: "2026-07-31T12:00:00.000Z",
  });
  assertEquals(calls, 2);
  assertEquals(proof.prompt, "hi");
  assertEquals(proof.modelSteps, 1);
  assertEquals(proof.toolCalls, 0);
  assertEquals(proof.effectiveInputTokens, 900);
  assertEquals(proof.baselineInputTokens, 2_500);
  assertEquals(proof.passed, true);

  const directory = await Deno.makeTempDir();
  try {
    const output = `${directory}/hi.json`;
    await writeHiMeasurement(output, proof);
    assertEquals(JSON.parse(await Deno.readTextFile(output)), proof);
    await assertRejects(
      () =>
        writeHiMeasurement(
          output,
          {
            ...proof,
            secret: "not allowed",
          } as HiMeasurement & { secret: string },
        ),
      Error,
      "exact sanitized shape",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

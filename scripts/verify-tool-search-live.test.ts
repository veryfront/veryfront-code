import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { AgentResponse } from "#veryfront/agent";
import type { ModelRuntime } from "#veryfront/provider";
import {
  createDirectModelRuntime,
  extractToolSearchLiveProof,
  parseToolSearchLiveArgs,
  runToolSearchLiveProof,
  type ToolSearchLiveProof,
  writeToolSearchLiveProof,
} from "./verify-tool-search-live.ts";

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
    attachableMetadataCount: 0,
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
      () =>
        parseToolSearchLiveArgs(["--model", model, "--output", "proof.json"]),
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

it("rejects eager loading because the first request exposes the target", async () => {
  await assertRejects(
    () =>
      runToolSearchLiveProof({
        model: "openai/scripted",
        modelRuntime: scriptedFallbackModel(),
        toolLoading: "eager",
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

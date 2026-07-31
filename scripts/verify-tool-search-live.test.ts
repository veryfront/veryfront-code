import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import {
  parseToolSearchLiveArgs,
  runToolSearchLiveProof,
  type ToolSearchLiveProof,
  writeToolSearchLiveProof,
} from "./verify-tool-search-live.ts";

function scriptedFallbackModel(): ModelRuntime {
  let step = 0;
  return {
    provider: "scripted",
    modelId: "scripted/fallback",
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

it("parses exactly one model and output flag", () => {
  assertEquals(
    parseToolSearchLiveArgs([
      "--model",
      "openai/gpt-5.4-nano",
      "--output",
      ".omx/logs/tool-exposure/direct-openai.json",
    ]),
    {
      model: "openai/gpt-5.4-nano",
      output: ".omx/logs/tool-exposure/direct-openai.json",
    },
  );
});

it("rejects cloud models, unknown flags, positional args, and missing values", () => {
  for (
    const args of [
      ["--model", "veryfront-cloud/openai/gpt-5.4-nano", "--output", "proof.json"],
      ["--model", "openai/gpt-5.4-nano", "--output", "proof.json", "--json"],
      ["--model", "openai/gpt-5.4-nano", "--output", "proof.json", "extra"],
      ["--model", "openai/gpt-5.4-nano", "--output"],
      [
        "--model",
        "openai/gpt-5.4-nano",
        "--model",
        "openai/gpt-5.4-nano",
        "--output",
        "proof.json",
      ],
    ]
  ) {
    let rejected = false;
    try {
      parseToolSearchLiveArgs(args);
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true);
  }
});

it("extracts the exact sanitized framework fallback proof from a scripted model", async () => {
  const proof = await runToolSearchLiveProof({
    model: "scripted/fallback",
    modelRuntime: scriptedFallbackModel(),
  });

  assertEquals(proof, {
    model: "scripted/fallback",
    loadingPath: "framework-fallback",
    toolCalls: ["tool_search", "read_release_marker"],
    targetExecutionCount: 1,
    searchResultContainsSchema: false,
    completed: true,
  });
  assertEquals(Object.keys(proof), [
    "model",
    "loadingPath",
    "toolCalls",
    "targetExecutionCount",
    "searchResultContainsSchema",
    "completed",
  ]);
});

it("fails closed when a scripted result contains schema-like data", async () => {
  const model = scriptedFallbackModel();
  const originalGenerate = model.doGenerate.bind(model);
  model.doGenerate = async (options) => {
    const result = await originalGenerate(options);
    if ((result.content?.[0] as { toolName?: string } | undefined)?.toolName === "tool_search") {
      return {
        ...result,
        content: [
          ...(result.content ?? []),
          {
            type: "tool-result",
            toolCallId: "search-1",
            toolName: "tool_search",
            result: { schema: { type: "object" } },
          },
        ],
      };
    }
    return result;
  };

  await assertRejects(
    () =>
      runToolSearchLiveProof({
        model: "scripted/schema-leak",
        modelRuntime: model,
      }),
    Error,
    "schema",
  );
});

it("writes only the exact sanitized proof shape", async () => {
  const directory = await Deno.makeTempDir();
  const output = `${directory}/proof.json`;
  try {
    const proof = await runToolSearchLiveProof({
      model: "scripted/fallback",
      modelRuntime: scriptedFallbackModel(),
    });
    await writeToolSearchLiveProof(output, proof);
    assertEquals(JSON.parse(await Deno.readTextFile(output)), proof);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("rejects report fields outside the sanitized proof shape", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const proof = await runToolSearchLiveProof({
      model: "scripted/fallback",
      modelRuntime: scriptedFallbackModel(),
    });
    await assertRejects(
      () =>
        writeToolSearchLiveProof(
          `${directory}/proof.json`,
          {
            ...proof,
            debug: "safe but not allowed",
          } as ToolSearchLiveProof & { debug: string },
        ),
      Error,
      "exact sanitized shape",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

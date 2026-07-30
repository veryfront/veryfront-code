import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  calculateEffectiveInputTokens,
  compareToolLoadingBenchmark,
  createToolLoadingBenchmarkMarkdown,
} from "./tool-loading-benchmark.ts";
import type { EvalToolLoadingBenchmarkRecord } from "./types.ts";

interface LiveReleaseGateArtifact {
  status: "passed" | "failed";
  sourceArtifact: {
    repository: string;
    path: string;
    sha256: string;
  };
  deterministicGate: {
    status: "passed" | "failed";
    passRate: number;
    executedCaseCount: number;
  };
  comparisons: Array<{
    prompt: "hi" | "Hello";
    status: "passed" | "failed";
    effectiveInputReduction: number;
    eager: EvalToolLoadingBenchmarkRecord;
    deferred: EvalToolLoadingBenchmarkRecord;
  }>;
}

function benchmarkRecord(
  mode: "eager" | "deferred",
  overrides: Partial<EvalToolLoadingBenchmarkRecord> = {},
): EvalToolLoadingBenchmarkRecord {
  return {
    prompt: "hi",
    mode,
    provider: "anthropic",
    model: "anthropic/claude-opus-4-6",
    sourceRevision: "0123456789abcdef",
    catalogFingerprint: "sha256:catalog",
    catalogSourceRevision: "catalog-rev-1",
    authorizedSearchableSchemaCount: 260,
    visibleSchemaCount: mode === "eager" ? 260 : 3,
    deferredSchemaCount: mode === "eager" ? 0 : 257,
    providerRequestToolDefinitionCount: mode === "eager" ? 260 : 3,
    providerWireDeferredMetadataCount: mode === "eager" ? 0 : 257,
    steps: 1,
    toolCalls: 0,
    durationMs: mode === "eager" ? 1_200 : 800,
    completed: true,
    usage: {
      inputTokens: mode === "eager" ? 20_000 : 4_000,
      cacheCreationInputTokens: mode === "eager" ? 5_000 : 1_000,
      cacheReadInputTokens: 0,
      billableInputTokens: mode === "eager" ? 25_000 : 5_000,
      providerInputCostUsd: mode === "eager" ? 0.25 : 0.05,
      usageCaptureStatus: "complete",
    },
    ...overrides,
  };
}

describe("eval/tool-loading-benchmark", () => {
  it("calculates Anthropic effective input from raw and cache token fields", () => {
    assertEquals(
      calculateEffectiveInputTokens("anthropic", {
        inputTokens: 100,
        cacheCreationInputTokens: 25,
        cacheReadInputTokens: 10,
      }),
      135,
    );
  });

  it("uses OpenAI input tokens without double-counting cache reads or writes", () => {
    assertEquals(
      calculateEffectiveInputTokens("openai", {
        inputTokens: 100,
        cachedInputTokens: 40,
        cacheReadInputTokens: 40,
        cacheWriteInputTokens: 12,
      }),
      100,
    );
  });

  it("passes a complete eager/deferred comparison that meets every release gate", () => {
    const comparison = compareToolLoadingBenchmark(
      benchmarkRecord("eager"),
      benchmarkRecord("deferred"),
    );

    assertEquals(comparison.status, "passed");
    assertEquals(comparison.effectiveInputReduction, 0.8);
    assertEquals(comparison.assertions.every((assertion) => assertion.pass === true), true);
  });

  it("marks a comparison incomplete when provider cost or usage capture is missing", () => {
    const comparison = compareToolLoadingBenchmark(
      benchmarkRecord("eager"),
      benchmarkRecord("deferred", {
        usage: {
          inputTokens: 4_000,
          cacheCreationInputTokens: 1_000,
          cacheReadInputTokens: 0,
          usageCaptureStatus: "partial",
        },
      }),
    );

    assertEquals(comparison.status, "incomplete");
    assertEquals(
      comparison.assertions.filter((assertion) => assertion.status === "incomplete").map(
        (assertion) => assertion.name,
      ),
      ["usage-capture-complete", "provider-input-cost-lower"],
    );
  });

  it("renders cache usage, context counts, wire metadata, and eager/deferred deltas together", () => {
    const comparison = compareToolLoadingBenchmark(
      benchmarkRecord("eager"),
      benchmarkRecord("deferred"),
    );
    const markdown = createToolLoadingBenchmarkMarkdown(comparison);

    assertStringIncludes(markdown, "| Cache creation input tokens | 5,000 | 1,000 | -4,000 |");
    assertStringIncludes(markdown, "| Cache read input tokens | 0 | 0 | 0 |");
    assertStringIncludes(markdown, "| Effective input tokens | 25,000 | 5,000 | -20,000 |");
    assertStringIncludes(markdown, "| Model-context tool definitions | 260 | 3 | -257 |");
    assertStringIncludes(markdown, "| Provider HTTP wire deferred metadata | 0 | 257 | +257 |");
    assertStringIncludes(markdown, "| Authorized searchable schemas | 260 | 260 | 0 |");
    assertStringIncludes(markdown, "`80.00%`");
  });

  it("keeps the checked-in live hi and Hello release evidence above every gate", async () => {
    const artifact = JSON.parse(
      await Deno.readTextFile(
        new URL("../../tests/fixtures/eval/tool-loading-live-release-gate.json", import.meta.url),
      ),
    ) as LiveReleaseGateArtifact;

    assertEquals(artifact.status, "passed");
    assertEquals(artifact.sourceArtifact, {
      repository: "veryfront-agent",
      path: ".veryfront/evals/tool-loading/live/report.json",
      sha256: "3d9db14c2da86ae7c2fa8aa72df4507926bcfd3d3472801fb17c0b9642da5a79",
    });
    assertEquals(artifact.deterministicGate, {
      status: "passed",
      passRate: 1,
      executedCaseCount: 12,
    });
    assertEquals(artifact.comparisons.map(({ prompt }) => prompt), ["hi", "Hello"]);

    for (const measured of artifact.comparisons) {
      const comparison = compareToolLoadingBenchmark(measured.eager, measured.deferred);

      assertEquals(comparison.status, measured.status);
      assertEquals(comparison.effectiveInputReduction, measured.effectiveInputReduction);
      assertEquals(comparison.assertions.every(({ status }) => status === "passed"), true);
    }
  });
});

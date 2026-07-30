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
  producerManifest: {
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

interface LiveProducerManifest {
  report: {
    path: string;
    sha256: string;
  };
  execution: {
    workingDirectory: string;
    command: string;
    model: string;
    executionModel: string;
    promptsAndModes: Array<{ prompt: "hi" | "Hello"; mode: "eager" | "deferred" }>;
    liveCanary: {
      prompt: string;
      mode: "deferred";
    };
    defaultTimeoutMs: number;
    requiredEnvironmentNames: string[];
    optionalEnvironmentNames: string[];
    environmentValuesPersisted: boolean;
  };
  agentProducer: {
    reportedBaseRevision: string;
    workingTreeState: string;
    snapshotRoot: string;
    files: Array<{ sourcePath: string; artifactPath: string; sha256: string }>;
  };
  frameworkProducer: {
    repositoryRevision: string;
    packageVersion: string;
    installedPackageTarget: string;
    builtPackageTreeSha256: string;
    snapshotRoot: string;
    files: Array<{ sourcePath: string; artifactPath: string; sha256: string }>;
  };
}

async function sha256(path: URL): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
    const producerManifestUrl = new URL(
      "../../tests/fixtures/eval/tool-loading-live-producer-manifest.json",
      import.meta.url,
    );
    assertEquals(artifact.producerManifest, {
      path: "tests/fixtures/eval/tool-loading-live-producer-manifest.json",
      sha256: await sha256(producerManifestUrl),
    });
    const producer = JSON.parse(
      await Deno.readTextFile(producerManifestUrl),
    ) as LiveProducerManifest;
    assertEquals(producer.report.sha256, artifact.sourceArtifact.sha256);
    assertEquals(producer.execution.workingDirectory, "veryfront-agent");
    assertEquals(producer.execution.command, "npm run eval:tool-loading:benchmark");
    assertEquals(producer.execution.model, "anthropic/claude-opus-4-6");
    assertEquals(producer.execution.executionModel, "veryfront-cloud/anthropic/claude-opus-4-6");
    assertEquals(producer.execution.promptsAndModes, [
      { prompt: "hi", mode: "eager" },
      { prompt: "hi", mode: "deferred" },
      { prompt: "Hello", mode: "eager" },
      { prompt: "Hello", mode: "deferred" },
    ]);
    assertEquals(producer.execution.liveCanary, {
      prompt:
        "Use tool_search to load the authorized list_projects read-only tool, call list_projects exactly once, then summarize the result.",
      mode: "deferred",
    });
    assertEquals(producer.execution.defaultTimeoutMs, 120_000);
    assertEquals(producer.execution.requiredEnvironmentNames, [
      "VERYFRONT_API_URL",
      "VERYFRONT_STUDIO_MCP_URL",
      "VERYFRONT_TOKEN",
      "VERYFRONT_API_TOKEN",
    ]);
    assertEquals(producer.execution.optionalEnvironmentNames, [
      "AG_UI_EVAL_PROJECT_ID",
      "VERYFRONT_TOOL_LOADING_TIMEOUT_MS",
      "GIT_COMMIT_SHA",
      "RELEASE_VERSION",
    ]);
    assertEquals(producer.execution.environmentValuesPersisted, false);
    assertEquals(
      producer.agentProducer.reportedBaseRevision,
      "732a93dc12d2acdd3d563d363e5fb74cbb1e8de5",
    );
    assertEquals(producer.agentProducer.workingTreeState, "dirty-with-untracked-evaluator");
    assertEquals(
      producer.frameworkProducer.repositoryRevision,
      "ffe38c7562be32c01f815a93cce8a9675e5ce302",
    );
    assertEquals(producer.frameworkProducer.packageVersion, "0.1.1177");
    assertEquals(producer.frameworkProducer.installedPackageTarget, "veryfront-code/npm");
    assertEquals(
      producer.frameworkProducer.builtPackageTreeSha256,
      "ad6f567ca3a7577275585a69b25da238dacca9004e3f1649851c6ab06930ab72",
    );
    for (const snapshot of [producer.agentProducer, producer.frameworkProducer]) {
      for (const file of snapshot.files) {
        assertEquals(
          await sha256(
            new URL(`../../${snapshot.snapshotRoot}/${file.artifactPath}`, import.meta.url),
          ),
          file.sha256,
        );
        assertEquals(file.artifactPath, `${file.sourcePath}.snapshot`);
      }
    }
    assertEquals(artifact.deterministicGate, {
      status: "passed",
      passRate: 1,
      executedCaseCount: 12,
    });
    assertEquals(artifact.comparisons.map(({ prompt }) => prompt), ["hi", "Hello"]);

    for (const measured of artifact.comparisons) {
      assertEquals(measured.eager.sourceRevision, producer.agentProducer.reportedBaseRevision);
      assertEquals(measured.deferred.sourceRevision, producer.agentProducer.reportedBaseRevision);
      const comparison = compareToolLoadingBenchmark(measured.eager, measured.deferred);

      assertEquals(comparison.status, measured.status);
      assertEquals(comparison.effectiveInputReduction, measured.effectiveInputReduction);
      assertEquals(comparison.assertions.every(({ status }) => status === "passed"), true);
    }
  });
});

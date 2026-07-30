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
  producer: {
    revision: string;
    tree: string;
    clean: boolean;
  };
  frameworkPackage: {
    version: string;
    integrity: string;
    source: string;
    tarballSha256: string;
    frameworkRevision: string;
    frameworkTree: string;
    frameworkSourceClean: boolean;
  };
  sourceRevision: string;
  sourceTree: string;
  catalogSourceRevision: string;
  catalogSourceTree: string;
  deterministicGate: {
    status: "passed" | "failed";
    passRate: number;
    executedCaseCount: number;
  };
  liveCanary: {
    id: string;
    prompt: string;
    mode: "deferred";
    completed: boolean;
    expectedToolName: string;
    observedToolCalls: Array<{
      name: string;
      status: string;
      input: unknown;
      result: unknown;
    }>;
    status: "passed" | "failed";
  };
  comparisons: Array<{
    prompt: "hi" | "Hello";
    status: "passed" | "failed";
    effectiveInputReduction: number;
    eager: EvalToolLoadingBenchmarkRecord & {
      sourceTree: string;
      catalogSourceTree: string;
    };
    deferred: EvalToolLoadingBenchmarkRecord & {
      sourceTree: string;
      catalogSourceTree: string;
    };
  }>;
}

interface LiveProducerSnapshotFile {
  sourcePath: string;
  artifactPath: string;
  sourceSha256?: string;
  artifactNormalization?: string;
  sha256: string;
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
    repositoryRevision: string;
    repositoryTree: string;
    workingTreeState: string;
    snapshotRoot: string;
    files: LiveProducerSnapshotFile[];
  };
  frameworkProducer: {
    repositoryRevision: string;
    repositoryTree: string;
    workingTreeState: string;
    packageVersion: string;
    installedPackageTarget: string;
    packageIntegrity: string;
    tarballSha256: string;
    snapshotRoot: string;
    files: LiveProducerSnapshotFile[];
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
      sha256: "0e081ae8d9fd2fb9805e423cf70d3b20223e6a71dfe132ccb83cc07b6cc911ed",
    });
    assertEquals(artifact.producer, {
      revision: "760672883619d4b631fe6c087ac65976a0438a96",
      tree: "4f796353886133a4bc6a3c9ac81ac81cef0cd2d1",
      clean: true,
    });
    assertEquals(artifact.frameworkPackage, {
      version: "0.1.1177",
      integrity:
        "sha512-CcS6oiFbZ9CmHWUvR9k1WEUOl7AYi+oRjapVotnQ/xY9Y4vP21A8SqizMooQS1+Bk2mGj0RYD6ZtqiZ3oQc/uA==",
      source: "local-npm-pack",
      tarballSha256: "1cac6e2e513607e931401cfd2e785d43ea041e4af8d37ab42ab68170a24172a3",
      frameworkRevision: "a2641bfa9a1df3b832efa6cfe3e7175e0b14e2d4",
      frameworkTree: "f56735838f2f541c4f4aed1cd79acb7bd339c419",
      frameworkSourceClean: true,
    });
    assertEquals(artifact.sourceRevision, artifact.producer.revision);
    assertEquals(artifact.sourceTree, artifact.producer.tree);
    assertEquals(artifact.catalogSourceRevision, artifact.producer.revision);
    assertEquals(artifact.catalogSourceTree, artifact.producer.tree);
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
    assertEquals(producer.agentProducer.repositoryRevision, artifact.producer.revision);
    assertEquals(producer.agentProducer.repositoryTree, artifact.producer.tree);
    assertEquals(producer.agentProducer.workingTreeState, "clean");
    assertEquals(
      producer.frameworkProducer.repositoryRevision,
      artifact.frameworkPackage.frameworkRevision,
    );
    assertEquals(
      producer.frameworkProducer.repositoryTree,
      artifact.frameworkPackage.frameworkTree,
    );
    assertEquals(producer.frameworkProducer.workingTreeState, "clean");
    assertEquals(producer.frameworkProducer.packageVersion, "0.1.1177");
    assertEquals(producer.frameworkProducer.installedPackageTarget, "veryfront-code/npm");
    assertEquals(
      producer.frameworkProducer.packageIntegrity,
      artifact.frameworkPackage.integrity,
    );
    assertEquals(
      producer.frameworkProducer.tarballSha256,
      artifact.frameworkPackage.tarballSha256,
    );
    assertEquals(producer.frameworkProducer.files[0], {
      sourcePath: "npm/package.json",
      artifactPath: "npm-package.json.snapshot",
      sourceSha256: "31172176081c01a15107cb5aa4eae9632b29f0951b4f46c57055e9f4fb4bf559",
      sha256: "31172176081c01a15107cb5aa4eae9632b29f0951b4f46c57055e9f4fb4bf559",
    });
    for (const snapshot of [producer.agentProducer, producer.frameworkProducer]) {
      for (const file of snapshot.files) {
        assertEquals(
          await sha256(
            new URL(`../../${snapshot.snapshotRoot}/${file.artifactPath}`, import.meta.url),
          ),
          file.sha256,
        );
        assertEquals(file.sourceSha256, file.sha256);
        assertEquals(file.artifactPath.endsWith(".snapshot"), true);
      }
    }
    assertEquals(artifact.deterministicGate, {
      status: "passed",
      passRate: 1,
      executedCaseCount: 12,
    });
    assertEquals(artifact.liveCanary.status, "passed");
    assertEquals(artifact.liveCanary.completed, true);
    assertEquals(artifact.liveCanary.expectedToolName, "list_projects");
    assertEquals(
      artifact.liveCanary.observedToolCalls.map(({ name, status }) => ({ name, status })),
      [
        { name: "tool_search", status: "completed" },
        { name: "list_projects", status: "completed" },
      ],
    );
    assertEquals(
      artifact.liveCanary.observedToolCalls.filter(({ name }) => name === "list_projects").length,
      1,
    );
    assertEquals(artifact.comparisons.map(({ prompt }) => prompt), ["hi", "Hello"]);

    for (const measured of artifact.comparisons) {
      assertEquals(measured.eager.sourceRevision, producer.agentProducer.repositoryRevision);
      assertEquals(measured.deferred.sourceRevision, producer.agentProducer.repositoryRevision);
      assertEquals(measured.eager.sourceTree, producer.agentProducer.repositoryTree);
      assertEquals(measured.deferred.sourceTree, producer.agentProducer.repositoryTree);
      assertEquals(measured.eager.catalogSourceRevision, producer.agentProducer.repositoryRevision);
      assertEquals(
        measured.deferred.catalogSourceRevision,
        producer.agentProducer.repositoryRevision,
      );
      assertEquals(measured.eager.catalogSourceTree, producer.agentProducer.repositoryTree);
      assertEquals(measured.deferred.catalogSourceTree, producer.agentProducer.repositoryTree);
      const comparison = compareToolLoadingBenchmark(measured.eager, measured.deferred);

      assertEquals(comparison.status, measured.status);
      assertEquals(comparison.effectiveInputReduction, measured.effectiveInputReduction);
      assertEquals(comparison.assertions.every(({ status }) => status === "passed"), true);
    }
  });
});

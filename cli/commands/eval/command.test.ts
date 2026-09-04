import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, makeTempDir, setEnv, withTempDir } from "#veryfront/testing/deno-compat.ts";
import { VeryfrontError } from "veryfront/errors";
import { type Agent, agent as createAgent, type AgentResponse } from "veryfront/agent";
import { defineSchema } from "veryfront/schemas";
import {
  datasets,
  type DiscoveredEval,
  EVAL_REPORT_SCHEMA_VERSION,
  evalAgent,
  evalDataset,
  type EvalReport,
  evalTool,
  metrics,
  runEval,
} from "veryfront/eval";
import { createEvalReportExporterRegistry } from "veryfront/extensions/eval";
import type { ModelRuntime } from "veryfront/provider";
import {
  markCurrentVeryfrontCloudBillingGroupUsed,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { type Tool, tool } from "veryfront/tool";
import type { ProjectAgentRuntimeDiscovery } from "../../../src/agent/project/agent-runtime.ts";
import { getActiveSourceIntegrationPolicy } from "../../../src/integrations/source-policy-context.ts";
import {
  normalizeSourceIntegrationPolicy,
  type SourceIntegrationPolicyManifest,
} from "../../../src/integrations/source-policy.ts";
import { saveToken } from "../../auth/token-store.ts";
import { setJsonMode } from "../../shared/json-output.ts";
import { setQuietMode } from "../../utils/index.ts";
import { stripAnsi } from "../../ui/ansi.ts";
import {
  applyGatewayBillingGroupFinalization,
  createAgentAdapter,
  createEvalToolExecutionContext,
  createResolvedEvalModelComparisonConfig,
  createToolAdapter,
  type EvalOptions,
  exportEvalReportForCli,
  finalizeGatewayBillingGroup,
  findEvalForCliId,
  hydrateEvalRuntimeAuth,
  loadEvalModelComparisonPolicy,
  normalizeEvalCliId,
  normalizeEvalInputForAgent,
  normalizeToolCalls,
  normalizeUsage,
  resolveEvalExporterIds,
  resolveEvalExportRedactionFromEnv,
  resolveEvalExportRequired,
  resolveToolTargetId,
  runEvalCommand,
  runEvalWithGatewayBillingGroup,
} from "./command.ts";
import { parseEvalArgs } from "./handler.ts";
import { deleteHostSecret, getHostEnv } from "#cli/process-env";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";

const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
const originalServiceLayer = Deno.env.get("VERYFRONT_SERVICE_LAYER");
const originalXdgConfigHome = Deno.env.get("XDG_CONFIG_HOME");
const originalEvalExport = Deno.env.get("VERYFRONT_EVAL_EXPORT");
const originalEvalExporters = Deno.env.get("VERYFRONT_EVAL_EXPORTERS");
const originalEvalExportRequired = Deno.env.get("VERYFRONT_EVAL_EXPORT_REQUIRED");
const originalMlflowTrackingUri = Deno.env.get("MLFLOW_TRACKING_URI");
const redactionEnvNames = [
  "VERYFRONT_EVAL_EXPORT_INCLUDE_INPUTS",
  "VERYFRONT_EVAL_EXPORT_INCLUDE_OUTPUTS",
  "VERYFRONT_EVAL_EXPORT_INCLUDE_REFERENCES",
  "VERYFRONT_EVAL_EXPORT_INCLUDE_TRACES",
  "VERYFRONT_EVAL_EXPORT_INCLUDE_METRIC_EVIDENCE",
  "VERYFRONT_EVAL_EXPORT_INCLUDE_METRIC_EXPLANATIONS",
  "VERYFRONT_EVAL_EXPORT_METADATA_ALLOWLIST",
] as const;
const originalRedactionEnv = Object.fromEntries(
  redactionEnvNames.map((name) => [name, Deno.env.get(name)]),
) as Record<(typeof redactionEnvNames)[number], string | undefined>;

function restoreEnv(): void {
  deleteHostSecret("VERYFRONT_API_TOKEN");
  if (originalApiToken === undefined) {
    Deno.env.delete("VERYFRONT_API_TOKEN");
  } else {
    Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
  }

  if (originalProjectSlug === undefined) {
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");
  } else {
    Deno.env.set("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
  }

  if (originalServiceLayer === undefined) {
    Deno.env.delete("VERYFRONT_SERVICE_LAYER");
  } else {
    Deno.env.set("VERYFRONT_SERVICE_LAYER", originalServiceLayer);
  }

  if (originalApiBaseUrl === undefined) {
    Deno.env.delete("VERYFRONT_API_BASE_URL");
  } else {
    Deno.env.set("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
  }

  if (originalXdgConfigHome === undefined) {
    Deno.env.delete("XDG_CONFIG_HOME");
  } else {
    Deno.env.set("XDG_CONFIG_HOME", originalXdgConfigHome);
  }

  if (originalEvalExport === undefined) {
    Deno.env.delete("VERYFRONT_EVAL_EXPORT");
  } else {
    Deno.env.set("VERYFRONT_EVAL_EXPORT", originalEvalExport);
  }

  if (originalEvalExporters === undefined) {
    Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
  } else {
    Deno.env.set("VERYFRONT_EVAL_EXPORTERS", originalEvalExporters);
  }

  if (originalEvalExportRequired === undefined) {
    Deno.env.delete("VERYFRONT_EVAL_EXPORT_REQUIRED");
  } else {
    Deno.env.set("VERYFRONT_EVAL_EXPORT_REQUIRED", originalEvalExportRequired);
  }

  if (originalMlflowTrackingUri === undefined) {
    Deno.env.delete("MLFLOW_TRACKING_URI");
  } else {
    Deno.env.set("MLFLOW_TRACKING_URI", originalMlflowTrackingUri);
  }

  for (const name of redactionEnvNames) {
    const original = originalRedactionEnv[name];
    if (original === undefined) {
      Deno.env.delete(name);
    } else {
      Deno.env.set(name, original);
    }
  }

  restoreMockFetch();
}

function createReport(): EvalReport {
  return {
    kind: "eval-report",
    schemaVersion: EVAL_REPORT_SCHEMA_VERSION,
    runId: "evalrun_test",
    definitionId: "eval:answers",
    targetKind: "agent",
    target: "agent:assistant",
    dataset: {
      kind: "inline",
      examples: 2,
      hash: "sha256:fixture-dataset",
    },
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:01.000Z",
    summary: {
      records: 2,
      passed: 1,
      failed: 1,
      passRate: 0.5,
      metrics: [
        {
          name: "answer.exactMatch",
          family: "answer",
          severity: "gate",
          passed: 1,
          failed: 1,
          skipped: 0,
          passRate: 0.5,
        },
      ],
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        billableInputTokens: 90,
        billableOutputTokens: 18,
        providerInputCostUsd: 0.0004,
        providerOutputCostUsd: 0.0006,
        providerCostUsd: 0.001,
        veryfrontInputChargeUsd: 0.001,
        veryfrontOutputChargeUsd: 0.0015,
        veryfrontChargeUsd: 0.0025,
        veryfrontBilledUsd: 0.1,
        costCredits: 1,
        costSource: "gateway",
        billingMode: "deferred",
        usageCaptureStatus: "complete",
      },
    },
    records: [
      {
        id: "q1:1",
        evalId: "eval:answers",
        exampleId: "q1",
        repetition: 1,
        input: "capital",
        output: { text: "Paris" },
        reference: "Paris",
        metadata: {},
        trace: { events: [], toolCalls: [] },
        usage: { totalTokens: 12, veryfrontBilledUsd: 0.06, costCredits: 0.6 },
        durationMs: 12,
        completed: true,
        metrics: [
          {
            name: "answer.exactMatch",
            family: "answer",
            severity: "gate",
            score: 1,
            pass: true,
          },
        ],
        checks: [],
      },
      {
        id: "q2:1",
        evalId: "eval:answers",
        exampleId: "q2",
        repetition: 1,
        input: "capital",
        output: { text: "Lyon" },
        reference: "Paris",
        metadata: {},
        trace: { events: [], toolCalls: [] },
        usage: { totalTokens: 10, veryfrontBilledUsd: 0.04, costCredits: 0.4 },
        durationMs: 10,
        completed: true,
        metrics: [
          {
            name: "answer.exactMatch",
            family: "answer",
            severity: "gate",
            score: 0,
            pass: false,
            explanation: "Expected Paris, got Lyon",
          },
        ],
        checks: [],
      },
    ],
  };
}

function createProjectRuntimeDiscovery(
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest,
): ProjectAgentRuntimeDiscovery {
  return {
    tools: new Map(),
    agents: new Map(),
    skills: new Map(),
    resources: new Map(),
    prompts: new Map(),
    workflows: new Map(),
    tasks: new Map(),
    schedules: new Map(),
    webhooks: new Map(),
    evals: new Map(),
    errors: [],
    sourceIntegrationPolicy,
  };
}

function createEvalOptions(overrides: Partial<EvalOptions> = {}): EvalOptions {
  const parsed = parseEvalArgs({ _: ["eval"] });
  if (!parsed.success) throw new Error("Failed to create eval options fixture");
  return { ...parsed.data, ...overrides };
}

function makeEvalTool(id: string, source = id): Tool {
  return tool({
    id,
    description: `${id} mock`,
    inputSchema: defineSchema((v) => v.object({ query: v.string().optional() }))(),
    execute: async (input) => ({ source, input }),
  }) as Tool;
}

type AgentGenerateFixture = (input: Parameters<Agent["generate"]>[0]) => Promise<AgentResponse>;

function createGenerateStub(generate: AgentGenerateFixture): Agent["generate"] {
  return (async (input: Parameters<Agent["generate"]>[0]) => {
    return await generate(input);
  }) as Agent["generate"];
}

function makeAgentStub(
  generate: AgentGenerateFixture,
  config: Partial<Agent["config"]> = {},
): Agent {
  return {
    id: "agent:stub",
    config: {
      model: "hosted/stub",
      system: "Stub.",
      ...config,
    } as Agent["config"],
    generate: createGenerateStub(generate),
    stream: async () => ({ toDataStreamResponse: () => new Response() }),
    respond: async () => new Response(),
    getMemory: () => ({}) as ReturnType<Agent["getMemory"]>,
    getMemoryStats: async () => ({ totalMessages: 0, estimatedTokens: 0, type: "stub" }),
    clearMemory: async () => {},
  };
}

function completedAgentResponse(toolName = "search_docs"): AgentResponse {
  return {
    text: "real answer",
    status: "completed",
    messages: [],
    toolCalls: [{
      id: "call-1",
      name: toolName,
      args: { query: "docs" },
      status: "completed",
      result: { source: "real-agent" },
    }],
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  };
}

async function captureConsoleOutput(fn: () => Promise<unknown>): Promise<{
  stdout: string[];
  stderr: string[];
}> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  return { stdout, stderr };
}

function relevantEvalHumanLines(output: { stdout: string[]; stderr: string[] }): string[] {
  return [...output.stdout, ...output.stderr]
    .map((line) => stripAnsi(line))
    .map((line) => {
      // Strip logger text-mode prefix before matching content.
      // Server preset (default in tests): "HH:MM:SS  TAGNAME    G " = 23 chars (PREFIX_WIDTH).
      // CLI preset (when entry point sets it): "  G " = 4 chars.
      if (/^\d{2}:\d{2}:\d{2}\s{2}/.test(line)) return line.slice(23);
      if (/^\s{2}[·●!✗]\s/.test(line)) return line.slice(4);
      // The eval command writes its own lines to stdout at a 2-space indent, no logger involved.
      if (line.startsWith("  ")) return line.slice(2);
      return line;
    })
    .filter((line) =>
      line.startsWith("Eval:") ||
      line.startsWith("Target: ") ||
      line.startsWith("Eval id: ") ||
      line.startsWith("Result: ") ||
      line.startsWith("Report: ") ||
      line.startsWith("Report JSON: ") ||
      line.startsWith("JUnit: ") ||
      line.startsWith("Baseline written: ") ||
      line.startsWith("Model: ") ||
      line.startsWith("Recommendation: ") ||
      line.startsWith("  - ") ||
      line.startsWith("Comparison: ") ||
      line.startsWith("Comparison markdown: ") ||
      line.startsWith("Eval suite: ")
    );
}

/** The `●` lines, which mark individual metric assertions and nothing else. */
function evalMetricLines(output: { stdout: string[] }): string[] {
  return output.stdout
    .map((line) => stripAnsi(line))
    .filter((line) => line.startsWith("  ● "))
    .map((line) => line.slice(4));
}

function parseLastJsonEnvelope(output: { stdout: string[] }): {
  success: boolean;
  command: string;
  data: Record<string, unknown>;
} {
  const line = [...output.stdout].reverse().find((entry) => entry.trim().startsWith("{"));
  if (!line) throw new Error("Expected JSON envelope output.");
  return JSON.parse(line) as {
    success: boolean;
    command: string;
    data: Record<string, unknown>;
  };
}

describe("eval CLI command helpers", () => {
  afterEach(() => {
    setJsonMode(false);
    restoreEnv();
  });

  it("parses eval command arguments", () => {
    const parsed = parseEvalArgs({
      _: ["eval", "deep-research"],
      list: false,
      "dataset-base": "fixtures",
      "report-dir": ".veryfront/evals/run-1",
      report: "reports/eval.json",
      junit: "reports/eval.xml",
      baseline: "reports/baseline.json",
      "write-baseline": "reports/next-baseline.json",
      "baseline-pass-rate-drop-threshold": 0.02,
      "baseline-metric-pass-rate-drop-threshold": 0.03,
      "baseline-failed-delta-threshold": 1,
      "baseline-usage-increase-threshold": 0.15,
      "baseline-latency-increase-threshold": 0.2,
      export: "braintrust,langfuse",
      "require-export": true,
      debug: true,
      "baseline-model": "anthropic/claude-opus-4-6",
      "candidate-model": ["moonshotai/kimi-k2.6"],
      "comparison-policy": "evals/model-comparison.policy.json",
    });

    assertEquals(parsed.success, true);
    if (parsed.success) {
      assertEquals(parsed.data.id, "deep-research");
      assertEquals(parsed.data.datasetBase, "fixtures");
      assertEquals(parsed.data.reportDir, ".veryfront/evals/run-1");
      assertEquals(parsed.data.report, "reports/eval.json");
      assertEquals(parsed.data.junit, "reports/eval.xml");
      assertEquals(parsed.data.baseline, "reports/baseline.json");
      assertEquals(parsed.data.writeBaseline, "reports/next-baseline.json");
      assertEquals(parsed.data.baselinePassRateDropThreshold, 0.02);
      assertEquals(parsed.data.baselineMetricPassRateDropThreshold, 0.03);
      assertEquals(parsed.data.baselineFailedDeltaThreshold, 1);
      assertEquals(parsed.data.baselineUsageIncreaseThreshold, 0.15);
      assertEquals(parsed.data.baselineLatencyIncreaseThreshold, 0.2);
      assertEquals(parsed.data.exporters, ["braintrust", "langfuse"]);
      assertEquals(parsed.data.requireExport, true);
      assertEquals(parsed.data.debug, true);
      assertEquals(parsed.data.baselineModel, "anthropic/claude-opus-4-6");
      assertEquals(parsed.data.candidateModels, ["moonshotai/kimi-k2.6"]);
      assertEquals(parsed.data.comparisonPolicy, "evals/model-comparison.policy.json");
    }
  });

  it("normalizes eval ids without requiring users to type the namespace", () => {
    assertEquals(normalizeEvalCliId("deep-research"), "eval:deep-research");
    assertEquals(normalizeEvalCliId("eval:deep-research"), "eval:deep-research");
  });

  it("resolves eval exporters from CLI flags instead of environment defaults", () => {
    Deno.env.set("VERYFRONT_EVAL_EXPORTERS", "mlflow,braintrust");
    Deno.env.set("VERYFRONT_EVAL_EXPORT", "langfuse");

    assertEquals(resolveEvalExporterIds({ exporters: ["custom"] }), ["custom"]);
  });

  it("resolves plural eval exporter env before the legacy env var", () => {
    Deno.env.set("VERYFRONT_EVAL_EXPORTERS", "mlflow,braintrust");
    Deno.env.set("VERYFRONT_EVAL_EXPORT", "langfuse");

    assertEquals(resolveEvalExporterIds({ exporters: [] }), ["mlflow", "braintrust"]);
  });

  it("uses the legacy eval exporter env var only when the plural env var is unset", () => {
    Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
    Deno.env.set("VERYFRONT_EVAL_EXPORT", "langfuse");

    assertEquals(resolveEvalExporterIds({ exporters: [] }), ["langfuse"]);
  });

  it("exports to MLflow when its tracking URI is configured", () => {
    Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
    Deno.env.delete("VERYFRONT_EVAL_EXPORT");
    Deno.env.set("MLFLOW_TRACKING_URI", "https://mlflow.example.com");

    assertEquals(resolveEvalExporterIds({ exporters: [] }), ["mlflow"]);
  });

  it("requires eval export only when the CLI flag or CI environment requests it", () => {
    Deno.env.delete("VERYFRONT_EVAL_EXPORT_REQUIRED");
    assertEquals(resolveEvalExportRequired({ requireExport: false }), false);
    assertEquals(resolveEvalExportRequired({ requireExport: true }), true);

    Deno.env.set("VERYFRONT_EVAL_EXPORT_REQUIRED", "true");
    assertEquals(resolveEvalExportRequired({ requireExport: false }), true);
  });

  it("keeps eval export redaction safe by default", () => {
    for (const name of redactionEnvNames) Deno.env.delete(name);

    assertEquals(resolveEvalExportRedactionFromEnv(), {});
  });

  it("lists evals without initializing selected exporter extensions", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-all",
          new URL("../../main.ts", import.meta.url).pathname,
          "eval",
          "--list",
          "--export",
          "mlflow",
        ],
        cwd: projectDir,
        clearEnv: true,
        env: {
          HOME: Deno.env.get("HOME") ?? projectDir,
          PATH: Deno.env.get("PATH") ?? "",
          NO_COLOR: "1",
          MLFLOW_TRACKING_URI: "file:///tmp/mlruns",
        },
      });

      const result = await command.output();
      const output = `${new TextDecoder().decode(result.stdout)}${
        new TextDecoder().decode(result.stderr)
      }`;

      assertEquals(result.code, 0, output);
      assertStringIncludes(output, "No evals found.");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("includes target kinds in structured eval list output", async () => {
    await withTempDir(async (projectDir) => {
      await withTempDir(async (configHome) => {
        const agentDefinition = evalAgent({
          id: "eval:agent-target",
          name: "Agent target",
          target: "agent:fixture",
          dataset: [{ id: "agent-case", input: "agent" }],
        });
        const datasetDefinition = evalDataset({
          id: "eval:dataset-target",
          name: "Dataset target",
          dataset: [{ id: "dataset-case", input: "dataset" }],
        });
        agentDefinition.source = {
          filePath: `${projectDir}/evals/agent-target.eval.ts`,
          exportName: "default",
        };
        datasetDefinition.source = {
          filePath: `${projectDir}/evals/dataset-target.eval.ts`,
          exportName: "default",
        };
        const runtime = createProjectRuntimeDiscovery(
          normalizeSourceIntegrationPolicy({ allow: {} }),
        );
        runtime.evals.set(agentDefinition.id, agentDefinition);
        runtime.evals.set(datasetDefinition.id, datasetDefinition);

        deleteEnv("VERYFRONT_API_TOKEN");
        deleteEnv("VERYFRONT_PROJECT_SLUG");
        deleteEnv("VERYFRONT_EVAL_EXPORT");
        deleteEnv("VERYFRONT_EVAL_EXPORTERS");
        setEnv("XDG_CONFIG_HOME", configHome);
        setJsonMode(true);

        try {
          const output = await captureConsoleOutput(async () => {
            await runEvalCommand(
              {
                list: true,
                exporters: [],
                debug: false,
                candidateModels: [],
                projectDir,
              },
              { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
            );
          });

          assertEquals(parseLastJsonEnvelope(output).data.evals, [
            {
              id: "eval:agent-target",
              name: "Agent target",
              targetKind: "agent",
              target: "agent:fixture",
              source: {
                filePath: "evals/agent-target.eval.ts",
                exportName: "default",
              },
            },
            {
              id: "eval:dataset-target",
              name: "Dataset target",
              targetKind: "dataset",
              target: "eval:dataset-target",
              source: {
                filePath: "evals/dataset-target.eval.ts",
                exportName: "default",
              },
            },
          ]);
        } finally {
          setJsonMode(false);
        }
      }, { prefix: "vf-eval-list-json-auth-" });
    }, { prefix: "vf-eval-list-json-" });
  });

  it("resolves eval export redaction from exact global env toggles", () => {
    Deno.env.set("VERYFRONT_EVAL_EXPORT_INCLUDE_INPUTS", "true");
    Deno.env.set("VERYFRONT_EVAL_EXPORT_INCLUDE_OUTPUTS", "1");
    Deno.env.set("VERYFRONT_EVAL_EXPORT_INCLUDE_REFERENCES", "yes");
    Deno.env.set("VERYFRONT_EVAL_EXPORT_INCLUDE_TRACES", "on");
    Deno.env.set("VERYFRONT_EVAL_EXPORT_INCLUDE_METRIC_EVIDENCE", "true");
    Deno.env.set("VERYFRONT_EVAL_EXPORT_INCLUDE_METRIC_EXPLANATIONS", "true");
    Deno.env.set("VERYFRONT_EVAL_EXPORT_METADATA_ALLOWLIST", "topic,tenantId topic");

    assertEquals(resolveEvalExportRedactionFromEnv(), {
      includeInputs: true,
      includeOutputs: true,
      includeReferences: true,
      includeTraces: true,
      includeMetricEvidence: true,
      includeMetricExplanations: true,
      metadataAllowlist: ["topic", "tenantId"],
    });
  });

  it("finds explicit eval ids without forcing the namespace", () => {
    const evals = [
      { id: "custom-capital" },
      { id: "eval:deep-research" },
    ] as DiscoveredEval[];

    assertEquals(findEvalForCliId(evals, "custom-capital")?.id, "custom-capital");
    assertEquals(findEvalForCliId(evals, "deep-research")?.id, "eval:deep-research");
    assertEquals(findEvalForCliId(evals, "eval:custom-capital")?.id, "custom-capital");
  });

  it("normalizes tool target ids", () => {
    assertEquals(resolveToolTargetId("lookup_order"), "lookup_order");
    assertEquals(resolveToolTargetId("tool:lookup_order"), "lookup_order");
  });

  it("normalizes structured eval inputs into agent prompts", () => {
    assertEquals(normalizeEvalInputForAgent("hello"), "hello");
    assertEquals(normalizeEvalInputForAgent({ prompt: "Write a summary" }), "Write a summary");
    assertEquals(
      normalizeEvalInputForAgent({ question: "What changed?", context: "diff" }),
      "What changed?",
    );
    assertEquals(normalizeEvalInputForAgent({ custom: true }), '{"custom":true}');
  });

  it("preserves gateway usage metadata in eval usage", () => {
    const response = {
      text: "done",
      messages: [],
      status: "completed",
      toolCalls: [],
      usage: {
        promptTokens: 12,
        completionTokens: 5,
        totalTokens: 17,
        cachedInputTokens: 3,
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 1,
        reasoningTokens: 4,
        billableInputTokens: 10,
        billableOutputTokens: 5,
        costUsd: 0.001,
        providerInputCostUsd: 0.0004,
        providerOutputCostUsd: 0.0006,
        providerCostUsd: 0.001,
        veryfrontInputChargeUsd: 0.001,
        veryfrontOutputChargeUsd: 0.0015,
        veryfrontChargeUsd: 0.0025,
        veryfrontBilledUsd: 0.1,
        costCredits: 0.025,
        costSource: "gateway",
        billingMode: "deferred",
        usageCaptureStatus: "complete",
      },
    } satisfies AgentResponse;

    assertEquals(normalizeUsage(response), {
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
      cachedInputTokens: 3,
      cacheCreationInputTokens: 2,
      cacheReadInputTokens: 1,
      reasoningTokens: 4,
      billableInputTokens: 10,
      billableOutputTokens: 5,
      costUsd: 0.001,
      providerInputCostUsd: 0.0004,
      providerOutputCostUsd: 0.0006,
      providerCostUsd: 0.001,
      veryfrontInputChargeUsd: 0.001,
      veryfrontOutputChargeUsd: 0.0015,
      veryfrontChargeUsd: 0.0025,
      veryfrontBilledUsd: 0.1,
      costCredits: 0.025,
      costSource: "gateway",
      billingMode: "deferred",
      usageCaptureStatus: "complete",
    });
  });

  it("preserves agent tool input and output in eval traces", () => {
    const response = {
      text: "done",
      messages: [],
      status: "completed",
      toolCalls: [
        {
          id: "call-1",
          name: "search_knowledge",
          args: { query: "sso login" },
          status: "completed",
          result: {
            data: [
              {
                path: "knowledge/login-troubleshooting.md",
                frontmatter: [{ key: "title", value: "Login troubleshooting" }],
              },
            ],
          },
        },
        {
          id: "call-2",
          name: "execute_skill_script",
          args: { script: "missing.sh" },
          status: "error",
          error: "File not found",
        },
      ],
    } satisfies AgentResponse;

    assertEquals(normalizeToolCalls(response), [
      {
        id: "call-1",
        name: "search_knowledge",
        status: "ok",
        input: { query: "sso login" },
        output: {
          data: [
            {
              path: "knowledge/login-troubleshooting.md",
              frontmatter: [{ key: "title", value: "Login troubleshooting" }],
            },
          ],
        },
      },
      {
        id: "call-2",
        name: "execute_skill_script",
        status: "error",
        input: { script: "missing.sh" },
        error: "File not found",
      },
    ]);
  });

  it("passes static mock tools into real agent.generate and keeps real traces", async () => {
    const mockTools = { search_docs: makeEvalTool("search_docs", "mock") };
    let capturedGenerateInput: Parameters<Agent["generate"]>[0] | undefined;
    const agent = makeAgentStub(async (input) => {
      capturedGenerateInput = input;
      return completedAgentResponse("search_docs");
    });
    const definition = evalAgent({
      id: "eval:mocked-agent",
      target: "agent:assistant",
      dataset: datasets.inline([{ id: "q1", input: "Find docs" }]),
      mockTools,
    });

    const result = await createAgentAdapter(agent, createEvalOptions())({
      definition,
      example: { id: "q1", input: "Find docs" },
      repetition: 1,
    });

    assertEquals(capturedGenerateInput?.tools, mockTools);
    assertEquals(result.text, "real answer");
    assertEquals(result.trace?.toolCalls, [{
      id: "call-1",
      name: "search_docs",
      status: "ok",
      input: { query: "docs" },
      output: { source: "real-agent" },
    }]);
  });

  it("resolves mock tools once for each example repetition", async () => {
    const calls: string[] = [];
    const agent = makeAgentStub(async () => completedAgentResponse("search_docs"));
    const definition = evalAgent({
      id: "eval:resolver-agent",
      target: "agent:assistant",
      dataset: datasets.inline([
        { id: "q1", input: "one" },
        { id: "q2", input: "two" },
      ]),
      repetitions: 2,
      mockTools: ({ example, repetition }) => {
        calls.push(`${example.id}:${repetition}`);
        return { search_docs: makeEvalTool("search_docs", `${example.id}:${repetition}`) };
      },
    });

    const report = await runEval(definition, {
      adapters: { agent: createAgentAdapter(agent, createEvalOptions()) },
    });

    assertEquals(report.records.map((record) => record.completed), [true, true, true, true]);
    assertEquals(calls, ["q1:1", "q1:2", "q2:1", "q2:2"]);
  });

  it("isolates mock tool resolver errors to the current eval record", async () => {
    const agent = makeAgentStub(async () => completedAgentResponse("search_docs"));
    const definition = evalAgent({
      id: "eval:resolver-error",
      target: "agent:assistant",
      dataset: datasets.inline([
        { id: "ok", input: "ok" },
        { id: "bad", input: "bad" },
      ]),
      mockTools: ({ example }) => {
        if (example.id === "bad") throw new Error("mock resolver failed");
        return { search_docs: makeEvalTool("search_docs") };
      },
    });

    const report = await runEval(definition, {
      adapters: { agent: createAgentAdapter(agent, createEvalOptions()) },
    });

    assertEquals(report.records.map((record) => record.completed), [true, false]);
    assertEquals(report.records[1]?.error, "mock resolver failed");
  });

  it("retains only skill loader tools for skills agents when mock tools are active", async () => {
    const observedToolNames: string[][] = [];
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/eval-skill-mocks",
      async doGenerate(options: unknown) {
        const tools = (options as { tools?: Array<{ name?: string }> | Record<string, unknown> })
          .tools;
        observedToolNames.push(
          Array.isArray(tools)
            ? tools.map((entry) => entry.name ?? "").filter(Boolean).sort()
            : Object.keys(tools ?? {}).sort(),
        );
        return {
          content: [{ type: "text", text: "real answer" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };
    const agent = createAgent({
      id: "eval-skills-agent",
      model: "hosted/eval-skill-mocks",
      system: "Use skills.",
      skills: true,
      tools: {
        load_skill: makeEvalTool("load_skill"),
        load_skill_reference: makeEvalTool("load_skill_reference"),
        execute_skill_script: makeEvalTool("execute_skill_script"),
      },
      resolveModelTransport: async () => ({ model }),
    });
    const definition = evalAgent({
      id: "eval:skills-agent",
      target: "agent:assistant",
      dataset: datasets.inline([{ id: "q1", input: "Use skill" }]),
      mockTools: { search_docs: makeEvalTool("search_docs") },
    });

    await createAgentAdapter(agent, createEvalOptions())({
      definition,
      example: { id: "q1", input: "Use skill" },
      repetition: 1,
    });

    assertEquals(observedToolNames, [[
      "load_skill",
      "load_skill_reference",
      "search_docs",
    ]]);
  });

  it("uses default-enabled skills when retaining skill loader tools for mocked evals", async () => {
    const observedToolNames: string[][] = [];
    const model: ModelRuntime = {
      provider: "hosted",
      modelId: "hosted/eval-default-skills-mocks",
      async doGenerate(options: unknown) {
        const tools = (options as { tools?: Array<{ name?: string }> | Record<string, unknown> })
          .tools;
        observedToolNames.push(
          Array.isArray(tools)
            ? tools.map((entry) => entry.name ?? "").filter(Boolean).sort()
            : Object.keys(tools ?? {}).sort(),
        );
        return {
          content: [{ type: "text", text: "real answer" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };
    const definition = evalAgent({
      id: "eval:default-skills-agent",
      target: "agent:assistant",
      dataset: datasets.inline([{ id: "q1", input: "Use skill" }]),
      mockTools: { search_docs: makeEvalTool("search_docs") },
    });

    const defaultSkillsAgent = createAgent({
      id: "eval-default-skills-agent",
      model: "hosted/eval-default-skills-mocks",
      system: "Use skills.",
      tools: {
        load_skill: makeEvalTool("load_skill"),
        load_skill_reference: makeEvalTool("load_skill_reference"),
        execute_skill_script: makeEvalTool("execute_skill_script"),
      },
      resolveModelTransport: async () => ({ model }),
    });
    const disabledSkillsAgent = createAgent({
      id: "eval-disabled-skills-agent",
      model: "hosted/eval-default-skills-mocks",
      system: "Do not use skills.",
      skills: false,
      tools: {
        load_skill: makeEvalTool("load_skill"),
        load_skill_reference: makeEvalTool("load_skill_reference"),
        execute_skill_script: makeEvalTool("execute_skill_script"),
      },
      resolveModelTransport: async () => ({ model }),
    });

    await createAgentAdapter(defaultSkillsAgent, createEvalOptions())({
      definition,
      example: { id: "q1", input: "Use skill" },
      repetition: 1,
    });
    await createAgentAdapter(disabledSkillsAgent, createEvalOptions())({
      definition,
      example: { id: "q1", input: "Use skill" },
      repetition: 1,
    });

    assertEquals(observedToolNames, [
      ["load_skill", "load_skill_reference", "search_docs"],
      ["search_docs"],
    ]);
  });

  it("creates a CLI tool adapter for direct tool evals", async () => {
    const contexts: Array<Parameters<Tool["execute"]>[1]> = [];
    const tool = {
      id: "lookup_order",
      type: "function",
      description: "Lookup an order.",
      inputSchema: {} as Tool["inputSchema"],
      execute: async (input: unknown, context?: Parameters<Tool["execute"]>[1]) => {
        contexts.push(context);
        return {
          input,
          toolCallId: context?.toolCallId,
          runId: context?.runId,
          projectSlug: context?.projectSlug,
        };
      },
    } as Tool;

    const adapter = createToolAdapter(tool, { projectSlug: "support-app" });
    const result = await adapter({
      definition: {
        kind: "eval",
        targetKind: "tool",
        id: "eval:lookup-tool",
        name: "Lookup tool",
        target: "tool:lookup_order",
        dataset: {} as never,
        metrics: [],
        repetitions: 1,
        tags: [],
        metadata: {},
      },
      example: { id: "order-1", input: { orderId: "A1049" } },
      repetition: 1,
      runId: "evalrun_lookup",
      input: { orderId: "A1049" },
    });
    const nextResult = await adapter({
      definition: {
        kind: "eval",
        targetKind: "tool",
        id: "eval:lookup-tool",
        name: "Lookup tool",
        target: "tool:lookup_order",
        dataset: {} as never,
        metrics: [],
        repetitions: 1,
        tags: [],
        metadata: {},
      },
      example: { id: "order-1", input: { orderId: "A1049" } },
      repetition: 2,
      runId: "evalrun_lookup",
      input: { orderId: "A1049" },
    });

    assertEquals(result.completed, true);
    assertEquals(result.toolCallId, contexts[0]?.toolCallId);
    assertStringIncludes(result.toolCallId ?? "", "eval-lookup_order-order-1-1-");
    assertStringIncludes(nextResult.toolCallId ?? "", "eval-lookup_order-order-1-2-");
    assertEquals(result.toolCallId === nextResult.toolCallId, false);
    assertEquals(result.output, {
      input: { orderId: "A1049" },
      toolCallId: result.toolCallId,
      runId: "evalrun_lookup",
      projectSlug: "support-app",
    });
  });

  it("keeps evalTool execution independent from agent mockTools support", async () => {
    const directTool = makeEvalTool("lookup_order");
    const definition = evalTool({
      id: "eval:lookup-tool-regression",
      target: "tool:lookup_order",
      dataset: datasets.inline([{ id: "order-1", input: { query: "A1049" } }]),
    });

    const report = await runEval(definition, {
      adapters: { tool: createToolAdapter(directTool) },
    });

    assertEquals(report.records[0]?.completed, true);
    assertEquals(report.records[0]?.trace.toolCalls[0]?.name, "lookup_order");
    assertEquals(report.records[0]?.output, {
      source: "lookup_order",
      input: { query: "A1049" },
    });
  });

  it("keeps the exact source policy active while a tool eval executes", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-eval-policy-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-eval-policy-auth-" });
    const sourceIntegrationPolicy = normalizeSourceIntegrationPolicy({
      allow: { confluence: { allowedTools: ["search_content"] } },
    });
    const observedPolicies: Array<SourceIntegrationPolicyManifest | undefined> = [];
    const observePolicyTool = {
      id: "observe_policy",
      type: "function",
      description: "Observe the source policy during eval execution.",
      inputSchema: {} as Tool["inputSchema"],
      execute: async () => {
        await Promise.resolve();
        const policy = getActiveSourceIntegrationPolicy();
        observedPolicies.push(policy);
        return { policy };
      },
    } as Tool;
    const definition = evalTool({
      id: "eval:source-policy",
      target: "tool:observe_policy",
      dataset: [{ id: "policy", input: {} }],
    });
    definition.source = {
      filePath: `${projectDir}/evals/source-policy.eval.ts`,
      exportName: "default",
    };
    const runtime = createProjectRuntimeDiscovery(sourceIntegrationPolicy);
    runtime.tools.set(observePolicyTool.id, observePolicyTool);
    runtime.evals.set(definition.id, definition);

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_EVAL_EXPORT");
      Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
      Deno.env.set("XDG_CONFIG_HOME", configHome);

      const exitCode = await runEvalCommand(
        {
          id: "source-policy",
          list: false,
          exporters: [],
          debug: false,
          candidateModels: [],
          projectDir,
          reportDir: `${projectDir}/report`,
        },
        {
          discoverProjectAgentRuntime: () => Promise.resolve(runtime),
        },
      );

      assertEquals(exitCode, 0);
      assertEquals(observedPolicies, [sourceIntegrationPolicy]);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("runs every discovered eval sequentially and passes example metadata through agent context", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-eval-suite-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-eval-suite-auth-" });
    const contexts: unknown[] = [];
    const fixtureAgent = {
      id: "fixture",
      config: {},
      generate: async (input: { context?: unknown }) => {
        contexts.push(input.context);
        return {
          text: "expected",
          messages: [],
          status: "completed",
          toolCalls: [],
        } satisfies AgentResponse;
      },
    } as unknown as Agent;
    const alpha = evalAgent({
      id: "eval:alpha",
      target: "agent:fixture",
      dataset: [{
        id: "alpha-example",
        input: "alpha",
        metadata: { fixtureScenario: "alpha" },
      }],
      metrics: [metrics.answer.contains({ text: "expected" }).gate()],
    });
    const beta = evalAgent({
      id: "eval:beta",
      target: "agent:fixture",
      dataset: [{
        id: "beta-example",
        input: "beta",
        metadata: { fixtureScenario: "beta" },
      }],
      metrics: [metrics.answer.contains({ text: "missing" }).gate()],
    });
    alpha.source = { filePath: `${projectDir}/evals/alpha.eval.ts`, exportName: "default" };
    beta.source = { filePath: `${projectDir}/evals/beta.eval.ts`, exportName: "default" };
    const runtime = createProjectRuntimeDiscovery(normalizeSourceIntegrationPolicy({ allow: {} }));
    runtime.agents.set(fixtureAgent.id, fixtureAgent);
    runtime.evals.set(beta.id, beta);
    runtime.evals.set(alpha.id, alpha);

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_EVAL_EXPORT");
      Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
      Deno.env.set("XDG_CONFIG_HOME", configHome);

      const exitCode = await runEvalCommand(
        {
          list: false,
          exporters: [],
          debug: false,
          candidateModels: [],
          projectDir,
          reportDir: `${projectDir}/suite`,
          junit: `${projectDir}/suite/junit.xml`,
        },
        { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
      );

      assertEquals(exitCode, 1);
      assertEquals(contexts, [
        {
          eval: {
            definitionId: "eval:alpha",
            exampleId: "alpha-example",
            repetition: 1,
            metadata: { fixtureScenario: "alpha" },
          },
        },
        {
          eval: {
            definitionId: "eval:beta",
            exampleId: "beta-example",
            repetition: 1,
            metadata: { fixtureScenario: "beta" },
          },
        },
      ]);
      const summary = JSON.parse(await Deno.readTextFile(`${projectDir}/suite/summary.json`));
      assertEquals(summary.total, 2);
      assertEquals(summary.passed, 1);
      assertEquals(summary.failed, 1);
      assertEquals(summary.results.map((result: { id: string }) => result.id), [
        "eval:alpha",
        "eval:beta",
      ]);
      const results = (await Deno.readTextFile(`${projectDir}/suite/results.jsonl`))
        .trim()
        .split("\n")
        .map((line) => {
          const result = JSON.parse(line) as { id: string; status: string };
          return { id: result.id, status: result.status };
        });
      assertEquals(results, [
        { id: "eval:alpha", status: "passed" },
        { id: "eval:beta", status: "failed" },
      ]);
      const junit = await Deno.readTextFile(`${projectDir}/suite/junit.xml`);
      assertStringIncludes(
        junit,
        '<testsuites tests="2" failures="1" skipped="0">\n  <testsuite name="veryfront eval suite" tests="2" failures="1" skipped="0">',
      );
      assertStringIncludes(junit, '    <testcase classname="eval" name="eval:alpha" />');
      assertStringIncludes(junit, '    <testcase classname="eval" name="eval:beta">');
      assertEquals(
        await Deno.stat(`${projectDir}/suite/001-alpha/summary.json`).then(() => true),
        true,
      );
      assertEquals(
        await Deno.stat(`${projectDir}/suite/002-beta/summary.json`).then(() => true),
        true,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("describes each metric in prose, naming the tool it asserted on", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-eval-metric-labels-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-eval-metric-labels-auth-" });
    const fixtureAgent = {
      id: "fixture",
      config: {},
      generate: async () => ({
        text: "expected",
        messages: [],
        status: "completed",
        toolCalls: [],
      } satisfies AgentResponse),
    } as unknown as Agent;
    const labelled = evalAgent({
      id: "eval:labelled",
      name: "Assistant smoke test",
      target: "agent:fixture",
      dataset: [{ id: "only", input: "only" }],
      metrics: [
        metrics.agent.calledTool("calculator").gate(),
        metrics.agent.noFailedTools().gate(),
        metrics.answer.contains({ text: "expected" }).gate(),
      ],
    });
    labelled.source = { filePath: `${projectDir}/evals/labelled.eval.ts`, exportName: "default" };
    const runtime = createProjectRuntimeDiscovery(normalizeSourceIntegrationPolicy({ allow: {} }));
    runtime.agents.set(fixtureAgent.id, fixtureAgent);
    runtime.evals.set(labelled.id, labelled);

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_EVAL_EXPORT");
      Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
      Deno.env.set("XDG_CONFIG_HOME", configHome);

      const output = await captureConsoleOutput(async () => {
        await runEvalCommand(
          {
            id: "labelled",
            list: false,
            exporters: [],
            debug: false,
            candidateModels: [],
            projectDir,
            reportDir: `${projectDir}/report`,
          },
          { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
        );
      });

      // The definition name heads the block, not the generated eval id.
      assertEquals(relevantEvalHumanLines(output)[0], "Eval:   Assistant smoke test");
      assertEquals(evalMetricLines(output), [
        'Agent called tool "calculator": 0/1 passed (0%)',
        "Agent had no failed tool calls: 1/1 passed (100%)",
        'Answer contained "expected": 1/1 passed (100%)',
      ]);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("prints why a gated metric failed, without restating it as a record error", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-eval-reasons-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-eval-reasons-auth-" });
    const fixtureAgent = {
      id: "fixture",
      config: {},
      generate: async () => ({
        text: "The split is $33.2366 each.",
        messages: [],
        status: "completed",
        toolCalls: [],
      } satisfies AgentResponse),
    } as unknown as Agent;
    const failing = evalAgent({
      id: "eval:reasons",
      target: "agent:fixture",
      dataset: [{ id: "calculator", input: "split the bill" }],
      metrics: [
        metrics.judge.rubric({
          rubric: "Every amount must be exact to the cent.",
          judge: () =>
            Promise.resolve({
              score: 0.2,
              pass: false,
              explanation: "The answer states $33.2366, which is not exact to the cent.",
            }),
        }).gate({ min: 0.8 }),
      ],
    });
    failing.source = { filePath: `${projectDir}/evals/reasons.eval.ts`, exportName: "default" };
    const runtime = createProjectRuntimeDiscovery(normalizeSourceIntegrationPolicy({ allow: {} }));
    runtime.agents.set(fixtureAgent.id, fixtureAgent);
    runtime.evals.set(failing.id, failing);

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_EVAL_EXPORT");
      Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
      Deno.env.set("XDG_CONFIG_HOME", configHome);

      const output = await captureConsoleOutput(async () => {
        await runEvalCommand(
          {
            id: "reasons",
            list: false,
            exporters: [],
            debug: false,
            candidateModels: [],
            projectDir,
            reportDir: `${projectDir}/report`,
          },
          { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
        );
      });

      const printed = [...output.stdout].map((line) => stripAnsi(line));
      assertEquals(
        printed.some((line) =>
          line ===
            "    calculator: The answer states $33.2366, which is not exact to the cent."
        ),
        true,
      );
      // The runner flips `completed` off whenever a gate fails, so "Record did not complete."
      // would only restate the judge verdict above it.
      assertEquals(printed.some((line) => line.includes("Record did not complete")), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("keeps a record error that carries detail of its own", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-eval-adapter-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-eval-adapter-auth-" });
    const fixtureAgent = {
      id: "boom",
      config: {},
      generate: () => Promise.reject(new Error("upstream refused the connection")),
    } as unknown as Agent;
    const failing = evalAgent({
      id: "eval:adapter",
      target: "agent:boom",
      dataset: [{ id: "calculator", input: "split the bill" }],
      metrics: [metrics.agent.calledTool("calculator").gate()],
    });
    failing.source = { filePath: `${projectDir}/evals/adapter.eval.ts`, exportName: "default" };
    const runtime = createProjectRuntimeDiscovery(normalizeSourceIntegrationPolicy({ allow: {} }));
    runtime.agents.set(fixtureAgent.id, fixtureAgent);
    runtime.evals.set(failing.id, failing);

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_EVAL_EXPORT");
      Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
      Deno.env.set("XDG_CONFIG_HOME", configHome);

      const output = await captureConsoleOutput(async () => {
        await runEvalCommand(
          {
            id: "adapter",
            list: false,
            exporters: [],
            debug: false,
            candidateModels: [],
            projectDir,
            reportDir: `${projectDir}/report`,
          },
          { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
        );
      });

      // The gate fails too, so the record error is suppressed by the recordId rule alone.
      // Its text is the only report of why the agent never answered, so it has to survive.
      const printed = [...output.stdout].map((line) => stripAnsi(line));
      assertEquals(
        printed.some((line) => line.includes("upstream refused the connection")),
        true,
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("prints no report output under --quiet", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-eval-quiet-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-eval-quiet-auth-" });
    const fixtureAgent = {
      id: "fixture",
      config: {},
      generate: async () => ({
        text: "expected",
        messages: [],
        status: "completed",
        toolCalls: [],
      } satisfies AgentResponse),
    } as unknown as Agent;
    const quiet = evalAgent({
      id: "eval:quiet",
      target: "agent:fixture",
      dataset: [{ id: "only", input: "only" }],
      metrics: [metrics.answer.contains({ text: "expected" }).gate()],
    });
    quiet.source = { filePath: `${projectDir}/evals/quiet.eval.ts`, exportName: "default" };
    const runtime = createProjectRuntimeDiscovery(normalizeSourceIntegrationPolicy({ allow: {} }));
    runtime.agents.set(fixtureAgent.id, fixtureAgent);
    runtime.evals.set(quiet.id, quiet);

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_EVAL_EXPORT");
      Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      setQuietMode(true);

      const output = await captureConsoleOutput(async () => {
        await runEvalCommand(
          {
            id: "quiet",
            list: false,
            exporters: [],
            debug: false,
            candidateModels: [],
            projectDir,
            reportDir: `${projectDir}/report`,
          },
          { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
        );
      });

      assertEquals(relevantEvalHumanLines(output), []);
      assertEquals(evalMetricLines(output), []);
    } finally {
      setQuietMode(false);
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("prints single, suite, and comparison eval output in CLI-owned order", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-eval-output-order-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-eval-output-order-auth-" });
    const fixtureAgent = {
      id: "fixture",
      config: {},
      generate: async () => ({
        text: "expected",
        messages: [],
        status: "completed",
        toolCalls: [],
      } satisfies AgentResponse),
    } as unknown as Agent;
    const single = evalAgent({
      id: "eval:single-output",
      target: "agent:fixture",
      dataset: [{ id: "single", input: "single" }],
    });
    const suite = evalAgent({
      id: "eval:suite-output",
      target: "agent:fixture",
      dataset: [{ id: "suite", input: "suite" }],
    });
    single.source = { filePath: `${projectDir}/evals/single.eval.ts`, exportName: "default" };
    suite.source = { filePath: `${projectDir}/evals/suite.eval.ts`, exportName: "default" };
    const runtime = createProjectRuntimeDiscovery(normalizeSourceIntegrationPolicy({ allow: {} }));
    runtime.agents.set(fixtureAgent.id, fixtureAgent);
    runtime.evals.set(single.id, single);
    runtime.evals.set(suite.id, suite);

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_EVAL_EXPORT");
      Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
      Deno.env.set("XDG_CONFIG_HOME", configHome);

      const singleOutput = await captureConsoleOutput(async () => {
        const exitCode = await runEvalCommand(
          {
            id: "single-output",
            list: false,
            exporters: [],
            debug: false,
            candidateModels: [],
            projectDir,
            reportDir: `${projectDir}/single`,
            report: `${projectDir}/single/report.json`,
            junit: `${projectDir}/single/junit.xml`,
            writeBaseline: `${projectDir}/single/baseline.json`,
          },
          { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
        );
        assertEquals(exitCode, 0);
      });
      assertEquals(relevantEvalHumanLines(singleOutput), [
        "Eval:   eval:single-output",
        "Target: agent:fixture",
        "Result: 1/1 passed (100%)",
        `Report: ${projectDir}/single/report.md`,
        `Report JSON: ${projectDir}/single/report.json`,
        `JUnit: ${projectDir}/single/junit.xml`,
        `Baseline written: ${projectDir}/single/baseline.json`,
      ]);

      const suiteOutput = await captureConsoleOutput(async () => {
        const exitCode = await runEvalCommand(
          {
            list: false,
            exporters: [],
            debug: false,
            candidateModels: [],
            projectDir,
            reportDir: `${projectDir}/suite`,
            junit: `${projectDir}/suite/junit.xml`,
          },
          { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
        );
        assertEquals(typeof exitCode, "number");
      });
      assertEquals(relevantEvalHumanLines(suiteOutput), [
        "Eval:   eval:single-output",
        "Target: agent:fixture",
        "Result: 1/1 passed (100%)",
        "Eval:   eval:suite-output",
        "Target: agent:fixture",
        "Result: 1/1 passed (100%)",
        "Eval suite: 2/2 passed",
        `Report: ${projectDir}/suite/report.md`,
        `JUnit: ${projectDir}/suite/junit.xml`,
      ]);

      const comparisonOutput = await captureConsoleOutput(async () => {
        const exitCode = await runEvalCommand(
          {
            id: "single-output",
            list: false,
            exporters: [],
            debug: false,
            baselineModel: "test/baseline",
            candidateModels: ["test/candidate"],
            projectDir,
            reportDir: `${projectDir}/comparison`,
            report: `${projectDir}/comparison/report.json`,
          },
          { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
        );
        assertEquals(exitCode, 0);
      });
      const comparisonLines = relevantEvalHumanLines(comparisonOutput);
      assertEquals(comparisonLines.slice(0, 8), [
        "Model:  test/baseline",
        "Eval:   eval:single-output",
        "Target: agent:fixture",
        "Result: 1/1 passed (100%)",
        "Model:  test/candidate",
        "Eval:   eval:single-output",
        "Target: agent:fixture",
        "Result: 1/1 passed (100%)",
      ]);
      assertStringIncludes(comparisonLines[8] ?? "", "Recommendation: ");
      assertEquals(comparisonLines.slice(9, 11), [
        "  - candidate has no quality regressions",
        "  - groundedness was not measured",
      ]);
      assertStringIncludes(comparisonLines[11] ?? "", "  - ");
      assertEquals(comparisonLines.slice(12), [
        `Comparison: ${projectDir}/comparison/comparison.json`,
        `Comparison markdown: ${projectDir}/comparison/comparison.md`,
        `Report JSON: ${projectDir}/comparison/report.json`,
      ]);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("keeps eval JSON envelope data keys stable for single, suite, and comparison modes", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-eval-json-keys-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-eval-json-keys-auth-" });
    const fixtureAgent = {
      id: "fixture",
      config: {},
      generate: async () => ({
        text: "expected",
        messages: [],
        status: "completed",
        toolCalls: [],
      } satisfies AgentResponse),
    } as unknown as Agent;
    const single = evalAgent({
      id: "eval:json-single",
      target: "agent:fixture",
      dataset: [{ id: "single", input: "single" }],
    });
    const suite = evalAgent({
      id: "eval:json-suite",
      target: "agent:fixture",
      dataset: [{ id: "suite", input: "suite" }],
    });
    single.source = { filePath: `${projectDir}/evals/json-single.eval.ts`, exportName: "default" };
    suite.source = { filePath: `${projectDir}/evals/json-suite.eval.ts`, exportName: "default" };
    const runtime = createProjectRuntimeDiscovery(normalizeSourceIntegrationPolicy({ allow: {} }));
    runtime.agents.set(fixtureAgent.id, fixtureAgent);
    runtime.evals.set(single.id, single);
    runtime.evals.set(suite.id, suite);
    const baseline = {
      ...createReport(),
      definitionId: single.id,
      target: single.target,
      targetKind: single.targetKind,
    };

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_EVAL_EXPORT");
      Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      await Deno.writeTextFile(`${projectDir}/baseline.json`, JSON.stringify(baseline));
      setJsonMode(true);

      const singleOutput = await captureConsoleOutput(async () => {
        const exitCode = await runEvalCommand(
          {
            id: "json-single",
            list: false,
            exporters: [],
            debug: false,
            candidateModels: [],
            projectDir,
            reportDir: `${projectDir}/single-json`,
            baseline: `${projectDir}/baseline.json`,
          },
          { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
        );
        assertEquals(typeof exitCode, "number");
      });
      assertEquals(Object.keys(parseLastJsonEnvelope(singleOutput).data), [
        "report",
        "summary",
        "baseline",
        "artifacts",
      ]);

      const suiteOutput = await captureConsoleOutput(async () => {
        const exitCode = await runEvalCommand(
          {
            list: false,
            exporters: [],
            debug: false,
            candidateModels: [],
            projectDir,
            reportDir: `${projectDir}/suite-json`,
          },
          { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
        );
        assertEquals(exitCode, 0);
      });
      assertEquals(Object.keys(parseLastJsonEnvelope(suiteOutput).data), [
        "suite",
        "artifacts",
      ]);

      const comparisonOutput = await captureConsoleOutput(async () => {
        const exitCode = await runEvalCommand(
          {
            id: "json-single",
            list: false,
            exporters: [],
            debug: false,
            baselineModel: "test/baseline",
            candidateModels: ["test/candidate"],
            projectDir,
            reportDir: `${projectDir}/comparison-json`,
          },
          { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
        );
        assertEquals(exitCode, 0);
      });
      assertEquals(Object.keys(parseLastJsonEnvelope(comparisonOutput).data), [
        "reports",
        "comparison",
        "artifacts",
      ]);
    } finally {
      setJsonMode(false);
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("runs a dataset eval without resolving an agent or tool target", async () => {
    const projectDir = await makeTempDir({ prefix: "vf-eval-dataset-cli-" });
    const configHome = await makeTempDir({ prefix: "vf-eval-dataset-cli-auth-" });
    const definition = evalDataset({
      id: "eval:dataset-standing",
      dataset: [{ id: "case-1", input: "Standing text.", reference: "pass" }],
    });
    definition.source = {
      filePath: `${projectDir}/evals/dataset-standing.eval.ts`,
      exportName: "default",
    };
    const runtime = createProjectRuntimeDiscovery(normalizeSourceIntegrationPolicy({ allow: {} }));
    runtime.evals.set(definition.id, definition);

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_EVAL_EXPORT");
      Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
      Deno.env.set("XDG_CONFIG_HOME", configHome);

      const singleOutput = await captureConsoleOutput(async () => {
        const exitCode = await runEvalCommand(
          {
            id: "dataset-standing",
            list: false,
            exporters: [],
            debug: false,
            candidateModels: [],
            projectDir,
            reportDir: `${projectDir}/single`,
          },
          { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
        );
        assertEquals(exitCode, 0);
      });
      assertStringIncludes(
        relevantEvalHumanLines(singleOutput).join("\n"),
        "Eval id: eval:dataset-standing",
      );
      assertStringIncludes(
        relevantEvalHumanLines(singleOutput).join("\n"),
        "Result:  1/1 passed (100%)",
      );

      const suiteOutput = await captureConsoleOutput(async () => {
        const exitCode = await runEvalCommand(
          {
            list: false,
            exporters: [],
            debug: false,
            candidateModels: [],
            projectDir,
            reportDir: `${projectDir}/suite`,
          },
          { discoverProjectAgentRuntime: () => Promise.resolve(runtime) },
        );
        assertEquals(exitCode, 0);
      });
      assertStringIncludes(
        relevantEvalHumanLines(suiteOutput).join("\n"),
        "Eval suite: 1/1 passed",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("keeps the exact source policy active across every model comparison run", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-eval-model-policy-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-eval-model-policy-auth-" });
    const sourceIntegrationPolicy = normalizeSourceIntegrationPolicy({
      allow: { github: { allowedTools: ["list_repos"] } },
    });
    const observations: Array<{
      model: string | undefined;
      policy: SourceIntegrationPolicyManifest | undefined;
    }> = [];
    const observePolicyAgent = {
      id: "observe_policy",
      config: {},
      generate: async (input: { model?: string }) => {
        await Promise.resolve();
        observations.push({
          model: input.model,
          policy: getActiveSourceIntegrationPolicy(),
        });
        return {
          text: "ok",
          messages: [],
          status: "completed",
          toolCalls: [],
        } satisfies AgentResponse;
      },
    } as unknown as Agent;
    const definition = evalAgent({
      id: "eval:model-source-policy",
      target: "agent:observe_policy",
      dataset: [{ id: "policy", input: "observe" }],
    });
    definition.source = {
      filePath: `${projectDir}/evals/model-source-policy.eval.ts`,
      exportName: "default",
    };
    const runtime = createProjectRuntimeDiscovery(sourceIntegrationPolicy);
    runtime.agents.set(observePolicyAgent.id, observePolicyAgent);
    runtime.evals.set(definition.id, definition);

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_EVAL_EXPORT");
      Deno.env.delete("VERYFRONT_EVAL_EXPORTERS");
      Deno.env.set("XDG_CONFIG_HOME", configHome);

      const exitCode = await runEvalCommand(
        {
          id: "model-source-policy",
          list: false,
          exporters: [],
          debug: false,
          baselineModel: "test/baseline",
          candidateModels: ["test/candidate"],
          projectDir,
          reportDir: `${projectDir}/report`,
        },
        {
          discoverProjectAgentRuntime: () => Promise.resolve(runtime),
        },
      );

      assertEquals(exitCode, 0);
      assertEquals(observations, [
        { model: "test/baseline", policy: sourceIntegrationPolicy },
        { model: "test/candidate", policy: sourceIntegrationPolicy },
      ]);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("marks CLI tool adapter error-marker outputs as failed", async () => {
    const tool = {
      id: "lookup_order",
      type: "function",
      description: "Lookup an order.",
      inputSchema: {} as Tool["inputSchema"],
      execute: async () => ({ error: "Rate limited" }),
    } as Tool;

    const result = await createToolAdapter(tool)({
      definition: {
        kind: "eval",
        targetKind: "tool",
        id: "eval:lookup-tool",
        name: "Lookup tool",
        target: "tool:lookup_order",
        dataset: {} as never,
        metrics: [],
        repetitions: 1,
        tags: [],
        metadata: {},
      },
      example: { id: "order-1", input: { orderId: "A1049" } },
      repetition: 1,
      runId: "evalrun_lookup",
      input: { orderId: "A1049" },
    });

    assertEquals(result.completed, false);
    assertEquals(result.error, "Rate limited");
    assertEquals(result.output, { error: "Rate limited" });
  });

  it("hydrates runtime auth from the stored login token and eval project config", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-eval-command-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-eval-auth-" });

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("VERYFRONT_SERVICE_LAYER");
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      await saveToken("stored-token");

      await hydrateEvalRuntimeAuth(projectDir, {
        projectSlug: "configured-eval-project",
      });

      // The stored login token never enters the process environment.
      assertEquals(Deno.env.get("VERYFRONT_API_TOKEN"), undefined);
      assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), "stored-token");
      assertEquals(Deno.env.get("VERYFRONT_PROJECT_SLUG"), "configured-eval-project");
      assertEquals(Deno.env.get("VERYFRONT_SERVICE_LAYER"), "cloud");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("keeps the stored login token out of the project tool execution context", async () => {
    // `createToolAdapter` passes this context straight to a project-defined
    // `tool.execute()`. The stored login token is host-private so project code
    // cannot read it; surfacing it here would hand it back.
    const projectDir = await makeTempDir({ prefix: "vf-eval-command-" });
    const configHome = await makeTempDir({ prefix: "vf-eval-auth-" });

    try {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      await saveToken("stored-token");
      await hydrateEvalRuntimeAuth(projectDir, { projectSlug: "eval-project" });

      assertEquals(getHostEnv("VERYFRONT_API_TOKEN"), "stored-token");
      const context = createEvalToolExecutionContext({ projectSlug: "eval-project" });
      assertEquals("authToken" in context, false);
      assertEquals(context.projectSlug, "eval-project");

      // An explicitly exported token is already readable from `Deno.env` by the
      // same project code, so it still reaches the context.
      Deno.env.set("VERYFRONT_API_TOKEN", "exported-token");
      assertEquals(
        createEvalToolExecutionContext({ projectSlug: "eval-project" }).authToken,
        "exported-token",
      );
    } finally {
      Deno.env.delete("VERYFRONT_API_TOKEN");
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("applies gateway billing group finalization to eval summary usage", () => {
    const report = createReport();

    const finalized = applyGatewayBillingGroupFinalization(report, {
      billing_group_id: "evalrun_test_anthropic__claude-sonnet-4-6",
      charged_credits: 16,
      target_credits: 1,
      adjustment_credits: 15,
      provider_cost_usd: 0.02465,
      veryfront_charge_usd: 0.07395,
      veryfront_billed_usd: 0.1,
    });

    assertEquals(finalized.summary.usage, {
      ...report.summary.usage,
      providerCostUsd: 0.02465,
      veryfrontChargeUsd: 0.07395,
      veryfrontBilledUsd: 0.1,
      costCredits: 1,
      costSource: "gateway",
      billingMode: "direct",
      usageCaptureStatus: "complete",
    });
  });

  it("finalizes a gateway billing group when an eval throws after gateway usage", async () => {
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_BASE_URL", "https://api.test");
    const requests: Request[] = [];
    installMockFetch((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            billing_group_id: "evalrun_test_model",
            already_finalized: false,
            request_count: 1,
            charged_credits: 4,
            target_credits: 1,
            adjustment_credits: 3,
            adjustment: "refund",
            provider_cost_usd: 0.01,
            veryfront_charge_usd: 0.03,
            veryfront_billed_usd: 0.4,
            usage_capture_status: "complete",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    });
    let ambientFetchCalled = false;
    globalThis.fetch = () => {
      ambientFetchCalled = true;
      return Promise.reject(new Error("project fetch must not receive host billing auth"));
    };

    await assertRejects(
      () =>
        runEvalWithGatewayBillingGroup("evalrun_test_model", async () => {
          markCurrentVeryfrontCloudBillingGroupUsed();
          throw new Error("custom metric failed");
        }),
      Error,
      "custom metric failed",
    );

    assertEquals(requests.length, 1);
    const request = requests[0];
    if (!request) throw new Error("Expected billing finalization request.");
    assertEquals(request.url, "https://api.test/ai/gateway/billing/finalize");
    assertEquals(request.headers.get("Authorization"), "Bearer test-token");
    assertEquals(await request.json(), { billing_group_id: "evalrun_test_model" });
    assertEquals(ambientFetchCalled, false);
  });

  it("retries gateway billing finalization while usage capture is not ready", async () => {
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_BASE_URL", "https://api.test");
    const requests: Request[] = [];
    const sleeps: number[] = [];
    installMockFetch((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (requests.length === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: "Gateway billing group usage is not ready to finalize",
              code: "gateway_billing_group_usage_not_ready",
            }),
            {
              status: 409,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            billing_group_id: "evalrun_test_model",
            already_finalized: false,
            request_count: 1,
            charged_credits: 4,
            target_credits: 1,
            adjustment_credits: 3,
            adjustment: "refund",
            provider_cost_usd: 0.01,
            veryfront_charge_usd: 0.03,
            veryfront_billed_usd: 0.4,
            usage_capture_status: "complete",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    });

    const finalization = await finalizeGatewayBillingGroup("evalrun_test_model", {
      retryDelaysMs: [25],
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    assertEquals(requests.length, 2);
    assertEquals(sleeps, [25]);
    assertEquals(finalization?.target_credits, 1);
    assertEquals(finalization?.veryfront_billed_usd, 0.4);
  });

  it("retries default gateway billing finalization long enough for delayed usage capture", async () => {
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_BASE_URL", "https://api.test");
    const requests: Request[] = [];
    const sleeps: number[] = [];
    installMockFetch((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (requests.length <= 6) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: "Gateway billing group usage is not ready to finalize",
              code: "gateway_billing_group_usage_not_ready",
            }),
            {
              status: 409,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            billing_group_id: "evalrun_test_model",
            already_finalized: false,
            request_count: 1,
            charged_credits: 4,
            target_credits: 1,
            adjustment_credits: 3,
            adjustment: "refund",
            provider_cost_usd: 0.01,
            veryfront_charge_usd: 0.03,
            veryfront_billed_usd: 0.4,
            usage_capture_status: "complete",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    });

    const finalization = await finalizeGatewayBillingGroup("evalrun_test_model", {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    assertEquals(requests.length, 7);
    assertEquals(sleeps.length, 6);
    assertEquals(finalization?.target_credits, 1);
    assertEquals(finalization?.veryfront_billed_usd, 0.4);
  });

  it("exports CLI eval reports after gateway billing finalization", async () => {
    const registry = createEvalReportExporterRegistry();
    const finalized = applyGatewayBillingGroupFinalization(createReport(), {
      billing_group_id: "evalrun_test_model",
      charged_credits: 4,
      target_credits: 1,
      adjustment_credits: 3,
      provider_cost_usd: 0.02465,
      veryfront_charge_usd: 0.07395,
      veryfront_billed_usd: 0.4,
    });
    let exportedUsage: EvalReport["summary"]["usage"] | undefined;

    registry.register({
      id: "capture",
      export(report) {
        exportedUsage = report.summary.usage;
        return { externalRunId: report.runId };
      },
    });

    const exported = await exportEvalReportForCli(finalized, {
      registry,
      exporterIds: ["capture"],
    });

    assertEquals(exportedUsage, finalized.summary.usage);
    assertEquals(exported.exports, [
      {
        exporterId: "capture",
        ok: true,
        receipt: { externalRunId: finalized.runId },
      },
    ]);
  });

  it("reports unknown CLI eval exporters as failed export results", async () => {
    const exported = await exportEvalReportForCli(createReport(), {
      registry: createEvalReportExporterRegistry(),
      exporterIds: ["missing"],
    });

    assertEquals(exported.exports, [
      {
        exporterId: "missing",
        ok: false,
        error: 'No EvalReportExporter registered for "missing".',
      },
    ]);
  });

  it("loads model comparison policy files relative to the project directory", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(`${projectDir}/evals`);
      await Deno.writeTextFile(
        `${projectDir}/evals/model-comparison.policy.json`,
        JSON.stringify({
          constraints: {
            p95Ms: { maxRegressionPct: 0.5 },
          },
          objectives: {
            totalTokens: { weight: 0.8, direction: "minimize" },
            p95Ms: { weight: 0.2, direction: "minimize" },
          },
        }),
      );

      const policy = await loadEvalModelComparisonPolicy(
        projectDir,
        "evals/model-comparison.policy.json",
      );

      assertEquals(policy, {
        constraints: {
          p95Ms: { maxRegressionPct: 0.5 },
        },
        objectives: {
          totalTokens: { weight: 0.8, direction: "minimize" },
          p95Ms: { weight: 0.2, direction: "minimize" },
        },
      });
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects invalid model comparison policy objective weights", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        `${projectDir}/policy.json`,
        JSON.stringify({
          objectives: {
            totalTokens: { weight: 0, direction: "minimize" },
          },
        }),
      );

      const error = await assertRejects(() =>
        loadEvalModelComparisonPolicy(projectDir, "policy.json")
      );
      assertStringIncludes(
        error instanceof Error ? error.message : String(error),
        "objectives.totalTokens.weight must be greater than 0",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("reports missing model comparison policy files as usage errors", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      const error = await assertRejects(
        () => loadEvalModelComparisonPolicy(projectDir, "missing-policy.json"),
        VeryfrontError,
        "Invalid --comparison-policy: file not found.",
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "invalid-argument");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects every malformed comparison policy shape as an invalid-argument usage error", async () => {
    const cases: Array<[string, string]> = [
      ["[]", "Invalid --comparison-policy: root value must be an object."],
      [
        JSON.stringify({ minGroundedness: "high" }),
        "Invalid --comparison-policy: root.minGroundedness must be a finite number.",
      ],
      [
        JSON.stringify({ constraints: "latency" }),
        "Invalid --comparison-policy: constraints must be an object.",
      ],
      [
        JSON.stringify({ constraints: { bogus: {} } }),
        'Invalid --comparison-policy: constraints.bogus uses unknown metric "bogus".',
      ],
      [
        JSON.stringify({ constraints: { p95Ms: 5 } }),
        "Invalid --comparison-policy: constraints.p95Ms must be an object.",
      ],
      [
        JSON.stringify({ constraints: { p95Ms: { min: "fast" } } }),
        "Invalid --comparison-policy: constraints.p95Ms.min must be a finite number.",
      ],
      [
        JSON.stringify({ constraints: { p95Ms: { maxRegressionPct: -1 } } }),
        "Invalid --comparison-policy: constraints.p95Ms.maxRegressionPct must be at least 0.",
      ],
      [
        JSON.stringify({ objectives: "latency" }),
        "Invalid --comparison-policy: objectives must be an object.",
      ],
      [
        JSON.stringify({ objectives: { p95Ms: 5 } }),
        "Invalid --comparison-policy: objectives.p95Ms must be an object.",
      ],
      [
        JSON.stringify({ objectives: { p95Ms: { direction: "minimize" } } }),
        "Invalid --comparison-policy: objectives.p95Ms.weight is required.",
      ],
      [
        JSON.stringify({ objectives: { p95Ms: { weight: 0, direction: "minimize" } } }),
        "Invalid --comparison-policy: objectives.p95Ms.weight must be greater than 0.",
      ],
      [
        JSON.stringify({ objectives: { p95Ms: { weight: 1, direction: "sideways" } } }),
        'Invalid --comparison-policy: objectives.p95Ms.direction must be "minimize" or "maximize".',
      ],
    ];

    await withTempDir(async (projectDir) => {
      for (const [payload, expectedDetail] of cases) {
        await Deno.writeTextFile(`${projectDir}/policy.json`, payload);
        const error = await assertRejects(
          () => loadEvalModelComparisonPolicy(projectDir, "policy.json"),
          VeryfrontError,
          expectedDetail,
        );
        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.slug, "invalid-argument");
        assertEquals(error.message, expectedDetail);
      }
    }, { prefix: "vf-eval-policy-shapes-" });
  });

  it("reports malformed model comparison policy JSON as a usage error", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(`${projectDir}/policy.json`, "{not-json");

      const error = await assertRejects(
        () => loadEvalModelComparisonPolicy(projectDir, "policy.json"),
        VeryfrontError,
        "Invalid --comparison-policy: file must contain valid JSON.",
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "invalid-argument");
      assertEquals(
        error.message,
        "Invalid --comparison-policy: file must contain valid JSON.",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("validates model comparison policy while preparing the comparison config", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        `${projectDir}/policy.json`,
        JSON.stringify({
          objectives: {
            totalTokens: { weight: 0, direction: "minimize" },
          },
        }),
      );

      const error = await assertRejects(() =>
        createResolvedEvalModelComparisonConfig(projectDir, {
          ...parseEvalArgs({
            _: ["eval", "support"],
            "baseline-model": "openai/gpt-5.2",
            "candidate-model": "moonshotai/kimi-k2.6",
            "comparison-policy": "policy.json",
          }).data!,
        })
      );
      assertStringIncludes(
        error instanceof Error ? error.message : String(error),
        "objectives.totalTokens.weight must be greater than 0",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

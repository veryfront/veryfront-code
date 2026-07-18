import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { Agent, AgentResponse } from "veryfront/agent";
import {
  compareEvalReports,
  type DiscoveredEval,
  EVAL_REPORT_SCHEMA_VERSION,
  evalAgent,
  type EvalReport,
  evalTool,
} from "veryfront/eval";
import { createEvalReportExporterRegistry } from "veryfront/extensions/eval";
import { markCurrentVeryfrontCloudBillingGroupUsed } from "veryfront/provider";
import type { Tool } from "veryfront/tool";
import type { ProjectAgentRuntimeDiscovery } from "../../../src/agent/project/agent-runtime.ts";
import { getActiveSourceIntegrationPolicy } from "../../../src/integrations/source-policy-context.ts";
import {
  normalizeSourceIntegrationPolicy,
  type SourceIntegrationPolicyManifest,
} from "../../../src/integrations/source-policy.ts";
import { saveToken } from "../../auth/token-store.ts";
import {
  applyGatewayBillingGroupFinalization,
  createDefaultEvalReportDir,
  createEvalArtifactPaths,
  createEvalCliExportConfig,
  createEvalExitCode,
  createEvalMarkdownReport,
  createEvalModelArtifactPaths,
  createEvalModelComparisonArtifact,
  createEvalModelComparisonExitCode,
  createJunitXml,
  createResolvedEvalModelComparisonConfig,
  createResultsJsonl,
  createSummaryArtifact,
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
  resolveToolTargetId,
  runEvalCommand,
  runEvalWithGatewayBillingGroup,
  summarizeReportForCli,
  writeEvalArtifacts,
} from "./command.ts";
import { parseEvalArgs } from "./handler.ts";

const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
const originalXdgConfigHome = Deno.env.get("XDG_CONFIG_HOME");
const originalEvalExport = Deno.env.get("VERYFRONT_EVAL_EXPORT");
const originalEvalExporters = Deno.env.get("VERYFRONT_EVAL_EXPORTERS");
const originalFetch = globalThis.fetch;
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

  for (const name of redactionEnvNames) {
    const original = originalRedactionEnv[name];
    if (original === undefined) {
      Deno.env.delete(name);
    } else {
      Deno.env.set(name, original);
    }
  }

  globalThis.fetch = originalFetch;
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

describe("eval CLI command helpers", () => {
  afterEach(() => {
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

  it("keeps eval export redaction safe by default", () => {
    for (const name of redactionEnvNames) Deno.env.delete(name);

    assertEquals(resolveEvalExportRedactionFromEnv(), {});
  });

  it("threads the runtime project slug into eval export context", () => {
    const registry = createEvalReportExporterRegistry();
    const config = createEvalCliExportConfig(
      {
        id: "eval:answers",
        filePath: "/repo/evals/answers.eval.ts",
        exportName: "default",
        definition: {
          id: "eval:answers",
          target: "agent:assistant",
          targetKind: "agent",
          dataset: { kind: "inline", examples: [] },
          metrics: [],
        },
      } as unknown as DiscoveredEval,
      { exporters: ["mlflow"] } as EvalOptions,
      "/repo",
      createEvalArtifactPaths("/tmp/report"),
      registry,
      { projectSlug: "customer-support-agent" },
    );

    assertEquals(config?.context?.projectReference, "customer-support-agent");
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
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      await saveToken("stored-token");

      await hydrateEvalRuntimeAuth(projectDir, {
        projectSlug: "configured-eval-project",
      });

      assertEquals(Deno.env.get("VERYFRONT_API_TOKEN"), "stored-token");
      assertEquals(Deno.env.get("VERYFRONT_PROJECT_SLUG"), "configured-eval-project");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(configHome, { recursive: true });
    }
  });

  it("summarizes reports for JSON and human CLI output", () => {
    assertEquals(summarizeReportForCli(createReport()), {
      runId: "evalrun_test",
      evalId: "eval:answers",
      target: "agent:assistant",
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
    });
  });

  it("creates default eval artifact paths", () => {
    assertEquals(
      createDefaultEvalReportDir("evalrun_20260621_010203000"),
      [
        ".veryfront",
        "evals",
        "20260621_010203000",
      ].join("/"),
    );
    assertEquals(
      createDefaultEvalReportDir("evalrun_20260621_010203000", "eval:support-triage"),
      [
        ".veryfront",
        "evals",
        "20260621_010203000-support-triage",
      ].join("/"),
    );
    assertEquals(createEvalArtifactPaths(".veryfront/evals/run-1"), {
      directory: ".veryfront/evals/run-1",
      summary: ".veryfront/evals/run-1/summary.json",
      results: ".veryfront/evals/run-1/results.jsonl",
      reportMarkdown: ".veryfront/evals/run-1/report.md",
    });
    assertEquals(
      createEvalModelArtifactPaths(".veryfront/evals/run-1", "anthropic/claude-opus-4-6"),
      {
        directory: ".veryfront/evals/run-1/models/anthropic__claude-opus-4-6",
        summary: ".veryfront/evals/run-1/models/anthropic__claude-opus-4-6/summary.json",
        results: ".veryfront/evals/run-1/models/anthropic__claude-opus-4-6/results.jsonl",
        reportMarkdown: ".veryfront/evals/run-1/models/anthropic__claude-opus-4-6/report.md",
        junit: ".veryfront/evals/run-1/models/anthropic__claude-opus-4-6/junit.xml",
      },
    );
  });

  it("serializes eval summary and record artifacts", () => {
    const report = createReport();
    const baseline = compareEvalReports(report, {
      ...report,
      runId: "evalrun_baseline",
      summary: {
        ...report.summary,
        passed: 2,
        failed: 0,
        passRate: 1,
        failedExamples: [],
      },
    });

    assertEquals(createSummaryArtifact(report, baseline), {
      kind: "eval-summary",
      schemaVersion: EVAL_REPORT_SCHEMA_VERSION,
      runId: "evalrun_test",
      definitionId: "eval:answers",
      targetKind: "agent",
      target: "agent:assistant",
      dataset: report.dataset,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      summary: report.summary,
      baseline,
    });

    const lines = createResultsJsonl(report).trimEnd().split("\n").map((line) =>
      JSON.parse(line) as { id: string }
    );
    assertEquals(lines.map((record) => record.id), ["q1:1", "q2:1"]);
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
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
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
  });

  it("retries gateway billing finalization while usage capture is not ready", async () => {
    Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
    Deno.env.set("VERYFRONT_API_BASE_URL", "https://api.test");
    const requests: Request[] = [];
    const sleeps: number[] = [];
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
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
    };

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
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
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
    };

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

  it("keeps local eval artifacts writable when selected exporters fail unexpectedly", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const report = createReport();
      const exported = await exportEvalReportForCli(report, {
        exporterIds: ["braintrust", "langfuse"],
        registry: {
          register() {},
          unregister() {},
          get() {
            throw new Error("gateway registry crashed");
          },
          require() {
            throw new Error("not implemented");
          },
          list() {
            return [];
          },
          has() {
            return false;
          },
          export() {
            throw new Error("not implemented");
          },
        },
      });
      const paths = createEvalArtifactPaths(`${tempDir}/eval-report`);

      await writeEvalArtifacts(exported, paths);
      await Deno.writeTextFile(`${tempDir}/junit.xml`, createJunitXml(exported));

      const summary = JSON.parse(await Deno.readTextFile(paths.summary)) as {
        exports?: Array<{ exporterId: string; ok: boolean; error?: string }>;
      };
      const junit = await Deno.readTextFile(`${tempDir}/junit.xml`);

      assertEquals(exported.exports, [
        {
          exporterId: "braintrust",
          ok: false,
          error: "gateway registry crashed",
        },
        {
          exporterId: "langfuse",
          ok: false,
          error: "gateway registry crashed",
        },
      ]);
      assertEquals(summary.exports, exported.exports);
      assertStringIncludes(junit, '<testsuite name="eval:answers"');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
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

  it("renders a markdown eval report", () => {
    const markdown = createEvalMarkdownReport(createReport());

    assertStringIncludes(markdown, "# Eval report: eval:answers");
    assertStringIncludes(markdown, "Result: `1/2 passed (50%)`");
    assertStringIncludes(markdown, "| Provider input cost USD | `$0.0004` |");
    assertStringIncludes(markdown, "| Provider output cost USD | `$0.0006` |");
    assertStringIncludes(markdown, "| Veryfront input charge USD | `$0.001` |");
    assertStringIncludes(markdown, "| Veryfront output charge USD | `$0.0015` |");
    assertStringIncludes(markdown, "| Veryfront billed USD | `$0.10` |");
    assertStringIncludes(markdown, "| Billing mode | deferred |");
    assertStringIncludes(markdown, "| `q1:1` | PASS | 0.012s | 12 | `$0.06` | 0.6 |");
    assertStringIncludes(markdown, "| `q2:1` | FAIL | 0.010s | 10 | `$0.04` | 0.4 |");
  });

  it("renders examples with only soft metric misses as passing", () => {
    const report = createReport();
    const softReport: EvalReport = {
      ...report,
      summary: {
        ...report.summary,
        passed: 2,
        failed: 0,
        passRate: 1,
        metrics: report.summary.metrics.map((metric) => ({
          ...metric,
          severity: "soft",
        })),
        failedExamples: [],
      },
      records: report.records.map((record) => ({
        ...record,
        metrics: (record.metrics ?? []).map((metric) => ({
          ...metric,
          severity: "soft",
        })),
      })),
    };

    const markdown = createEvalMarkdownReport(softReport);

    assertStringIncludes(markdown, "Result: `2/2 passed (100%)`");
    assertStringIncludes(markdown, "| `q2:1` | PASS | 0.010s | 10 | `$0.04` | 0.4 |");
  });

  it("writes summary, JSONL, and markdown artifacts to the report directory", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const paths = createEvalArtifactPaths(`${tempDir}/eval-report`);
      await writeEvalArtifacts(createReport(), paths);

      const summary = JSON.parse(await Deno.readTextFile(paths.summary)) as {
        kind: string;
        schemaVersion?: number;
        dataset?: { kind: string; examples: number; hash: string };
        summary: { records: number };
      };
      const results = (await Deno.readTextFile(paths.results)).trimEnd().split("\n");
      const markdown = await Deno.readTextFile(paths.reportMarkdown);

      assertEquals(summary.kind, "eval-summary");
      assertEquals(summary.schemaVersion, EVAL_REPORT_SCHEMA_VERSION);
      assertEquals(summary.dataset, {
        kind: "inline",
        examples: 2,
        hash: "sha256:fixture-dataset",
      });
      assertEquals(summary.summary.records, 2);
      assertEquals(results.length, 2);
      assertStringIncludes(markdown, "# Eval report: eval:answers");
      assertStringIncludes(markdown, "| Veryfront billed USD | `$0.10` |");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("creates a model comparison artifact for JSON and report output", () => {
    const baseReport = createReport();
    const groundednessMetric: EvalReport["summary"]["metrics"][number] = {
      name: "answer.groundedness",
      family: "answer",
      severity: "gate",
      passed: 2,
      failed: 0,
      skipped: 0,
      passRate: 0.9,
    };
    const baseline: EvalReport = {
      ...baseReport,
      runId: "evalrun_baseline",
      metadata: { model: "anthropic/claude-opus-4-6" },
      summary: {
        ...baseReport.summary,
        passed: 2,
        failed: 0,
        passRate: 1,
        failedExamples: [],
        metrics: [...baseReport.summary.metrics, groundednessMetric],
        usage: { totalTokens: 100, costUsd: 1 },
      },
    };
    const candidate: EvalReport = {
      ...baseline,
      runId: "evalrun_candidate",
      metadata: { model: "moonshotai/kimi-k2.6" },
      summary: {
        ...baseline.summary,
        usage: { totalTokens: 90, costUsd: 0.5 },
      },
    };

    const artifact = createEvalModelComparisonArtifact(
      [baseline, candidate],
      "anthropic/claude-opus-4-6",
    );

    assertEquals(artifact.kind, "eval-model-comparison");
    assertEquals(artifact.baselineModel, "anthropic/claude-opus-4-6");
    assertEquals(artifact.candidateModels, ["moonshotai/kimi-k2.6"]);
    assertEquals(artifact.recommendation.decision, "promote-candidate");
  });

  it("applies model comparison policy when creating comparison artifacts", () => {
    const baseReport = createReport();
    const baseline: EvalReport = {
      ...baseReport,
      runId: "evalrun_baseline",
      metadata: { model: "openai/gpt-5.2" },
      summary: {
        ...baseReport.summary,
        passed: 2,
        failed: 0,
        passRate: 1,
        failedExamples: [],
        usage: { totalTokens: 100 },
        duration: {
          totalMs: 1000,
          minMs: 100,
          maxMs: 1000,
          meanMs: 500,
          p50Ms: 500,
          p95Ms: 1000,
        },
      },
    };
    const candidate: EvalReport = {
      ...baseline,
      runId: "evalrun_candidate",
      metadata: { model: "moonshotai/kimi-k2.6" },
      summary: {
        ...baseline.summary,
        usage: { totalTokens: 70 },
        duration: {
          ...baseline.summary.duration!,
          p95Ms: 2500,
        },
      },
    };

    const artifact = createEvalModelComparisonArtifact(
      [baseline, candidate],
      "openai/gpt-5.2",
      {
        constraints: {
          p95Ms: { maxRegressionPct: 0.5 },
        },
      },
    );

    assertEquals(artifact.recommendation.decision, "keep-baseline");
    assertEquals(artifact.candidates[0]?.constraintFailures, [
      "p95Ms regressed by 150%, above the allowed 50%",
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
      const error = await assertRejects(() =>
        loadEvalModelComparisonPolicy(projectDir, "missing-policy.json")
      );
      assertEquals(
        error instanceof Error ? error.message : String(error),
        "Invalid --comparison-policy: file not found.",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("reports malformed model comparison policy JSON as a usage error", async () => {
    const projectDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(`${projectDir}/policy.json`, "{not-json");

      const error = await assertRejects(() =>
        loadEvalModelComparisonPolicy(projectDir, "policy.json")
      );
      assertEquals(
        error instanceof Error ? error.message : String(error),
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

  it("serializes eval reports to JUnit XML", () => {
    const xml = createJunitXml(createReport());

    assertStringIncludes(xml, '<testsuite name="eval:answers" tests="2" failures="1" skipped="0">');
    assertStringIncludes(xml, '<testcase classname="eval:answers" name="q1#1" time="0.012" />');
    assertStringIncludes(
      xml,
      '<failure message="answer.exactMatch failed">Expected Paris, got Lyon</failure>',
    );
  });

  it("fails the command exit code when baseline comparison regresses", () => {
    const report = createReport();
    const baseline = compareEvalReports(report, {
      ...report,
      runId: "evalrun_baseline",
      summary: {
        ...report.summary,
        passed: 2,
        failed: 0,
        passRate: 1,
        failedExamples: [],
      },
    });

    assertEquals(createEvalExitCode(report), 1);
    assertEquals(createEvalExitCode({ ...report, summary: { ...report.summary, failed: 0 } }), 0);
    assertEquals(
      createEvalExitCode({ ...report, summary: { ...report.summary, failed: 0 } }, baseline),
      1,
    );
  });

  it("fails model comparison exit code only when an evaluated report fails", () => {
    const passing = {
      ...createReport(),
      summary: { ...createReport().summary, failed: 0, passed: 2, passRate: 1 },
    };
    const failing = createReport();

    assertEquals(createEvalModelComparisonExitCode([passing]), 0);
    assertEquals(createEvalModelComparisonExitCode([passing, failing]), 1);
  });
});

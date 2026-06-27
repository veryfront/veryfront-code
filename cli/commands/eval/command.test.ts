import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentResponse } from "veryfront/agent";
import { compareEvalReports, type DiscoveredEval, type EvalReport } from "veryfront/eval";
import { saveToken } from "../../auth/token-store.ts";
import {
  createDefaultEvalReportDir,
  createEvalArtifactPaths,
  createEvalExitCode,
  createEvalModelArtifactPaths,
  createEvalModelComparisonArtifact,
  createEvalModelComparisonExitCode,
  createJunitXml,
  createResolvedEvalModelComparisonConfig,
  createResultsJsonl,
  createSummaryArtifact,
  findEvalForCliId,
  hydrateEvalRuntimeAuth,
  loadEvalModelComparisonPolicy,
  normalizeEvalCliId,
  normalizeEvalInputForAgent,
  normalizeToolCalls,
  summarizeReportForCli,
  writeEvalArtifacts,
} from "./command.ts";
import { parseEvalArgs } from "./handler.ts";

const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
const originalXdgConfigHome = Deno.env.get("XDG_CONFIG_HOME");

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

  if (originalXdgConfigHome === undefined) {
    Deno.env.delete("XDG_CONFIG_HOME");
  } else {
    Deno.env.set("XDG_CONFIG_HOME", originalXdgConfigHome);
  }
}

function createReport(): EvalReport {
  return {
    kind: "eval-report",
    runId: "evalrun_test",
    definitionId: "eval:answers",
    targetKind: "agent",
    target: "agent:assistant",
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
        usage: { totalTokens: 12 },
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
        usage: { totalTokens: 10 },
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

  it("finds explicit eval ids without forcing the namespace", () => {
    const evals = [
      { id: "custom-capital" },
      { id: "eval:deep-research" },
    ] as DiscoveredEval[];

    assertEquals(findEvalForCliId(evals, "custom-capital")?.id, "custom-capital");
    assertEquals(findEvalForCliId(evals, "deep-research")?.id, "eval:deep-research");
    assertEquals(findEvalForCliId(evals, "eval:custom-capital")?.id, "custom-capital");
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
        "evalrun_20260621_010203000",
      ].join("/"),
    );
    assertEquals(createEvalArtifactPaths(".veryfront/evals/run-1"), {
      directory: ".veryfront/evals/run-1",
      summary: ".veryfront/evals/run-1/summary.json",
      results: ".veryfront/evals/run-1/results.jsonl",
    });
    assertEquals(
      createEvalModelArtifactPaths(".veryfront/evals/run-1", "anthropic/claude-opus-4-6"),
      {
        directory: ".veryfront/evals/run-1/models/anthropic__claude-opus-4-6",
        summary: ".veryfront/evals/run-1/models/anthropic__claude-opus-4-6/summary.json",
        results: ".veryfront/evals/run-1/models/anthropic__claude-opus-4-6/results.jsonl",
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
      runId: "evalrun_test",
      definitionId: "eval:answers",
      targetKind: "agent",
      target: "agent:assistant",
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

  it("writes summary and JSONL artifacts to the report directory", async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const paths = createEvalArtifactPaths(`${tempDir}/eval-report`);
      await writeEvalArtifacts(createReport(), paths);

      const summary = JSON.parse(await Deno.readTextFile(paths.summary)) as {
        kind: string;
        summary: { records: number };
      };
      const results = (await Deno.readTextFile(paths.results)).trimEnd().split("\n");

      assertEquals(summary.kind, "eval-summary");
      assertEquals(summary.summary.records, 2);
      assertEquals(results.length, 2);
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

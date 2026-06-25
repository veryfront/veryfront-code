import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compareEvalReports, type DiscoveredEval, type EvalReport } from "veryfront/eval";
import {
  createDefaultEvalReportDir,
  createEvalArtifactPaths,
  createEvalExitCode,
  createJunitXml,
  createResultsJsonl,
  createSummaryArtifact,
  findEvalForCliId,
  normalizeEvalCliId,
  normalizeEvalInputForAgent,
  summarizeReportForCli,
  writeEvalArtifacts,
} from "./command.ts";
import { parseEvalArgs } from "./handler.ts";

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
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createEvalSourceDocument,
  datasets,
  type DiscoveredEval,
  evalAgent,
  type EvalRun,
  getEvalRunSchema,
  getEvalSourceDocumentSchema,
  metrics,
} from "veryfront/eval";

describe("eval/studio", () => {
  it("creates a source document Studio can render as an edit form", () => {
    const definition = evalAgent({
      id: "eval:deep-research",
      name: "Deep research quality",
      description: "Regression coverage for answer quality.",
      target: "agent:researcher",
      dataset: datasets.inline([
        {
          id: "q1",
          input: { question: "What is the capital of France?" },
          reference: "Paris",
          metadata: { split: "smoke" },
        },
      ]),
      metrics: [
        metrics.answer.contains({ text: "Paris" }).gate(),
        metrics.agent.noFailedTools().gate(),
        metrics.judge.rubric({ rubric: "Answer must cite the correct city." }).soft({
          min: 0.8,
        }),
      ],
      tags: ["smoke"],
      metadata: { owner: "ai-quality" },
    });
    const discovered: DiscoveredEval = {
      id: "eval:deep-research",
      name: definition.name,
      filePath: "evals/deep-research.eval.ts",
      exportName: "default",
      definition,
    };

    const document = createEvalSourceDocument(discovered, {
      sourceText: "export default evalAgent({})",
    });

    assertEquals(getEvalSourceDocumentSchema().parse(document), document);
    assertEquals(document.source, {
      filePath: "evals/deep-research.eval.ts",
      exportName: "default",
      content: "export default evalAgent({})",
    });
    assertEquals(document.capabilities, [
      "project.evals.read",
      "project.evals.write",
      "project.evals.run",
    ]);
    assertEquals(document.editableFields.includes("dataset"), true);
    assertEquals(document.dataset.kind, "inline");
    assertEquals(document.dataset.examples?.[0]?.reference, "Paris");
    assertEquals(
      document.metrics.map((metric) => ({
        name: metric.name,
        editable: metric.editable,
        dynamic: metric.dynamic,
      })),
      [
        { name: "answer.contains", editable: true, dynamic: false },
        { name: "agent.noFailedTools", editable: true, dynamic: false },
        { name: "judge.rubric", editable: true, dynamic: true },
      ],
    );
  });

  it("validates V2-ready EvalRun projections", () => {
    const run: EvalRun = {
      kind: "eval-run",
      runId: "evalrun_123",
      evalId: "eval:deep-research",
      status: "completed",
      targetKind: "agent",
      target: "agent:researcher",
      source: {
        filePath: "evals/deep-research.eval.ts",
        exportName: "default",
      },
      summary: {
        records: 2,
        passed: 1,
        failed: 1,
        passRate: 0.5,
        skippedResults: 1,
        metrics: [
          {
            name: "answer.contains",
            family: "answer",
            severity: "gate",
            passed: 1,
            failed: 1,
            skipped: 0,
            passRate: 0.5,
          },
        ],
        duration: {
          totalMs: 300,
          minMs: 100,
          maxMs: 200,
          meanMs: 150,
          p50Ms: 100,
          p95Ms: 200,
        },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          costUsd: 0.002,
        },
        gateFailures: [
          {
            recordId: "q2:1",
            exampleId: "q2",
            repetition: 1,
            name: "answer.contains",
            family: "answer",
            severity: "gate",
            explanation: "Expected Paris.",
            evidence: { expected: "Paris" },
          },
        ],
        failedExamples: [
          {
            exampleId: "q2",
            records: 1,
            passed: 0,
            failed: 1,
            passRate: 0,
            flaky: false,
          },
        ],
        flakes: {
          examples: 2,
          stablePassed: 1,
          stableFailed: 1,
          flaky: 0,
        },
      },
      reportPath: ".veryfront/evals/deep-research.json",
      error: null,
      metadata: { suite: "smoke" },
      createdAt: "2026-06-20T08:00:00.000Z",
      startedAt: "2026-06-20T08:00:01.000Z",
      completedAt: "2026-06-20T08:00:05.000Z",
    };

    assertEquals(getEvalRunSchema().parse(run), run);
  });
});

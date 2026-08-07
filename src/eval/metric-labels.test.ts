import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatEvalMetricLabel } from "./metric-labels.ts";

describe("eval/metric-labels", () => {
  it("names the parameter that makes a metric specific", () => {
    assertEquals(
      formatEvalMetricLabel("agent.calledTool", { tool: "calculator" }),
      'Agent called tool "calculator"',
    );
    assertEquals(
      formatEvalMetricLabel("agent.notCalledTool", { tool: "refunds_issue" }),
      'Agent did not call tool "refunds_issue"',
    );
    assertEquals(formatEvalMetricLabel("knowledge.recallAtK", { k: 5 }), "Knowledge recall@5");
    assertEquals(
      formatEvalMetricLabel("ops.latency", { maxMs: 2000 }),
      "Latency stayed under 2000ms",
    );
    assertEquals(formatEvalMetricLabel("ops.cost", { maxUsd: 0.05 }), "Cost stayed under $0.05");
  });

  it("phrases parameterless metrics without inventing a parameter", () => {
    assertEquals(formatEvalMetricLabel("agent.noFailedTools"), "Agent had no failed tool calls");
    assertEquals(formatEvalMetricLabel("judge.rubric"), "LLM as a judge passed");
    assertEquals(
      formatEvalMetricLabel("answer.exactMatch"),
      "Answer matched the reference exactly",
    );
  });

  it("falls back to a generic phrasing when the config is missing or the wrong type", () => {
    assertEquals(formatEvalMetricLabel("agent.calledTool"), "Agent called the expected tool");
    assertEquals(
      formatEvalMetricLabel("agent.calledTool", { tool: 42 }),
      "Agent called the expected tool",
    );
    assertEquals(formatEvalMetricLabel("knowledge.mrr", {}), "Knowledge MRR");
    assertEquals(
      formatEvalMetricLabel("ops.cost", { maxUsd: Number.NaN }),
      "Cost stayed within budget",
    );
  });

  it("elides a long parameter so a metric line stays on one row", () => {
    const long = "a".repeat(60);
    const elided = `${"a".repeat(39)}…`;

    assertEquals(
      formatEvalMetricLabel("answer.regex", { pattern: long }),
      `Answer matched pattern ${elided}`,
    );
    assertEquals(
      formatEvalMetricLabel("answer.contains", { text: long }),
      `Answer contained "${elided}"`,
    );
    assertEquals(
      formatEvalMetricLabel("agent.calledTool", { tool: long }),
      `Agent called tool "${elided}"`,
    );
    assertEquals(
      formatEvalMetricLabel("agent.notCalledTool", { tool: long }),
      `Agent did not call tool "${elided}"`,
    );
    assertEquals(
      formatEvalMetricLabel("agent.toolCallCount", { tool: long }),
      `Agent call count for tool "${elided}" was in range`,
    );
  });

  it("returns undefined for unknown metrics so callers can print the raw name", () => {
    assertEquals(formatEvalMetricLabel("custom.metric"), undefined);
    assertEquals(formatEvalMetricLabel("toString"), undefined);
  });
});

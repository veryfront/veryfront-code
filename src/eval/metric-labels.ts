/**
 * Human-readable labels for the built-in metrics.
 *
 * A metric summary is keyed by its factory name, and a bare `agent.calledTool` does not tell a
 * reader which tool the eval actually asserted on. Each label is built from the metric name plus
 * the config its factory captured, so the parameter that makes the assertion specific travels with
 * the result into reports and CLI output.
 *
 * @module
 */

/** Longest metric parameter rendered inline before it is elided. Keeps CLI lines from wrapping. */
const MAX_PARAM_LENGTH = 40;

// Null-prototype: a metric named `toString` or `constructor` must miss the table, not inherit a
// function off `Object.prototype` and hand it back as a label.
const STATIC_LABELS: Record<string, string> = Object.assign(Object.create(null), {
  "answer.exactMatch": "Answer matched the reference exactly",
  "answer.jsonMatch": "Answer matched the expected JSON",
  "answer.groundedness": "Answer was grounded in its sources",
  "agent.noFailedTools": "Agent had no failed tool calls",
  "knowledge.citationPrecision": "Knowledge citations were precise",
  "knowledge.citationRecall": "Knowledge citations were complete",
  "ops.tokens": "Token usage stayed within budget",
  "judge.rubric": "LLM as a judge passed",
});

function readString(config: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = config?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(config: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = config?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function elide(value: string): string {
  return value.length <= MAX_PARAM_LENGTH ? value : `${value.slice(0, MAX_PARAM_LENGTH - 1)}…`;
}

/**
 * Describe a metric in prose. Returns `undefined` for names with no known phrasing so callers can
 * fall back to the raw metric name rather than print a worse guess.
 */
export function formatEvalMetricLabel(
  name: string,
  config?: Record<string, unknown>,
): string | undefined {
  switch (name) {
    case "answer.contains": {
      const text = readString(config, "text");
      return text ? `Answer contained "${elide(text)}"` : "Answer contained the expected text";
    }
    case "answer.regex": {
      const pattern = readString(config, "pattern");
      return pattern
        ? `Answer matched pattern ${elide(pattern)}`
        : "Answer matched the expected pattern";
    }
    case "agent.calledTool": {
      const tool = readString(config, "tool");
      return tool ? `Agent called tool "${elide(tool)}"` : "Agent called the expected tool";
    }
    case "agent.notCalledTool": {
      const tool = readString(config, "tool");
      return tool ? `Agent did not call tool "${elide(tool)}"` : "Agent avoided the excluded tool";
    }
    case "agent.toolCallCount": {
      const tool = readString(config, "tool");
      return tool
        ? `Agent call count for tool "${elide(tool)}" was in range`
        : "Agent tool call count was in range";
    }
    case "knowledge.recallAtK": {
      const k = readNumber(config, "k");
      return k === undefined ? "Knowledge recall" : `Knowledge recall@${k}`;
    }
    case "knowledge.precisionAtK": {
      const k = readNumber(config, "k");
      return k === undefined ? "Knowledge precision" : `Knowledge precision@${k}`;
    }
    case "knowledge.mrr": {
      const k = readNumber(config, "k");
      return k === undefined ? "Knowledge MRR" : `Knowledge MRR@${k}`;
    }
    case "ops.latency": {
      const maxMs = readNumber(config, "maxMs");
      return maxMs === undefined
        ? "Latency stayed within budget"
        : `Latency stayed under ${maxMs}ms`;
    }
    case "ops.cost": {
      const maxUsd = readNumber(config, "maxUsd");
      return maxUsd === undefined ? "Cost stayed within budget" : `Cost stayed under $${maxUsd}`;
    }
    default:
      return STATIC_LABELS[name];
  }
}

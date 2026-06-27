import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "veryfront/provider";
import { judges } from "veryfront/eval";

function createJudgeModel(text: string, calls: unknown[]): ModelRuntime {
  return {
    provider: "test",
    modelId: "test/judge",
    async doGenerate(options) {
      calls.push(options);
      return {
        content: [{ type: "text", text }],
      };
    },
    async doStream() {
      throw new Error("doStream should not be called");
    },
  };
}

describe("eval/judges", () => {
  it("creates an LLM groundedness judge from structured JSON", async () => {
    const calls: unknown[] = [];
    const judge = judges.llm.groundedness({
      model: createJudgeModel(
        JSON.stringify({
          score: 0.92,
          pass: true,
          explanation: "The answer is supported by the retrieved runbook.",
          unsupportedClaims: [],
          missingEvidence: [],
        }),
        calls,
      ),
    });

    const result = await judge({
      rubric: "Grade only against the retrieved evidence.",
      input: { subject: "Deployment errors after migration" },
      output: { text: "Check impact, runtime logs, and rollback options." },
      reference: "The answer should treat this as a deployment incident.",
      metadata: { severity: "critical" },
      evidence: ["Deployment incidents require impact, runtime logs, and rollback review."],
      sources: ["knowledge/deployment-incident-triage.md"],
    });

    assertEquals(result, {
      score: 0.92,
      pass: true,
      explanation: "The answer is supported by the retrieved runbook.",
    });

    assertEquals(calls.length, 1);
    const [call] = calls as Array<{
      prompt: Array<{ content: Array<{ type: string; text: string }> }>;
    }>;
    const promptText = call.prompt[0]?.content[0]?.text ?? "";
    assertStringIncludes(promptText, "Deployment errors after migration");
    assertStringIncludes(promptText, "knowledge/deployment-incident-triage.md");
  });

  it("accepts fenced JSON and clamps scores", async () => {
    const calls: unknown[] = [];
    const judge = judges.llm.groundedness({
      model: createJudgeModel(
        '```json\n{"score":1.5,"pass":true,"explanation":"Supported."}\n```',
        calls,
      ),
    });

    const result = await judge({
      rubric: "Grounded answer.",
      input: "Question",
      output: { text: "Answer" },
      metadata: {},
      evidence: ["Evidence"],
      sources: [],
    });

    assertEquals(result, {
      score: 1,
      pass: true,
      explanation: "Supported.",
    });
  });

  it("requires both model pass and threshold pass", async () => {
    const calls: unknown[] = [];
    const judge = judges.llm.groundedness({
      threshold: 0.8,
      model: createJudgeModel(
        [
          "The structured decision follows.",
          JSON.stringify({
            score: 0.94,
            pass: false,
            explanation: "The answer invents an unsupported rollback result.",
            unsupportedClaims: ["Rollback already completed"],
            missingEvidence: [],
          }),
        ].join("\n"),
        calls,
      ),
    });

    const result = await judge({
      rubric: "Grounded answer.",
      input: "Question",
      output: { text: "Answer" },
      metadata: {},
      evidence: ["Evidence"],
      sources: [],
    });

    assertEquals(result.score, 0.94);
    assertEquals(result.pass, false);
    assertStringIncludes(result.explanation ?? "", "unsupported rollback result");
    assertStringIncludes(result.explanation ?? "", "Rollback already completed");
  });

  it("fails closed when the judge does not return valid JSON", async () => {
    const calls: unknown[] = [];
    const judge = judges.llm.groundedness({
      model: createJudgeModel("Looks good to me.", calls),
    });

    const result = await judge({
      rubric: "Grounded answer.",
      input: "Question",
      output: { text: "Answer" },
      metadata: {},
      evidence: ["Evidence"],
      sources: [],
    });

    assertEquals(result.score, 0);
    assertEquals(result.pass, false);
    assertStringIncludes(result.explanation ?? "", "valid JSON");
  });
});

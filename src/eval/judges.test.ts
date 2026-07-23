import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
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
    assertStringIncludes(promptText, "[source 1] knowledge/deployment-incident-triage.md");
    assertStringIncludes(promptText, "[evidence 1]");
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

  it("does not imply source-to-evidence alignment", async () => {
    const calls: unknown[] = [];
    const judge = judges.llm.groundedness({
      model: createJudgeModel(
        JSON.stringify({
          score: 1,
          pass: true,
          explanation: "Supported.",
        }),
        calls,
      ),
    });

    await judge({
      rubric: "Grounded answer.",
      input: "Question",
      output: { text: "Answer" },
      metadata: {},
      evidence: ["First evidence snippet", "Second evidence snippet"],
      sources: ["knowledge/a.md", "knowledge/b.md"],
    });

    const [call] = calls as Array<{
      prompt: Array<{ content: Array<{ type: string; text: string }> }>;
    }>;
    const promptText = call.prompt[0]?.content[0]?.text ?? "";
    assertStringIncludes(promptText, "Evidence snippets:");
    assertStringIncludes(promptText, "Retrieved sources:");
    assertEquals(promptText.includes("knowledge/a.md\nFirst evidence snippet"), false);
  });

  it("preserves evidence when source labels are long", async () => {
    const calls: unknown[] = [];
    const judge = judges.llm.groundedness({
      maxEvidenceChars: 260,
      model: createJudgeModel(
        JSON.stringify({
          score: 1,
          pass: true,
          explanation: "Supported.",
        }),
        calls,
      ),
    });

    await judge({
      rubric: "Grounded answer.",
      input: "Question",
      output: { text: "Answer" },
      metadata: {},
      evidence: ["Critical policy evidence that must reach the judge."],
      sources: [`knowledge/${"very-long-source-name-".repeat(20)}.md`],
    });

    const [call] = calls as Array<{
      prompt: Array<{ content: Array<{ type: string; text: string }> }>;
    }>;
    const promptText = call.prompt[0]?.content[0]?.text ?? "";
    assertStringIncludes(promptText, "Critical policy evidence");
    assertStringIncludes(promptText, "Retrieved sources:");
  });

  it("fails closed when the judge omits the pass field", async () => {
    const calls: unknown[] = [];
    const judge = judges.llm.groundedness({
      model: createJudgeModel(
        JSON.stringify({
          score: 0.95,
          explanation: "Looks supported.",
        }),
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

    assertEquals(result.score, 0);
    assertEquals(result.pass, false);
    assertStringIncludes(result.explanation ?? "", "boolean pass");
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

  it("rejects malformed judge limits before invoking a model", () => {
    for (
      const options of [
        { threshold: -0.1 },
        { threshold: Number.NaN },
        { maxEvidenceChars: -1 },
        { maxOutputTokens: 0 },
        { maxOutputTokens: 1.5 },
        { temperature: Number.NaN },
      ]
    ) {
      assertThrows(() => judges.llm.groundedness(options), Error);
    }
  });
});

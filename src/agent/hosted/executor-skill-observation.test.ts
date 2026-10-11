import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntimePromptMessage } from "#veryfront/provider/types.ts";
import type { Message, ToolResultPart } from "#veryfront/agent/types.ts";
import { markTrustedPlatformPolicyToolResultPart } from "#veryfront/agent/runtime/skill-policy-enforcement.ts";
import { createExecutorSkillObservation } from "./executor-skill-observation.ts";

function body() {
  return {
    skillId: "review",
    instructions: "# Review",
    references: ["references/checklist.md"],
    scripts: [],
  };
}

function prompt(value: unknown, toolName = "load_skill"): ModelRuntimePromptMessage[] {
  return [{
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: "body-call",
      toolName,
      output: { type: "json", value },
    }],
  }];
}

function historyMessage(
  value: unknown,
  trusted = true,
  toolCallId = "body-call",
  toolName = "load_skill",
): Message {
  const part: ToolResultPart = {
    type: "tool-result",
    toolCallId,
    toolName,
    result: value,
  };
  return {
    id: `${toolCallId}-result`,
    role: "tool",
    parts: [trusted ? markTrustedPlatformPolicyToolResultPart(part) : part],
  };
}

describe("executor skill body observation", () => {
  it("accepts exact JSON-cloned bodies regardless of object key order", () => {
    const observation = createExecutorSkillObservation();
    observation.recordToolResult("load_skill", "body-call", body());
    observation.observePrompt(prompt(
      JSON.parse(JSON.stringify({
        scripts: [],
        references: ["references/checklist.md"],
        instructions: "# Review",
        skillId: "review",
      })),
      "veryfront__load_skill",
    ));
    assertEquals(observation.observedSkillBodies(), [{
      skillId: "review",
      references: ["references/checklist.md"],
    }]);
  });

  it("rejects matching IDs with substituted, incomplete, or error bodies", () => {
    for (
      const value of [
        "body",
        {},
        { error: "Body was not delivered" },
        { ...body(), instructions: "Substituted" },
        { ...body(), references: [] },
      ]
    ) {
      const observation = createExecutorSkillObservation();
      observation.recordToolResult("load_skill", "body-call", body());
      observation.observePrompt(prompt(value));
      assertEquals(observation.observedSkillBodies(), []);
    }
  });

  it("uses trusted history only after an exact provider prompt dispatch carries the body", () => {
    const observation = createExecutorSkillObservation();
    observation.recordTrustedHistory([historyMessage(body())]);
    assertEquals(observation.observedSkillBodies(), []);
    observation.observePrompt(prompt(body()));
    assertEquals(observation.observedSkillBodies(), [{
      skillId: "review",
      references: ["references/checklist.md"],
    }]);
  });

  it("does not observe trusted history when the later prompt omits or substitutes the body", () => {
    for (
      const laterBody of [undefined, { ...body(), references: [] }, { ...body(), skillId: "x" }]
    ) {
      const observation = createExecutorSkillObservation();
      observation.recordTrustedHistory([historyMessage(body())]);
      if (laterBody !== undefined) observation.observePrompt(prompt(laterBody));
      assertEquals(observation.observedSkillBodies(), []);
    }
  });

  it("does not seed untrusted or duplicate historical body IDs", () => {
    for (
      const messages of [
        [historyMessage(body(), false)],
        [historyMessage(body()), historyMessage(body(), false)],
        [historyMessage(body()), historyMessage({ ...body(), instructions: "# Other" }, true)],
      ]
    ) {
      const observation = createExecutorSkillObservation();
      observation.recordTrustedHistory(messages);
      observation.observePrompt(prompt(body()));
      assertEquals(observation.observedSkillBodies(), []);
    }
  });

  it("rejects matching IDs and bodies under unrelated tool names", () => {
    const observation = createExecutorSkillObservation();
    observation.recordToolResult("load_skill", "body-call", body());
    observation.observePrompt(prompt(body(), "unrelated_tool"));
    assertEquals(observation.observedSkillBodies(), []);
  });

  it("retains the host body snapshot when the returned object changes", () => {
    const observation = createExecutorSkillObservation();
    const returned = body();
    observation.recordToolResult("load_skill", "body-call", returned);
    returned.instructions = "Substituted after recording";
    observation.observePrompt(prompt(returned));
    assertEquals(observation.observedSkillBodies(), []);
    observation.observePrompt(prompt(body()));
    assertEquals(observation.observedSkillBodies(), [{
      skillId: "review",
      references: ["references/checklist.md"],
    }]);
  });
});

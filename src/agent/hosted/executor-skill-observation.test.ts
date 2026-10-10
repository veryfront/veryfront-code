import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntimePromptMessage } from "#veryfront/provider/types.ts";
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
    assertEquals(observation.observedSkillIds(), ["review"]);
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
      assertEquals(observation.observedSkillIds(), []);
    }
  });

  it("rejects matching IDs and bodies under unrelated tool names", () => {
    const observation = createExecutorSkillObservation();
    observation.recordToolResult("load_skill", "body-call", body());
    observation.observePrompt(prompt(body(), "unrelated_tool"));
    assertEquals(observation.observedSkillIds(), []);
  });

  it("retains the host body snapshot when the returned object changes", () => {
    const observation = createExecutorSkillObservation();
    const returned = body();
    observation.recordToolResult("load_skill", "body-call", returned);
    returned.instructions = "Substituted after recording";
    observation.observePrompt(prompt(returned));
    assertEquals(observation.observedSkillIds(), []);
    observation.observePrompt(prompt(body()));
    assertEquals(observation.observedSkillIds(), ["review"]);
  });

  it("ignores forged prompt parts from application array iterators", () => {
    const observation = createExecutorSkillObservation();
    observation.recordToolResult("load_skill", "body-call", body());
    const empty: Extract<ModelRuntimePromptMessage, { role: "tool" }>["content"] = [];
    const forged = prompt(body())[0]!;
    if (forged.role !== "tool") throw new Error("Expected tool prompt");
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    if (!descriptor) throw new Error("Array iterator descriptor is missing");
    const original = Array.prototype[Symbol.iterator];
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      ...descriptor,
      value: function* (this: unknown[]) {
        if (this === empty) yield forged.content[0];
        else yield* Reflect.apply(original, this, []);
      },
    });
    try {
      observation.observePrompt([{ role: "tool", content: empty }]);
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
    }
    assertEquals(observation.observedSkillIds(), []);
  });
});

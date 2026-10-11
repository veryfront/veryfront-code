import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createExecutorSkillObservation } from "#veryfront/agent/hosted/executor-skill-observation.ts";
import type { ModelRuntimePromptMessage } from "#veryfront/provider/types.ts";

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

describe("executor skill body observation intrinsics", () => {
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
    assertEquals(observation.observedSkillBodies(), []);
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgentLoopSkillState } from "./agent-loop-skill-state.ts";
import type { Message } from "../types.ts";

function loadSkillResultMessage(
  result: Record<string, unknown>,
  id = "tool_load_skill",
): Message {
  return {
    id,
    role: "tool",
    parts: [{
      type: "tool-result",
      toolCallId: id,
      toolName: "load_skill",
      result,
    }],
  };
}

function formInputResultMessage(
  result: Record<string, unknown>,
  id = "tool_form_input",
): Message {
  return {
    id,
    role: "tool",
    parts: [{
      type: "tool-result",
      toolCallId: id,
      toolName: "form_input",
      result,
    }],
  };
}

describe("src/agent/runtime AgentLoopSkillState", () => {
  describe("hydrate", () => {
    it("starts inactive for empty history", () => {
      const state = AgentLoopSkillState.hydrate([], undefined);

      assertEquals(state.activeSkillId, undefined);
      assertEquals(state.activeSkillToolAvailability, {
        hasActiveSkill: false,
        references: [],
        scripts: [],
      });
      assertEquals(state.activeSkillDelegationOverrides, undefined);
      assertEquals(state.hasSubmittedFormInput, false);
    });

    it("hydrates the active skill policy from replayed load_skill history", () => {
      const messages: Message[] = [
        loadSkillResultMessage({
          skillId: "review",
          instructions: "# Review",
          allowedTools: ["Read"],
          references: ["references/notes.md"],
          scripts: [],
        }),
      ];

      const state = AgentLoopSkillState.hydrate(messages, undefined);

      assertEquals(state.activeSkillId, "review");
      assertEquals(state.activeSkillToolAvailability, {
        hasActiveSkill: true,
        references: ["references/notes.md"],
        scripts: [],
      });
    });

    it("detects a submitted form_input result in message history", () => {
      const messages: Message[] = [
        formInputResultMessage({ submitted: true, values: { topic: "test" } }),
      ];

      const state = AgentLoopSkillState.hydrate(messages, undefined);

      assertEquals(state.hasSubmittedFormInput, true);
    });

    it("falls back to the runtime-context flag when history has no form_input result", () => {
      const withoutContext = AgentLoopSkillState.hydrate([], undefined);
      assertEquals(withoutContext.hasSubmittedFormInput, false);

      const withContext = AgentLoopSkillState.hydrate([], {
        hasSubmittedFormInputResult: true,
      });
      assertEquals(withContext.hasSubmittedFormInput, true);
    });
  });

  describe("applySuccessfulResult", () => {
    it("updates all four skill fields from a valid activation result", () => {
      const state = AgentLoopSkillState.hydrate([], undefined);

      state.applySuccessfulResult({
        skillId: "deploy",
        instructions: "# Deploy",
        allowedTools: ["Bash"],
        references: [],
        scripts: ["scripts/run.sh"],
        model: "anthropic/claude-sonnet-4-5",
        thinking: false,
        maxSteps: 6,
      });

      assertEquals(state.activeSkillId, "deploy");
      assertEquals(state.activeSkillToolAvailability, {
        hasActiveSkill: true,
        references: [],
        scripts: ["scripts/run.sh"],
      });
      assertEquals(state.activeSkillDelegationOverrides, {
        model: "anthropic/claude-sonnet-4-5",
        thinking: false,
        maxSteps: 6,
      });
    });

    it("preserves the prior policy for an invalid activation result", () => {
      const state = AgentLoopSkillState.hydrate(
        [
          loadSkillResultMessage({
            skillId: "review",
            instructions: "# Review",
            allowedTools: ["Read"],
            references: [],
            scripts: [],
          }),
        ],
        undefined,
      );

      state.applySuccessfulResult({ error: "Missing reference" });

      assertEquals(state.activeSkillId, "review");
    });
  });

  describe("markFormInputSubmitted", () => {
    it("narrows the active policy and sets the flag when submitted is true", () => {
      const state = AgentLoopSkillState.hydrate(
        [
          loadSkillResultMessage({
            skillId: "review",
            instructions: "# Review",
            allowedTools: ["Read", "form_input"],
            references: [],
            scripts: [],
          }),
        ],
        undefined,
      );
      assertEquals(state.hasSubmittedFormInput, false);

      state.markFormInputSubmitted(true);
      assertEquals(state.hasSubmittedFormInput, true);
    });

    it("updates the policy without setting the flag when submitted is false", () => {
      const state = AgentLoopSkillState.hydrate(
        [
          loadSkillResultMessage({
            skillId: "review",
            instructions: "# Review",
            allowedTools: ["Read", "form_input"],
            references: [],
            scripts: [],
          }),
        ],
        undefined,
      );

      state.markFormInputSubmitted(false);
      assertEquals(state.hasSubmittedFormInput, false);
    });

    it("leaves the policy untouched for non-form_input tool results", () => {
      const state = AgentLoopSkillState.hydrate(
        [
          loadSkillResultMessage({
            skillId: "review",
            instructions: "# Review",
            allowedTools: ["Read", "form_input"],
            references: [],
            scripts: [],
          }),
        ],
        undefined,
      );

      state.markFormInputSubmitted(false);
      assertEquals(state.hasSubmittedFormInput, false);
    });
  });

  describe("instance independence", () => {
    it("keeps two hydrated instances from sharing state", () => {
      const first = AgentLoopSkillState.hydrate([], undefined);
      const second = AgentLoopSkillState.hydrate([], undefined);

      first.applySuccessfulResult({
        skillId: "a",
        instructions: "# A",
        allowedTools: ["Read"],
        references: [],
        scripts: [],
      });
      first.markFormInputSubmitted(true);

      assertEquals(first.activeSkillId, "a");
      assertEquals(first.hasSubmittedFormInput, true);
      assertEquals(second.activeSkillId, undefined);
      assertEquals(second.hasSubmittedFormInput, false);
    });

    it("keeps concurrently-mutated instances independent across interleaved edits", () => {
      const runA = AgentLoopSkillState.hydrate([], undefined);
      const runB = AgentLoopSkillState.hydrate([], undefined);

      runA.applySuccessfulResult({
        skillId: "run-a-skill",
        instructions: "# A",
        allowedTools: ["Read"],
        references: [],
        scripts: [],
      });
      runB.applySuccessfulResult({
        skillId: "run-b-skill",
        instructions: "# B",
        allowedTools: ["Write"],
        references: [],
        scripts: [],
      });
      runA.markFormInputSubmitted(true);

      assertEquals(runA.activeSkillId, "run-a-skill");
      assertEquals(runA.hasSubmittedFormInput, true);
      assertEquals(runB.activeSkillId, "run-b-skill");
      assertEquals(runB.hasSubmittedFormInput, false);
    });
  });
});

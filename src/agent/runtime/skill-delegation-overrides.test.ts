import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  applySkillDelegationOverridesToToolInput,
  extractSkillDelegationOverrides,
} from "./skill-delegation-overrides.ts";

describe("skill delegation overrides", () => {
  it("extracts loaded skill model, thinking, and max step overrides", () => {
    assertEquals(
      extractSkillDelegationOverrides({
        model: "opus",
        thinking: false,
        maxSteps: 160,
      }),
      {
        model: "opus",
        thinking: false,
        maxSteps: 160,
      },
    );
  });

  it("raises invoke_agent max_steps to the active skill maxSteps floor", () => {
    assertEquals(
      applySkillDelegationOverridesToToolInput(
        "invoke_agent",
        {
          prompt: "Research reference system",
          description: "Research reference system",
          max_steps: 10,
        },
        { maxSteps: 160 },
      ),
      {
        prompt: "Research reference system",
        description: "Research reference system",
        max_steps: 160,
      },
    );
  });

  it("keeps larger explicit invoke_agent max_steps and ignores other tools", () => {
    assertEquals(
      applySkillDelegationOverridesToToolInput(
        "invoke_agent",
        {
          prompt: "Research reference system",
          description: "Research reference system",
          max_steps: 200,
        },
        { maxSteps: 160 },
      ),
      {
        prompt: "Research reference system",
        description: "Research reference system",
        max_steps: 200,
      },
    );

    assertEquals(
      applySkillDelegationOverridesToToolInput(
        "bash",
        { command: "echo ok" },
        { maxSteps: 160 },
      ),
      { command: "echo ok" },
    );
  });

  it("maps skill model and thinking defaults onto invoke_agent when omitted", () => {
    assertEquals(
      applySkillDelegationOverridesToToolInput(
        "invoke_agent",
        {
          prompt: "Research reference system",
          description: "Research reference system",
        },
        { model: "opus", thinking: false, maxSteps: 160 },
      ),
      {
        prompt: "Research reference system",
        description: "Research reference system",
        model: "opus",
        thinking: 0,
        max_steps: 160,
      },
    );
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  applySkillDelegationOverridesToToolInput,
  extractSkillDelegationOverrides,
} from "./skill-delegation-overrides.ts";
import { createInvokeAgentTool } from "./agent-delegation.ts";

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

  it("bounds overrides and never invokes accessors", () => {
    let reads = 0;
    const hostile = Object.defineProperties({}, {
      model: {
        enumerable: true,
        get() {
          reads += 1;
          return "unsafe";
        },
      },
      thinking: {
        enumerable: true,
        value: 1_000_001,
      },
      maxSteps: {
        enumerable: true,
        value: 1_001,
      },
    });

    assertEquals(extractSkillDelegationOverrides(hostile), {});
    assertEquals(reads, 0);
    assertEquals(
      extractSkillDelegationOverrides({
        model: "openai/gpt-5.1",
        thinking: 1_000_000,
        maxSteps: 1_000,
      }),
      {
        model: "openai/gpt-5.1",
        thinking: 1_000_000,
        maxSteps: 1_000,
      },
    );
  });

  it("fails closed for revoked proxy results", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    assertEquals(extractSkillDelegationOverrides(revoked.proxy), {});
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

  it("does not inject hosted child overrides into direct invoke_agent", () => {
    const input = {
      prompt: "Research reference system",
      description: "Research reference system",
    };

    assertEquals(
      applySkillDelegationOverridesToToolInput(
        "invoke_agent",
        input,
        { model: "opus", thinking: false, maxSteps: 160 },
        createInvokeAgentTool(),
      ),
      input,
    );
  });
});

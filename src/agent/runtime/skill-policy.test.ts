import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createInactiveSkillState,
  createRuntimeLoadedSkillState,
  enforceSkillPolicy,
  extractSkillPolicy,
  extractSkillToolAvailability,
  hasSubmittedFormInputResult,
  removeFormInputAfterSubmission,
} from "./skill-policy-enforcement.ts";
import type { Message } from "../types.ts";

describe("src/agent/runtime skill policy helpers", () => {
  describe("extractSkillPolicy", () => {
    it("should return undefined for null/non-object results", () => {
      assertEquals(extractSkillPolicy(null), undefined);
      assertEquals(extractSkillPolicy(undefined), undefined);
      assertEquals(extractSkillPolicy("string"), undefined);
      assertEquals(extractSkillPolicy(42), undefined);
    });

    it("should return undefined when allowedTools key is absent", () => {
      assertEquals(extractSkillPolicy({ instructions: "do stuff" }), undefined);
    });

    it("should return undefined when allowedTools is explicitly undefined", () => {
      assertEquals(extractSkillPolicy({ allowedTools: undefined }), undefined);
    });

    it("should return valid string array as-is", () => {
      assertEquals(extractSkillPolicy({ allowedTools: ["Read", "Write"] }), ["Read", "Write"]);
    });

    it("should return valid wildcard patterns", () => {
      assertEquals(extractSkillPolicy({ allowedTools: ["api:*", "Read"] }), ["api:*", "Read"]);
    });

    it("should fail closed (empty array) for non-array allowedTools", () => {
      assertEquals(extractSkillPolicy({ allowedTools: "Read Write" }), []);
      assertEquals(extractSkillPolicy({ allowedTools: 123 }), []);
      assertEquals(extractSkillPolicy({ allowedTools: true }), []);
      assertEquals(extractSkillPolicy({ allowedTools: { Read: true } }), []);
    });

    it("should fail closed (empty array) for array with non-string entries", () => {
      assertEquals(extractSkillPolicy({ allowedTools: ["Read", 123] }), []);
      assertEquals(extractSkillPolicy({ allowedTools: [null, "Write"] }), []);
    });

    it("should fail closed (empty array) for invalid patterns", () => {
      assertEquals(extractSkillPolicy({ allowedTools: ["Bash(git:*)"] }), []);
    });

    // Critical regression test: skill A (restricted) -> skill B (no restrictions)
    // must NOT accidentally grant unrestricted access
    it("should distinguish undefined (no restrictions) from empty result (no tools)", () => {
      // Skill with no allowedTools key -> no restrictions
      const noKey = extractSkillPolicy({ instructions: "hi" });
      assertEquals(noKey, undefined);

      // Skill with invalid allowedTools -> fail closed (no tools)
      const invalid = extractSkillPolicy({ allowedTools: 42 });
      assertEquals(invalid, []);

      // These are semantically different:
      // undefined -> "no restrictions, all tools allowed"
      // [] -> "empty policy, no tools allowed"
    });
  });

  describe("enforceSkillPolicy", () => {
    it("should allow any tool when no policy and no mustLoadFirst", () => {
      const result = enforceSkillPolicy("Read", undefined, false);
      assertEquals(result, { allowed: true });
    });

    it("should reject non-skill tools for empty policy", () => {
      const result = enforceSkillPolicy("Read", [], false);
      assertEquals(result.allowed, false);
    });

    it("should reject non-skill tools when mustLoadSkillFirst is true", () => {
      const result = enforceSkillPolicy("Read", undefined, true);
      assertEquals(result.allowed, false);
      assertEquals("error" in result && result.error.includes("load_skill"), true);
    });

    it("should allow load_skill even when mustLoadSkillFirst is true", () => {
      const result = enforceSkillPolicy("load_skill", undefined, true);
      assertEquals(result, { allowed: true });
    });

    it("should allow tool matching active policy", () => {
      const result = enforceSkillPolicy("Read", ["Read", "Write"], false);
      assertEquals(result, { allowed: true });
    });

    it("should reject tool not in active policy", () => {
      const result = enforceSkillPolicy("Bash", ["Read", "Write"], false);
      assertEquals(result.allowed, false);
    });

    it("blocks intake and skill reload tools after a submitted form without blocking delegation", () => {
      assertEquals(
        enforceSkillPolicy("form_input", ["studio_suggestions"], false).allowed,
        false,
      );
      for (const toolName of ["form_input", "load_skill"]) {
        const result = enforceSkillPolicy(toolName, [toolName], false, {
          hasSubmittedFormInput: true,
        });
        assertEquals(result.allowed, false);
      }
      assertEquals(
        enforceSkillPolicy("invoke_agent", ["invoke_agent"], false, {
          hasSubmittedFormInput: true,
        }),
        { allowed: true },
      );
      assertEquals(
        enforceSkillPolicy("create_agent", ["create_agent"], false, {
          hasSubmittedFormInput: true,
        }),
        { allowed: true },
      );
    });

    it("should always allow load_skill regardless of policy", () => {
      assertEquals(enforceSkillPolicy("load_skill", ["Read"], false), { allowed: true });
      assertEquals(enforceSkillPolicy("load_skill_reference", ["Read"], false).allowed, false);
      assertEquals(enforceSkillPolicy("execute_skill_script", ["Read"], false).allowed, false);
    });

    it("allows load_skill_reference only when the active skill advertised references", () => {
      assertEquals(
        enforceSkillPolicy("load_skill_reference", ["Read"], false, {
          skillToolAvailability: {
            hasActiveSkill: true,
            references: ["references/guide.md"],
            scripts: [],
          },
        }),
        { allowed: true },
      );

      const result = enforceSkillPolicy("load_skill_reference", ["Read"], false, {
        skillToolAvailability: {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        },
      });
      assertEquals(result.allowed, false);
    });

    it("allows execute_skill_script only when the active skill advertised scripts", () => {
      assertEquals(
        enforceSkillPolicy("execute_skill_script", ["Read"], false, {
          skillToolAvailability: {
            hasActiveSkill: true,
            references: [],
            scripts: ["scripts/run.sh"],
          },
        }),
        { allowed: true },
      );

      const result = enforceSkillPolicy("execute_skill_script", ["Read"], false, {
        skillToolAvailability: {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        },
      });
      assertEquals(result.allowed, false);
    });

    it("should allow wildcard-matched tools", () => {
      const result = enforceSkillPolicy("api:list-users", ["api:*"], false);
      assertEquals(result, { allowed: true });
    });

    it("should reject tools not matching wildcard", () => {
      const result = enforceSkillPolicy("db:query", ["api:*"], false);
      assertEquals(result.allowed, false);
    });

    // Skill A -> Skill B policy transition simulation
    it("should enforce new policy after skill switch", () => {
      // Skill A: only Read allowed
      const policyA: string[] = ["Read"];
      assertEquals(enforceSkillPolicy("Read", policyA, false), { allowed: true });
      assertEquals(enforceSkillPolicy("Write", policyA, false).allowed, false);

      // Skill B: only Write allowed
      const policyB: string[] = ["Write"];
      assertEquals(enforceSkillPolicy("Write", policyB, false), { allowed: true });
      assertEquals(enforceSkillPolicy("Read", policyB, false).allowed, false);

      // Skill C: no restrictions (undefined)
      assertEquals(enforceSkillPolicy("Read", undefined, false), { allowed: true });
      assertEquals(enforceSkillPolicy("Write", undefined, false), { allowed: true });
      assertEquals(enforceSkillPolicy("Bash", undefined, false), { allowed: true });
    });
  });

  describe("extractSkillToolAvailability", () => {
    it("extracts references and scripts from load_skill results", () => {
      assertEquals(
        extractSkillToolAvailability({
          instructions: "# Support",
          references: ["references/guide.md"],
          scripts: ["scripts/run.sh"],
        }),
        {
          hasActiveSkill: true,
          references: ["references/guide.md"],
          scripts: ["scripts/run.sh"],
        },
      );
    });

    it("returns an active skill with empty file capabilities for no-reference skills", () => {
      assertEquals(
        extractSkillToolAvailability({
          instructions: "# Support",
          allowedTools: ["search_knowledge"],
          references: [],
          scripts: [],
        }),
        {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        },
      );
    });

    it("ignores non-load-skill error results", () => {
      assertEquals(
        extractSkillToolAvailability({
          error: "Skill not found",
        }),
        undefined,
      );
    });
  });

  describe("removeFormInputAfterSubmission", () => {
    it("removes form_input from the active policy after a submitted form result", () => {
      assertEquals(
        removeFormInputAfterSubmission("form_input", { submitted: true }, undefined, [
          "form_input",
          "inspect_source",
          "write_output",
        ]),
        ["inspect_source", "write_output"],
      );
    });

    it("keeps form_input available for non-submitted or non-form tool results", () => {
      assertEquals(
        removeFormInputAfterSubmission("form_input", { submitted: false }, "any-skill", [
          "form_input",
          "inspect_source",
        ]),
        ["form_input", "inspect_source"],
      );
      assertEquals(
        removeFormInputAfterSubmission("inspect_source", { submitted: true }, "any-skill", [
          "form_input",
          "inspect_source",
        ]),
        ["form_input", "inspect_source"],
      );
    });

    it("applies the same post-submission transition to every skill id", () => {
      const policy = ["form_input", "inspect_source", "write_output"];
      for (const skillId of ["alpha", "plan", "research", "custom-workflow"]) {
        assertEquals(
          removeFormInputAfterSubmission("form_input", { submitted: true }, skillId, policy),
          ["inspect_source", "write_output"],
        );
      }
    });
  });

  describe("invocation Skill state", () => {
    it("returns inactive skill tool availability before a skill is loaded", () => {
      const state = createInactiveSkillState();

      assertEquals(state.activeSkillId, undefined);
      assertEquals(state.activeSkillPolicy, undefined);
      assertEquals(state.activeSkillDelegationOverrides, undefined);
      assertEquals(state.activeSkillToolAvailability, {
        hasActiveSkill: false,
        references: [],
        scripts: [],
      });
      assertEquals(Object.isFrozen(state.activeSkillToolAvailability), true);
      assertEquals(Object.isFrozen(state.activeSkillToolAvailability.references), true);
      assertEquals(Object.isFrozen(state.activeSkillToolAvailability.scripts), true);
    });

    it("detects a submitted form_input result in message history", () => {
      const messages: Message[] = [
        {
          id: "tool_form_input",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "form_input_1",
            toolName: "form_input",
            result: { submitted: true, values: { topic: "Support FAQ assistant" } },
          }],
        },
      ];

      assertEquals(hasSubmittedFormInputResult(messages), true);
      assertEquals(
        hasSubmittedFormInputResult([{
          id: "tool_form_input_string",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "form_input_string",
            toolName: "form_input",
            result: JSON.stringify({ submitted: true, values: { topic: "Support FAQ assistant" } }),
          }],
        }]),
        true,
      );
      assertEquals(
        hasSubmittedFormInputResult([{
          id: "tool_form_input_nested",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "form_input_nested",
            toolName: "form_input",
            result: { response: { submitted: true, values: { topic: "Support FAQ assistant" } } },
          }],
        }]),
        true,
      );
      assertEquals(
        hasSubmittedFormInputResult([{
          id: "tool_form_input_pending",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "form_input_2",
            toolName: "form_input",
            result: { submitted: false, values: {} },
          }],
        }]),
        false,
      );
      assertEquals(
        hasSubmittedFormInputResult([
          {
            id: "tool_form_input_old",
            role: "tool",
            parts: [{
              type: "tool-result",
              toolCallId: "form_input_old",
              toolName: "form_input",
              result: { submitted: true, values: { topic: "old topic" } },
            }],
          },
          {
            id: "user_new_turn",
            role: "user",
            parts: [{ type: "text", text: "Start something new" }],
          },
        ]),
        false,
      );
    });

    it("creates active state from a runtime-executed load_skill result", () => {
      const state = createRuntimeLoadedSkillState({
        skillId: "new",
        allowedTools: ["Write"],
        references: [],
        scripts: ["scripts/run.sh"],
        model: "openai/gpt-5.1",
        thinking: false,
        maxSteps: 8,
      });

      assertEquals(state.activeSkillId, "new");
      assertEquals(state.activeSkillPolicy, ["Write"]);
      assertEquals(state.activeSkillToolAvailability, {
        hasActiveSkill: true,
        references: [],
        scripts: ["scripts/run.sh"],
      });
      assertEquals(state.activeSkillDelegationOverrides, {
        model: "openai/gpt-5.1",
        thinking: false,
        maxSteps: 8,
      });
    });
  });
});

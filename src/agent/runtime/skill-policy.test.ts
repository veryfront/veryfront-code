import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  enforceSkillPolicy,
  extractSkillPolicy,
  hydrateActiveSkillStateFromMessages,
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

    it("should always allow skill system tools regardless of policy", () => {
      assertEquals(enforceSkillPolicy("load_skill", ["Read"], false), { allowed: true });
      assertEquals(enforceSkillPolicy("load_skill_reference", ["Read"], false), {
        allowed: true,
      });
      assertEquals(enforceSkillPolicy("execute_skill_script", ["Read"], false), {
        allowed: true,
      });
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

  describe("removeFormInputAfterSubmission", () => {
    it("removes form_input from the active policy after a submitted form result", () => {
      assertEquals(
        removeFormInputAfterSubmission("form_input", { submitted: true }, [
          "form_input",
          "studio_suggestions",
          "create_file",
        ]),
        ["studio_suggestions", "create_file"],
      );
    });

    it("keeps form_input available for non-submitted or non-form tool results", () => {
      assertEquals(
        removeFormInputAfterSubmission("form_input", { submitted: false }, [
          "form_input",
          "studio_suggestions",
        ]),
        ["form_input", "studio_suggestions"],
      );
      assertEquals(
        removeFormInputAfterSubmission("web_search", { submitted: true }, [
          "form_input",
          "web_search",
        ]),
        ["form_input", "web_search"],
      );
    });
  });

  describe("hydrateActiveSkillStateFromMessages", () => {
    it("hydrates the latest load_skill policy and delegation overrides from tool history", () => {
      const messages: Message[] = [
        {
          id: "tool_load_skill_old",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "load_skill_old",
            toolName: "load_skill",
            result: {
              allowedTools: ["Read"],
              model: "anthropic/claude-sonnet-4-5",
              thinking: true,
              maxSteps: 4,
            },
          }],
        },
        {
          id: "tool_other",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "other_tool",
            toolName: "read_file",
            result: { allowedTools: ["Bash"] },
          }],
        },
        {
          id: "tool_load_skill_new",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "load_skill_new",
            toolName: "load_skill",
            result: {
              allowedTools: ["Write"],
              model: "openai/gpt-5.1",
              thinking: false,
              maxSteps: 8,
            },
          }],
        },
      ];

      const hydrated = hydrateActiveSkillStateFromMessages(messages);

      assertEquals(hydrated.activeSkillPolicy, ["Write"]);
      assertEquals(hydrated.activeSkillDelegationOverrides, {
        model: "openai/gpt-5.1",
        thinking: false,
        maxSteps: 8,
      });
    });
  });
});

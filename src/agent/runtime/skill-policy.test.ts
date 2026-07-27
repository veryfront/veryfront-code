import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  applySkillActivationResult,
  enforceSkillPolicy,
  extractSkillPolicy,
  extractSkillToolAvailability,
  hasSubmittedFormInputResult,
  hydrateActiveSkillStateFromMessages,
  INACTIVE_SKILL_TOOL_AVAILABILITY,
  isSkillBodyLoadRequest,
  removeFormInputAfterSubmission,
} from "./skill-policy-enforcement.ts";
import type { Message } from "../types.ts";
import {
  SKILL_ALLOWED_TOOL_MAX_PATTERNS,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import {
  markRuntimeGeneratedUserMessage,
} from "./runtime-message-origin.ts";

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

    it("captures a detached immutable active policy", () => {
      const allowedTools = ["Read"];
      const policy = extractSkillPolicy({ allowedTools });

      allowedTools[0] = "Write";
      allowedTools.push("Delete");

      assertEquals(policy, ["Read"]);
      assertEquals(Object.isFrozen(policy), true);
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

    it("rejects oversized and unreadable policy arrays before traversing them", () => {
      assertEquals(
        extractSkillPolicy({
          allowedTools: Array.from(
            { length: SKILL_ALLOWED_TOOL_MAX_PATTERNS + 1 },
            (_unused, index) => `tool_${index}`,
          ),
        }),
        [],
      );

      let lengthReads = 0;
      const hostile = new Proxy(["Read"], {
        getOwnPropertyDescriptor(target, key) {
          if (key === "length") {
            lengthReads += 1;
            throw new Error("length trap");
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      assertEquals(extractSkillPolicy({ allowedTools: hostile }), []);
      assertEquals(lengthReads, 1);
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

    it("blocks repeated intake after a submitted form without blocking skill references", () => {
      assertEquals(
        enforceSkillPolicy("form_input", ["studio_suggestions"], false).allowed,
        false,
      );
      const formResult = enforceSkillPolicy("form_input", ["form_input"], false, {
        hasSubmittedFormInput: true,
      });
      assertEquals(formResult.allowed, false);
      assertEquals(
        enforceSkillPolicy("load_skill", ["load_skill"], false, {
          activeSkillId: "plan",
          hasSubmittedFormInput: true,
          skillToolAvailability: {
            hasActiveSkill: true,
            references: ["references/guide.md"],
            scripts: [],
          },
          toolInput: { skillId: "plan", file: "references/guide.md" },
        }),
        { allowed: true },
      );
      assertEquals(
        enforceSkillPolicy("load_skill", ["load_skill"], false, {
          activeSkillId: "plan",
          hasSubmittedFormInput: true,
          toolInput: { skillId: "plan" },
        }).allowed,
        false,
      );
      assertEquals(
        enforceSkillPolicy("load_skill", ["load_skill"], false, {
          activeSkillId: "plan",
          hasSubmittedFormInput: true,
          toolInput: { skillId: "research", file: "references/guide.md" },
        }).allowed,
        false,
      );
      assertEquals(
        enforceSkillPolicy("load_skill", ["load_skill"], false, {
          activeSkillId: "plan",
          hasSubmittedFormInput: true,
          skillToolAvailability: {
            hasActiveSkill: true,
            references: ["references/guide.md"],
            scripts: [],
          },
          toolInput: { skillId: "plan", file: "resources/secret.md" },
        }).allowed,
        false,
      );
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

  describe("isSkillBodyLoadRequest", () => {
    it("distinguishes body activation from reference reads and malformed calls", () => {
      assertEquals(
        isSkillBodyLoadRequest("load_skill", { skillId: "research" }),
        true,
      );
      assertEquals(
        isSkillBodyLoadRequest("load_skill", {
          skillId: "research",
          file: "references/guide.md",
        }),
        false,
      );
      assertEquals(isSkillBodyLoadRequest("load_skill", {}), false);
      assertEquals(
        isSkillBodyLoadRequest("other_tool", { skillId: "research" }),
        false,
      );
    });

    it("does not invoke an accessor-backed file property", () => {
      let reads = 0;
      const input = Object.defineProperty(
        { skillId: "research" },
        "file",
        {
          enumerable: true,
          get() {
            reads += 1;
            return undefined;
          },
        },
      );

      assertEquals(isSkillBodyLoadRequest("load_skill", input), false);
      assertEquals(reads, 0);
    });
  });

  describe("extractSkillToolAvailability", () => {
    it("extracts references and scripts from load_skill results", () => {
      const references = [
        "references/guide.md",
        "resources/schema.json",
        "assets/template.txt",
      ];
      const scripts = ["scripts/run.sh"];
      const availability = extractSkillToolAvailability({
        skillId: "support",
        instructions: "# Support",
        references,
        scripts,
      });

      references.push("references/injected.md");
      scripts.length = 0;

      assertEquals(
        availability,
        {
          hasActiveSkill: true,
          references: [
            "references/guide.md",
            "resources/schema.json",
            "assets/template.txt",
          ],
          scripts: ["scripts/run.sh"],
        },
      );
      assertEquals(Object.isFrozen(availability), true);
      assertEquals(Object.isFrozen(availability?.references), true);
      assertEquals(Object.isFrozen(availability?.scripts), true);
    });

    it("returns an active skill with empty file capabilities for no-reference skills", () => {
      assertEquals(
        extractSkillToolAvailability({
          skillId: "support",
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

    it("fails closed on non-canonical or cross-directory file capabilities", () => {
      assertEquals(
        extractSkillToolAvailability({
          skillId: "support",
          instructions: "# Support",
          references: ["references/guide.md", "../secret.md"],
          scripts: ["scripts/run.sh"],
        }),
        {
          hasActiveSkill: true,
          references: [],
          scripts: ["scripts/run.sh"],
        },
      );
      assertEquals(
        extractSkillToolAvailability({
          skillId: "support",
          instructions: "# Support",
          references: ["scripts/not-a-reference.md"],
          scripts: ["references/not-a-script.sh"],
        }),
        {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        },
      );
    });

    it("deduplicates file capabilities without retaining caller arrays", () => {
      assertEquals(
        extractSkillToolAvailability({
          skillId: "support",
          instructions: "# Support",
          references: ["references/guide.md", "references/guide.md"],
          scripts: ["scripts/run.sh", "scripts/run.sh"],
        }),
        {
          hasActiveSkill: true,
          references: ["references/guide.md"],
          scripts: ["scripts/run.sh"],
        },
      );
    });

    it("accepts the exact merged reference budget and rejects overflow", () => {
      const prefixes = ["references", "resources", "assets"];
      const references = prefixes.flatMap((prefix) =>
        Array.from(
          { length: SKILL_SUBDIR_MAX_ENTRIES },
          (_unused, index) => `${prefix}/${index}.txt`,
        )
      );
      assertEquals(references.length, SKILL_LOADABLE_REFERENCE_MAX_ENTRIES);
      assertEquals(
        extractSkillToolAvailability({
          skillId: "support",
          instructions: "# Support",
          references,
          scripts: [],
        })?.references?.length,
        SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
      );
      assertEquals(
        extractSkillToolAvailability({
          skillId: "support",
          instructions: "# Support",
          references: [...references, "assets/overflow.txt"],
          scripts: [],
        })?.references,
        [],
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
      const narrowed = removeFormInputAfterSubmission(
        "form_input",
        { submitted: true },
        [
          "form_input",
          "studio_suggestions",
          "create_file",
        ],
      );
      assertEquals(narrowed, ["studio_suggestions", "create_file"]);
      assertEquals(Object.isFrozen(narrowed), true);
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

    it("removes only form_input without inferring policy from a shadowable skill id", () => {
      assertEquals(
        removeFormInputAfterSubmission("form_input", { submitted: true }, [
          "form_input",
          "studio_suggestions",
          "list_files",
          "get_file",
          "search_files",
          "create_file",
          "update_file",
          "web_search",
        ]),
        [
          "studio_suggestions",
          "list_files",
          "get_file",
          "search_files",
          "create_file",
          "update_file",
          "web_search",
        ],
      );
      assertEquals(
        removeFormInputAfterSubmission(
          "form_input",
          { submitted: true },
          [
            "form_input",
            "studio_suggestions",
            "list_files",
            "create_file",
          ],
        ),
        ["studio_suggestions", "list_files", "create_file"],
      );
    });

    it("keeps agent design tools available after create-agent intake", () => {
      assertEquals(
        removeFormInputAfterSubmission("form_input", { submitted: true }, [
          "form_input",
          "studio_suggestions",
          "create_agent",
          "create_skill",
          "create_tool",
          "create_file",
          "update_file",
          "list_integrations",
          "get_integration",
          "get_user_oauth_status",
          "list_user_oauth_integrations",
          "web_fetch",
        ]),
        [
          "studio_suggestions",
          "create_agent",
          "create_skill",
          "create_tool",
          "create_file",
          "update_file",
          "list_integrations",
          "get_integration",
          "get_user_oauth_status",
          "list_user_oauth_integrations",
          "web_fetch",
        ],
      );
    });

    it("keeps workflow primitive tools available after create-agentic-workflow intake", () => {
      assertEquals(
        removeFormInputAfterSubmission(
          "form_input",
          { submitted: true },
          [
            "form_input",
            "studio_suggestions",
            "create_workflow",
            "create_agent",
            "create_skill",
            "create_tool",
            "list_files",
            "get_file",
            "search_files",
            "create_file",
            "update_file",
            "web_search",
            "web_fetch",
          ],
        ),
        [
          "studio_suggestions",
          "create_workflow",
          "create_agent",
          "create_skill",
          "create_tool",
          "list_files",
          "get_file",
          "search_files",
          "create_file",
          "update_file",
          "web_search",
          "web_fetch",
        ],
      );
    });

    it("preserves every declared research tool except form_input", () => {
      assertEquals(
        removeFormInputAfterSubmission("form_input", { submitted: true }, [
          "form_input",
          "studio_suggestions",
          "web_search",
          "web_fetch",
          "list_files",
          "get_file",
          "create_file",
          "update_file",
        ]),
        [
          "studio_suggestions",
          "web_search",
          "web_fetch",
          "list_files",
          "get_file",
          "create_file",
          "update_file",
        ],
      );
    });
  });

  describe("applySkillActivationResult", () => {
    it("commits a validated activation atomically and preserves it for references/errors", () => {
      const initial = {
        activeSkillId: undefined,
        activeSkillPolicy: undefined,
        activeSkillToolAvailability: INACTIVE_SKILL_TOOL_AVAILABILITY,
        activeSkillDelegationOverrides: undefined,
      };
      const activated = applySkillActivationResult(initial, {
        skillId: "research",
        instructions: "# Research",
        allowedTools: ["web_search"],
        references: ["references/guide.md"],
        scripts: [],
        model: "openai/gpt-5.1",
        maxSteps: 12,
      });

      assertEquals(activated, {
        activeSkillId: "research",
        activeSkillPolicy: ["web_search"],
        activeSkillToolAvailability: {
          hasActiveSkill: true,
          references: ["references/guide.md"],
          scripts: [],
        },
        activeSkillDelegationOverrides: {
          model: "openai/gpt-5.1",
          maxSteps: 12,
        },
      });
      assertEquals(
        applySkillActivationResult(activated, {
          skillId: "research",
          file: "references/guide.md",
          content: "# Guide",
        }),
        activated,
      );
      assertEquals(
        applySkillActivationResult(activated, { error: "Reference unavailable" }),
        activated,
      );
      assertEquals(
        applySkillActivationResult(activated, {
          skillId: "unsafe",
          instructions: "# Unsafe",
          isError: true,
        }),
        activated,
      );
    });

    it("does not invoke accessors or partially replace active state", () => {
      let reads = 0;
      const hostile = Object.defineProperty(
        {
          skillId: "hostile",
          instructions: "# Hostile",
        },
        "allowedTools",
        {
          enumerable: true,
          get() {
            reads += 1;
            return ["unsafe"];
          },
        },
      );
      const initial = {
        activeSkillId: "safe",
        activeSkillPolicy: ["read"],
        activeSkillToolAvailability: {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        },
        activeSkillDelegationOverrides: undefined,
      };

      assertEquals(applySkillActivationResult(initial, hostile), {
        activeSkillId: "hostile",
        activeSkillPolicy: [],
        activeSkillToolAvailability: {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        },
        activeSkillDelegationOverrides: {},
      });
      assertEquals(reads, 0);
    });

    it("does not throw when activation capability arrays trap length reads", () => {
      let lengthReads = 0;
      const hostileReferences = new Proxy(["references/guide.md"], {
        getOwnPropertyDescriptor(target, key) {
          if (key === "length") {
            lengthReads += 1;
            throw new Error("length trap");
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      const initial = {
        activeSkillId: undefined,
        activeSkillPolicy: undefined,
        activeSkillToolAvailability: INACTIVE_SKILL_TOOL_AVAILABILITY,
        activeSkillDelegationOverrides: undefined,
      };

      assertEquals(
        applySkillActivationResult(initial, {
          skillId: "safe",
          instructions: "# Safe",
          allowedTools: ["Read"],
          references: hostileReferences,
          scripts: [],
        }),
        {
          activeSkillId: "safe",
          activeSkillPolicy: ["Read"],
          activeSkillToolAvailability: {
            hasActiveSkill: true,
            references: [],
            scripts: [],
          },
          activeSkillDelegationOverrides: {},
        },
      );
      assertEquals(lengthReads, 1);
    });
  });

  describe("hydrateActiveSkillStateFromMessages", () => {
    it("returns inactive skill tool availability before a skill is loaded", () => {
      const hydrated = hydrateActiveSkillStateFromMessages([]);

      assertEquals(hydrated.activeSkillToolAvailability, {
        hasActiveSkill: false,
        references: [],
        scripts: [],
      });
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
          id: "tool_form_input_conflicting",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "form_input_conflicting",
            toolName: "form_input",
            result: {
              submitted: false,
              values: { submitted: true },
              response: { submitted: true },
            },
          }],
        }]),
        false,
      );
      let submittedReads = 0;
      const accessorResult = Object.defineProperty({}, "submitted", {
        enumerable: true,
        get() {
          submittedReads += 1;
          return true;
        },
      });
      assertEquals(
        hasSubmittedFormInputResult([{
          id: "tool_form_input_accessor",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "form_input_accessor",
            toolName: "form_input",
            result: accessorResult,
          }],
        }]),
        false,
      );
      assertEquals(submittedReads, 0);
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
      for (
        const result of [
          { submitted: true, error: "form failed" },
          { submitted: true, isError: true },
          { response: { submitted: true, error: "form failed" } },
        ]
      ) {
        assertEquals(
          hasSubmittedFormInputResult([{
            id: "tool_form_input_error",
            role: "tool",
            parts: [{
              type: "tool-result",
              toolCallId: "form_input_error",
              toolName: "form_input",
              result,
            }],
          }]),
          false,
        );
      }
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
      assertEquals(
        hasSubmittedFormInputResult([
          {
            id: "tool_form_input_before_recovery",
            role: "tool",
            parts: [{
              type: "tool-result",
              toolCallId: "form_input_before_recovery",
              toolName: "form_input",
              result: { submitted: true, values: { topic: "preserve me" } },
            }],
          },
          markRuntimeGeneratedUserMessage({
            id: "runtime_recovery_note",
            role: "user",
            parts: [{ type: "text", text: "Retry with available tools." }],
          }),
        ]),
        true,
      );
      assertEquals(
        hasSubmittedFormInputResult([
          {
            id: "tool_form_input_before_metadata_collision",
            role: "tool",
            parts: [{
              type: "tool-result",
              toolCallId: "form_input_before_metadata_collision",
              toolName: "form_input",
              result: { submitted: true, values: { topic: "must reset" } },
            }],
          },
          {
            id: "real_user_with_reserved-looking_metadata",
            role: "user",
            parts: [{ type: "text", text: "This is a real new turn." }],
            metadata: {
              __veryfrontRuntimeGeneratedUserMessage: "unavailable-tool-recovery",
            },
          },
        ]),
        false,
      );
    });

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
              skillId: "old",
              instructions: "# Old",
              allowedTools: ["Read"],
              references: ["references/old.md"],
              scripts: [],
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
              skillId: "new",
              instructions: "# New",
              allowedTools: ["Write"],
              references: [],
              scripts: ["scripts/run.sh"],
              model: "openai/gpt-5.1",
              thinking: false,
              maxSteps: 8,
            },
          }],
        },
        {
          id: "tool_load_skill_reference",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "load_skill_reference",
            toolName: "load_skill",
            result: {
              skillId: "new",
              file: "references/guide.md",
              content: "# Guide",
            },
          }],
        },
        {
          id: "tool_load_skill_error",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "load_skill_error",
            toolName: "load_skill",
            result: { error: "Missing reference" },
          }],
        },
      ];

      const hydrated = hydrateActiveSkillStateFromMessages(messages);

      assertEquals(hydrated.activeSkillId, "new");
      assertEquals(hydrated.activeSkillPolicy, ["Write"]);
      assertEquals(hydrated.activeSkillToolAvailability, {
        hasActiveSkill: true,
        references: [],
        scripts: ["scripts/run.sh"],
      });
      assertEquals(hydrated.activeSkillDelegationOverrides, {
        model: "openai/gpt-5.1",
        thinking: false,
        maxSteps: 8,
      });
    });

    it("keeps the latest active skill across later user turns", () => {
      const hydrated = hydrateActiveSkillStateFromMessages([
        {
          id: "skill-result",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "load-skill",
            toolName: "load_skill",
            result: {
              skillId: "review",
              instructions: "# Review",
              allowedTools: ["Read"],
              references: [],
              scripts: [],
            },
          }],
        },
        {
          id: "later-user-turn",
          role: "user",
          parts: [{ type: "text", text: "Continue the conversation" }],
        },
      ]);

      assertEquals(hydrated.activeSkillId, "review");
      assertEquals(hydrated.activeSkillPolicy, ["Read"]);
    });
  });
});

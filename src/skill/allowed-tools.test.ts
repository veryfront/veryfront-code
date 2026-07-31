import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  filterToolNamesForSkill,
  filterToolsForSkill,
  isToolAllowedBySkill,
  matchesAllowedTool,
  snapshotAllowedToolPatterns,
  validateAllowedToolPatterns,
  validateStrictAllowedToolPatterns,
} from "./allowed-tools.ts";
import { SKILL_ALLOWED_TOOL_PATTERN_REGEX, SKILL_TOOL_IDS } from "./types.ts";

describe("src/skill/allowed-tools", () => {
  describe("snapshotAllowedToolPatterns", () => {
    it("does not invoke inherited indexed setters while building authorization snapshots", () => {
      const inherited = Object.getOwnPropertyDescriptor(Array.prototype, "0");
      let setterCalls = 0;
      let snapshot: string[] | undefined;
      try {
        Object.defineProperty(Array.prototype, "0", {
          configurable: true,
          set(this: unknown[], _value: unknown) {
            setterCalls += 1;
            Object.defineProperty(this, "0", {
              configurable: true,
              enumerable: true,
              value: "api:*",
              writable: true,
            });
          },
        });
        snapshot = snapshotAllowedToolPatterns(["Read"]);
      } finally {
        if (inherited === undefined) {
          delete (Array.prototype as { 0?: unknown })[0];
        } else {
          Object.defineProperty(Array.prototype, "0", inherited);
        }
      }

      assertEquals(setterCalls, 0);
      assertEquals(snapshot, ["Read"]);
    });

    it("should snapshot array data properties without invoking an overridden iterator", () => {
      let iteratorGetterReads = 0;
      const patterns = ["read_file"];
      Object.defineProperty(patterns, Symbol.iterator, {
        configurable: true,
        get() {
          iteratorGetterReads += 1;
          throw new Error("allowed-tools iterator getter must not run");
        },
      });

      assertEquals(snapshotAllowedToolPatterns(patterns), ["read_file"]);
      assertEquals(iteratorGetterReads, 0);
    });

    it("should reject element accessors without invoking them", () => {
      let elementGetterReads = 0;
      const patterns: string[] = [];
      Object.defineProperty(patterns, 0, {
        enumerable: true,
        get() {
          elementGetterReads += 1;
          return "read_file";
        },
      });

      assertThrows(
        () => snapshotAllowedToolPatterns(patterns),
        TypeError,
        "data property",
      );
      assertEquals(elementGetterReads, 0);
    });
  });

  describe("matchesAllowedTool", () => {
    it("should match exact tool name", () => {
      assertEquals(matchesAllowedTool("Read", "Read"), true);
    });

    it("should not match different tool name", () => {
      assertEquals(matchesAllowedTool("Write", "Read"), false);
    });

    it("should match prefix wildcard", () => {
      assertEquals(matchesAllowedTool("api:list-users", "api:*"), true);
    });

    it("should not match different prefix", () => {
      assertEquals(matchesAllowedTool("db:query", "api:*"), false);
    });

    it("should return false for invalid pattern", () => {
      assertEquals(matchesAllowedTool("Read", "Bash(git:*)"), false);
    });

    it("should reject double-colon patterns", () => {
      assertEquals(matchesAllowedTool("api::list", "api::*"), false);
    });

    it("should reject leading digit patterns", () => {
      assertEquals(matchesAllowedTool("123tool", "123tool"), false);
    });

    it("should reject trailing colon patterns", () => {
      assertEquals(matchesAllowedTool("api:", "api:"), false);
    });
  });

  describe("filterToolsForSkill", () => {
    const tools = [
      { name: "Read", description: "Read", parameters: {} },
      { name: "Write", description: "Write", parameters: {} },
      { name: "api:list", description: "API", parameters: {} },
      { name: "load_skill", description: "Load", parameters: {} },
      { name: "load_skill_reference", description: "Load reference", parameters: {} },
      { name: "execute_skill_script", description: "Execute script", parameters: {} },
    ];

    it("should return all tools when allowedTools is undefined", () => {
      const result = filterToolsForSkill(tools, undefined);
      assertEquals(result.length, 6);
    });

    it("should constrain skill infrastructure tools when allowedTools is undefined", () => {
      const result = filterToolsForSkill(tools, undefined, {
        hasActiveSkill: true,
        references: [],
        scripts: [],
      });

      assertEquals(result.map((t) => t.name), [
        "Read",
        "Write",
        "api:list",
        "load_skill",
      ]);
    });

    it("should return only load_skill when allowedTools is empty and no skill files are available", () => {
      const result = filterToolsForSkill(tools, []);
      assertEquals(result.length, 1);
      assertEquals(result.map((t) => t.name), ["load_skill"]);
    });

    it("should filter to allowed tools plus load_skill when no skill files are available", () => {
      const result = filterToolsForSkill(tools, ["Read"]);
      assertEquals(result.length, 2); // Read + load_skill
      assertEquals(result.map((t) => t.name).sort(), ["Read", "load_skill"]);
    });

    it("should expose load_skill_reference only when policy and active files allow it", () => {
      const result = filterToolsForSkill(tools, ["Read", "load_skill_reference"], {
        hasActiveSkill: true,
        references: ["references/guide.md"],
        scripts: [],
      });

      assertEquals(result.map((t) => t.name).sort(), [
        "Read",
        "load_skill",
        "load_skill_reference",
      ]);
    });

    it("should expose execute_skill_script only when policy and active files allow it", () => {
      const result = filterToolsForSkill(tools, ["Read", "execute_skill_script"], {
        hasActiveSkill: true,
        references: [],
        scripts: ["scripts/run.sh"],
      });

      assertEquals(result.map((t) => t.name).sort(), [
        "Read",
        "execute_skill_script",
        "load_skill",
      ]);
    });

    it("should support prefix wildcards", () => {
      const result = filterToolsForSkill(tools, ["api:*"]);
      assertEquals(result.length, 2); // api:list + load_skill
    });

    it("should always include load_skill", () => {
      const result = filterToolsForSkill(tools, ["Write"]);
      assertEquals(result.some((t) => t.name === "load_skill"), true);
      assertEquals(result.some((t) => t.name === "load_skill_reference"), false);
      assertEquals(result.some((t) => t.name === "execute_skill_script"), false);
    });

    it("denies advertised skill file tools for an explicit empty policy", () => {
      const result = filterToolsForSkill(tools, [], {
        hasActiveSkill: true,
        references: ["references/guide.md"],
        scripts: ["scripts/run.sh"],
      });

      assertEquals(result.map((tool) => tool.name), ["load_skill"]);
    });
  });

  describe("filterToolNamesForSkill", () => {
    it("applies exact and prefix policies to name-only tool inventories", () => {
      assertEquals(
        filterToolNamesForSkill(
          ["web_search", "mail:read", "mail:send"],
          ["web_search", "mail:*"],
        ),
        ["web_search", "mail:read", "mail:send"],
      );
      assertEquals(
        filterToolNamesForSkill(
          ["web_search", "mail:read"],
          ["mail:*"],
        ),
        ["mail:read"],
      );
    });

    it("denies every non-infrastructure tool for an explicit empty policy", () => {
      assertEquals(filterToolNamesForSkill(["web_search", "web_fetch"], []), []);
    });

    it("denies advertised skill file tools unless a declared policy matches them", () => {
      const availability = {
        hasActiveSkill: true,
        references: ["references/guide.md"],
        scripts: ["scripts/run.sh"],
      };
      assertEquals(
        filterToolNamesForSkill(
          ["load_skill", "load_skill_reference", "execute_skill_script"],
          [],
          availability,
        ),
        ["load_skill"],
      );
      assertEquals(
        filterToolNamesForSkill(
          ["load_skill", "load_skill_reference", "execute_skill_script"],
          ["load_skill_reference"],
          availability,
        ),
        ["load_skill", "load_skill_reference"],
      );
    });

    it("preserves unrestricted name-only inventories when no policy is active", () => {
      assertEquals(
        filterToolNamesForSkill(["web_search", "web_fetch"], undefined),
        ["web_search", "web_fetch"],
      );
    });
  });

  describe("isToolAllowedBySkill", () => {
    it("does not let mutations of the public tool-id snapshot alter enforcement", () => {
      SKILL_TOOL_IDS.delete("load_skill");
      try {
        assertEquals(isToolAllowedBySkill("load_skill", []), true);
      } finally {
        SKILL_TOOL_IDS.add("load_skill");
      }
    });

    it("should allow all tools when no policy", () => {
      assertEquals(isToolAllowedBySkill("anything", undefined), true);
    });

    it("should still constrain skill infrastructure tools when no policy", () => {
      assertEquals(
        isToolAllowedBySkill("load_skill_reference", undefined, {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        }),
        false,
      );
      assertEquals(
        isToolAllowedBySkill("Read", undefined, {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        }),
        true,
      );
    });

    it("should deny non-skill tools when empty policy", () => {
      assertEquals(isToolAllowedBySkill("anything", []), false);
    });

    it("should allow only load_skill when empty policy and no active skill files are available", () => {
      assertEquals(isToolAllowedBySkill("load_skill", []), true);
      assertEquals(isToolAllowedBySkill("load_skill_reference", []), false);
      assertEquals(isToolAllowedBySkill("execute_skill_script", []), false);
    });

    it("should allow matching tool", () => {
      assertEquals(isToolAllowedBySkill("Read", ["Read", "Write"]), true);
    });

    it("should reject non-matching tool", () => {
      assertEquals(isToolAllowedBySkill("Bash", ["Read", "Write"]), false);
    });

    it("should always allow load_skill", () => {
      assertEquals(isToolAllowedBySkill("load_skill", ["Read"]), true);
      assertEquals(isToolAllowedBySkill("load_skill_reference", ["Read"]), false);
      assertEquals(isToolAllowedBySkill("execute_skill_script", ["Read"]), false);
    });

    it("should allow load_skill_reference only when policy and active files allow it", () => {
      assertEquals(
        isToolAllowedBySkill("load_skill_reference", ["Read", "load_skill_reference"], {
          hasActiveSkill: true,
          references: ["references/guide.md"],
          scripts: [],
        }),
        true,
      );
      assertEquals(
        isToolAllowedBySkill("load_skill_reference", ["Read"], {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        }),
        false,
      );
    });

    it("should allow execute_skill_script only when policy and active files allow it", () => {
      assertEquals(
        isToolAllowedBySkill("execute_skill_script", ["Read", "execute_skill_script"], {
          hasActiveSkill: true,
          references: [],
          scripts: ["scripts/run.sh"],
        }),
        true,
      );
      assertEquals(
        isToolAllowedBySkill("execute_skill_script", ["Read"], {
          hasActiveSkill: true,
          references: [],
          scripts: [],
        }),
        false,
      );
    });

    it("denies advertised skill file tools for an explicit empty policy", () => {
      const availability = {
        hasActiveSkill: true,
        references: ["references/guide.md"],
        scripts: ["scripts/run.sh"],
      };

      assertEquals(isToolAllowedBySkill("load_skill", [], availability), true);
      assertEquals(isToolAllowedBySkill("load_skill_reference", [], availability), false);
      assertEquals(isToolAllowedBySkill("execute_skill_script", [], availability), false);
    });
  });

  describe("validateAllowedToolPatterns", () => {
    it("does not echo control-bearing policy text in validation errors", () => {
      const token = "TOP_SECRET_POLICY";
      const error = assertThrows(
        () => validateStrictAllowedToolPatterns([`Read\u001b[31m${token}`]),
        Error,
      );

      assertEquals(error.message.includes("\u001b"), false);
      assertEquals(error.message.includes(token), false);
    });

    it("should accept valid patterns", () => {
      const result = validateAllowedToolPatterns(["Read", "api:*", "Write"]);
      assertEquals(result, ["Read", "api:*", "Write"]);
    });

    it("should reject invalid patterns", () => {
      try {
        validateAllowedToolPatterns(["Bash(git:*)"]);
        throw new Error("Should have thrown");
      } catch (e) {
        assertEquals((e as Error).message.includes("Invalid allowed-tools pattern"), true);
      }
    });

    it("should accept empty array", () => {
      assertEquals(validateAllowedToolPatterns([]), []);
    });

    it("preserves unbounded programmatic validation outside strict trust boundaries", () => {
      const patterns = Array.from({ length: 101 }, () => "Read");
      const overlongPattern = "a".repeat(257);
      assertEquals(validateAllowedToolPatterns(patterns), patterns);
      assertEquals(validateAllowedToolPatterns([overlongPattern]), [overlongPattern]);
      assertEquals(isToolAllowedBySkill("Read", patterns), true);
    });

    it("strict validation rejects pattern lists and entries over their resource budgets", () => {
      assertThrows(
        () => validateStrictAllowedToolPatterns(Array.from({ length: 101 }, () => "Read")),
        RangeError,
        "at most 100",
      );
      assertThrows(
        () => validateStrictAllowedToolPatterns(["a".repeat(257)]),
        RangeError,
        "at most 256",
      );
    });

    it("strict validation rejects hostile arrays without invoking their hooks", () => {
      let elementGetterReads = 0;
      const accessorBacked: string[] = [];
      Object.defineProperty(accessorBacked, 0, {
        enumerable: true,
        get() {
          elementGetterReads += 1;
          return "Read";
        },
      });

      assertThrows(
        () => validateStrictAllowedToolPatterns(accessorBacked),
        TypeError,
        "data property",
      );
      assertEquals(elementGetterReads, 0);

      const inherited = Object.getOwnPropertyDescriptor(Object.prototype, "value");
      let inheritedValueReads = 0;
      try {
        Object.defineProperty(Object.prototype, "value", {
          configurable: true,
          get() {
            inheritedValueReads += 1;
            return "Read";
          },
        });
        assertThrows(
          () => validateStrictAllowedToolPatterns(accessorBacked),
          TypeError,
          "data property",
        );
      } finally {
        if (inherited === undefined) {
          delete (Object.prototype as { value?: unknown }).value;
        } else {
          Object.defineProperty(Object.prototype, "value", inherited);
        }
      }
      assertEquals(inheritedValueReads, 0);

      let proxyTrapCalls = 0;
      const proxied = new Proxy(["Read"], {
        get(target, property, receiver) {
          proxyTrapCalls += 1;
          return Reflect.get(target, property, receiver);
        },
        getOwnPropertyDescriptor(target, property) {
          proxyTrapCalls += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });
      assertThrows(
        () => validateStrictAllowedToolPatterns(proxied),
        TypeError,
        "must not be a proxy",
      );
      assertEquals(proxyTrapCalls, 0);
    });

    it("keeps deny decisions independent of later built-in mutation", () => {
      const targets = [
        [String.prototype, "endsWith"],
        [String.prototype, "slice"],
        [String.prototype, "startsWith"],
        [RegExp.prototype, "test"],
        [Array.prototype, "filter"],
        [Array.prototype, "push"],
        [Array.prototype, "some"],
        [Set.prototype, "has"],
      ] as const;
      const originals = targets.map(([target, property]) =>
        Object.getOwnPropertyDescriptor(target, property)
      );
      let hookCalls = 0;
      for (const [target, property] of targets) {
        Object.defineProperty(target, property, {
          configurable: true,
          value() {
            hookCalls += 1;
            return true;
          },
          writable: true,
        });
      }

      let directMatch = true;
      let executionAllowed = true;
      let filteredTools: Array<{ name: string }> = [{ name: "Write" }];
      let validated: string[] = [];
      try {
        directMatch = matchesAllowedTool("Write", "Read");
        executionAllowed = isToolAllowedBySkill("Write", ["Read"]);
        filteredTools = filterToolsForSkill([{ name: "Write" }], ["Read"]);
        validated = validateStrictAllowedToolPatterns(["Read"]);
      } finally {
        targets.forEach(([target, property], index) => {
          const descriptor = originals[index];
          if (descriptor) Object.defineProperty(target, property, descriptor);
        });
      }

      assertEquals(directMatch, false);
      assertEquals(executionAllowed, false);
      assertEquals(filteredTools, []);
      assertEquals(validated, ["Read"]);
      assertEquals(hookCalls, 0);
    });

    it("does not use the mutable public regex as authorization state", () => {
      const originalSource = SKILL_ALLOWED_TOOL_PATTERN_REGEX.source;
      let failure: unknown;
      try {
        SKILL_ALLOWED_TOOL_PATTERN_REGEX.compile(".*");
        try {
          validateStrictAllowedToolPatterns(["Bash(git:*)"]);
        } catch (error) {
          failure = error;
        }
      } finally {
        SKILL_ALLOWED_TOOL_PATTERN_REGEX.compile(originalSource);
      }

      assertEquals(failure instanceof Error, true);
    });
  });
});

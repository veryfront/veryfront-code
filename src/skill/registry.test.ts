import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  getAllSkills,
  getSkill,
  registerSkill,
  skillRegistry,
  skillRegistryInternal,
} from "./registry.ts";
import { type Skill, SKILL_PROVIDER_SAFE_ID_REGEX } from "./types.ts";

function withInheritedArrayIndexSetter<T>(
  index: number,
  operation: () => T,
): { result: T; setterCalls: number } {
  const key = String(index);
  const original = Object.getOwnPropertyDescriptor(Array.prototype, key);
  let setterCalls = 0;
  Object.defineProperty(Array.prototype, key, {
    configurable: true,
    set: () => {
      setterCalls += 1;
    },
  });
  try {
    return { result: operation(), setterCalls };
  } finally {
    if (original) {
      Object.defineProperty(Array.prototype, key, original);
    } else {
      Reflect.deleteProperty(Array.prototype, key);
    }
  }
}

function createTestSkill(id: string): Skill {
  return {
    id,
    metadata: { name: id, description: `Test skill ${id}` },
    rootPath: `/test/skills/${id}`,
  };
}

function createScopedTestSkill(input: {
  id: string;
  ownerAgentId?: string;
  shortName?: string;
}): Skill {
  return {
    ...createTestSkill(input.id),
    ...(input.ownerAgentId === undefined ? {} : { ownerAgentId: input.ownerAgentId }),
    ...(input.shortName === undefined ? {} : { shortName: input.shortName }),
  };
}

describe("src/skill/registry", () => {
  beforeEach(() => {
    skillRegistryInternal.clearAll();
  });

  describe("registerSkill / getSkill", () => {
    it("should register and retrieve a skill", () => {
      const skill = createTestSkill("my-skill");
      registerSkill("my-skill", skill);
      assertStrictEquals(getSkill("my-skill"), skill);
    });

    it("normalizes internal policy ids while preserving the public source view", () => {
      const source = createTestSkill("definition-id");
      registerSkill("registry-id", source);

      assertStrictEquals(getSkill("registry-id"), source);
      assertEquals(getSkill("registry-id")?.id, "definition-id");
      assertEquals(skillRegistryInternal.get("registry-id")?.id, "registry-id");
    });

    it("keeps one stable mutable public view isolated from the frozen snapshot", () => {
      const skill: Skill = {
        id: "owned",
        metadata: {
          name: "owned",
          displayName: "Owned Helper",
          description: "Original",
          allowedTools: ["Read"],
          metadata: { author: "A" },
        },
        rootPath: "/test/skills/owned",
        ownerAgentId: "agent-a",
        shortName: "owned",
      };

      registerSkill("owned", skill);
      skill.metadata.description = "Mutated";
      skill.metadata.allowedTools?.push("Write");
      skill.metadata.metadata!.author = "B";
      skill.ownerAgentId = "agent-b";

      const registered = getSkill("owned");
      assertStrictEquals(registered, skill);
      assertStrictEquals(getSkill("owned"), registered);
      assertStrictEquals(getAllSkills().get("owned"), registered);
      assertEquals(registered?.metadata.description, "Mutated");
      assertEquals(registered?.metadata.displayName, "Owned Helper");
      assertEquals(registered?.metadata.allowedTools, ["Read", "Write"]);
      assertEquals(registered?.metadata.metadata, { author: "B" });
      assertEquals(registered?.ownerAgentId, "agent-b");
      assertEquals(Object.isFrozen(registered), false);
      assertEquals(Object.isFrozen(registered?.metadata), false);
      registered!.metadata.allowedTools!.push("PublicWrite");
      registered!.metadata.metadata!.author = "Public mutation";
      assertEquals(getSkill("owned")?.metadata.allowedTools, [
        "Read",
        "Write",
        "PublicWrite",
      ]);
      assertEquals(getSkill("owned")?.metadata.metadata, { author: "Public mutation" });

      const internal = skillRegistryInternal.get("owned");
      assertEquals(internal?.metadata.description, "Original");
      assertEquals(internal?.metadata.displayName, "Owned Helper");
      assertEquals(internal?.metadata.allowedTools, ["Read"]);
      assertEquals(internal?.metadata.metadata, { author: "A" });
      assertEquals(internal?.ownerAgentId, "agent-a");
      assertEquals(Object.isFrozen(internal), true);
      assertEquals(Object.isFrozen(internal?.metadata), true);
      assertEquals(Object.isFrozen(internal?.metadata.allowedTools), true);
      assertEquals(Object.isFrozen(internal?.metadata.metadata), true);
    });

    it("caches a stable public view for framework-owned internal snapshots", () => {
      skillRegistryInternal.register("framework", createTestSkill("framework"));

      const first = getSkill("framework");
      const second = getSkill("framework");
      const fromAll = getAllSkills().get("framework");
      assertStrictEquals(first, second);
      assertStrictEquals(first, fromAll);

      first!.metadata.description = "Public mutation";
      assertEquals(second?.metadata.description, "Public mutation");
      assertEquals(
        skillRegistryInternal.get("framework")?.metadata.description,
        "Test skill framework",
      );
    });

    it("rejects ambiguous owner and short-name registrations", () => {
      registerSkill("agent--first", {
        ...createTestSkill("agent--first"),
        ownerAgentId: "agent",
        shortName: "shared",
      });

      assertThrows(
        () =>
          registerSkill("agent--second", {
            ...createTestSkill("agent--second"),
            ownerAgentId: "agent",
            shortName: "shared",
          }),
        TypeError,
        "already owns",
      );
    });

    it("rejects ambiguous short names independently of Map iterator mutation", () => {
      registerSkill("agent--first", {
        ...createTestSkill("agent--first"),
        ownerAgentId: "agent",
        shortName: "shared",
      });
      const originalIterator = Object.getOwnPropertyDescriptor(
        Map.prototype,
        Symbol.iterator,
      );
      let iteratorCalls = 0;

      try {
        Object.defineProperty(Map.prototype, Symbol.iterator, {
          configurable: true,
          value: function* () {
            iteratorCalls += 1;
            yield* [];
          },
          writable: true,
        });
        assertThrows(
          () =>
            registerSkill("agent--second", {
              ...createTestSkill("agent--second"),
              ownerAgentId: "agent",
              shortName: "shared",
            }),
          TypeError,
          "already owns",
        );
      } finally {
        if (originalIterator) {
          Object.defineProperty(Map.prototype, Symbol.iterator, originalIterator);
        }
      }

      assertEquals(iteratorCalls, 0);
      assertEquals(getSkill("agent--second"), undefined);
    });

    it("retains an opaque proxied filesystem adapter without invoking traps", () => {
      let trapCalls = 0;
      const adapter = new Proxy({} as FileSystemAdapter, {
        get(target, property, receiver) {
          trapCalls += 1;
          return Reflect.get(target, property, receiver);
        },
        getOwnPropertyDescriptor(target, property) {
          trapCalls += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
        ownKeys(target) {
          trapCalls += 1;
          return Reflect.ownKeys(target);
        },
      });

      registerSkill("proxied-adapter", {
        ...createTestSkill("proxied-adapter"),
        fsAdapter: adapter,
      });

      assertStrictEquals(skillRegistryInternal.get("proxied-adapter")?.fsAdapter, adapter);
      assertEquals(trapCalls, 0);
    });

    it("preserves owner-only exact-id skills while rejecting ownerless aliases", () => {
      registerSkill("agent--exact-only", {
        ...createTestSkill("agent--exact-only"),
        ownerAgentId: "agent",
      });
      assertEquals(getSkill("agent--exact-only")?.ownerAgentId, "agent");

      assertThrows(
        () =>
          registerSkill("orphan-alias", {
            ...createTestSkill("orphan-alias"),
            shortName: "alias",
          }),
        TypeError,
        "requires ownerAgentId",
      );
    });

    it("rejects relative roots without an owning filesystem adapter", () => {
      assertThrows(
        () =>
          registerSkill("relative", {
            id: "relative",
            metadata: { name: "relative", description: "Relative root" },
            rootPath: "skills/relative",
          }),
        TypeError,
        "must be absolute unless an fsAdapter",
      );
      assertEquals(getSkill("relative"), undefined);
    });

    it("accepts only canonical adapter-relative roots", () => {
      const adapter = {} as FileSystemAdapter;
      registerSkill("relative", {
        id: "relative",
        metadata: { name: "relative", description: "Relative adapter root" },
        rootPath: "skills/relative",
        fsAdapter: adapter,
      });

      assertEquals(getSkill("relative")?.rootPath, "skills/relative");
      assertStrictEquals(skillRegistryInternal.get("relative")?.fsAdapter, adapter);

      assertThrows(
        () =>
          registerSkill("traversal", {
            id: "traversal",
            metadata: { name: "traversal", description: "Traversal root" },
            rootPath: "../skills/traversal",
            fsAdapter: adapter,
          }),
        TypeError,
        "canonical relative path",
      );
      for (const rootPath of ["./skills/relative", "skills//relative", "skills\\relative"]) {
        assertThrows(
          () =>
            registerSkill("non-canonical", {
              id: "non-canonical",
              metadata: { name: "non-canonical", description: "Non-canonical root" },
              rootPath,
              fsAdapter: adapter,
            }),
          TypeError,
          "canonical relative path",
        );
      }
    });

    it("rejects non-printable programmatic metadata", () => {
      assertThrows(
        () =>
          registerSkill("unsafe-metadata", {
            id: "unsafe-metadata",
            metadata: {
              name: "unsafe-metadata",
              description: "Unsafe metadata",
              metadata: { key: "bad\u0000value" },
            },
            rootPath: "/test/skills/unsafe-metadata",
          }),
        TypeError,
        "printable characters",
      );
      assertEquals(getSkill("unsafe-metadata"), undefined);
    });

    it("should return undefined for missing skill", () => {
      assertEquals(getSkill("nonexistent"), undefined);
    });
  });

  describe("getAllSkills", () => {
    it("should return all registered skills", () => {
      registerSkill("a", createTestSkill("a"));
      registerSkill("b", createTestSkill("b"));
      const all = getAllSkills();
      assertEquals(all.size, 2);
      assertEquals(all.has("a"), true);
      assertEquals(all.has("b"), true);
    });

    it("should return empty map when no skills registered", () => {
      assertEquals(getAllSkills().size, 0);
    });
  });

  describe("resolveForAgent", () => {
    it("should return all skills for true", () => {
      registerSkill("x", createTestSkill("x"));
      registerSkill("y", createTestSkill("y"));
      const resolved = skillRegistry.resolveForAgent(true);
      assertEquals(resolved.size, 2);
    });

    it("should return only matching skills for string[]", () => {
      registerSkill("a", createTestSkill("a"));
      registerSkill("b", createTestSkill("b"));
      registerSkill("c", createTestSkill("c"));
      const resolved = skillRegistry.resolveForAgent(["a", "c"]);
      assertEquals(resolved.size, 2);
      assertEquals(resolved.has("a"), true);
      assertEquals(resolved.has("c"), true);
      assertEquals(resolved.has("b"), false);
    });

    it("should skip missing IDs silently", () => {
      registerSkill("a", createTestSkill("a"));
      const resolved = skillRegistry.resolveForAgent(["a", "nonexistent"]);
      assertEquals(resolved.size, 1);
      assertEquals(resolved.has("a"), true);
    });

    it("should return empty map for all missing IDs", () => {
      const resolved = skillRegistry.resolveForAgent(["x", "y"]);
      assertEquals(resolved.size, 0);
    });

    it("keeps visibility decisions independent of mutable public views", () => {
      const source: Skill = {
        ...createTestSkill("agent--helper"),
        ownerAgentId: "agent-a",
        shortName: "old-name",
      };
      registerSkill("agent--helper", source);

      source.ownerAgentId = "agent-b";
      source.shortName = "new-name";

      assertEquals(
        [...skillRegistry.resolveForAgent(true, { agentId: "agent-a" }).keys()],
        ["agent--helper"],
      );
      assertStrictEquals(
        skillRegistry.resolveVisibleSkill("old-name", { agentId: "agent-a" }),
        source,
      );
      assertEquals(
        skillRegistry.resolveVisibleSkill("new-name", { agentId: "agent-b" }),
        undefined,
      );
      assertEquals(skillRegistry.getVisibleSkillIds({ agentId: "agent-a" }), [
        "agent--helper",
      ]);
      assertEquals(skillRegistry.hasVisibleSkills({ agentId: "agent-a" }), true);
      assertEquals(skillRegistry.hasVisibleSkills({ agentId: "agent-b" }), false);

      assertEquals(
        skillRegistryInternal.resolveVisibleSkill("old-name", { agentId: "agent-a" })?.shortName,
        "old-name",
      );
      assertEquals(
        skillRegistryInternal.resolveVisibleSkill("new-name", { agentId: "agent-b" }),
        undefined,
      );
    });

    it("builds visible id snapshots without invoking inherited numeric setters", () => {
      registerSkill("visible", createTestSkill("visible"));

      const { result, setterCalls } = withInheritedArrayIndexSetter(0, () => ({
        internal: skillRegistryInternal.getVisibleSkillIds(),
        public: skillRegistry.getVisibleSkillIds(),
      }));

      assertEquals(setterCalls, 0);
      assertEquals(result.internal, ["visible"]);
      assertEquals(result.public, ["visible"]);
    });

    it("keeps owned short-name admission independent of public regex and prototype mutation", () => {
      const originalSource = SKILL_PROVIDER_SAFE_ID_REGEX.source;
      const originalTest = Object.getOwnPropertyDescriptor(RegExp.prototype, "test");
      let failure: unknown;

      try {
        SKILL_PROVIDER_SAFE_ID_REGEX.compile(".*");
        Object.defineProperty(RegExp.prototype, "test", {
          configurable: true,
          value: () => true,
          writable: true,
        });
        try {
          registerSkill(
            "agent--bad",
            createScopedTestSkill({
              id: "agent--bad",
              ownerAgentId: "agent",
              shortName: "bad/name",
            }),
          );
        } catch (error) {
          failure = error;
        }
      } finally {
        if (originalTest) Object.defineProperty(RegExp.prototype, "test", originalTest);
        SKILL_PROVIDER_SAFE_ID_REGEX.compile(originalSource);
      }

      assertEquals(failure instanceof TypeError, true);
      assertEquals(skillRegistryInternal.get("agent--bad"), undefined);
    });

    it("rejects accessor metadata fields despite inherited descriptor pollution", () => {
      const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
      let getterCalls = 0;
      let failure: unknown;
      const metadata = Object.defineProperties({}, {
        name: {
          enumerable: true,
          get() {
            getterCalls += 1;
            return "do-not-read";
          },
        },
        description: { enumerable: true, value: "Description" },
      });

      try {
        Object.defineProperty(Object.prototype, "value", {
          configurable: true,
          value: "owned",
          writable: true,
        });
        try {
          registerSkill("owned", {
            id: "owned",
            metadata: metadata as never,
            rootPath: "/test/skills/owned",
          });
        } catch (error) {
          failure = error;
        }
      } finally {
        if (originalValue) {
          Object.defineProperty(Object.prototype, "value", originalValue);
        } else {
          Reflect.deleteProperty(Object.prototype, "value");
        }
      }

      assertEquals(failure instanceof TypeError, true);
      assertEquals(getterCalls, 0);
      assertEquals(skillRegistryInternal.get("owned"), undefined);
    });

    it("rejects proxied skill definitions without invoking traps", () => {
      let trapCalls = 0;
      const proxied = new Proxy(createTestSkill("proxied"), {
        getOwnPropertyDescriptor(target, key) {
          trapCalls += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });

      assertThrows(
        () => registerSkill("proxied", proxied),
        TypeError,
        "must not be a proxy",
      );
      assertEquals(trapCalls, 0);
      assertEquals(skillRegistryInternal.get("proxied"), undefined);
    });
  });

  describe("resolveSelectorForAgent", () => {
    it("keeps the historical public registry selector method", () => {
      const registered = createTestSkill("a");
      registerSkill("a", registered);

      const snapshot = skillRegistry.resolveSelectorForAgent(["a"]);

      assertEquals(snapshot.allowedSkillIds, ["a"]);
      assertEquals(snapshot.definitions.map((skill) => skill.id), ["a"]);
      assertStrictEquals(snapshot.definitions[0], registered);
    });

    it("preserves omitted, true, empty, and allowlist selector policies", () => {
      registerSkill("a", createTestSkill("a"));
      registerSkill("b", createTestSkill("b"));

      const omitted = skillRegistryInternal.resolveSelectorForAgent(undefined);
      assertEquals(omitted.policy, { kind: "all-visible", source: "omitted" });
      assertEquals(omitted.allowedSkillIds, ["a", "b"]);

      const all = skillRegistryInternal.resolveSelectorForAgent(true);
      assertEquals(all.policy, { kind: "all-visible", source: "true" });
      assertEquals(all.allowedSkillIds, ["a", "b"]);

      const none = skillRegistryInternal.resolveSelectorForAgent([]);
      assertEquals(none.policy, { kind: "none" });
      assertEquals(none.allowedSkillIds, []);

      const selected = skillRegistryInternal.resolveSelectorForAgent(["b"]);
      assertEquals(selected.policy, { kind: "allowlist", entries: ["b"] });
      assertEquals(selected.allowedSkillIds, ["b"]);
    });

    it("deduplicates explicit selections in request order and exposes source paths", () => {
      registerSkill("a", createTestSkill("a"));
      registerSkill("b", createTestSkill("b"));

      const resolved = skillRegistryInternal.resolveSelectorForAgent(["b", "a", "b"]);
      assertEquals(resolved.allowedSkillIds, ["b", "a"]);
      assertEquals(resolved.skillSourcePaths, {
        b: "/test/skills/b/SKILL.md",
        a: "/test/skills/a/SKILL.md",
      });
      assertEquals(resolved.definitions.map((skill) => skill.id), ["b", "a"]);
    });

    it("rejects unresolved explicit entries without echoing requested ids", () => {
      registerSkill("a", createTestSkill("a"));

      const error = assertThrows(
        () => skillRegistryInternal.resolveSelectorForAgent(["missing-skill"]),
        Error,
        "configured skills are not available",
      );

      assertEquals(String(error).includes("missing-skill"), false);
    });

    it("applies the canonical selector matrix for owner-visible skills", () => {
      registerSkill("global", createScopedTestSkill({ id: "global" }));
      registerSkill("bundled", createScopedTestSkill({ id: "bundled" }));
      registerSkill(
        "agent--cite",
        createScopedTestSkill({ id: "agent--cite", ownerAgentId: "agent", shortName: "cite" }),
      );
      registerSkill(
        "other--style",
        createScopedTestSkill({ id: "other--style", ownerAgentId: "other", shortName: "style" }),
      );
      registerSkill("cite", createScopedTestSkill({ id: "cite" }));

      const cases: Array<{
        selector: true | string[] | undefined;
        expectedPolicy: object;
        expectedIds: string[];
      }> = [
        {
          selector: undefined,
          expectedPolicy: { kind: "all-visible", source: "omitted" },
          expectedIds: ["global", "bundled", "agent--cite", "cite"],
        },
        {
          selector: true,
          expectedPolicy: { kind: "all-visible", source: "true" },
          expectedIds: ["global", "bundled", "agent--cite", "cite"],
        },
        {
          selector: [],
          expectedPolicy: { kind: "none" },
          expectedIds: [],
        },
        {
          selector: ["bundled", "cite", "global", "bundled"],
          expectedPolicy: { kind: "allowlist", entries: ["bundled", "cite", "global", "bundled"] },
          expectedIds: ["bundled", "agent--cite", "global"],
        },
      ];

      for (const testCase of cases) {
        const snapshot = skillRegistryInternal.resolveSelectorForAgent(testCase.selector, {
          agentId: "agent",
        });
        assertEquals(snapshot.policy, testCase.expectedPolicy);
        assertEquals(snapshot.allowedSkillIds, testCase.expectedIds);
        assertEquals(snapshot.definitions.map((skill) => skill.id), testCase.expectedIds);
      }
    });
  });
});

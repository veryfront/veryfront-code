import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  getAllSkills,
  getSkill,
  registerSkill,
  skillRegistry,
  skillRegistryInternal,
} from "./registry.ts";
import type { Skill } from "./types.ts";

function createTestSkill(id: string): Skill {
  return {
    id,
    metadata: { name: id, description: `Test skill ${id}` },
    rootPath: `/test/skills/${id}`,
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

    it("resolves visibility and short names from the mutable public view", () => {
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
        [],
      );
      assertStrictEquals(
        skillRegistry.resolveVisibleSkill("new-name", { agentId: "agent-b" }),
        source,
      );
      assertEquals(skillRegistry.getVisibleSkillIds({ agentId: "agent-b" }), [
        "agent--helper",
      ]);
      assertEquals(skillRegistry.hasVisibleSkills({ agentId: "agent-b" }), true);

      assertEquals(
        skillRegistryInternal.resolveVisibleSkill("old-name", { agentId: "agent-a" })?.shortName,
        "old-name",
      );
      assertEquals(
        skillRegistryInternal.resolveVisibleSkill("new-name", { agentId: "agent-b" }),
        undefined,
      );
    });
  });
});

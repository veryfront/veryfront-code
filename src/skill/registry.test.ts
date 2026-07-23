import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import {
  getAllSkills,
  getSkill,
  isSkillVisibleTo,
  registerSkill,
  skillRegistry,
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
    skillRegistry.clearAll();
  });

  afterEach(() => {
    skillRegistry.clearAll();
  });

  describe("registerSkill / getSkill", () => {
    it("should register and retrieve a skill", () => {
      const skill = createTestSkill("my-skill");
      registerSkill("my-skill", skill);
      assertEquals(getSkill("my-skill"), skill);
    });

    it("should return undefined for missing skill", () => {
      assertEquals(getSkill("nonexistent"), undefined);
    });

    it("should reject a registry key that differs from the skill id", () => {
      assertThrows(
        () => registerSkill("registry-id", createTestSkill("different-id")),
        Error,
        "must match",
      );
    });

    it("should keep global and owned skill identities coherent", () => {
      const global = createTestSkill("global-skill");
      global.metadata.name = "different-name";
      assertThrows(
        () => registerSkill("global-skill", global),
        Error,
        "must match its metadata name",
      );

      const owned = createTestSkill("agent--review");
      owned.metadata.name = "review";
      owned.ownerAgentId = "agent";
      owned.shortName = "other";
      assertThrows(
        () => registerSkill("agent--review", owned),
        Error,
        "short name must match",
      );
    });

    it("should isolate mutable public results from the stored registry snapshot", () => {
      const skill = createTestSkill("stable");
      skill.metadata.allowedTools = ["Read"];
      skill.metadata.metadata = { tier: "stable" };
      registerSkill("stable", skill);

      skill.ownerAgentId = "attacker";
      skill.metadata.description = "mutated";
      const stored = getSkill("stable")!;

      assertEquals(stored.ownerAgentId, undefined);
      assertEquals(stored.metadata.description, "Test skill stable");
      stored.ownerAgentId = "caller-only";
      stored.metadata.description = "caller-only";
      stored.metadata.allowedTools?.push("Write");
      stored.metadata.metadata!.tier = "caller-only";

      const fresh = getSkill("stable")!;
      assertEquals(fresh.ownerAgentId, undefined);
      assertEquals(fresh.metadata.description, "Test skill stable");
      assertEquals(fresh.metadata.allowedTools, ["Read"]);
      assertEquals(fresh.metadata.metadata, { tier: "stable" });
    });

    it("should reject accessor-backed registration fields without invoking them", () => {
      const skill = Object.defineProperty({}, "id", {
        enumerable: true,
        get() {
          throw new Error("must not execute");
        },
      });

      assertThrows(
        () => registerSkill("test", skill as Skill),
        Error,
        "data properties only",
      );
    });

    it("should reject invalid registration fields at the registry boundary", () => {
      const invalidCases: Array<{
        mutate: (skill: Skill) => void;
        message: string;
      }> = [
        {
          mutate: (skill) => {
            skill.id = "invalid id";
          },
          message: "registry id is invalid",
        },
        {
          mutate: (skill) => {
            skill.rootPath = "bad\npath";
          },
          message: "root path is invalid",
        },
        {
          mutate: (skill) => {
            skill.metadata.name = "Invalid";
          },
          message: "metadata name is invalid",
        },
        {
          mutate: (skill) => {
            skill.metadata.description = " padded ";
          },
          message: "description is invalid",
        },
        {
          mutate: (skill) => {
            skill.metadata.license = " MIT ";
          },
          message: "license is invalid",
        },
        {
          mutate: (skill) => {
            skill.metadata.compatibility = " Deno ";
          },
          message: "compatibility is invalid",
        },
        {
          mutate: (skill) => {
            skill.metadata.allowedTools = "Read" as unknown as string[];
          },
          message: "policy must be an array",
        },
        {
          mutate: (skill) => {
            skill.metadata.metadata = { version: 1 as unknown as string };
          },
          message: "bounded string keys and values",
        },
        {
          mutate: (skill) => {
            skill.fsAdapter = null as unknown as Skill["fsAdapter"];
          },
          message: "filesystem adapter is invalid",
        },
      ];

      for (const [index, invalidCase] of invalidCases.entries()) {
        const skill = createTestSkill(`invalid-${index}`);
        invalidCase.mutate(skill);
        assertThrows(
          () => registerSkill(skill.id, skill),
          Error,
          invalidCase.message,
        );
      }
    });

    it("should reject duplicate owned short names and fail closed on hostile visibility", () => {
      registerSkill("agent--review", {
        id: "agent--review",
        metadata: { name: "review", description: "Review" },
        rootPath: "/test/skills/review",
        ownerAgentId: "agent",
        shortName: "review",
      });
      assertThrows(
        () =>
          registerSkill("agent--review-copy", {
            id: "agent--review-copy",
            metadata: { name: "review", description: "Review copy" },
            rootPath: "/test/skills/review-copy",
            ownerAgentId: "agent",
            shortName: "review",
          }),
        Error,
        "unique short names",
      );

      const hostile = Object.defineProperty({}, "ownerAgentId", {
        get() {
          throw new Error("must not escape");
        },
      });
      assertEquals(isSkillVisibleTo(hostile as Skill, { agentId: "agent" }), false);
    });

    it("should reject agent-owned shared registrations", () => {
      registerSkill("agent--review", {
        id: "agent--review",
        metadata: { name: "review", description: "Review" },
        rootPath: "/test/skills/review",
        ownerAgentId: "agent",
        shortName: "review",
      });

      assertThrows(
        () =>
          skillRegistry.registerShared("agent--shared-review", {
            id: "agent--shared-review",
            metadata: { name: "review", description: "Shared review" },
            rootPath: "/test/skills/shared-review",
            ownerAgentId: "agent",
            shortName: "review",
          }),
        Error,
        "cannot be agent-owned",
      );
    });

    it("should reject process-wide shared skills with project-owned identity", async () => {
      await runWithRequestContext(
        { projectSlug: "project-a", token: "test-token-a" },
        async () => {
          registerSkill("agent--review", {
            id: "agent--review",
            metadata: { name: "review", description: "Project review" },
            rootPath: "/test/project-a/review",
            ownerAgentId: "agent",
            shortName: "review",
          });
        },
      );

      await assertRejects(
        () =>
          runWithRequestContext(
            { projectSlug: "project-b", token: "test-token-b" },
            async () => {
              skillRegistry.registerShared("agent--shared-review", {
                id: "agent--shared-review",
                metadata: { name: "review", description: "Shared review" },
                rootPath: "/test/shared/review",
                ownerAgentId: "agent",
                shortName: "review",
              });
            },
          ),
        Error,
        "cannot be agent-owned",
      );
    });

    it("should snapshot shared skill registrations", () => {
      const skill = createTestSkill("shared-skill");
      skillRegistry.registerShared("shared-skill", skill);
      skill.metadata.description = "mutated";

      assertEquals(
        skillRegistry.getShared("shared-skill")?.metadata.description,
        "Test skill shared-skill",
      );
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
  });
});

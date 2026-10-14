import { filterToolsForSkill, isSkillToolAvailable } from "#veryfront/skill/allowed-tools.ts";
import { registerSkill, skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { createLoadSkillReferenceTool } from "#veryfront/skill/tools.ts";
import { createSkillTestAdapter } from "#veryfront/skill/testing.ts";
import type { Skill } from "#veryfront/skill/types.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";

function createTestSkill(id: string): Skill {
  return {
    id,
    metadata: {
      name: id,
      description: `Skill ${id}`,
    },
    rootPath: `/project/skills/${id}`,
    fsAdapter: createSkillTestAdapter({
      [`/project/skills/${id}/references/guide.md`]: "Guide",
      [`/project/skills/${id}/references/private/secret.md`]: "Secret",
    }),
  };
}

describe("skill tool intrinsic isolation", () => {
  beforeEach(() => {
    skillRegistryInternal.clearAll();
  });

  it("rejects forged availability when Array.prototype.includes is poisoned", async () => {
    registerSkill("my-skill", createTestSkill("my-skill"));
    const tool = createLoadSkillReferenceTool();
    const originalIncludes = Array.prototype.includes;
    Array.prototype.includes = () => true;

    try {
      await assertRejects(
        () =>
          tool.execute({
            skillId: "my-skill",
            reference: "references/private/secret.md",
          }, {
            activeSkillId: "my-skill",
            activeSkillToolAvailability: {
              hasActiveSkill: true,
              references: ["references/private/secret.md"],
              scripts: [],
            },
          }),
        Error,
        "advertised by load_skill",
      );
    } finally {
      Array.prototype.includes = originalIncludes;
    }
  });

  it("authorizes a valid reference when String.prototype.split is poisoned", async () => {
    const skill = createTestSkill("my-skill");
    const baseAdapter = skill.fsAdapter!;
    skill.fsAdapter = {
      ...baseAdapter,
      async *readDir(path) {
        if (path === skill.rootPath) {
          yield { name: "references", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === `${skill.rootPath}/references`) {
          yield { name: "guide.md", isFile: true, isDirectory: false, isSymlink: false };
        }
      },
    };
    registerSkill("my-skill", skill);
    const tool = createLoadSkillReferenceTool();
    const originalSplit = String.prototype.split;
    String.prototype.split = function (separator, limit) {
      if (separator === "/" && limit === 1) throw new Error("poisoned split");
      return Reflect.apply(originalSplit, this, [separator, limit]);
    };

    try {
      const result = await tool.execute({
        skillId: "my-skill",
        reference: "references/guide.md",
      }, {
        activeSkillId: "my-skill",
        activeSkillToolAvailability: {
          hasActiveSkill: true,
          references: ["references/guide.md"],
          scripts: [],
        },
      });
      assertEquals(result.content, "Guide");
    } finally {
      String.prototype.split = originalSplit;
    }
  });
});

for (const method of ["startsWith", "slice"] as const) {
  it(`keeps canonical skill capabilities when String.prototype.${method} is replaced`, () => {
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, method)!;
    const tools = [{ name: "veryfront__load_skill" }, { name: "veryfront__load_skill_reference" }, {
      name: "veryfront__execute_skill_script",
    }];
    const availability = { hasActiveSkill: true, references: ["references/guide.md"], scripts: [] };
    let filtered;
    let loaderAvailable;
    let scriptAvailable;
    try {
      Object.defineProperty(String.prototype, method, {
        ...descriptor,
        value: method === "startsWith" ? () => false : () => "project_tool",
      });
      filtered = filterToolsForSkill(tools, availability);
      loaderAvailable = isSkillToolAvailable("veryfront__load_skill", availability);
      scriptAvailable = isSkillToolAvailable("veryfront__execute_skill_script", availability);
    } finally {
      Object.defineProperty(String.prototype, method, descriptor);
    }
    assertEquals(filtered, tools.slice(0, 2));
    assertEquals(loaderAvailable, true);
    assertEquals(scriptAvailable, false);
  });
}

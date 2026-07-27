import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { registerSkill, skillRegistryInternal } from "./registry.ts";
import {
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
  createLoadSkillTool,
} from "./tools.ts";
import type { Skill } from "./types.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { createSkillTestAdapter } from "./testing.ts";
import { LocalScriptExecutor } from "./executor.ts";

function createTestSkill(fsAdapter: FileSystemAdapter): Skill {
  return {
    id: "my-skill",
    metadata: {
      name: "my-skill",
      description: "Skill from adapter",
    },
    rootPath: "/project/skills/my-skill",
    fsAdapter,
  };
}

function createNamedTestSkill(id: string, fsAdapter: FileSystemAdapter): Skill {
  return {
    id,
    metadata: {
      name: id,
      description: `Skill ${id}`,
    },
    rootPath: `/project/skills/${id}`,
    fsAdapter,
  };
}

describe("src/skill/tools", () => {
  beforeEach(() => {
    skillRegistryInternal.clearAll();
  });

  it("uses snake case runtime ids for skill platform tools", () => {
    assertEquals(createLoadSkillTool().id, "load_skill");
    assertEquals(createLoadSkillReferenceTool().id, "load_skill_reference");
    assertEquals(createExecuteSkillScriptTool().id, "execute_skill_script");
  });

  it("load_skill should list references and scripts via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
allowed-tools: Read api:*
---
# Instructions
Do work.`,
      "/project/skills/my-skill/references/guide.md": "Guide",
      "/project/skills/my-skill/scripts/run.sh": "echo run",
    });
    registerSkill("my-skill", {
      ...createTestSkill(fsAdapter),
      metadata: {
        name: "my-skill",
        description: "Skill from adapter",
        allowedTools: ["Read", "api:*"],
      },
    });

    const tool = createLoadSkillTool();
    const result = await tool.execute({ skillId: "my-skill" });

    assertEquals(result.skillId, "my-skill");
    assertEquals(result.allowedTools, ["Read", "api:*"]);
    assertEquals(result.references, ["references/guide.md"]);
    assertEquals(result.scripts, ["scripts/run.sh"]);
  });

  it("load_skill derives the active policy from the same current document as its instructions", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Current document
allowed-tools: Write
---
Use the current policy.`,
    });
    registerSkill("my-skill", {
      ...createTestSkill(fsAdapter),
      metadata: {
        name: "my-skill",
        description: "Previous snapshot",
        allowedTools: ["Read"],
      },
    });

    const result = await createLoadSkillTool().execute({ skillId: "my-skill" });

    assertEquals(result.instructions.trim(), "Use the current policy.");
    assertEquals(result.allowedTools, ["Write"]);
  });

  it("load_skill preserves an explicitly empty policy as deny-all", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Deny all optional tools
allowed-tools: ""
---
Use no optional tools.`,
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const result = await createLoadSkillTool().execute({ skillId: "my-skill" });

    assertEquals(result.allowedTools, []);
  });

  it("validates the file name against its directory rather than the registry alias", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/review/SKILL.md": `---
name: review
description: Review files
---
Review the files.`,
    });
    registerSkill("read-only-review", {
      id: "read-only-review",
      metadata: {
        name: "Review",
        description: "Programmatic registry alias",
      },
      rootPath: "/project/skills/review",
      fsAdapter,
    });

    const result = await createLoadSkillTool().execute({ skillId: "read-only-review" });

    assertEquals(result.skillId, "read-only-review");
    assertEquals(result.instructions.trim(), "Review the files.");
  });

  it("load_skill should list resources as loadable references via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Review the resource files.`,
      "/project/skills/my-skill/resources/article-30.md": "Article 30",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillTool();
    const result = await tool.execute({ skillId: "my-skill" });

    assertEquals(result.references, ["resources/article-30.md"]);
  });

  it("load_skill should list assets as loadable references via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Review the asset files.`,
      "/project/skills/my-skill/assets/checklist.txt": "Checklist",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillTool();
    const result = await tool.execute({ skillId: "my-skill" });

    assertEquals(result.references, ["assets/checklist.txt"]);
  });

  it("load_skill should omit prompt notes for unavailable file tools", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Do work.`,
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillTool();
    const result = await tool.execute({ skillId: "my-skill" });

    assertEquals(result.note, undefined);

    const referencesOnlyAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Do work.`,
      "/project/skills/my-skill/references/guide.md": "Guide",
    });
    registerSkill("my-skill", createTestSkill(referencesOnlyAdapter));

    const referencesOnly = await tool.execute({ skillId: "my-skill" });

    assertEquals(referencesOnly.note, undefined);

    const scriptsOnlyAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Do work.`,
      "/project/skills/my-skill/scripts/run.sh": "echo run",
    });
    registerSkill("my-skill", createTestSkill(scriptsOnlyAdapter));

    const scriptsOnly = await tool.execute({ skillId: "my-skill" });

    assertEquals(scriptsOnly.note, undefined);
  });

  it("load_skill_reference should read content via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/references/guide.md": "Reference text",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillReferenceTool();
    const result = await tool.execute({
      skillId: "my-skill",
      reference: "references/guide.md",
    });

    assertEquals(result.content, "Reference text");
    assertEquals(result.path, "references/guide.md");
  });

  it("load_skill_reference rejects a local parent replacement before opening the file", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-skill-reference-race-" });
    const skillRoot = `${tempDir}/my-skill`;
    const referencesDir = `${skillRoot}/references`;
    const savedReferencesDir = `${skillRoot}/references-safe`;
    const replacementDir = `${tempDir}/replacement`;
    const referencePath = `${referencesDir}/guide.md`;
    const originalOpen = Deno.open;
    let replaced = false;

    try {
      await Deno.mkdir(referencesDir, { recursive: true });
      await Deno.mkdir(replacementDir, { recursive: true });
      await Deno.writeTextFile(referencePath, "trusted");
      await Deno.writeTextFile(`${replacementDir}/guide.md`, "outside");
      registerSkill("my-skill", {
        id: "my-skill",
        metadata: { name: "my-skill", description: "Local skill" },
        rootPath: skillRoot,
      });

      Deno.open = async (path, options) => {
        if (!replaced && String(path) === referencePath) {
          replaced = true;
          await Deno.rename(referencesDir, savedReferencesDir);
          await Deno.rename(replacementDir, referencesDir);
        }
        return await originalOpen(path, options);
      };

      await assertRejects(
        () =>
          createLoadSkillReferenceTool().execute({
            skillId: "my-skill",
            reference: "references/guide.md",
          }),
        TypeError,
        "changed during validation",
      );
      assertEquals(replaced, true);
    } finally {
      Deno.open = originalOpen;
      if (replaced) {
        await Deno.rename(referencesDir, replacementDir);
        await Deno.rename(savedReferencesDir, referencesDir);
      }
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("load_skill_reference rejects oversized files before reading them", async () => {
    const referencePath = "/project/skills/my-skill/references/large.md";
    const adapter = createSkillTestAdapter({ [referencePath]: "small fixture" });
    let readAttempted = false;
    registerSkill(
      "my-skill",
      createTestSkill({
        ...adapter,
        async stat(path: string) {
          const info = await adapter.stat(path);
          return path === referencePath ? { ...info, size: 1_048_577 } : info;
        },
        async readFile(path: string) {
          if (path === referencePath) readAttempted = true;
          return await adapter.readFile(path);
        },
      }),
    );

    await assertRejects(
      () =>
        createLoadSkillReferenceTool().execute({
          skillId: "my-skill",
          reference: "references/large.md",
        }),
      RangeError,
      "exceeds",
    );
    assertEquals(readAttempted, false);
  });

  it("load_skill_reference should read asset files via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/assets/checklist.txt": "Asset text",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillReferenceTool();
    const result = await tool.execute({
      skillId: "my-skill",
      reference: "assets/checklist.txt",
    });

    assertEquals(result.content, "Asset text");
    assertEquals(result.path, "assets/checklist.txt");
  });

  it("load_skill_reference should read resource files via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/resources/article-30.md": "Article 30 text",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillReferenceTool();
    const result = await tool.execute({
      skillId: "my-skill",
      reference: "resources/article-30.md",
    });

    assertEquals(result.content, "Article 30 text");
    assertEquals(result.path, "resources/article-30.md");
  });

  it("load_skill_reference should allow the active skill through its short name", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/researcher--cite/references/guide.md": "Citation guide",
    });
    registerSkill("researcher--cite", {
      ...createNamedTestSkill("researcher--cite", fsAdapter),
      ownerAgentId: "researcher",
      shortName: "cite",
    });

    const tool = createLoadSkillReferenceTool();
    const result = await tool.execute({
      skillId: "cite",
      reference: "references/guide.md",
    }, {
      agentId: "researcher",
      activeSkillId: "researcher--cite",
      activeSkillToolAvailability: {
        hasActiveSkill: true,
        references: ["references/guide.md"],
        scripts: [],
      },
    });

    assertEquals(result.content, "Citation guide");
    assertEquals(result.path, "references/guide.md");
  });

  it("load_skill_reference should reject a different skill than the active loaded skill", async () => {
    const activeAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/references/guide.md": "Guide",
    });
    const otherAdapter = createSkillTestAdapter({
      "/project/skills/other-skill/references/secret.md": "Secret",
    });
    registerSkill("my-skill", createNamedTestSkill("my-skill", activeAdapter));
    registerSkill("other-skill", createNamedTestSkill("other-skill", otherAdapter));

    const tool = createLoadSkillReferenceTool();

    await assertRejects(
      () =>
        tool.execute({
          skillId: "other-skill",
          reference: "references/secret.md",
        }, {
          activeSkillId: "my-skill",
          activeSkillToolAvailability: {
            hasActiveSkill: true,
            references: ["references/guide.md"],
            scripts: [],
          },
        }),
      Error,
    );
  });

  it("load_skill_reference should reject files not advertised by the active skill", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/references/guide.md": "Guide",
      "/project/skills/my-skill/references/hidden.md": "Hidden",
    });
    registerSkill("my-skill", createNamedTestSkill("my-skill", fsAdapter));

    const tool = createLoadSkillReferenceTool();

    await assertRejects(
      () =>
        tool.execute({
          skillId: "my-skill",
          reference: "references/hidden.md",
        }, {
          activeSkillId: "my-skill",
          activeSkillToolAvailability: {
            hasActiveSkill: true,
            references: ["references/guide.md"],
            scripts: [],
          },
        }),
      Error,
    );
  });

  it("execute_skill_script should run a local script from the skill directory", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-skill-script-" });

    try {
      const skillRoot = `${tempDir}/my-skill`;
      await Deno.mkdir(`${skillRoot}/scripts`, { recursive: true });
      await Deno.writeTextFile(
        `${skillRoot}/scripts/echo-style.sh`,
        [
          "#!/usr/bin/env bash",
          'echo "style=$STYLE voice=$1"',
        ].join("\n"),
      );

      registerSkill("my-skill", {
        id: "my-skill",
        metadata: { name: "my-skill", description: "Executes scripts" },
        rootPath: skillRoot,
      });

      const tool = createExecuteSkillScriptTool({
        executor: new LocalScriptExecutor(),
      });
      const result = await tool.execute({
        skillId: "my-skill",
        script: "scripts/echo-style.sh",
        args: ["active"],
        env: { STYLE: "tight" },
      });

      assertEquals(result.exitCode, 0);
      assertEquals(result.stderr, "");
      assertEquals(result.stdout.trim(), "style=tight voice=active");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("execute_skill_script preserves script-relative imports across supported runtimes", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-skill-relative-import-" });

    try {
      const skillRoot = `${tempDir}/my-skill`;
      await Deno.mkdir(`${skillRoot}/scripts`, { recursive: true });
      await Deno.writeTextFile(
        `${skillRoot}/scripts/main.js`,
        [
          'const helper = require("./helper.js");',
          "console.log(helper.message);",
        ].join("\n"),
      );
      await Deno.writeTextFile(
        `${skillRoot}/scripts/helper.js`,
        'module.exports = { message: "node-relative-import-ok" };\n',
      );
      await Deno.writeTextFile(
        `${skillRoot}/scripts/main.py`,
        "from helper import message\nprint(message)\n",
      );
      await Deno.writeTextFile(
        `${skillRoot}/scripts/helper.py`,
        'message = "python-relative-import-ok"\n',
      );
      await Deno.writeTextFile(
        `${skillRoot}/scripts/main.sh`,
        [
          "#!/usr/bin/env bash",
          'source "$(dirname "$0")/helper.sh"',
          'printf "%s\\n" "$MESSAGE"',
        ].join("\n"),
      );
      await Deno.writeTextFile(
        `${skillRoot}/scripts/helper.sh`,
        'MESSAGE="bash-relative-import-ok"\n',
      );
      await Deno.writeTextFile(
        `${skillRoot}/scripts/main.ts`,
        [
          'import { message } from "./helper.ts";',
          "console.log(message);",
        ].join("\n"),
      );
      await Deno.writeTextFile(
        `${skillRoot}/scripts/helper.ts`,
        'export const message = "deno-relative-import-ok";\n',
      );

      registerSkill("my-skill", {
        id: "my-skill",
        metadata: { name: "my-skill", description: "Executes scripts" },
        rootPath: skillRoot,
      });

      const result = await createExecuteSkillScriptTool({
        executor: new LocalScriptExecutor(),
      });

      for (
        const [script, expected] of [
          ["scripts/main.js", "node-relative-import-ok"],
          ["scripts/main.py", "python-relative-import-ok"],
          ["scripts/main.sh", "bash-relative-import-ok"],
          ["scripts/main.ts", "deno-relative-import-ok"],
        ] as const
      ) {
        const execution = await result.execute({
          skillId: "my-skill",
          script,
        });
        assertEquals(execution.exitCode, 0);
        assertEquals(execution.stderr, "");
        assertEquals(execution.stdout.trim(), expected);
      }

      const leakedSnapshots: string[] = [];
      for await (const entry of Deno.readDir(`${skillRoot}/scripts`)) {
        if (entry.name.startsWith(".veryfront-script-")) {
          leakedSnapshots.push(entry.name);
        }
      }
      assertEquals(leakedSnapshots, []);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("execute_skill_script fails explicitly when safe same-directory staging is read-only", async () => {
    if (Deno.build.os === "windows") return;
    const tempDir = await Deno.makeTempDir({ prefix: "vf-skill-read-only-script-" });
    const skillRoot = `${tempDir}/my-skill`;
    const scriptDirectory = `${skillRoot}/scripts`;

    try {
      await Deno.mkdir(scriptDirectory, { recursive: true });
      await Deno.writeTextFile(`${scriptDirectory}/run.js`, 'console.log("ok");\n');
      await Deno.chmod(scriptDirectory, 0o555);

      const probePath = `${scriptDirectory}/.write-probe`;
      try {
        const probe = await Deno.open(probePath, {
          createNew: true,
          write: true,
        });
        probe.close();
        await Deno.remove(probePath);
        // Privileged test processes can bypass POSIX mode bits, so this
        // environment cannot exercise the operational read-only failure.
        return;
      } catch (error) {
        if (!(error instanceof Deno.errors.PermissionDenied)) throw error;
      }

      registerSkill("my-skill", {
        id: "my-skill",
        metadata: { name: "my-skill", description: "Executes scripts" },
        rootPath: skillRoot,
      });

      await assertRejects(
        () =>
          createExecuteSkillScriptTool({
            executor: new LocalScriptExecutor(),
          }).execute({
            skillId: "my-skill",
            script: "scripts/run.js",
          }),
        Error,
        "does not fall back to an unrelated temporary directory",
      );
    } finally {
      await Deno.chmod(scriptDirectory, 0o700).catch(() => {});
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("execute_skill_script should reject scripts not advertised by the active skill", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-skill-script-policy-" });

    try {
      const skillRoot = `${tempDir}/my-skill`;
      await Deno.mkdir(`${skillRoot}/scripts`, { recursive: true });
      await Deno.writeTextFile(
        `${skillRoot}/scripts/hidden.sh`,
        [
          "#!/usr/bin/env bash",
          'echo "hidden"',
        ].join("\n"),
      );

      registerSkill("my-skill", {
        id: "my-skill",
        metadata: { name: "my-skill", description: "Executes scripts" },
        rootPath: skillRoot,
      });

      const tool = createExecuteSkillScriptTool();

      await assertRejects(
        () =>
          tool.execute({
            skillId: "my-skill",
            script: "scripts/hidden.sh",
          }, {
            activeSkillId: "my-skill",
            activeSkillToolAvailability: {
              hasActiveSkill: true,
              references: [],
              scripts: ["scripts/run.sh"],
            },
          }),
        Error,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("execute_skill_script bounds argument and environment cardinality at its schema", async () => {
    const tool = createExecuteSkillScriptTool();
    await assertRejects(
      () =>
        tool.execute({
          skillId: "my-skill",
          script: "scripts/run.sh",
          args: Array.from({ length: 65 }, () => "x"),
        }),
      Error,
      "64",
    );
    await assertRejects(
      () =>
        tool.execute({
          skillId: "my-skill",
          script: "scripts/run.sh",
          env: Object.fromEntries(
            Array.from({ length: 65 }, (_unused, index) => [`KEY_${index}`, "value"]),
          ),
        }),
      Error,
      "64",
    );
    await assertRejects(
      () =>
        tool.execute({
          skillId: "my-skill",
          script: "scripts/run.sh",
          args: Array.from({ length: 17 }, () => "x".repeat(4_096)),
        }),
      Error,
      "total at most",
    );
    await assertRejects(
      () =>
        tool.execute({
          skillId: "my-skill",
          script: "scripts/run.sh",
          env: Object.fromEntries(
            Array.from({ length: 9 }, (_unused, index) => [
              `KEY_${index}`,
              "x".repeat(8_192),
            ]),
          ),
        }),
      Error,
      "total at most",
    );
  });

  it("rejects invalid environment names before invoking a custom executor", async () => {
    const scriptPath = "/project/skills/my-skill/scripts/run.sh";
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("my-skill", createTestSkill(adapter));
    let executorCalled = false;
    const tool = createExecuteSkillScriptTool({
      executor: {
        async execute() {
          executorCalled = true;
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      },
    });

    await assertRejects(
      () =>
        tool.execute({
          skillId: "my-skill",
          script: "scripts/run.sh",
          env: { "BAD=KEY": "value" },
        }),
      Error,
      "Environment variable",
    );
    assertEquals(executorCalled, false);
  });

  it("execute_skill_script propagates request cancellation to the executor", async () => {
    const scriptPath = "/project/skills/my-skill/scripts/run.sh";
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("my-skill", createTestSkill(adapter));
    const controller = new AbortController();
    controller.abort();
    let observedSignal: AbortSignal | undefined;

    const tool = createExecuteSkillScriptTool({
      executor: {
        async execute(input) {
          observedSignal = (input as typeof input & { abortSignal?: AbortSignal }).abortSignal;
          return { stdout: "", stderr: "", exitCode: 130 };
        },
      },
    });
    await tool.execute(
      { skillId: "my-skill", script: "scripts/run.sh" },
      { abortSignal: controller.signal },
    );

    assertEquals(observedSignal, controller.signal);
  });
});

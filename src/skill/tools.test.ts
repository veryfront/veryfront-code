import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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
import { SKILL_SCRIPT_ENV_KEY_REGEX, SKILL_SCRIPT_MAX_OUTPUT_BYTES } from "./limits.ts";

type Settlement<T> =
  | { kind: "fulfilled"; value: T }
  | { kind: "rejected"; error: unknown }
  | { kind: "pending" };

async function settleWithin<T>(promise: Promise<T>, timeoutMs = 50): Promise<Settlement<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value): Settlement<T> => ({ kind: "fulfilled", value }),
        (error: unknown): Settlement<T> => ({ kind: "rejected", error }),
      ),
      new Promise<Settlement<T>>((resolve) => {
        timeoutId = setTimeout(() => resolve({ kind: "pending" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

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

  it("load_skill redacts its root when optional subdirectory stat fails", async () => {
    const root = "/project/skills/my-skill";
    const fsAdapter = createSkillTestAdapter({
      [`${root}/SKILL.md`]: `---
name: my-skill
description: Skill from adapter
---
Do work.`,
      [`${root}/references`]: "not a directory",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    let message = "";
    try {
      await createLoadSkillTool().execute({ skillId: "my-skill" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    assertEquals(message.includes(root), false);
    assertEquals(message.includes("<skill-root>/references"), true);
  });

  it("load_skill redacts its root from adapter listing failures", async () => {
    const root = "/project/skills/my-skill";
    const baseAdapter = createSkillTestAdapter({
      [`${root}/SKILL.md`]: `---
name: my-skill
description: Skill from adapter
---
Do work.`,
    });
    const fsAdapter = {
      ...baseAdapter,
      async exists(path: string) {
        if (path === `${root}/references`) {
          throw new Error(`Storage listing failed below ${root}/references`);
        }
        return await baseAdapter.exists(path);
      },
    };
    registerSkill("my-skill", createTestSkill(fsAdapter));

    let message = "";
    try {
      await createLoadSkillTool().execute({ skillId: "my-skill" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    assertEquals(message.includes(root), false);
    assertEquals(message.includes("<skill-root>/references"), true);
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

  it("load_skill should reject skills outside the selector before reading storage", async () => {
    let readCount = 0;
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Do work.`,
    });
    const countingAdapter: FileSystemAdapter = {
      ...fsAdapter,
      async readFile(path) {
        readCount++;
        return await fsAdapter.readFile(path);
      },
    };
    registerSkill("my-skill", createTestSkill(countingAdapter));

    const tool = createLoadSkillTool();

    await assertRejects(
      () =>
        tool.execute({ skillId: "my-skill" }, {
          agentId: "agent",
          allowedSkillIds: [],
        }),
      Error,
      "not available to this agent",
    );
    assertEquals(readCount, 0);
  });

  it("load_skill should not disclose selector-disallowed skills in unavailable errors", async () => {
    const allowedAdapter = createSkillTestAdapter({
      "/project/skills/allowed-skill/SKILL.md": `---
name: allowed-skill
description: Allowed skill
---
# Instructions
Allowed work.`,
    });
    const hiddenAdapter = createSkillTestAdapter({
      "/project/skills/hidden-skill/SKILL.md": `---
name: hidden-skill
description: Hidden skill
---
# Instructions
Hidden work.`,
    });
    registerSkill("allowed-skill", createNamedTestSkill("allowed-skill", allowedAdapter));
    registerSkill("hidden-skill", createNamedTestSkill("hidden-skill", hiddenAdapter));

    const tool = createLoadSkillTool();

    const error = await assertRejects(
      () =>
        tool.execute({ skillId: "missing-skill" }, {
          agentId: "agent",
          allowedSkillIds: ["allowed-skill"],
        }),
      Error,
    );

    assert(error instanceof Error);
    assertEquals(error.message.includes("hidden-skill"), false);
    assertEquals(error.message.includes("allowed-skill"), false);

    const hiddenError = await assertRejects(
      () =>
        tool.execute({ skillId: "hidden-skill" }, {
          agentId: "agent",
          allowedSkillIds: ["allowed-skill"],
        }),
      Error,
    );

    assert(hiddenError instanceof Error);
    assertEquals(hiddenError.message.includes("hidden-skill"), false);
    assertEquals(hiddenError.message.includes("allowed-skill"), false);
  });

  it("load_skill detaches selector callback failures before a root is assigned", async () => {
    const root = "/project/skills/my-skill";
    const adapter = createSkillTestAdapter({
      [`${root}/SKILL.md`]: "---\nname: my-skill\ndescription: Test\n---\nBody",
    });
    registerSkill("my-skill", createTestSkill(adapter));
    const original = new Error("Selector failed", {
      cause: new Error(`${root}/private`),
    });
    const tool = createLoadSkillTool({
      resolveAllowedSkillIds() {
        throw original;
      },
    });

    let failure: unknown;
    try {
      await tool.execute({ skillId: "my-skill" });
    } catch (error) {
      failure = error;
    }

    assertEquals(failure instanceof Error, true);
    assertEquals(failure === original, false);
    assertEquals(failure instanceof Error ? failure.cause : undefined, undefined);
  });

  it("load_skill fails closed on a proxied selector allowlist without invoking traps", async () => {
    let readCount = 0;
    let trapCalls = 0;
    const root = "/project/skills/my-skill";
    const adapter = createSkillTestAdapter({
      [`${root}/SKILL.md`]: "---\nname: my-skill\ndescription: Test\n---\nBody",
    });
    const countingAdapter: FileSystemAdapter = {
      ...adapter,
      async readFile(path) {
        readCount += 1;
        return await adapter.readFile(path);
      },
    };
    const allowlist = new Proxy(["my-skill"], {
      get(target, key, receiver) {
        trapCalls += 1;
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        trapCalls += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    registerSkill("my-skill", createTestSkill(countingAdapter));
    const tool = createLoadSkillTool({
      resolveAllowedSkillIds: () => allowlist,
    });

    await assertRejects(
      () => tool.execute({ skillId: "my-skill" }),
      Error,
      "not available",
    );
    assertEquals(trapCalls, 0);
    assertEquals(readCount, 0);
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

  it("load_skill_reference should reject stale active skill state outside the selector", async () => {
    let readCount = 0;
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/references/guide.md": "Guide",
    });
    const countingAdapter: FileSystemAdapter = {
      ...fsAdapter,
      async readFile(path) {
        readCount++;
        return await fsAdapter.readFile(path);
      },
    };
    registerSkill("my-skill", createNamedTestSkill("my-skill", countingAdapter));

    const tool = createLoadSkillReferenceTool();

    await assertRejects(
      () =>
        tool.execute({
          skillId: "my-skill",
          reference: "references/guide.md",
        }, {
          agentId: "agent",
          allowedSkillIds: [],
          activeSkillId: "my-skill",
          activeSkillToolAvailability: {
            hasActiveSkill: true,
            references: ["references/guide.md"],
            scripts: [],
          },
        }),
      Error,
      "not available to this agent",
    );
    assertEquals(readCount, 0);
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

      const sourceEntriesBefore = (await Array.fromAsync(Deno.readDir(`${skillRoot}/scripts`)))
        .map((entry) => entry.name)
        .sort();
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

      const sourceEntriesAfter = (await Array.fromAsync(Deno.readDir(`${skillRoot}/scripts`)))
        .map((entry) => entry.name)
        .sort();
      assertEquals(sourceEntriesAfter, sourceEntriesBefore);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("execute_skill_script runs from a read-only skill tree without source staging", async () => {
    if (Deno.build.os === "windows") return;
    const tempDir = await Deno.makeTempDir({ prefix: "vf-skill-read-only-script-" });
    const skillRoot = `${tempDir}/my-skill`;
    const scriptDirectory = `${skillRoot}/scripts`;

    try {
      await Deno.mkdir(scriptDirectory, { recursive: true });
      await Deno.writeTextFile(`${scriptDirectory}/run.js`, 'console.log("ok");\n');
      await Deno.chmod(scriptDirectory, 0o555);
      await Deno.chmod(skillRoot, 0o555);

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

      const result = await createExecuteSkillScriptTool({
        executor: new LocalScriptExecutor(),
      }).execute({
        skillId: "my-skill",
        script: "scripts/run.js",
      });

      assertEquals(result.exitCode, 0);
      assertEquals(result.stderr, "");
      assertEquals(result.stdout.trim(), "ok");
    } finally {
      await Deno.chmod(skillRoot, 0o700).catch(() => {});
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

  it("keeps active-skill script authorization independent of Array prototype hooks", async () => {
    const scriptPath = "/project/skills/my-skill/scripts/hidden.sh";
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo hidden" });
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
    const originalIncludes = Object.getOwnPropertyDescriptor(Array.prototype, "includes");

    try {
      Object.defineProperty(Array.prototype, "includes", {
        configurable: true,
        value: () => true,
        writable: true,
      });
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
        "advertised",
      );
    } finally {
      if (originalIncludes) {
        Object.defineProperty(Array.prototype, "includes", originalIncludes);
      }
    }

    assertEquals(executorCalled, false);
  });

  it("keeps selector authorization independent of Array prototype hooks", async () => {
    const scriptPath = "/project/skills/my-skill/scripts/run.sh";
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("my-skill", createTestSkill(adapter));
    let executorCalled = false;
    const tool = createExecuteSkillScriptTool({
      resolveAllowedSkillIds: () => ["other-skill"],
      executor: {
        async execute() {
          executorCalled = true;
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      },
    });
    const originalIncludes = Object.getOwnPropertyDescriptor(Array.prototype, "includes");

    try {
      Object.defineProperty(Array.prototype, "includes", {
        configurable: true,
        value: () => true,
        writable: true,
      });
      await assertRejects(
        () =>
          tool.execute({
            skillId: "my-skill",
            script: "scripts/run.sh",
          }),
        Error,
        "not available",
      );
    } finally {
      if (originalIncludes) {
        Object.defineProperty(Array.prototype, "includes", originalIncludes);
      }
    }

    assertEquals(executorCalled, false);
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

  it("keeps environment-name authorization independent of public regex and prototype mutation", async () => {
    const scriptPath = "/project/skills/my-skill/scripts/run.sh";
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("my-skill", createTestSkill(adapter));
    let executorCalled = false;
    let failure: unknown;
    const tool = createExecuteSkillScriptTool({
      executor: {
        async execute() {
          executorCalled = true;
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      },
    });
    const originalSource = SKILL_SCRIPT_ENV_KEY_REGEX.source;
    const originalTest = Object.getOwnPropertyDescriptor(RegExp.prototype, "test");

    try {
      SKILL_SCRIPT_ENV_KEY_REGEX.compile(".*");
      Object.defineProperty(RegExp.prototype, "test", {
        configurable: true,
        value: () => true,
        writable: true,
      });
      try {
        await tool.execute({
          skillId: "my-skill",
          script: "scripts/run.sh",
          env: { "BAD=KEY": "value" },
        });
      } catch (error) {
        failure = error;
      }
    } finally {
      if (originalTest) Object.defineProperty(RegExp.prototype, "test", originalTest);
      SKILL_SCRIPT_ENV_KEY_REGEX.compile(originalSource);
    }

    assert(failure instanceof Error);
    assertEquals(executorCalled, false);
  });

  it("rejects untrusted custom-executor result shapes without invoking accessors", async () => {
    const scriptPath = "/project/skills/my-skill/scripts/run.sh";
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("my-skill", createTestSkill(adapter));
    let getterCalls = 0;
    const hostileResult = Object.defineProperties({}, {
      stdout: {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "leak";
        },
      },
      stderr: { enumerable: true, value: "" },
      exitCode: { enumerable: true, value: 0 },
    });
    const tool = createExecuteSkillScriptTool({
      executor: {
        async execute() {
          return hostileResult as never;
        },
      },
    });

    await assertRejects(
      () => tool.execute({ skillId: "my-skill", script: "scripts/run.sh" }),
      TypeError,
      "data properties",
    );
    assertEquals(getterCalls, 0);
  });

  it("bounds and detaches custom-executor results before returning them", async () => {
    const scriptPath = "/project/skills/my-skill/scripts/run.sh";
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("my-skill", createTestSkill(adapter));
    const oversizedTool = createExecuteSkillScriptTool({
      executor: {
        async execute() {
          return {
            stdout: "x".repeat(SKILL_SCRIPT_MAX_OUTPUT_BYTES + 1),
            stderr: "",
            exitCode: 0,
          };
        },
      },
    });

    await assertRejects(
      () => oversizedTool.execute({ skillId: "my-skill", script: "scripts/run.sh" }),
      RangeError,
      "output",
    );

    const sourceResult = { stdout: "ok", stderr: "", exitCode: 0 };
    const detachedTool = createExecuteSkillScriptTool({
      executor: { execute: () => Promise.resolve(sourceResult) },
    });
    const result = await detachedTool.execute({
      skillId: "my-skill",
      script: "scripts/run.sh",
    });
    sourceResult.stdout = "mutated";
    sourceResult.exitCode = 99;

    assertEquals(result, { stdout: "ok", stderr: "", exitCode: 0 });
    assertEquals(Object.isFrozen(result), true);
  });

  it("execute_skill_script propagates request cancellation to the executor", async () => {
    const scriptPath = "/project/skills/my-skill/scripts/run.sh";
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("my-skill", createTestSkill(adapter));
    const controller = new AbortController();
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

  it("execute_skill_script redacts its root from executor failures", async () => {
    const root = "/project/skills/my-skill";
    const scriptPath = `${root}/scripts/run.sh`;
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("my-skill", createTestSkill(adapter));
    const tool = createExecuteSkillScriptTool({
      executor: {
        execute() {
          throw new Error(`Runner failed below ${root}/scripts`);
        },
      },
    });

    let message = "";
    try {
      await tool.execute({ skillId: "my-skill", script: "scripts/run.sh" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    assertEquals(message.includes(root), false);
    assertEquals(message.includes("<skill-root>/scripts"), true);
  });

  it("execute_skill_script removes nested error state that contains its root", async () => {
    const root = "/project/skills/my-skill";
    const scriptPath = `${root}/scripts/run.sh`;
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("my-skill", createTestSkill(adapter));
    const original = new Error("Runner failed", {
      cause: new Error(`Private source: ${root}/scripts/run.sh`),
    });
    Object.defineProperty(original, "diagnostic", {
      enumerable: true,
      value: `${root}/internal`,
    });
    const tool = createExecuteSkillScriptTool({
      executor: {
        execute() {
          throw original;
        },
      },
    });

    let failure: unknown;
    try {
      await tool.execute({ skillId: "my-skill", script: "scripts/run.sh" });
    } catch (error) {
      failure = error;
    }

    assertEquals(failure instanceof Error, true);
    assertEquals(failure === original, false);
    assertEquals(failure instanceof Error ? failure.message : "", "Runner failed");
    assertEquals(failure instanceof Error ? failure.cause : undefined, undefined);
    assertEquals(
      failure instanceof Error && Object.hasOwn(failure, "diagnostic"),
      false,
    );
  });

  it("execute_skill_script redacts roots before diagnostic truncation", async () => {
    const root = "/private/workspaces/customer/skills/writer";
    const scriptPath = `${root}/scripts/run.sh`;
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("writer", {
      id: "writer",
      metadata: { name: "writer", description: "Writes" },
      rootPath: root,
      fsAdapter: adapter,
    });
    const tool = createExecuteSkillScriptTool({
      executor: {
        execute() {
          throw new Error(`${"x".repeat(2_000)}${root}/secret`);
        },
      },
    });

    let message = "";
    try {
      await tool.execute({ skillId: "writer", script: "scripts/run.sh" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    assertEquals(message.includes(root), false);
    assertEquals(message.includes("/private/workspaces/customer/skill"), false);
    assertEquals(message.includes("<skill-root>/secret"), true);
  });

  it("execute_skill_script sanitizes hostile thrown objects without invoking accessors", async () => {
    const root = "/project/skills/my-skill";
    const scriptPath = `${root}/scripts/run.sh`;
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("my-skill", createTestSkill(adapter));
    let accessorReads = 0;
    const hostile = Object.create(Error.prototype);
    for (const property of ["message", "name", "cause"] as const) {
      Object.defineProperty(hostile, property, {
        get() {
          accessorReads += 1;
          throw new Error(`Accessor exposed ${root}`);
        },
      });
    }
    const tool = createExecuteSkillScriptTool({
      executor: {
        execute() {
          throw hostile;
        },
      },
    });

    let failure: unknown;
    try {
      await tool.execute({ skillId: "my-skill", script: "scripts/run.sh" });
    } catch (error) {
      failure = error;
    }

    assertEquals(accessorReads, 0);
    assertEquals(failure instanceof Error, true);
    assertEquals(failure === hostile, false);
    assertEquals(failure instanceof Error ? failure.message : "", "Skill operation failed");
  });

  it("execute_skill_script classifies timeouts only after detaching Proxy failures", async () => {
    const root = "/private/workspaces/customer/skills/demo";
    const scriptPath = `${root}/scripts/run.sh`;
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("demo", {
      id: "demo",
      metadata: { name: "demo", description: "Demo" },
      rootPath: root,
      fsAdapter: adapter,
    });
    let prototypeTrapCalls = 0;
    const hostile = new Proxy(new Error("runner failed"), {
      getPrototypeOf() {
        prototypeTrapCalls += 1;
        throw new Error(`${root}/private`);
      },
    });
    const tool = createExecuteSkillScriptTool({
      executor: {
        execute() {
          throw hostile;
        },
      },
    });

    let failure: unknown;
    try {
      await tool.execute({ skillId: "demo", script: "scripts/run.sh" });
    } catch (error) {
      failure = error;
    }

    assertEquals(prototypeTrapCalls, 0);
    assertEquals(failure instanceof Error, true);
    assertEquals(
      failure instanceof Error ? failure.message.includes(root) : true,
      false,
    );
  });

  it("execute_skill_script settles when cancellation interrupts filesystem preflight", async () => {
    const pending = new Promise<boolean>(() => {});
    const adapter = {
      ...createSkillTestAdapter({}),
      exists: () => pending,
    };
    registerSkill("my-skill", createTestSkill(adapter));
    const controller = new AbortController();
    let executorCalled = false;
    const tool = createExecuteSkillScriptTool({
      executor: {
        async execute() {
          executorCalled = true;
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      },
    });

    const execution = tool.execute(
      { skillId: "my-skill", script: "scripts/run.sh" },
      { abortSignal: controller.signal },
    );
    controller.abort(new Error("cancel script preflight"));
    const settlement = await settleWithin(execution);

    assertEquals(settlement.kind, "fulfilled");
    if (settlement.kind === "fulfilled") {
      assertEquals(settlement.value.exitCode, 130);
    }
    assertEquals(executorCalled, false);
  });

  it("load_skill settles when cancellation interrupts filesystem preflight", async () => {
    const pending = new Promise<boolean>(() => {});
    const adapter = {
      ...createSkillTestAdapter({}),
      exists: () => pending,
    };
    registerSkill("my-skill", createTestSkill(adapter));
    const controller = new AbortController();
    const cancellation = new Error("cancel load_skill preflight");

    const execution = createLoadSkillTool().execute(
      { skillId: "my-skill" },
      { abortSignal: controller.signal },
    );
    controller.abort(cancellation);

    const settlement = await settleWithin(execution);
    assertEquals(settlement.kind, "rejected");
    if (settlement.kind === "rejected") {
      assertEquals(settlement.error, cancellation);
    }
  });

  it("load_skill_reference settles when cancellation interrupts filesystem preflight", async () => {
    const pending = new Promise<boolean>(() => {});
    const adapter = {
      ...createSkillTestAdapter({}),
      exists: () => pending,
    };
    registerSkill("my-skill", createTestSkill(adapter));
    const controller = new AbortController();
    const cancellation = new Error("cancel reference preflight");

    const execution = createLoadSkillReferenceTool().execute(
      { skillId: "my-skill", reference: "references/guide.md" },
      { abortSignal: controller.signal },
    );
    controller.abort(cancellation);

    const settlement = await settleWithin(execution);
    assertEquals(settlement.kind, "rejected");
    if (settlement.kind === "rejected") {
      assertEquals(settlement.error, cancellation);
    }
  });

  it("execute_skill_script applies its timeout to filesystem preflight", async () => {
    const pending = new Promise<boolean>(() => {});
    const adapter = {
      ...createSkillTestAdapter({}),
      exists: () => pending,
    };
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

    const settlement = await settleWithin(
      tool.execute({
        skillId: "my-skill",
        script: "scripts/run.sh",
        timeoutMs: 10,
      }),
    );

    assertEquals(settlement.kind, "fulfilled");
    if (settlement.kind === "fulfilled") {
      assertEquals(settlement.value.exitCode, 124);
    }
    assertEquals(executorCalled, false);
  });

  it("execute_skill_script rejects executor success after the total timeout", async () => {
    const scriptPath = "/project/skills/my-skill/scripts/run.sh";
    const adapter = createSkillTestAdapter({ [scriptPath]: "echo run" });
    registerSkill("my-skill", createTestSkill(adapter));
    let executorCalled = false;
    const tool = createExecuteSkillScriptTool({
      executor: {
        async execute() {
          executorCalled = true;
          const startedAt = performance.now();
          while (performance.now() - startedAt < 100) {
            // Deliberately block past the public tool's total deadline.
          }
          return { stdout: "late success", stderr: "", exitCode: 0 };
        },
      },
    });

    const result = await tool.execute({
      skillId: "my-skill",
      script: "scripts/run.sh",
      timeoutMs: 50,
    });

    assertEquals(executorCalled, true);
    assertEquals(result.exitCode, 124);
    assertEquals(result.stdout, "");
  });
});

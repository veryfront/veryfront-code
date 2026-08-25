import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { join, relative, resolve } from "#std/path.ts";
import { filenameToId } from "#veryfront/discovery/discovery-utils.ts";
import {
  planAuthScaffold,
  planScaffold,
  scaffoldAuthFiles,
  scaffoldProjectFile,
} from "./engine.ts";

async function withTempProject(fn: (projectDir: string) => Promise<void>): Promise<void> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-scaffold-engine-" });
  try {
    await fn(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

describe("scaffold engine", () => {
  it("plans app-router route files", () => {
    const projectDir = "/project";

    assertEquals(
      planScaffold({ projectDir, type: "page", name: "docs/intro" }).files[0]?.path,
      "/project/app/docs/intro/page.tsx",
    );
    assertEquals(
      planScaffold({ projectDir, type: "api", name: "users/[id]" }).files[0]?.path,
      "/project/app/api/users/[id]/route.ts",
    );
    // An explicit "api/" prefix must not be doubled up.
    assertEquals(
      planScaffold({ projectDir, type: "api", name: "api/users/[id]" }).files[0]?.path,
      "/project/app/api/users/[id]/route.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "api", name: "api" }).files[0]?.path,
      "/project/app/api/route.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "layout", name: "admin" }).files[0]?.path,
      "/project/app/admin/layout.tsx",
    );
  });

  it("plans pages-router route files", () => {
    const projectDir = "/project";
    const router = "pages-router";

    assertEquals(
      planScaffold({ projectDir, router, type: "page", name: "docs/intro" }).files[0]?.path,
      "/project/pages/docs/intro.mdx",
    );
    assertEquals(
      planScaffold({ projectDir, router, type: "api", name: "users/[id]" }).files[0]?.path,
      "/project/pages/api/users/[id].ts",
    );
    assertEquals(
      planScaffold({ projectDir, router, type: "api", name: "api" }).files[0]?.path,
      "/project/pages/api/index.ts",
    );
    assertEquals(
      planScaffold({ projectDir, router, type: "layout", name: "main" }).files[0]?.path,
      "/project/layouts/Main.mdx",
    );
  });

  it("plans component and AI primitive files", () => {
    const projectDir = "/project";

    assertEquals(
      planScaffold({ projectDir, type: "component", name: "user-card" }).files[0]?.path,
      "/project/components/UserCard.tsx",
    );
    assertEquals(
      planScaffold({ projectDir, type: "tool", name: "search-docs" }).files[0]?.path,
      "/project/tools/search-docs.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "agent", name: "researcher" }).files[0]?.path,
      "/project/agents/researcher.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "prompt", name: "summarize-report" }).files[0]?.path,
      "/project/prompts/summarize-report.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "workflow", name: "content-pipeline" }).files[0]?.path,
      "/project/workflows/content-pipeline.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "task", name: "sync-data" }).files[0]?.path,
      "/project/tasks/sync-data.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "resource", name: "docs" }).files[0]?.path,
      "/project/resources/docs.ts",
    );
    assertEquals(
      planScaffold({ projectDir, type: "skill", name: "code-review" }).files[0]?.path,
      "/project/skills/code-review/SKILL.md",
    );
  });

  it("writes planned files and reports created files", async () => {
    await withTempProject(async (projectDir) => {
      const result = await scaffoldProjectFile({
        projectDir,
        type: "tool",
        name: "search-docs",
      });
      const filePath = join(projectDir, "tools", "search-docs.ts");

      assertEquals(result.success, true);
      assertEquals(result.files, [{ path: filePath, created: true }]);

      const content = await Deno.readTextFile(filePath);
      assertStringIncludes(content, "inputSchema");
      assertStringIncludes(content, 'import { tool } from "veryfront/tool";');
      assertStringIncludes(content, "execute: ({ input }) =>");
      assertEquals(content.includes("execute: async"), false);
    });
  });

  it("gives a scaffolded tool the same id discovery derives from its filename", () => {
    const projectDir = "/project";

    for (const name of ["get-weather", "get weather", "search_docs", "searchDocs"]) {
      const file = planScaffold({ projectDir, type: "tool", name }).files[0]!;
      const discoveredId = filenameToId(file.path);

      assertStringIncludes(
        file.content,
        `id: "${discoveredId}",`,
        `scaffolded tool "${name}" must declare the id discovery derives from ${file.path}`,
      );
    }
  });

  it("uses the slug as the generated agent id", async () => {
    await withTempProject(async (projectDir) => {
      const result = await scaffoldProjectFile({
        projectDir,
        type: "agent",
        name: "research-agent",
      });
      const filePath = join(projectDir, "agents", "research-agent.ts");

      assertEquals(result.success, true);

      const content = await Deno.readTextFile(filePath);
      assertStringIncludes(content, 'id: "research-agent"');
      assertStringIncludes(content, "specialized in research-agent");
    });
  });

  it("reports conflicts before overwriting files", async () => {
    await withTempProject(async (projectDir) => {
      const first = await scaffoldProjectFile({ projectDir, type: "agent", name: "assistant" });
      const second = await scaffoldProjectFile({ projectDir, type: "agent", name: "assistant" });

      assertEquals(first.success, true);
      assertEquals(second.success, false);
      assertEquals(second.files, [{
        path: join(projectDir, "agents", "assistant.ts"),
        created: false,
      }]);
      assertStringIncludes(second.message, "already exists");
    });
  });

  it("plans auth preset files in deterministic project-relative order", async () => {
    const projectDir = "/project";
    const plan = await planAuthScaffold({ projectDir, preset: "authelia" });

    assertEquals(plan.type, "auth");
    assertEquals(plan.name, "authelia");
    assertEquals(plan.files.map((file) => file.path), [
      "/project/.env.auth.example",
      "/project/AUTH_PROVIDER_SETUP.md",
      "/project/AUTH_SETUP.md",
      "/project/authelia.client.example.yml",
      "/project/veryfront.auth.config.example.ts",
    ]);
    assertStringIncludes(plan.files[4]!.content, "security:");
    assertStringIncludes(plan.files[4]!.content, "auth:");
    assertStringIncludes(plan.files[4]!.content, "oidc:");
  });

  it("plans auth preset targets against a resolved project directory", async () => {
    const projectDir = "./relative-auth-project";
    const plan = await planAuthScaffold({ projectDir, preset: "authelia" });

    assertEquals(plan.files.map((file) => file.path), [
      resolve(projectDir, ".env.auth.example"),
      resolve(projectDir, "AUTH_PROVIDER_SETUP.md"),
      resolve(projectDir, "AUTH_SETUP.md"),
      resolve(projectDir, "authelia.client.example.yml"),
      resolve(projectDir, "veryfront.auth.config.example.ts"),
    ]);
  });

  it("rejects unknown auth presets without falling back to another scaffold", async () => {
    await withTempProject(async (projectDir) => {
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "other" as "authelia",
      });

      assertEquals(result.success, false);
      assertEquals(result.files, []);
      assertStringIncludes(result.message, "Unknown auth preset");
      assertStringIncludes(result.message, "authelia, oidc, microsoft-entra");
    });
  });

  it("preflights every auth target and writes nothing when one file exists", async () => {
    await withTempProject(async (projectDir) => {
      await Deno.writeTextFile(join(projectDir, "AUTH_SETUP.md"), "existing");

      const result = await scaffoldAuthFiles({ projectDir, preset: "oidc" });

      assertEquals(result.success, false);
      assertEquals(result.files, [{ path: "AUTH_SETUP.md", created: false }]);
      assertEquals(await Deno.readTextFile(join(projectDir, "AUTH_SETUP.md")), "existing");
      assertEquals(await exists(join(projectDir, ".env.auth.example")), false);
    });
  });

  it("reports every existing auth target in one deterministic conflict result", async () => {
    await withTempProject(async (projectDir) => {
      await Deno.writeTextFile(join(projectDir, "AUTH_SETUP.md"), "existing setup");
      await Deno.writeTextFile(join(projectDir, "AUTH_PROVIDER_SETUP.md"), "existing provider");

      const result = await scaffoldAuthFiles({ projectDir, preset: "oidc" });

      assertEquals(result.success, false);
      assertEquals(result.files, [
        { path: "AUTH_PROVIDER_SETUP.md", created: false },
        { path: "AUTH_SETUP.md", created: false },
      ]);
      assertEquals(await exists(join(projectDir, ".env.auth.example")), false);
      assertEquals(
        await Deno.readTextFile(join(projectDir, "AUTH_PROVIDER_SETUP.md")),
        "existing provider",
      );
    });
  });

  it("reports an identical auth rerun as a conflict with project-relative paths", async () => {
    await withTempProject(async (projectDir) => {
      const first = await scaffoldAuthFiles({ projectDir, preset: "microsoft-entra" });
      const second = await scaffoldAuthFiles({ projectDir, preset: "microsoft-entra" });

      assertEquals(first.success, true);
      assertEquals(second.success, false);
      assertEquals(second.files.map((file) => file.created), [false, false, false, false]);
      assertEquals(second.files.map((file) => file.path), [
        ".env.auth.example",
        "AUTH_PROVIDER_SETUP.md",
        "AUTH_SETUP.md",
        "veryfront.auth.config.example.ts",
      ]);
    });
  });

  it("accepts Windows real paths when the opened target remains inside the project root", async () => {
    await withTempProject(async (projectDir) => {
      const target = join(projectDir, "first.txt");
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [{ path: target, content: "first" }],
        realPathForTesting: (path) =>
          Promise.resolve(
            path === projectDir
              ? String.raw`C:\projects\veryfront-app`
              : String.raw`C:\projects\veryfront-app\first.txt`,
          ),
      });

      assertEquals(result.success, true);
      assertEquals(await Deno.readTextFile(target), "first");
    });
  });

  it("rejects unsafe multi-file plan paths before writing", async () => {
    await withTempProject(async (projectDir) => {
      for (
        const file of [
          { path: join(projectDir, "..", "escape.txt"), content: "escape" },
          { path: projectDir, content: "root" },
        ]
      ) {
        const result = await scaffoldAuthFiles({
          projectDir,
          preset: "oidc",
          filesForTesting: [file],
        });

        assertEquals(result.success, false);
        assertStringIncludes(result.message, "Unsafe scaffold path");
      }
    });
  });

  it("rejects absolute and reserved auth template paths before planning targets", async () => {
    await withTempProject(async (projectDir) => {
      for (
        const path of [
          "/absolute.txt",
          "../escape.txt",
          "docs//setup.md",
          "docs/./setup.md",
          "docs/setup.md",
          "CON",
          "aux.md",
          "COM\u00B9",
          "name.",
          "name ",
          "existing.txt:scaffold",
          "docs\\setup.md",
          "",
        ]
      ) {
        const result = await scaffoldAuthFiles({
          projectDir,
          preset: "oidc",
          templateFilesForTesting: [{ path, content: "unsafe" }],
        });

        assertEquals(result.success, false, `template path ${JSON.stringify(path)} must fail`);
        assertStringIncludes(result.message, "Unsafe auth template path");
      }
    });
  });

  it("rejects empty and reserved target path components before writing", async () => {
    await withTempProject(async (projectDir) => {
      for (
        const path of [
          "",
          `${projectDir}/docs//setup.md`,
          `${projectDir}/docs/./setup.md`,
          `${projectDir}/docs/`,
          join(projectDir, "CON"),
          join(projectDir, "aux.md"),
          join(projectDir, "LPT\u00B2.txt"),
          join(projectDir, "name."),
          join(projectDir, "name "),
          join(projectDir, "existing.txt:scaffold"),
        ]
      ) {
        const result = await scaffoldAuthFiles({
          projectDir,
          preset: "oidc",
          filesForTesting: [{ path, content: "unsafe" }],
        });

        assertEquals(result.success, false, `target path ${JSON.stringify(path)} must fail`);
        assertStringIncludes(result.message, "Unsafe scaffold path");
      }
    });
  });

  it("rejects duplicate normalized targets before writing", async () => {
    await withTempProject(async (projectDir) => {
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [
          { path: join(projectDir, "docs", "setup.md"), content: "one" },
          { path: join(projectDir, "docs", "..", "docs", "setup.md"), content: "two" },
        ],
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "Duplicate scaffold path");
      assertEquals(await exists(join(projectDir, "docs", "setup.md")), false);
    });
  });

  it("rejects an unbounded multi-file plan before writing", async () => {
    await withTempProject(async (projectDir) => {
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: Array.from({ length: 33 }, (_, index) => ({
          path: join(projectDir, `file-${index}.txt`),
          content: "no",
        })),
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "too many files");
      assertEquals(await exists(join(projectDir, "file-0.txt")), false);
    });
  });

  it("rejects lexical traversal even when normalization stays inside the project", async () => {
    await withTempProject(async (projectDir) => {
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [{
          path: `${projectDir}/docs/../safe.txt`,
          content: "no",
        }],
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "Unsafe scaffold path");
      assertEquals(await exists(join(projectDir, "safe.txt")), false);
    });
  });

  it("rejects symlinked project roots before writing auth files", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-auth-root-" });
    const outside = await Deno.makeTempDir({ prefix: "vf-auth-root-outside-" });
    const linkedRoot = `${projectDir}-link`;
    try {
      await Deno.symlink(outside, linkedRoot);
    } catch (error) {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(outside, { recursive: true });
      if (error instanceof Deno.errors.PermissionDenied) return;
      throw error;
    }
    try {
      const result = await scaffoldAuthFiles({
        projectDir: linkedRoot,
        preset: "oidc",
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "Unsafe scaffold project root");
      assertEquals(await exists(join(outside, "AUTH_SETUP.md")), false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
      await Deno.remove(linkedRoot);
      await Deno.remove(outside, { recursive: true });
    }
  });

  it("rejects symlinked target parents before writing", async () => {
    await withTempProject(async (projectDir) => {
      const outside = await Deno.makeTempDir({ prefix: "vf-scaffold-outside-" });
      try {
        await Deno.symlink(outside, join(projectDir, "linked"));
      } catch (error) {
        if (error instanceof Deno.errors.PermissionDenied) return;
        throw error;
      }
      try {
        const result = await scaffoldAuthFiles({
          projectDir,
          preset: "oidc",
          filesForTesting: [{ path: join(projectDir, "linked", "file.txt"), content: "no" }],
        });

        assertEquals(result.success, false);
        assertStringIncludes(result.message, "Unsafe scaffold path");
        assertEquals(await exists(join(outside, "file.txt")), false);
      } finally {
        await Deno.remove(outside, { recursive: true });
      }
    });
  });

  it("rejects symlinked target files without changing their referent", async () => {
    await withTempProject(async (projectDir) => {
      const outside = await Deno.makeTempFile({ prefix: "vf-scaffold-target-" });
      await Deno.writeTextFile(outside, "outside");
      try {
        await Deno.symlink(outside, join(projectDir, "target.txt"));
      } catch (error) {
        await Deno.remove(outside);
        if (error instanceof Deno.errors.PermissionDenied) return;
        throw error;
      }
      try {
        const result = await scaffoldAuthFiles({
          projectDir,
          preset: "oidc",
          filesForTesting: [{ path: join(projectDir, "target.txt"), content: "no" }],
        });

        assertEquals(result.success, false);
        assertStringIncludes(result.message, "Unsafe scaffold path");
        assertEquals(await Deno.readTextFile(outside), "outside");
      } finally {
        await Deno.remove(outside);
      }
    });
  });

  it("rejects non-directory target parents before writing", async () => {
    await withTempProject(async (projectDir) => {
      await Deno.writeTextFile(join(projectDir, "blocked"), "file");

      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [{ path: join(projectDir, "blocked", "target.txt"), content: "no" }],
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "Unsafe scaffold path: blocked");
      assertEquals(await Deno.readTextFile(join(projectDir, "blocked")), "file");
    });
  });

  it("uses exclusive create when a target appears after preflight", async () => {
    await withTempProject(async (projectDir) => {
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [
          { path: join(projectDir, "first.txt"), content: "first" },
          { path: join(projectDir, "second.txt"), content: "second" },
        ],
        beforeWriteForTesting: async (file) => {
          if (file.path.endsWith("second.txt")) {
            await Deno.writeTextFile(file.path, "racing writer", { createNew: true });
          }
        },
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "target already exists");
      assertEquals(await exists(join(projectDir, "first.txt")), false);
      assertEquals(await Deno.readTextFile(join(projectDir, "second.txt")), "racing writer");
    });
  });

  it("uses exclusive creation and rolls back files created by the same invocation", async () => {
    await withTempProject(async (projectDir) => {
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [
          { path: join(projectDir, "first.txt"), content: "first" },
          { path: join(projectDir, "second.txt"), content: "second" },
        ],
        beforeWriteForTesting: (file) => {
          if (file.path.endsWith("second.txt")) {
            throw new Deno.errors.AlreadyExists("race");
          }
          return Promise.resolve();
        },
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "Failed to create scaffold");
      assertEquals(await exists(join(projectDir, "first.txt")), false);
      assertEquals(await exists(join(projectDir, "second.txt")), false);
    });
  });

  it("does not remove a created file path after another writer replaces it before rollback", async () => {
    await withTempProject(async (projectDir) => {
      const firstPath = join(projectDir, "first.txt");
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [
          { path: firstPath, content: "first" },
          { path: join(projectDir, "second.txt"), content: "second" },
        ],
        beforeWriteForTesting: async (file) => {
          if (file.path.endsWith("second.txt")) {
            await Deno.remove(firstPath);
            await Deno.writeTextFile(firstPath, "replacement");
            throw new Error("simulated write failure");
          }
        },
      });

      assertEquals(result.success, false);
      assertEquals(await Deno.readTextFile(firstPath), "replacement");
    });
  });

  it("fails closed when the project root identity changes after opening a target", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-auth-root-race-" });
    const outside = await Deno.makeTempDir({ prefix: "vf-auth-root-race-outside-" });
    let replacedRoot = false;
    try {
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [{ path: join(projectDir, "first.txt"), content: "first" }],
        afterOpenForTesting: async () => {
          await Deno.remove(projectDir, { recursive: true });
          await Deno.symlink(outside, projectDir);
          replacedRoot = true;
        },
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "filesystem write failed");
      assertEquals(await exists(join(outside, "first.txt")), false);
    } finally {
      if (replacedRoot) await Deno.remove(projectDir);
      else await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
      await Deno.remove(outside, { recursive: true });
    }
  });

  it("writes no content when the project root changes between the final check and open", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-auth-root-open-race-" });
    const outside = await Deno.makeTempDir({ prefix: "vf-auth-root-open-race-outside-" });
    const outsideTarget = join(outside, "first.txt");
    let replacedRoot = false;
    try {
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [{ path: join(projectDir, "first.txt"), content: "first" }],
        beforeOpenForTesting: async () => {
          await Deno.remove(projectDir, { recursive: true });
          await Deno.symlink(outside, projectDir);
          replacedRoot = true;
        },
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "filesystem write failed");
      if (await exists(outsideTarget)) {
        assertEquals(await Deno.readTextFile(outsideTarget), "");
      }
    } finally {
      if (replacedRoot) await Deno.remove(projectDir);
      else await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
      await Deno.remove(outside, { recursive: true });
    }
  });

  it("does not remove rollback paths when filesystem identity cannot be proven", async () => {
    await withTempProject(async (projectDir) => {
      const firstPath = join(projectDir, "first.txt");
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [
          { path: firstPath, content: "first" },
          { path: join(projectDir, "second.txt"), content: "second" },
        ],
        beforeWriteForTesting: (file) => {
          if (file.path.endsWith("second.txt")) throw new Error("simulated write failure");
          return Promise.resolve();
        },
        identityForTesting: () => null,
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "Rollback could not remove: first.txt");
      assertEquals(await Deno.readTextFile(firstPath), "first");
    });
  });

  it("removes a partially written file created by the same invocation", async () => {
    await withTempProject(async (projectDir) => {
      const partialPath = join(projectDir, "partial.txt");
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [
          { path: partialPath, content: "partial content" },
          { path: join(projectDir, "second.txt"), content: "second" },
        ],
        failWriteAfterBytesForTesting: 4,
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "filesystem write failed");
      assertEquals(await exists(partialPath), false);
      assertEquals(await exists(join(projectDir, "second.txt")), false);
    });
  });

  it("bounds auth scaffold file paths, per-file bytes, and total bytes", async () => {
    await withTempProject(async (projectDir) => {
      const longName = `${"a".repeat(241)}.txt`;
      const tooLongPath = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [{ path: join(projectDir, longName), content: "no" }],
      });
      const tooLargeFile = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [{ path: join(projectDir, "large.txt"), content: "x".repeat(262_145) }],
      });
      const tooLargePlan = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [
          { path: join(projectDir, "one.txt"), content: "x".repeat(200_000) },
          { path: join(projectDir, "two.txt"), content: "x".repeat(200_000) },
        ],
      });

      assertEquals(tooLongPath.success, false);
      assertStringIncludes(tooLongPath.message, "path is too long");
      assertEquals(tooLargeFile.success, false);
      assertStringIncludes(tooLargeFile.message, "file is too large");
      assertEquals(tooLargePlan.success, false);
      assertStringIncludes(tooLargePlan.message, "plan is too large");
    });
  });

  it("does not remove pre-existing empty parent directories during rollback", async () => {
    await withTempProject(async (projectDir) => {
      await Deno.mkdir(join(projectDir, "existing"));

      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [
          { path: join(projectDir, "existing", "first.txt"), content: "first" },
          { path: join(projectDir, "existing", "second.txt"), content: "second" },
        ],
        beforeWriteForTesting: (file) => {
          if (file.path.endsWith("second.txt")) {
            throw new Error("simulated write failure");
          }
          return Promise.resolve();
        },
      });

      assertEquals(result.success, false);
      assertEquals(await exists(join(projectDir, "existing")), true);
      assertEquals(await exists(join(projectDir, "existing", "first.txt")), false);
    });
  });

  it("sanitizes rollback failures and identifies only project-relative owned paths", async () => {
    await withTempProject(async (projectDir) => {
      const result = await scaffoldAuthFiles({
        projectDir,
        preset: "oidc",
        filesForTesting: [
          { path: join(projectDir, "first.txt"), content: "first" },
          { path: join(projectDir, "second.txt"), content: "second" },
        ],
        beforeWriteForTesting: (file) => {
          if (file.path.endsWith("second.txt")) throw new Error(`sensitive ${projectDir}`);
          return Promise.resolve();
        },
        removeForTesting: (path) => {
          if (path.endsWith("first.txt")) throw new Error(`sensitive ${projectDir}`);
          return Deno.remove(path);
        },
      });

      assertEquals(result.success, false);
      assertStringIncludes(result.message, "filesystem write failed");
      assertStringIncludes(result.message, "Rollback could not remove: first.txt");
      assertEquals(result.message.includes(projectDir), false);
      assertEquals(result.message.includes("sensitive"), false);
    });
  });

  it("plans identical auth content in two clean project directories", async () => {
    const firstDir = await makeTempDir({ prefix: "vf-auth-plan-first-" });
    const secondDir = await makeTempDir({ prefix: "vf-auth-plan-second-" });
    try {
      const first = await planAuthScaffold({ projectDir: firstDir, preset: "oidc" });
      const second = await planAuthScaffold({ projectDir: secondDir, preset: "oidc" });

      assertEquals(
        first.files.map((file) => ({ path: relative(firstDir, file.path), content: file.content })),
        second.files.map((file) => ({
          path: relative(secondDir, file.path),
          content: file.content,
        })),
      );
    } finally {
      await Deno.remove(firstDir, { recursive: true });
      await Deno.remove(secondDir, { recursive: true });
    }
  });

  it("writes workflow, task, resource, and skill scaffold content", async () => {
    await withTempProject(async (projectDir) => {
      const workflowResult = await scaffoldProjectFile({
        projectDir,
        type: "workflow",
        name: "content-pipeline",
      });
      const taskResult = await scaffoldProjectFile({
        projectDir,
        type: "task",
        name: "sync-data",
      });
      const resourceResult = await scaffoldProjectFile({
        projectDir,
        type: "resource",
        name: "docs",
      });
      const skillResult = await scaffoldProjectFile({
        projectDir,
        type: "skill",
        name: "code-review",
      });

      assertEquals(workflowResult.success, true);
      assertEquals(taskResult.success, true);
      assertEquals(resourceResult.success, true);
      assertEquals(skillResult.success, true);

      const workflowContent = await Deno.readTextFile(
        join(projectDir, "workflows", "content-pipeline.ts"),
      );
      const taskContent = await Deno.readTextFile(join(projectDir, "tasks", "sync-data.ts"));
      const resourceContent = await Deno.readTextFile(join(projectDir, "resources", "docs.ts"));
      const skillContent = await Deno.readTextFile(
        join(projectDir, "skills", "code-review", "SKILL.md"),
      );

      assertStringIncludes(workflowContent, 'import { step, workflow } from "veryfront/workflow";');
      assertStringIncludes(workflowContent, 'id: "content-pipeline"');
      assertStringIncludes(taskContent, "async run");
      assertStringIncludes(taskContent, "schedulable: false");
      assertStringIncludes(resourceContent, 'import { resource } from "veryfront/resource";');
      assertStringIncludes(resourceContent, "paramsSchema");
      assertStringIncludes(skillContent, "name: code-review");
      assertStringIncludes(skillContent, "# Code Review");
    });
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

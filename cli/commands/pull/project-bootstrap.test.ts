import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { ensurePulledProjectBootstrap } from "./project-bootstrap.ts";

it("rolls back other bootstrap files when ignore creation fails", async () => {
  const projectDir = await Deno.makeTempDir();
  const original = Deno.writeTextFile;
  try {
    Deno.writeTextFile = ((path, data, options) =>
      String(path).endsWith(".gitignore")
        ? Promise.reject(new Error("ignore write failed"))
        : original(path, data, options)) as typeof Deno.writeTextFile;
    await assertRejects(
      () =>
        ensurePulledProjectBootstrap({
          projectDir,
          config: { apiUrl: "https://api.veryfront.com", apiToken: "test", projectSlug: "demo" },
          project: { id: "project", slug: "demo" },
          pulledPaths: new Set(),
          deletedPaths: new Set(),
          dryRun: false,
          quiet: true,
        }),
      Error,
      "ignore write failed",
    );
    assertEquals(await Array.fromAsync(Deno.readDir(projectDir)), []);
  } finally {
    Deno.writeTextFile = original;
    await Deno.remove(projectDir, { recursive: true });
  }
});

it("preserves an ignore file created after planning", async () => {
  const projectDir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${projectDir}/.gitignore`, "keep-me/\n");
    await assertRejects(() =>
      ensurePulledProjectBootstrap({
        projectDir,
        config: { apiUrl: "https://api.veryfront.com", apiToken: "test", projectSlug: "demo" },
        project: { id: "project", slug: "demo" },
        pulledPaths: new Set(),
        deletedPaths: new Set(),
        dryRun: false,
        quiet: true,
        plan: {
          projectLinkAction: "create",
          createPackageJson: true,
          createTsconfig: true,
          createGitignore: true,
          writeCount: 4,
        },
      }), Deno.errors.AlreadyExists);
    assertEquals(await Deno.readTextFile(`${projectDir}/.gitignore`), "keep-me/\n");
    assertEquals((await Array.fromAsync(Deno.readDir(projectDir))).map((entry) => entry.name), [
      ".gitignore",
    ]);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
});

import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  ensurePulledProjectBootstrap,
  planPulledProjectBootstrap,
} from "../../../../cli/commands/pull/project-bootstrap.ts";

it("rolls back other bootstrap files when ignore creation fails", async () => {
  const projectDir = await makeTempDirWithOptions();
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
  const projectDir = await makeTempDirWithOptions();
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
          sharedAssociationAction: "create",
          writeCount: 5,
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

it("creates a credential-free tracked association for a Studio-first project", async () => {
  const projectDir = await makeTempDirWithOptions();
  try {
    await ensurePulledProjectBootstrap({
      projectDir,
      config: { apiUrl: "http://localhost:4400", apiToken: "private-token", projectSlug: "demo" },
      project: { id: "project", slug: "demo" },
      pulledPaths: new Set(),
      deletedPaths: new Set(),
      dryRun: false,
      quiet: true,
    });
    await Deno.remove(`${projectDir}/.veryfront`, { recursive: true });
    assertEquals(JSON.parse(await Deno.readTextFile(`${projectDir}/veryfront.json`)), {
      projectSlug: "demo",
      apiUrl: "http://localhost:4400",
    });
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
});

it("merges a pulled config association and leaves a matched association unchanged", async () => {
  const projectDir = await makeTempDirWithOptions();
  try {
    await Deno.writeTextFile(`${projectDir}/veryfront.json`, JSON.stringify({ name: "my-app" }));
    const options = {
      projectDir,
      config: { apiUrl: "http://localhost:4400", apiToken: "private-token", projectSlug: "demo" },
      project: { id: "project", slug: "demo" },
      pulledPaths: new Set(["veryfront.json"]),
      deletedPaths: new Set<string>(),
      dryRun: false,
      quiet: true,
    };
    await ensurePulledProjectBootstrap(options);
    assertEquals(JSON.parse(await Deno.readTextFile(`${projectDir}/veryfront.json`)), {
      name: "my-app",
      projectSlug: "demo",
      apiUrl: "http://localhost:4400",
    });
    assertEquals(
      (await planPulledProjectBootstrap({ ...options, pulledPaths: new Set() }))
        .sharedAssociationAction,
      null,
    );
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
});

it("preserves an association created after planning", async () => {
  const projectDir = await makeTempDirWithOptions();
  try {
    const options = {
      projectDir,
      config: { apiUrl: "http://localhost:4400", apiToken: "private-token", projectSlug: "demo" },
      project: { id: "project", slug: "demo" },
      pulledPaths: new Set<string>(),
      deletedPaths: new Set<string>(),
      dryRun: false,
      quiet: true,
    };
    const plan = await planPulledProjectBootstrap(options);
    await Deno.writeTextFile(`${projectDir}/veryfront.json`, '{"name":"racing-app"}');
    await assertRejects(
      () => ensurePulledProjectBootstrap({ ...options, plan }),
      Deno.errors.AlreadyExists,
    );
    assertEquals(await Deno.readTextFile(`${projectDir}/veryfront.json`), '{"name":"racing-app"}');
    assertEquals((await Array.fromAsync(Deno.readDir(projectDir))).map((entry) => entry.name), [
      "veryfront.json",
    ]);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
});

it("restores an existing config association when later bootstrap fails", async () => {
  const projectDir = await makeTempDirWithOptions();
  const original = Deno.writeTextFile;
  const previous = '{"name":"existing","projectSlug":"old"}\n';
  try {
    await original(`${projectDir}/veryfront.json`, previous);
    Deno.writeTextFile = ((path, data, options) =>
      String(path).endsWith(".gitignore")
        ? Promise.reject(new Error("ignore write failed"))
        : original(path, data, options)) as typeof Deno.writeTextFile;
    await assertRejects(
      () =>
        ensurePulledProjectBootstrap({
          projectDir,
          config: {
            apiUrl: "http://localhost:4400",
            apiToken: "private-token",
            projectSlug: "demo",
          },
          project: { id: "project", slug: "demo" },
          pulledPaths: new Set(),
          deletedPaths: new Set(),
          dryRun: false,
          quiet: true,
        }),
      Error,
      "ignore write failed",
    );
    assertEquals(await Deno.readTextFile(`${projectDir}/veryfront.json`), previous);
    assertEquals(
      (await Array.fromAsync(Deno.readDir(projectDir))).map((entry) =>
        entry.name
      ),
      ["veryfront.json"],
    );
  } finally {
    Deno.writeTextFile = original;
    await Deno.remove(projectDir, { recursive: true });
  }
});

for (const file of ["package.json", "tsconfig.json"]) {
  it(`preserves ${file} created after planning and rolls back only owned files`, async () => {
    const projectDir = await makeTempDirWithOptions();
    try {
      const options = {
        projectDir,
        config: { apiUrl: "http://localhost:4400", apiToken: "private-token", projectSlug: "demo" },
        project: { id: "project", slug: "demo" },
        pulledPaths: new Set<string>(),
        deletedPaths: new Set<string>(),
        dryRun: false,
        quiet: true,
      };
      const plan = await planPulledProjectBootstrap(options);
      const content = '{"custom":"keep"}\n';
      await Deno.writeTextFile(`${projectDir}/${file}`, content);
      await assertRejects(
        () => ensurePulledProjectBootstrap({ ...options, plan }),
        Deno.errors.AlreadyExists,
      );
      assertEquals(await Deno.readTextFile(`${projectDir}/${file}`), content);
      assertEquals((await Array.fromAsync(Deno.readDir(projectDir))).map((entry) => entry.name), [
        file,
      ]);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });
}

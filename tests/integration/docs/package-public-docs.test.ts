import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import path from "node:path";
import { assertEquals, assertRejects, assertStringIncludes } from "#std/assert";
import {
  docsSourceIdentity,
  packagePublicDocs,
} from "../../../scripts/docs/package-public-docs.ts";
import { prepareRcBuildVersion } from "../../../scripts/ci/prepare-rc-build.ts";

async function fixture(
  run: (root: string, repository: string, revision: string) => Promise<void>,
) {
  const root = await makeTempDirWithOptions({ prefix: "docs-package-test-" });
  const repository = path.join(root, "repo");
  async function command(args: string[]) {
    const result = await new Deno.Command("git", {
      args: ["-C", repository, ...args],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) {
      throw new Error(new TextDecoder().decode(result.stderr));
    }
    return new TextDecoder().decode(result.stdout).trim();
  }
  try {
    await Deno.mkdir(path.join(repository, "docs/public/agent"), {
      recursive: true,
    });
    await Deno.mkdir(path.join(repository, "docs/public/assets"));
    await Deno.mkdir(path.join(repository, "docs/internal"));
    await Deno.writeTextFile(
      path.join(repository, "docs/public/agent/index.md"),
      "---\ntitle: Agent\n---\nRead this guide.",
    );
    await Deno.writeTextFile(
      path.join(repository, "docs/public/agent/draft.md"),
      "---\ntitle: Draft\ndraft: true\n---\nDo not publish.",
    );
    await Deno.writeTextFile(
      path.join(repository, "docs/internal/private.md"),
      "Private implementation",
    );
    await Deno.writeTextFile(
      path.join(repository, "docs/public/assets/icon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    await Deno.writeTextFile(
      path.join(repository, "docs/public/assets/private.txt"),
      "Not an asset",
    );
    await command(["init", "-q"]);
    await command([
      "remote",
      "add",
      "origin",
      "https://example.invalid/product.git",
    ]);
    await command(["add", "."]);
    await command([
      "-c",
      "user.name=Docs fixture",
      "-c",
      "user.email=docs@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "fixture",
    ]);
    const revision = await command(["rev-parse", "HEAD"]);
    await run(root, repository, revision);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("docs-only npm package excludes private content and has no executable package hooks", async () => {
  await fixture(async (root, repository, revision) => {
    const output = path.join(root, "package");
    const result = await packagePublicDocs({
      repository,
      revision,
      product: "agent",
      name: "@veryfront/agent-docs",
      version: "1.2.3",
      output,
      mode: "release",
    });
    assertEquals(result.pages, 1);
    const pkg = JSON.parse(
      await Deno.readTextFile(path.join(output, "package.json")),
    );
    assertEquals(pkg.files, ["content"]);
    assertEquals(pkg.dependencies, undefined);
    assertEquals(pkg.scripts, undefined);
    assertEquals(pkg.exports["./config.json"], "./content/config.json");
    const manifest = JSON.parse(
      await Deno.readTextFile(path.join(output, "content/manifest.json")),
    );
    assertEquals(manifest.sources[0].revision, revision);
    assertEquals(manifest.sources[0].dirty, false);
    assertEquals(
      manifest.files.map((file: { path: string }) => file.path).sort(),
      [
        "agent/agent/index.md",
        "agent/assets/icon.svg",
        "config.json",
        "redirects.json",
      ],
    );
    assertStringIncludes(
      await Deno.readTextFile(
        path.join(output, "content/agent/agent/index.md"),
      ),
      "Read this guide.",
    );
    await assertRejects(
      () =>
        packagePublicDocs({
          repository,
          revision,
          product: "agent",
          name: "@veryfront/agent-docs",
          version: "1.2.3",
          output,
          mode: "release",
        }),
      Error,
      "already exists",
    );
  });
});

Deno.test("release packaging rejects dirty/unpinned sources, symlinks, and output inside a repository", async () => {
  await fixture(async (root, repository, revision) => {
    const options = {
      repository,
      revision,
      product: "agent",
      name: "@veryfront/agent-docs",
      version: "1.2.3",
      output: path.join(root, "package"),
      mode: "release" as const,
    };
    await assertRejects(
      () => packagePublicDocs({ ...options, revision: "0".repeat(40) }),
      Error,
      "clean pinned",
    );
    await assertRejects(
      () =>
        packagePublicDocs({
          ...options,
          output: path.join(repository, "output"),
        }),
      Error,
      "outside its source",
    );
    const file = path.join(repository, "docs/public/agent/index.md");
    const source = await Deno.readTextFile(file);
    await Deno.writeTextFile(file, source + "\nChanged");
    await assertRejects(
      () => packagePublicDocs(options),
      Error,
      "clean pinned",
    );
    await Deno.writeTextFile(file, source);
    await Deno.symlink(
      path.join(repository, "docs/internal/private.md"),
      path.join(repository, "docs/public/agent/leak.md"),
    );
    await assertRejects(
      () => packagePublicDocs({ ...options, mode: "local" }),
      Error,
      "symlinks",
    );
  });
});

Deno.test("Code docs accept only the exact existing RC metadata transformation", async () => {
  await fixture(async (_root, repository) => {
    await Deno.mkdir(path.join(repository, "src/utils"), { recursive: true });
    await Deno.mkdir(path.join(repository, "scripts"));
    await Deno.writeTextFile(
      path.join(repository, "deno.json"),
      JSON.stringify({ name: "@fixture/core", version: "0.1.0-rc" }, null, 2) +
        "\n",
    );
    await Deno.writeTextFile(
      path.join(repository, "src/utils/version-constant.ts"),
      'export const VERSION = "0.1.0-rc";\n',
    );
    await Deno.writeTextFile(
      path.join(repository, "scripts/deno.lock"),
      JSON.stringify(
        {
          version: "5",
          workspace: { links: { "jsr:@fixture/core@0.1.0-rc": "." } },
        },
        null,
        2,
      ) + "\n",
    );
    for (
      const args of [["add", "."], [
        "-c",
        "user.name=Docs fixture",
        "-c",
        "user.email=docs@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "version fixture",
      ]]
    ) {
      const result = await new Deno.Command("git", {
        args: ["-C", repository, ...args],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.success, true);
    }
    await prepareRcBuildVersion({
      rootDir: repository,
      version: "0.1.0-rc.42",
    });
    const identity = await docsSourceIdentity(repository, "0.1.0-rc.42");
    assertEquals(identity.dirty, false);
    assertEquals(identity.versionPreparation, "ci-rc");
    const manifest = path.join(repository, "deno.json");
    const source = await Deno.readTextFile(manifest);
    await Deno.writeTextFile(
      manifest,
      source.replace('"name": "@fixture/core"', '"name": "@fixture/other"'),
    );
    assertEquals(
      (await docsSourceIdentity(repository, "0.1.0-rc.42")).dirty,
      true,
    );
    await Deno.writeTextFile(manifest, source);
    await Deno.writeTextFile(
      path.join(repository, "src/changed.ts"),
      "export const changed = true;\n",
    );
    assertEquals(
      (await docsSourceIdentity(repository, "0.1.0-rc.42")).dirty,
      true,
    );
  });
});

Deno.test("release rejects ignored pages and assets absent from the pinned commit", async () => {
  await fixture(async (root, repository, revision) => {
    await Deno.writeTextFile(
      path.join(repository, ".git/info/exclude"),
      "private.md\nprivate.svg\n",
    );
    const options = {
      repository,
      revision,
      product: "agent",
      name: "@veryfront/agent-docs",
      version: "1.2.3",
      output: path.join(root, "package"),
      mode: "release" as const,
    };
    for (
      const [relative, content] of [
        [
          "docs/public/agent/private.md",
          "---\ntitle: Private\n---\nLocal note",
        ],
        ["docs/public/assets/private.svg", "<svg/>"],
      ]
    ) {
      const file = path.join(repository, relative);
      await Deno.writeTextFile(file, content);
      await assertRejects(
        () => packagePublicDocs(options),
        Error,
        "Untracked release documentation input",
      );
      await Deno.remove(file);
    }
    assertEquals((await packagePublicDocs(options)).pages, 1);
  });
});

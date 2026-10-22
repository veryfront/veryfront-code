import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import { join } from "node:path";
import { assertEquals, assertRejects, assertStringIncludes } from "#std/assert";
import { copyPublicDocs, PUBLIC_DOC_ROOTS } from "../../../scripts/build/copy-public-docs.ts";

async function fixture(
  run: (root: string, pkg: string) => Promise<void>,
): Promise<void> {
  const root = await makeTempDirWithOptions({ prefix: "public-docs-test-" });
  try {
    for (const directory of [...PUBLIC_DOC_ROOTS, "architecture"]) {
      await Deno.mkdir(join(root, "docs", directory), { recursive: true });
    }
    await Deno.writeTextFile(
      join(root, "docs/guides/agents.md"),
      "---\ntitle: Agents\ndescription: Build an agent\n---\nUse agents.",
    );
    await Deno.writeTextFile(
      join(root, "docs/getting-started/quickstart.md"),
      "---\ntitle: Quickstart\n---\nRun the app.",
    );
    await Deno.writeTextFile(
      join(root, "docs/architecture/private.md"),
      "PRIVATE",
    );
    await Deno.writeTextFile(
      join(root, "docs/guides/README.md"),
      "Maintainer notes",
    );
    await Deno.writeTextFile(
      join(root, "docs/guides/draft.md"),
      "---\ntitle: Draft\nstatus: draft\n---\nPRIVATE",
    );
    await Deno.mkdir(join(root, "assets/product-covers"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "assets/product-covers/code.svg"),
      "<svg/>",
    );
    await run(root, join(root, "package"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("packages public pages with a versioned task index and excludes private and maintainer content", async () => {
  await fixture(async (root, pkg) => {
    const pages = await copyPublicDocs(root, pkg, "1.2.3");
    assertEquals(pages.map((page) => page.path), [
      "getting-started/quickstart.md",
      "guides/agents.md",
    ]);
    assertStringIncludes(
      await Deno.readTextFile(join(pkg, "docs/README.md")),
      "veryfront 1.2.3",
    );
    assertStringIncludes(
      await Deno.readTextFile(join(pkg, "docs/README.md")),
      "./guides/agents.md",
    );
    assertEquals(
      JSON.parse(await Deno.readTextFile(join(pkg, "docs/manifest.json")))
        .version,
      "1.2.3",
    );
    const manifest = JSON.parse(
      await Deno.readTextFile(join(pkg, "docs/manifest.json")),
    );
    assertEquals(manifest.mode, "local");
    assertEquals(manifest.sources[0].product, "code");
    assertEquals(manifest.sources[0].dirty, true);
    assertEquals(
      manifest.files.some((file: { path: string }) => file.path === "config.json"),
      true,
    );
    assertEquals(
      manifest.files.some((file: { path: string }) =>
        file.path === "assets/product-covers/code.svg"
      ),
      true,
    );
    const config = JSON.parse(
      await Deno.readTextFile(join(pkg, "docs/config.json")),
    );
    assertEquals(config.mounts[0].root, ".");
    assertEquals(config.mounts[0].directories, PUBLIC_DOC_ROOTS);
    await assertRejects(
      () => Deno.stat(join(pkg, "docs/architecture/private.md")),
      Deno.errors.NotFound,
    );
    await assertRejects(
      () => Deno.stat(join(pkg, "docs/guides/README.md")),
      Deno.errors.NotFound,
    );
  });
});

Deno.test("failed generation preserves the previous complete docs bundle", async () => {
  await fixture(async (root, pkg) => {
    await copyPublicDocs(root, pkg, "1.2.3");
    await Deno.writeTextFile(
      join(root, "docs/guides/broken.md"),
      "No metadata",
    );
    await assertRejects(
      () => copyPublicDocs(root, pkg, "1.2.4"),
      Error,
      "Missing public documentation metadata",
    );
    assertEquals(
      JSON.parse(await Deno.readTextFile(join(pkg, "docs/manifest.json")))
        .version,
      "1.2.3",
    );
  });
});

Deno.test("symlinks and missing public roots fail closed", async () => {
  await fixture(async (root, pkg) => {
    await Deno.symlink(
      join(root, "docs/architecture/private.md"),
      join(root, "docs/guides/leak.md"),
    );
    await assertRejects(
      () => copyPublicDocs(root, pkg, "1.2.3"),
      Error,
      "symlinks",
    );
    await Deno.remove(join(root, "docs/guides/leak.md"));
    await Deno.remove(join(root, "docs/concepts"));
    await assertRejects(
      () => copyPublicDocs(root, pkg, "1.2.3"),
      Deno.errors.NotFound,
    );
  });
});

Deno.test("framework release rejects ignored local docs instead of attesting them as committed", async () => {
  await fixture(async (root, pkg) => {
    const git = async (...args: string[]) => {
      const result = await new Deno.Command("git", {
        args: ["-C", root, ...args],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!result.success) {
        throw new Error(new TextDecoder().decode(result.stderr));
      }
      return new TextDecoder().decode(result.stdout).trim();
    };
    await git("init", "-q");
    await git("add", ".");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "fixture",
    );
    const identity = {
      revision: await git("rev-parse", "HEAD"),
      dirty: false,
      repository: "https://example.invalid/code",
    };
    await Deno.writeTextFile(
      join(root, ".git/info/exclude"),
      "private.md\nprivate.svg\n",
    );
    for (
      const [relative, content] of [
        ["docs/guides/private.md", "---\ntitle: Private\n---\nLocal note"],
        ["assets/product-covers/private.svg", "<svg/>"],
      ]
    ) {
      await Deno.writeTextFile(join(root, relative), content);
      await assertRejects(
        () => copyPublicDocs(root, pkg, "1.2.3", identity),
        Error,
        "Untracked release documentation input",
      );
      await Deno.remove(join(root, relative));
    }
    assertEquals(
      (await copyPublicDocs(root, pkg, "1.2.3", identity)).length,
      2,
    );
  });
});

Deno.test("docs output cannot alias the source through a package-directory symlink", async () => {
  await fixture(async (root, pkg) => {
    await Deno.symlink(join(root, "docs"), pkg, { type: "dir" });
    await assertRejects(() => copyPublicDocs(root, pkg, "1.2.3"), Error, "outside the authored");
    assertStringIncludes(
      await Deno.readTextFile(join(root, "docs/guides/agents.md")),
      "Use agents.",
    );
  });
});

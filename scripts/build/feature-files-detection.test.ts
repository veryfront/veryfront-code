import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findFeaturesWithIgnoredFiles } from "./generate-templates-manifest.ts";

/**
 * #3786 asked whether `templates/features/mdx/files/` is dead weight or a
 * loader bug. It is neither, exactly: the mechanism was never wired. Every
 * feature ships a `files/` tree, `FeatureConfig` has no `files` field, and the
 * loader never reads the directory, so none of it has ever been scaffolded.
 *
 * These pin the detector that now says so on every generator run. They do not
 * assert the specific features or counts against the real tree, because that
 * would fail the moment someone resolves one of them, which is the point.
 */
describe("scripts/build feature files detection", () => {
  it("reports a feature whose files/ the manifest does not carry", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-feature-detect-" });
    try {
      await Deno.mkdir(`${root}/example/files/app`, { recursive: true });
      await Deno.writeTextFile(`${root}/example/files/app/page.mdx`, "# hi\n");
      await Deno.writeTextFile(`${root}/example/files/app/other.mdx`, "# hi\n");
      assertEquals(await findFeaturesWithIgnoredFiles(root), [
        { feature: "example", fileCount: 2 },
      ]);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("says nothing about a feature with no files/ directory", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-feature-detect-" });
    try {
      await Deno.mkdir(`${root}/config-only`, { recursive: true });
      await Deno.writeTextFile(`${root}/config-only/feature.json`, "{}\n");
      assertEquals(await findFeaturesWithIgnoredFiles(root), []);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("says nothing about an empty files/ directory", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-feature-detect-" });
    try {
      await Deno.mkdir(`${root}/empty/files`, { recursive: true });
      assertEquals(await findFeaturesWithIgnoredFiles(root), []);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("returns nothing rather than throwing when the directory is absent", async () => {
    assertEquals(
      await findFeaturesWithIgnoredFiles("/nonexistent-features-dir"),
      [],
    );
  });

  it("detects the condition in the real tree today", async () => {
    // Deliberately asserts only that the condition EXISTS, not which features.
    // When someone resolves #3786 this flips to an empty array and the test
    // fails loudly, which is the reminder to delete it.
    const ignored = await findFeaturesWithIgnoredFiles();
    assertEquals(
      ignored.length > 0,
      true,
      "expected at least one feature with an ignored files/ directory",
    );
  });

  it("importing the generator does not rewrite the tracked artifacts", async () => {
    // Raised in review: the generator ran at module scope, so importing it to
    // reach this detector regenerated and REWROTE templates/manifest.json and
    // manifest.generated.ts. The gzip representation varies with the installed
    // Deno version, so a focused test run could leave a spurious diff in a
    // tracked file. `import.meta.main` now guards the entry point.
    //
    // Runs in a CHILD process on purpose. Importing in-process is a no-op after
    // the first import in this file, so an in-process check passes against the
    // unguarded version too. It proves nothing.
    const artifacts = [
      "./templates/manifest.json",
      "./templates/manifest.generated.ts",
    ];
    const before = await Promise.all(artifacts.map((path) => Deno.stat(path)));

    const moduleUrl =
      new URL("./generate-templates-manifest.ts", import.meta.url).href;
    // Inside the repo tree, not a temp dir: the generator imports `#std/path`,
    // which only resolves against the checked-in import map.
    const probeDir = await Deno.makeTempDir({
      prefix: ".vf-generator-import-",
      dir: ".",
    });
    const probePath = `${probeDir}/probe.ts`;
    await Deno.writeTextFile(
      probePath,
      `const mod = await import(${JSON.stringify(moduleUrl)});\n` +
        `if (typeof mod.findFeaturesWithIgnoredFiles !== "function") Deno.exit(3);\n`,
    );
    let output;
    try {
      output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", probePath],
        cwd: Deno.cwd(),
        stdout: "piped",
        stderr: "piped",
      }).output();
    } finally {
      await Deno.remove(probeDir, { recursive: true });
    }
    assertEquals(
      output.code,
      0,
      `probe failed: ${new TextDecoder().decode(output.stderr)}`,
    );

    const after = await Promise.all(artifacts.map((path) => Deno.stat(path)));
    for (const [index, path] of artifacts.entries()) {
      assertEquals(
        after[index].mtime?.getTime(),
        before[index].mtime?.getTime(),
        `importing the generator must not rewrite ${path}`,
      );
    }
  });
});

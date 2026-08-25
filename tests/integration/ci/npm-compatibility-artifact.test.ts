import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { fromFileUrl, join } from "#std/path";
import {
  createNpmCompatibilityArtifact,
  formatNpmCompatibilityArtifactCliError,
  loadNpmCompatibilityArtifact,
  materializeNpmCompatibilityArtifact,
  NpmCompatibilityArtifactError,
  type NpmCompatibilityManifest,
} from "../../../scripts/ci/npm-compatibility-artifact.ts";

async function writePackage(
  directory: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  await Deno.mkdir(directory, { recursive: true });
  await Deno.writeTextFile(
    join(directory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await Deno.writeTextFile(join(directory, "index.js"), "export {};\n");
}

function withTempDirs<T>(
  prefixes: string[],
  run: (directories: string[]) => Promise<T>,
  directories: string[] = [],
): Promise<T> {
  const [prefix, ...remaining] = prefixes;
  if (!prefix) return run(directories);
  return withTempDir(
    (directory) => withTempDirs(remaining, run, [...directories, directory]),
    { prefix },
  );
}

describe("npm compatibility artifact", () => {
  it("sanitizes package paths and npm stderr at the CLI error boundary", () => {
    const packageDirectory = "/private/tmp/npm-controlled/package";
    const npmStderr = "npm ERR! token=attacker-controlled\n::error::injected";
    const error = new NpmCompatibilityArtifactError(
      "pack",
      `npm pack failed for ${packageDirectory}: ${npmStderr}`,
      { packageName: "@veryfront/ext-alpha" },
    );

    assertStringIncludes(error.message, packageDirectory);
    assertStringIncludes(error.message, npmStderr);
    assertEquals(
      formatNpmCompatibilityArtifactCliError(error, "pack"),
      "npm compatibility artifact pack failed for @veryfront/ext-alpha.",
    );
    const publicMessage = formatNpmCompatibilityArtifactCliError(error, "pack");
    assertEquals(publicMessage.includes(packageDirectory), false);
    assertEquals(publicMessage.includes(npmStderr), false);
    assertEquals(publicMessage.includes("token=attacker-controlled"), false);
    assertEquals(publicMessage.includes("::error::injected"), false);

    const unsafePackageName = "@veryfront/ext-alpha\n::error::package-injected";
    const unsafePackageError = new NpmCompatibilityArtifactError(
      "pack",
      `npm pack failed for ${unsafePackageName}`,
      { packageName: unsafePackageName },
    );
    assertEquals(
      formatNpmCompatibilityArtifactCliError(unsafePackageError, "pack"),
      "npm compatibility artifact pack failed.",
    );
  });

  it("packs into a destination relative to the caller working directory", async () => {
    await withTempDirs([
      "vf-npm-artifact-source-",
      "vf-npm-artifact-workspace-",
    ], async ([root, workspace]) => {
      assertExists(root);
      assertExists(workspace);
      await writePackage(root, { name: "veryfront", version: "1.2.3" });

      const moduleUrl = new URL(
        "../../../scripts/ci/npm-compatibility-artifact.ts",
        import.meta.url,
      ).href;
      const code = `import { createNpmCompatibilityArtifact } from ${
        JSON.stringify(moduleUrl)
      }; await createNpmCompatibilityArtifact(Deno.args[0], "dist/npm-compatibility");`;
      const output = await new Deno.Command("deno", {
        args: [
          "eval",
          "--unstable-sloppy-imports",
          `--config=${fromFileUrl(new URL("../../../scripts/test.deno.json", import.meta.url))}`,
          // The outer test stays frozen. This child runs from a temporary cwd, where the
          // config's workspace-linked lock cannot resolve. --no-lock isolates the relative-
          // destination assertion without modifying the tracked lock.
          "--no-lock",
          code,
          root,
        ],
        cwd: workspace,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));

      const manifest = JSON.parse(
        await Deno.readTextFile(
          join(workspace, "dist/npm-compatibility/manifest.json"),
        ),
      ) as NpmCompatibilityManifest;
      assertEquals(manifest.packages.length, 1);
      const packageEntry = manifest.packages[0];
      assertExists(packageEntry);
      await Deno.stat(
        join(workspace, "dist/npm-compatibility", packageEntry.file),
      );
    });
  });

  it("records package versions and SHA-256 digests for one packed package set", async () => {
    await withTempDirs([
      "vf-npm-artifact-source-",
      "vf-npm-artifact-output-",
    ], async ([root, destination]) => {
      assertExists(root);
      assertExists(destination);
      await writePackage(root, {
        name: "veryfront",
        version: "1.2.3",
        dependencies: {
          "@veryfront/ext-alpha": "1.2.3",
          "@veryfront/ext-external": "^4.0.0",
        },
      });
      await writePackage(join(root, "extensions", "ext-alpha"), {
        name: "@veryfront/ext-alpha",
        version: "1.2.3",
      });
      await writePackage(join(root, "extensions", "ext-beta"), {
        name: "@veryfront/ext-beta",
        version: "1.2.3",
      });

      const manifest = await createNpmCompatibilityArtifact(root, destination);

      assertEquals(manifest.schemaVersion, 1);
      assertEquals(manifest.rootPackage, "veryfront");
      assertEquals(manifest.rootExtensionNames, ["@veryfront/ext-alpha"]);
      assertEquals(
        manifest.packages.map(({ name, version }) => ({ name, version })),
        [
          { name: "@veryfront/ext-alpha", version: "1.2.3" },
          { name: "@veryfront/ext-beta", version: "1.2.3" },
          { name: "veryfront", version: "1.2.3" },
        ],
      );
      for (const entry of manifest.packages) {
        assertEquals(
          /^[a-f0-9]{64}$/.test(entry.sha256),
          true,
          `${entry.name} must have a SHA-256 digest`,
        );
      }

      const loaded = await loadNpmCompatibilityArtifact(destination);
      assertStringIncludes(loaded.root, destination);
      assertEquals(loaded.rootExtensionNames, ["@veryfront/ext-alpha"]);
      assertEquals(
        loaded.extensions.map(({ name }) => name),
        ["@veryfront/ext-alpha", "@veryfront/ext-beta"],
      );
      assertEquals(/^[a-f0-9]{64}$/.test(loaded.manifestSha256), true);
    });
  });

  it("stamps the release commit into every canonical package tarball", async () => {
    await withTempDirs([
      "vf-npm-artifact-source-",
      "vf-npm-artifact-output-",
      "vf-npm-artifact-materialized-",
    ], async ([root, artifact, destination]) => {
      assertExists(root);
      assertExists(artifact);
      assertExists(destination);
      await writePackage(root, {
        name: "veryfront",
        version: "1.2.3",
        dependencies: { "@veryfront/ext-alpha": "1.2.3" },
      });
      await writePackage(join(root, "extensions", "ext-alpha"), {
        name: "@veryfront/ext-alpha",
        version: "1.2.3",
      });
      const gitHead = "0123456789abcdef0123456789abcdef01234567";

      await createNpmCompatibilityArtifact(root, artifact, { gitHead });
      await materializeNpmCompatibilityArtifact(artifact, destination);

      const rootManifest = JSON.parse(
        await Deno.readTextFile(join(destination, "package.json")),
      );
      const extensionManifest = JSON.parse(
        await Deno.readTextFile(
          join(destination, "extensions", "ext-alpha", "package.json"),
        ),
      );
      assertEquals(rootManifest.gitHead, gitHead);
      assertEquals(extensionManifest.gitHead, gitHead);
    });
  });

  it("rejects a package whose bytes do not match the canonical manifest", async () => {
    await withTempDirs([
      "vf-npm-artifact-source-",
      "vf-npm-artifact-output-",
    ], async ([root, destination]) => {
      assertExists(root);
      assertExists(destination);
      await writePackage(root, { name: "veryfront", version: "1.2.3" });
      const manifest = await createNpmCompatibilityArtifact(root, destination);
      const packageEntry = manifest.packages[0];
      assertExists(packageEntry);
      await Deno.writeTextFile(
        join(destination, packageEntry.file),
        "tampered",
      );

      await assertRejects(
        () => loadNpmCompatibilityArtifact(destination),
        Error,
        "SHA-256 mismatch",
      );
    });
  });

  it("rejects a first-party package version that differs from the root", async () => {
    await withTempDirs([
      "vf-npm-artifact-source-",
      "vf-npm-artifact-output-",
    ], async ([root, destination]) => {
      assertExists(root);
      assertExists(destination);
      await writePackage(root, {
        name: "veryfront",
        version: "1.2.3",
        dependencies: { "@veryfront/ext-alpha": "1.2.3" },
      });
      await writePackage(join(root, "extensions", "ext-alpha"), {
        name: "@veryfront/ext-alpha",
        version: "1.2.2",
      });

      await assertRejects(
        () => createNpmCompatibilityArtifact(root, destination),
        Error,
        "@veryfront/ext-alpha version 1.2.2 does not match root package version 1.2.3",
      );
    });
  });

  it("materializes the verified root and extensions for existing npm output checks", async () => {
    await withTempDirs([
      "vf-npm-artifact-source-",
      "vf-npm-artifact-output-",
      "vf-npm-artifact-materialized-",
    ], async ([root, artifact, destination]) => {
      assertExists(root);
      assertExists(artifact);
      assertExists(destination);
      await writePackage(root, {
        name: "veryfront",
        version: "1.2.3",
        dependencies: { "@veryfront/ext-alpha": "1.2.3" },
      });
      await writePackage(join(root, "extensions", "ext-alpha"), {
        name: "@veryfront/ext-alpha",
        version: "1.2.3",
      });
      await createNpmCompatibilityArtifact(root, artifact);

      await materializeNpmCompatibilityArtifact(artifact, destination);

      assertEquals(
        JSON.parse(await Deno.readTextFile(join(destination, "package.json")))
          .name,
        "veryfront",
      );
      assertEquals(
        JSON.parse(
          await Deno.readTextFile(
            join(destination, "extensions", "ext-alpha", "package.json"),
          ),
        ).name,
        "@veryfront/ext-alpha",
      );
    });
  });
});

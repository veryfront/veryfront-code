import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "#std/path/join";
import {
  createNpmCompatibilityArtifact,
  loadNpmCompatibilityArtifact,
  materializeNpmCompatibilityArtifact,
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
  it("records package versions and SHA-256 digests for one packed package set", async () => {
    await withTempDirs([
      "vf-npm-artifact-source-",
      "vf-npm-artifact-output-",
    ], async ([root, destination]) => {
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

  it("rejects a package whose bytes do not match the canonical manifest", async () => {
    await withTempDirs([
      "vf-npm-artifact-source-",
      "vf-npm-artifact-output-",
    ], async ([root, destination]) => {
      await writePackage(root, { name: "veryfront", version: "1.2.3" });
      const manifest = await createNpmCompatibilityArtifact(root, destination);
      await Deno.writeTextFile(
        join(destination, manifest.packages[0].file),
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

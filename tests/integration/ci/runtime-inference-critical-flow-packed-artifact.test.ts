import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDirWithOptions, remove } from "#veryfront/testing/deno-compat.ts";
import { isAbsolute, relative } from "#std/path";
import {
  loadPackedArtifactDirectory,
  runRuntimeInferenceCriticalFlow,
} from "../../../scripts/test/runtime-inference-critical-flow.ts";

async function sha256File(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function writePackageTarball(
  artifactDir: string,
  filename: string,
  manifest: { readonly name: string; readonly version: string },
  body: string,
): Promise<string> {
  const stagingDir = `${artifactDir}/staging-${crypto.randomUUID()}`;
  const packageDir = `${stagingDir}/package`;
  const tarball = `${artifactDir}/${filename}`;
  await Deno.mkdir(packageDir, { recursive: true });
  try {
    await Deno.writeTextFile(`${packageDir}/package.json`, JSON.stringify(manifest));
    await Deno.writeTextFile(`${packageDir}/index.js`, body);
    const output = await new Deno.Command("tar", {
      args: ["-czf", tarball, "package"],
      cwd: stagingDir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    return tarball;
  } finally {
    await remove(stagingDir, { recursive: true }).catch(() => {});
  }
}

async function writePackedArtifactFixture(
  artifactDir: string,
  rootBody: string,
  options: { readonly validTarball?: boolean } = {},
): Promise<string> {
  const rootFile = options.validTarball === false
    ? `${artifactDir}/veryfront-0.1.0.tgz`
    : await writePackageTarball(
      artifactDir,
      "veryfront-0.1.0.tgz",
      { name: "veryfront", version: "0.1.0" },
      rootBody,
    );
  if (options.validTarball === false) {
    await Deno.writeTextFile(rootFile, rootBody);
  }
  await Deno.writeTextFile(
    `${artifactDir}/manifest.json`,
    `${
      JSON.stringify(
        {
          schemaVersion: 1,
          rootPackage: "veryfront",
          rootExtensionNames: [],
          packages: [
            {
              name: "veryfront",
              version: "0.1.0",
              file: "veryfront-0.1.0.tgz",
              sha256: await sha256File(rootFile),
            },
          ],
        },
        null,
        2,
      )
    }\n`,
  );
  return rootFile;
}

describe("runtime inference critical-flow packed artifact integration", () => {
  it("redacts the requested packed directory when artifact loading fails", async () => {
    const privateDirectory = "../vf-private-packed-artifact";
    const error = await assertRejects(
      () =>
        runRuntimeInferenceCriticalFlow([
          "--runtime=node",
          "--skip-build",
          "--packed-dir",
          privateDirectory,
        ]),
      Error,
    );
    const message = `${(error as Error).message}\n${(error as Error).stack ?? ""}`;

    assert(
      !message.includes(privateDirectory),
      "Packed-artifact load failures must not expose the requested directory",
    );
  });

  it("loads packed artifact tarballs as absolute paths before scaffold cwd changes", async () => {
    const artifactDir = await makeTempDirWithOptions({
      dir: Deno.cwd(),
      prefix: ".runtime-packed-artifact-",
    });
    try {
      await writePackedArtifactFixture(
        artifactDir,
        "root package",
      );
      const extensionFile = await writePackageTarball(
        artifactDir,
        "ext-bundler-esbuild-0.1.0.tgz",
        { name: "@veryfront/ext-bundler-esbuild", version: "0.1.0" },
        "extension package",
      );
      const manifest = JSON.parse(
        await Deno.readTextFile(`${artifactDir}/manifest.json`),
      );
      manifest.rootExtensionNames = ["@veryfront/ext-bundler-esbuild"];
      manifest.packages.push({
        name: "@veryfront/ext-bundler-esbuild",
        version: "0.1.0",
        file: "ext-bundler-esbuild-0.1.0.tgz",
        sha256: await sha256File(extensionFile),
      });
      await Deno.writeTextFile(
        `${artifactDir}/manifest.json`,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );

      const loaded = await loadPackedArtifactDirectory(
        relative(Deno.cwd(), artifactDir),
      );

      assert(isAbsolute(loaded.root), "Root tarball path must be absolute");
      assert(
        loaded.extensions.every(({ tarball }) => isAbsolute(tarball)),
        "Extension tarball paths must be absolute",
      );
      assertEquals((await Deno.stat(loaded.root)).isFile, true);
      assertEquals((await Deno.stat(loaded.extensions[0]?.tarball ?? "")).isFile, true);
    } finally {
      await remove(artifactDir, { recursive: true }).catch(() => {});
    }
  });

  it("redacts paths when a checksum-valid packed artifact is not a tarball", async () => {
    const artifactDir = await makeTempDirWithOptions({
      dir: Deno.cwd(),
      prefix: ".runtime-invalid-packed-artifact-",
    });
    try {
      const tarball = await writePackedArtifactFixture(
        artifactDir,
        "this checksum matches, but this is not a gzipped tarball",
        { validTarball: false },
      );

      const error = await assertRejects(
        () =>
          runRuntimeInferenceCriticalFlow([
            "--runtime=node",
            "--skip-build",
            "--packed-dir",
            relative(Deno.cwd(), artifactDir),
          ]),
        Error,
      );
      const message = (error as Error).message;

      assertStringIncludes(
        message,
        "Failed to inspect canonical package metadata for veryfront",
        "The loader must reject a checksum-valid file that is not a package tarball",
      );
      assert(
        !message.includes(artifactDir),
        "Invalid packed-artifact failures must not include the artifact directory",
      );
      assert(
        !message.includes(tarball),
        "Invalid packed-artifact failures must not include the canonical tarball path",
      );
      assert(
        !message.includes(Deno.cwd()),
        "Invalid packed-artifact failures must not include the checkout path",
      );
      assert(
        !message.includes("file://"),
        "Invalid packed-artifact failures must not include file URLs",
      );
    } finally {
      await remove(artifactDir, { recursive: true }).catch(() => {});
    }
  });
});

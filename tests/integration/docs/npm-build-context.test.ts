import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import { assertEquals, assertRejects } from "#std/assert";
import path from "node:path";
import { buildNpm } from "../../../scripts/build/build-npm.ts";
import { NpmDocsBuildContext } from "../../../scripts/build/npm-docs-build-context.ts";
import { copyPublicDocs, PUBLIC_DOC_ROOTS } from "../../../scripts/build/copy-public-docs.ts";
import { docsSourceIdentity } from "../../../scripts/docs/package-public-docs.ts";
import { prepareRcBuildVersion } from "../../../scripts/ci/prepare-rc-build.ts";

const generated = "src/hydration.generated.ts";
const version = "0.1.0-rc.42";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await Deno.realPath(await makeTempDirWithOptions());
  try {
    for (const dir of PUBLIC_DOC_ROOTS) {
      await Deno.mkdir(path.join(root, "docs", dir), { recursive: true });
    }
    await Deno.mkdir(path.join(root, "src/utils"), { recursive: true });
    await Deno.mkdir(path.join(root, "scripts"));
    await Deno.writeTextFile(
      path.join(root, "deno.json"),
      JSON.stringify({ name: "@fixture/core", version: "0.1.0-rc" }, null, 2) + "\n",
    );
    await Deno.writeTextFile(
      path.join(root, "src/utils/version-constant.ts"),
      'export const VERSION = "0.1.0-rc";\n',
    );
    await Deno.writeTextFile(
      path.join(root, "scripts/deno.lock"),
      JSON.stringify(
        { version: "5", workspace: { links: { "jsr:@fixture/core@0.1.0-rc": "." } } },
        null,
        2,
      ) + "\n",
    );
    await Deno.writeTextFile(path.join(root, generated), 'export const version = "0.1.0-rc";\n');
    await Deno.writeTextFile(
      path.join(root, "src/application.ts"),
      "export const application = true;\n",
    );
    await Deno.writeTextFile(
      path.join(root, "docs/guides/start.md"),
      "---\ntitle: Start\n---\nRead the guide.\n",
    );
    await Deno.writeTextFile(path.join(root, ".gitignore"), "npm/\nlegacy-npm/\n.cache/\n");
    for (
      const args of [
        ["init", "-q"],
        ["remote", "add", "origin", "https://github.com/example/framework.git"],
        ["add", "."],
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-qm",
          "fixture",
        ],
      ]
    ) {
      const result = await new Deno.Command("git", {
        args: ["-C", root, ...args],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!result.success) throw new Error("Unable to create source fixture");
    }
    await prepareRcBuildVersion({ rootDir: root, version });
    await run(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("npm RC builds keep release docs when versioned generators dirty tracked outputs", async () => {
  await fixture(async (root) => {
    const context = new NpmDocsBuildContext(new Set([generated]));
    const phases: string[] = [];
    await buildNpm({
      root,
      release: true,
      context,
      run: async (args) => {
        phases.push(args[1]!);
        if (args[1] === "generate") {
          await Deno.writeTextFile(
            path.join(root, generated),
            `export const version = "${version}";\n`,
          );
        }
      },
      transform: async () => {
        // The former postBuild lookup silently downgraded this legitimate RC build.
        const lateIdentity = await docsSourceIdentity(root, version);
        assertEquals(lateIdentity.dirty, true);
        await copyPublicDocs(root, path.join(root, "legacy-npm"), version, lateIdentity);
        assertEquals(
          JSON.parse(await Deno.readTextFile(path.join(root, "legacy-npm/docs/manifest.json")))
            .mode,
          "local",
        );
        const identity = await context.identityForBuild(root, version, true);
        assertEquals(identity.dirty, false);
        await copyPublicDocs(root, path.join(root, "npm"), version, identity);
        const manifest = JSON.parse(
          await Deno.readTextFile(path.join(root, "npm/docs/manifest.json")),
        );
        assertEquals(manifest.mode, "release");
        assertEquals(manifest.sources[0].versionPreparation, "ci-rc");
      },
    });
    assertEquals(phases, ["-A", "generate", "lint:dnt-meta-properties"]);
  });
});

Deno.test("npm CI rejects unexpected dirty inputs before running generators", async () => {
  await fixture(async (root) => {
    await Deno.writeTextFile(path.join(root, "src/application.ts"), "unreviewed change");
    let ran = false;
    await assertRejects(
      () =>
        buildNpm({
          root,
          release: true,
          context: new NpmDocsBuildContext(new Set([generated])),
          run: () => {
            ran = true;
            return Promise.resolve();
          },
          transform: () => Promise.resolve(),
        }),
      Error,
      "clean pinned source before generation",
    );
    assertEquals(ran, false);
  });
});

Deno.test("npm build generation cannot mutate ordinary source or prepared version bytes", async () => {
  for (const file of ["src/application.ts", "src/utils/version-constant.ts"]) {
    await fixture(async (root) => {
      let transformed = false;
      await assertRejects(() =>
        buildNpm({
          root,
          release: true,
          context: new NpmDocsBuildContext(new Set([generated])),
          run: async () => {
            await Deno.writeTextFile(path.join(root, file), "unexpected change");
          },
          transform: () => {
            transformed = true;
            return Promise.resolve();
          },
        })
      );
      assertEquals(transformed, false);
    });
  }
});

Deno.test("npm build rejects generator output changes after sealing", async () => {
  await fixture(async (root) => {
    await assertRejects(
      () =>
        buildNpm({
          root,
          release: true,
          context: new NpmDocsBuildContext(new Set([generated])),
          run: () => Promise.resolve(),
          transform: async () => {
            await Deno.writeTextFile(path.join(root, generated), "changed after generation");
          },
        }),
      Error,
      "output changed after generation",
    );
  });
});

Deno.test("direct CI DNT requires captured provenance while local archives remain supported", async () => {
  const root = await makeTempDirWithOptions();
  try {
    const context = new NpmDocsBuildContext();
    await assertRejects(
      () => context.identityForBuild(root, version, true),
      Error,
      "capture source before generation",
    );
    assertEquals((await context.identityForBuild(root, version, false)).dirty, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

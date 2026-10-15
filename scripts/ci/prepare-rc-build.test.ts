import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { prepareRcBuildVersion } from "./prepare-rc-build.ts";

async function createVersionFixture(
  manifestVersion = "0.1.1230-rc",
  sourceVersion = manifestVersion,
): Promise<string> {
  const rootDir = await Deno.makeTempDir();
  await Deno.mkdir(`${rootDir}/src/utils`, { recursive: true });
  await Deno.mkdir(`${rootDir}/scripts`, { recursive: true });
  await Deno.writeTextFile(
    `${rootDir}/scripts/deno.lock`,
    JSON.stringify(
      {
        version: "5",
        specifiers: { "npm:fixture@1": "1.0.0" },
        npm: { "fixture@1.0.0": { integrity: "sha512-fixture" } },
        workspace: {
          links: {
            "jsr:@veryfront/react@0.1.0": {},
            [`jsr:veryfront@${manifestVersion}`]: {
              dependencies: ["npm:fixture@1"],
            },
          },
        },
      },
      null,
      2,
    ) + "\n",
  );
  await Deno.writeTextFile(
    `${rootDir}/deno.json`,
    JSON.stringify(
      {
        name: "veryfront",
        version: manifestVersion,
        tasks: { "build:npm": "fixture" },
      },
      null,
      2,
    ) + "\n",
  );
  await Deno.writeTextFile(
    `${rootDir}/src/utils/version-constant.ts`,
    `// Keep in sync with deno.json version.\nexport const VERSION = "${sourceVersion}";\n`,
  );
  return rootDir;
}

describe("RC build version preparation", () => {
  it("injects the published RC version into the manifest and source constant", async () => {
    const rootDir = await createVersionFixture();

    try {
      await prepareRcBuildVersion({
        rootDir,
        version: "0.1.1230-rc.456",
      });

      const manifest = JSON.parse(
        await Deno.readTextFile(`${rootDir}/deno.json`),
      );
      assertEquals(manifest.version, "0.1.1230-rc.456");
      assertEquals(manifest.tasks["build:npm"], "fixture");
      assertEquals(
        await Deno.readTextFile(`${rootDir}/src/utils/version-constant.ts`),
        '// Keep in sync with deno.json version.\nexport const VERSION = "0.1.1230-rc.456";\n',
      );
    } finally {
      await Deno.remove(rootDir, { recursive: true });
    }
  });

  it("keeps the workspace lock consistent with the injected package version", async () => {
    const rootDir = await createVersionFixture();
    try {
      const path = `${rootDir}/scripts/deno.lock`;
      const before = await Deno.readTextFile(path);
      await prepareRcBuildVersion({ rootDir, version: "0.1.1230-rc.456" });
      assertEquals(
        await Deno.readTextFile(path),
        before.replace(
          '"jsr:veryfront@0.1.1230-rc"',
          '"jsr:veryfront@0.1.1230-rc.456"',
        ),
        "only the workspace package identity changes; dependency pins stay intact",
      );
    } finally {
      await Deno.remove(rootDir, { recursive: true });
    }
  });

  for (
    const invalid of ["stale", "collision", "malformed", "missing"] as const
  ) {
    it(`rejects a ${invalid} workspace lock before changing source versions`, async () => {
      const rootDir = await createVersionFixture();
      try {
        const manifest = await Deno.readTextFile(`${rootDir}/deno.json`);
        const constant = await Deno.readTextFile(
          `${rootDir}/src/utils/version-constant.ts`,
        );
        const path = `${rootDir}/scripts/deno.lock`;
        if (invalid === "missing") await Deno.remove(path);
        else if (invalid === "malformed") {
          await Deno.writeTextFile(
            path,
            "{broken",
          );
        } else {
          const lock = JSON.parse(await Deno.readTextFile(path));
          if (invalid === "stale") {
            lock.workspace.links["jsr:veryfront@0.1.1229-rc"] =
              lock.workspace.links["jsr:veryfront@0.1.1230-rc"];
            delete lock.workspace.links["jsr:veryfront@0.1.1230-rc"];
          } else lock.workspace.links["jsr:veryfront@0.1.1230-rc.456"] = {};
          await Deno.writeTextFile(path, JSON.stringify(lock));
        }
        await assertRejects(() =>
          prepareRcBuildVersion({ rootDir, version: "0.1.1230-rc.456" })
        );
        assertEquals(await Deno.readTextFile(`${rootDir}/deno.json`), manifest);
        assertEquals(
          await Deno.readTextFile(`${rootDir}/src/utils/version-constant.ts`),
          constant,
        );
      } finally {
        await Deno.remove(rootDir, { recursive: true });
      }
    });
  }

  it("preserves legacy path-based workspace metadata", async () => {
    const rootDir = await createVersionFixture();
    try {
      const path = `${rootDir}/scripts/deno.lock`;
      const legacy =
        '{"version":"5","workspace":{"members":{"../":{"dependencies":[]}}}}\n';
      await Deno.writeTextFile(path, legacy);
      await prepareRcBuildVersion({ rootDir, version: "0.1.1230-rc.456" });
      assertEquals(await Deno.readTextFile(path), legacy);
    } finally {
      await Deno.remove(rootDir, { recursive: true });
    }
  });

  it("rejects a publish version that is not the manifest prerelease plus a run number", async () => {
    const rootDir = await createVersionFixture();

    try {
      await assertRejects(
        () =>
          prepareRcBuildVersion({
            rootDir,
            version: "0.1.1231-rc.456",
          }),
        Error,
        "must extend 0.1.1230-rc with a numeric run number",
      );
      assertEquals(
        JSON.parse(await Deno.readTextFile(`${rootDir}/deno.json`)).version,
        "0.1.1230-rc",
      );
    } finally {
      await Deno.remove(rootDir, { recursive: true });
    }
  });

  it("rejects source and manifest versions that are already out of sync", async () => {
    const rootDir = await createVersionFixture("0.1.1230-rc", "0.1.1229-rc");

    try {
      await assertRejects(
        () =>
          prepareRcBuildVersion({
            rootDir,
            version: "0.1.1230-rc.456",
          }),
        Error,
        "does not match deno.json version",
      );
    } finally {
      await Deno.remove(rootDir, { recursive: true });
    }
  });
});

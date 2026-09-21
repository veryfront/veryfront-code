import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { prepareRcBuildVersion } from "./prepare-rc-build.ts";

async function createVersionFixture(
  manifestVersion = "0.1.1230-rc",
  sourceVersion = manifestVersion,
): Promise<string> {
  const rootDir = await Deno.makeTempDir();
  await Deno.mkdir(`${rootDir}/src/utils`, { recursive: true });
  await Deno.writeTextFile(
    `${rootDir}/deno.json`,
    JSON.stringify({
      name: "veryfront",
      version: manifestVersion,
      tasks: { "build:npm": "fixture" },
    }, null, 2) + "\n",
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

      const manifest = JSON.parse(await Deno.readTextFile(`${rootDir}/deno.json`));
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

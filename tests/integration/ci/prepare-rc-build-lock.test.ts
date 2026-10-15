import {
  assertEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { prepareRcBuildVersion } from "../../../scripts/ci/prepare-rc-build.ts";
import { rewriteWorkspacePackageVersion } from "../../../scripts/lib/workspace-package-version.ts";
import { bumpDenoJsonVersion } from "../../../scripts/release-version.ts";

it("keeps a versioned workspace frozen after RC preparation under pinned Deno", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/scripts`);
    await Deno.mkdir(`${root}/member`);
    await Deno.mkdir(`${root}/src/utils`, { recursive: true });
    const manifest = {
      name: "veryfront",
      version: "0.1.1230-rc",
      exports: "./mod.ts",
      workspace: ["./member"],
    };
    await Deno.writeTextFile(`${root}/deno.json`, JSON.stringify(manifest));
    await Deno.writeTextFile(
      `${root}/member/deno.json`,
      JSON.stringify({
        name: "@veryfront/member",
        version: "0.1.0",
        exports: "./mod.ts",
      }),
    );
    await Deno.writeTextFile(`${root}/mod.ts`, "export const value = 1;\n");
    await Deno.writeTextFile(`${root}/member/mod.ts`, "export {};\n");
    await Deno.writeTextFile(
      `${root}/src/utils/version-constant.ts`,
      'export const VERSION = "0.1.1230-rc";\n',
    );
    await Deno.writeTextFile(
      `${root}/scripts/test.deno.json`,
      JSON.stringify({ lock: "./deno.lock", links: ["..", "../member"] }),
    );
    await Deno.writeTextFile(
      `${root}/scripts/check.ts`,
      'import {value} from "veryfront"; console.log(value);\n',
    );
    await Deno.writeTextFile(
      `${root}/scripts/deno.lock`,
      JSON.stringify(
        {
          version: "5",
          workspace: {
            links: {
              "jsr:veryfront@0.1.1230-rc": {},
              "jsr:@veryfront/member@0.1.0": {},
            },
          },
        },
        null,
        2,
      ) + "\n",
    );
    const check = async (frozen: boolean) => {
      return await new Deno.Command(Deno.execPath(), {
        cwd: root,
        args: [
          "run",
          "--config",
          "scripts/test.deno.json",
          "--lock=scripts/deno.lock",
          frozen ? "--frozen" : "--frozen=false",
          "scripts/check.ts",
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
    };
    const initial = await check(false);
    assertEquals(
      initial.success,
      true,
      new TextDecoder().decode(initial.stderr),
    );

    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify({ ...manifest, version: "0.1.1230-rc.456" }),
    );
    const stale = await check(true);
    assertEquals(
      stale.success,
      false,
      "an unsynchronized RC version must fail frozen resolution",
    );
    assertStringIncludes(
      new TextDecoder().decode(stale.stderr),
      "lockfile is out of date",
    );
    await Deno.writeTextFile(
      `${root}/deno.json`,
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await prepareRcBuildVersion({ rootDir: root, version: "0.1.1230-rc.456" });
    const fixed = await check(true);
    assertEquals(fixed.success, true, new TextDecoder().decode(fixed.stderr));
    // The stable release writer uses the same lock rewrite before committing.
    const manifestPath = `${root}/deno.json`;
    const lockPath = `${root}/scripts/deno.lock`;
    const stableLock = rewriteWorkspacePackageVersion(
      await Deno.readTextFile(lockPath),
      "jsr:veryfront@0.1.1230-rc.456",
      "jsr:veryfront@0.1.1230",
    );
    await Deno.writeTextFile(
      manifestPath,
      bumpDenoJsonVersion(
        await Deno.readTextFile(manifestPath),
        "0.1.1230",
      ),
    );
    await Deno.writeTextFile(lockPath, stableLock);
    const stable = await check(true);
    assertEquals(stable.success, true, new TextDecoder().decode(stable.stderr));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

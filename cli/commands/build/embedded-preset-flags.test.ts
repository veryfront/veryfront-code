import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { withCwd } from "#veryfront/testing/cwd.ts";
import { parseCliArgs } from "#cli/shared/args";
import { assertEmbeddedPresetFlags, handleBuildCommand } from "./handler.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function makeProject(prefix: string): Promise<string> {
  const projectDir = await Deno.makeTempDir({ prefix });
  await Deno.mkdir(join(projectDir, "app"), { recursive: true });
  await Deno.writeTextFile(join(projectDir, "app/page.mdx"), "# Home\n");
  return projectDir;
}

describe("commands/build/handler embedded preset flags", () => {
  it("does not write a bundle for a --dry-run embedded build", async () => {
    const projectDir = await makeProject("vf-embedded-dry-run-");
    try {
      await withCwd(projectDir, async () => {
        await assertRejects(
          () =>
            handleBuildCommand(
              parseCliArgs(["build", "--preset", "embedded", "--dry-run"]),
            ),
          Error,
          "--dry-run",
        );
      });

      assertEquals(
        await exists(join(projectDir, "dist/embedded/manifest.json")),
        false,
        "a dry run must not write dist/embedded/manifest.json",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("writes an embedded bundle to build.outDir from veryfront.config.js", async () => {
    const projectDir = await makeProject("vf-embedded-outdir-");
    try {
      await Deno.writeTextFile(
        join(projectDir, "veryfront.config.js"),
        'export default { build: { outDir: "custom-out" } };\n',
      );

      await withCwd(projectDir, async () => {
        await handleBuildCommand(parseCliArgs(["build", "--preset", "embedded"]));
      });

      assertEquals(
        await exists(join(projectDir, "custom-out/embedded/manifest.json")),
        true,
        "build.outDir must decide where the embedded preset writes",
      );
      assertEquals(
        await exists(join(projectDir, "dist")),
        false,
        "the embedded preset must not fall back to dist/ when build.outDir is set",
      );
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  describe("flag validation", () => {
    const rejected: Array<{ argv: string[]; flag: string }> = [
      { argv: ["build", "--preset", "embedded", "--dry-run"], flag: "--dry-run" },
      { argv: ["build", "--preset", "embedded", "--split"], flag: "--split" },
      { argv: ["build", "--preset", "embedded", "--no-split"], flag: "--no-split" },
      { argv: ["build", "--preset", "embedded", "--compress"], flag: "--compress" },
      { argv: ["build", "--preset", "embedded", "--no-compress"], flag: "--no-compress" },
      { argv: ["build", "--preset", "embedded", "--prefetch"], flag: "--prefetch" },
      { argv: ["build", "--preset", "embedded", "--prefetch=false"], flag: "--prefetch" },
      { argv: ["build", "--preset", "embedded", "--ssg"], flag: "--ssg" },
      { argv: ["build", "--preset", "embedded", "--no-ssg"], flag: "--no-ssg" },
      { argv: ["build", "--preset", "embedded", "--include", "/docs"], flag: "--include" },
      { argv: ["build", "--preset", "embedded", "--exclude", "/api"], flag: "--exclude" },
    ];

    for (const { argv, flag } of rejected) {
      it(`rejects ${argv.slice(3).join(" ")} and names ${flag}`, () => {
        const args = parseCliArgs(argv);
        let thrown: unknown;
        try {
          assertEmbeddedPresetFlags(args, "embedded");
        } catch (error) {
          thrown = error;
        }

        assertEquals(thrown instanceof Error, true, `${flag} must be rejected`);
        const message = (thrown as Error).message;
        assertEquals(
          message.startsWith("Invalid "),
          true,
          `usage errors must start with "Invalid " so the router exits 2: ${message}`,
        );
        assertEquals(
          message.includes(flag),
          true,
          `the error must name ${flag}: ${message}`,
        );
      });
    }

    const accepted: string[][] = [
      ["build", "--preset", "embedded"],
      ["build", "--preset", "embedded", "-o", "out"],
      ["build", "--preset", "embedded", "--output", "out"],
      ["build", "--preset", "embedded", "--json"],
      ["build", "--preset", "embedded", "--verbose"],
      ["build", "--preset", "embedded", "--quiet"],
    ];

    for (const argv of accepted) {
      it(`accepts ${argv.slice(1).join(" ")}`, () => {
        assertEmbeddedPresetFlags(parseCliArgs(argv), "embedded");
      });
    }

    it("leaves the default preset alone", () => {
      assertEmbeddedPresetFlags(
        parseCliArgs(["build", "--dry-run", "--no-split", "--include", "/docs"]),
        undefined,
      );
    });

    it("names every rejected flag the user typed", () => {
      let thrown: unknown;
      try {
        assertEmbeddedPresetFlags(
          parseCliArgs(["build", "--preset", "embedded", "--dry-run", "--no-ssg"]),
          "embedded",
        );
      } catch (error) {
        thrown = error;
      }
      const message = (thrown as Error).message;
      assertEquals(message.includes("--dry-run"), true, message);
      assertEquals(message.includes("--no-ssg"), true, message);
    });
  });
});

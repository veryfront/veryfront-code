import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { computeSourceHash } from "../e2e/setup/binary.ts";

async function runGit(cwd: string, args: string[]): Promise<void> {
  const result = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "null",
    stderr: "piped",
  }).output();

  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

describe("computeSourceHash", () => {
  it("changes deterministically for uncommitted binary source edits", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "vf-binary-source-hash-" });

    try {
      await Deno.mkdir(join(cwd, "src"));
      await Deno.mkdir(join(cwd, "cli"));
      await Deno.mkdir(join(cwd, "scripts", "build"), { recursive: true });
      await Deno.mkdir(join(cwd, "extensions"));
      await Deno.mkdir(join(cwd, "react"));
      await Deno.writeTextFile(join(cwd, "src", "entry.ts"), "export const value = 1;\n");
      await Deno.writeTextFile(join(cwd, "cli", "entry.ts"), "export const cli = true;\n");
      await Deno.writeTextFile(join(cwd, "scripts", "build", "build.ts"), "export {};\n");
      await Deno.writeTextFile(join(cwd, "extensions", "entry.ts"), "export {};\n");
      await Deno.writeTextFile(join(cwd, "react", "react.ts"), "export const version = 1;\n");
      await Deno.writeTextFile(join(cwd, "deno.json"), "{}\n");
      await Deno.writeTextFile(join(cwd, "deno.lock"), "{}\n");

      await runGit(cwd, ["init", "--quiet"]);
      await runGit(cwd, ["add", "."]);
      await runGit(cwd, [
        "-c",
        "user.name=Veryfront Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ]);

      const cleanHash = await computeSourceHash(cwd);
      await Deno.writeTextFile(
        join(cwd, "react", "react.ts"),
        "export const version = 2;\n",
      );
      assertNotEquals(await computeSourceHash(cwd), cleanHash);
      await Deno.writeTextFile(
        join(cwd, "react", "react.ts"),
        "export const version = 1;\n",
      );
      assertEquals(await computeSourceHash(cwd), cleanHash);

      await Deno.writeTextFile(join(cwd, "src", "entry.ts"), "export const value = 2;\n");

      const dirtyHash = await computeSourceHash(cwd);
      assertNotEquals(dirtyHash, cleanHash);
      assertEquals(await computeSourceHash(cwd), dirtyHash);

      await Deno.writeTextFile(join(cwd, "src", "untracked.ts"), "export {};\n");
      assertNotEquals(await computeSourceHash(cwd), dirtyHash);
    } finally {
      await Deno.remove(cwd, { recursive: true });
    }
  });
});

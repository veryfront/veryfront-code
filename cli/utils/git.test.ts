import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists, makeTempDir, remove } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";

describe("initializeGitRepo", () => {
  it("initializes the requested directory when ambient Git targets another repository", async () => {
    const projectDir = await makeTempDir({ prefix: "veryfront-git-isolation-" });
    const moduleUrl = new URL("./git.ts", import.meta.url).href;
    const ambientIndex = join(projectDir, "ambient-index");

    try {
      await Deno.writeTextFile(join(projectDir, "app.ts"), "export {};\n");
      const code = `
        import { initializeGitRepo } from ${JSON.stringify(moduleUrl)};
        console.log(await initializeGitRepo(${JSON.stringify(projectDir)}, "isolated"));
      `;
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["eval", "--no-check", code],
        env: {
          GIT_AUTHOR_NAME: "Veryfront Tests",
          GIT_AUTHOR_EMAIL: "tests@example.invalid",
          GIT_COMMITTER_NAME: "Veryfront Tests",
          GIT_COMMITTER_EMAIL: "tests@example.invalid",
          GIT_DIR: join(projectDir, "missing-git-dir"),
          GIT_INDEX_FILE: ambientIndex,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      const stderr = new TextDecoder().decode(output.stderr);

      assertEquals(output.success, true, stderr);
      assertEquals(new TextDecoder().decode(output.stdout).trim(), "true");
      assertEquals(await exists(join(projectDir, ".git")), true);
      assertEquals(await exists(join(projectDir, ".git", "index")), true);
      assertEquals(await exists(ambientIndex), false);
    } finally {
      await remove(projectDir, { recursive: true }).catch(() => {});
    }
  });
});

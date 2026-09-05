import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildTestProcessEnv } from "../../../scripts/test/suites.ts";

describe("Git fixture environment isolation", () => {
  it("keeps fixture Git commands in their own repositories under a hook environment", async () => {
    const root = await Deno.makeTempDir();
    const checkout = `${root}/checkout`;
    const fixture = `${root}/fixture`;
    const cleanEnv: Record<string, string> = {};
    for (const key of ["PATH", "HOME", "USERPROFILE"]) {
      const value = Deno.env.get(key);
      if (value !== undefined) cleanEnv[key] = value;
    }
    const runGit = (cwd: string, args: string[], env = cleanEnv) =>
      new Deno.Command("git", {
        cwd,
        args,
        env,
        clearEnv: true,
        stdout: "piped",
        stderr: "piped",
      }).output();

    try {
      for (const directory of [checkout, fixture]) {
        await Deno.mkdir(directory);
        const initialized = await runGit(directory, ["init", "--quiet"]);
        assertEquals(
          initialized.success,
          true,
          new TextDecoder().decode(initialized.stderr),
        );
      }

      const env = buildTestProcessEnv({
        ...cleanEnv,
        GIT_DIR: `${checkout}/.git`,
        GIT_WORK_TREE: checkout,
        GIT_COMMON_DIR: `${checkout}/.git`,
        GIT_INDEX_FILE: `${checkout}/.git/index`,
        GITHUB_SHA: "fixture-ci-revision",
      });
      const configured = await runGit(fixture, [
        "config",
        "--local",
        "test.fixtureIdentity",
        "fixture",
      ], env);
      assertEquals(
        configured.success,
        true,
        new TextDecoder().decode(configured.stderr),
      );

      const fixtureValue = await runGit(fixture, [
        "config",
        "--local",
        "--get",
        "test.fixtureIdentity",
      ]);
      assertEquals(
        new TextDecoder().decode(fixtureValue.stdout).trim(),
        "fixture",
      );
      const checkoutValue = await runGit(checkout, [
        "config",
        "--local",
        "--get",
        "test.fixtureIdentity",
      ]);
      assertEquals(checkoutValue.code, 1);
      assertEquals(env.GITHUB_SHA, "fixture-ci-revision");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

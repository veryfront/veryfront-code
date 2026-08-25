import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { join } from "../../../../src/platform/compat/path/index.ts";

it("distinguishes disabled loading from the default ./.env lookup", async () => {
  await withTempDir(async (cwd) => {
    await writeTextFile(join(cwd, ".env"), "VF_DOTENV_SENTINEL=leaked");

    const dotenvModule = JSON.stringify(
      import.meta.resolve("../../../../src/platform/compat/std/dotenv.ts"),
    );
    const script = `
      const { load } = await import(${dotenvModule});
      console.log(JSON.stringify([
        Object.hasOwn(await load({ envPath: null }), "VF_DOTENV_SENTINEL"),
        Object.hasOwn(await load({ envPath: "" }), "VF_DOTENV_SENTINEL"),
        Object.hasOwn(await load({}), "VF_DOTENV_SENTINEL"),
      ]));
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `--config=${new URL("../../../../deno.json", import.meta.url).pathname}`,
        script,
      ],
      cwd,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, stderr);
    assertEquals(
      JSON.parse(new TextDecoder().decode(output.stdout)),
      [false, false, true],
      "envPath null/empty disables loading; the default reads ./.env",
    );
  }, { prefix: "veryfront-dotenv-default-" });
});

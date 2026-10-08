import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { getEnvironmentConfig } from "veryfront/config";
import { studioCommand } from "../../../cli/commands/studio/command.ts";

describe("Studio remote project configuration", () => {
  it("reads the JSON API endpoint without executing unrelated project code", async () => {
    const originalDirectory = Deno.cwd();
    const directory = await makeTempDir();
    try {
      await Deno.writeTextFile(
        `${directory}/veryfront.config.ts`,
        'Deno.writeTextFileSync("studio-config-executed", "executed"); throw new Error("Studio must not execute this project config");',
      );
      await Deno.writeTextFile(
        `${directory}/veryfront.json`,
        JSON.stringify({ apiUrl: "https://api.veryfront.org" }),
      );
      Deno.chdir(directory);
      const env = {
        ...getEnvironmentConfig(),
        ci: true,
        apiUrl: undefined,
        apiBaseUrl: "https://api.veryfront.com",
      };
      assertEquals(await studioCommand({ project: "explicit-project" }, env), {
        url: "https://veryfront.org/projects/explicit-project",
        opened: false,
      });
      assertEquals(await studioCommand({}, { ...env, projectSlug: "environment-project" }), {
        url: "https://veryfront.org/projects/environment-project",
        opened: false,
      });
      await assertRejects(
        () => Deno.stat(`${directory}/studio-config-executed`),
        Deno.errors.NotFound,
      );
    } finally {
      Deno.chdir(originalDirectory);
      await Deno.remove(directory, { recursive: true });
    }
  });
});

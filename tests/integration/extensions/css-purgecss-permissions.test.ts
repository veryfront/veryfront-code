import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

const extensionDirectory = new URL(
  "../../../extensions/ext-css-purgecss/",
  import.meta.url,
);

const environments: Record<string, string>[] = [
  {},
  { CI: "true" },
  { TERM: "xterm-256color" },
  { TERM: "dumb", CI: "true" },
  { FORCE_COLOR: "1", CI: "true", TERM: "xterm-256color" },
  { FORCE_COLOR: "0", CI: "false", TERM: "dumb" },
  { NO_COLOR: "1", CI: "true", TERM: "xterm-256color" },
];

describe("PurgeCSS restricted standalone task", () => {
  for (const env of environments) {
    it(`loads and purges with environment ${JSON.stringify(env)}`, async () => {
      const output = await new Deno.Command(Deno.execPath(), {
        args: ["task", "test"],
        cwd: extensionDirectory,
        clearEnv: true,
        env: { PATH: Deno.env.get("PATH") ?? "", ...env },
        stdout: "piped",
        stderr: "piped",
      }).output();

      assertEquals(
        output.success,
        true,
        new TextDecoder().decode(output.stdout) +
          new TextDecoder().decode(output.stderr),
      );
    });
  }
});

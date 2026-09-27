import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("local application OTLP export", () => {
  for (const mode of ["enabled", "disabled"]) {
    it(`honors ${mode} tracing with a real HTTP collector`, async () => {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-check",
          "--allow-read",
          "--allow-env",
          "--allow-sys",
          "--allow-net=127.0.0.1",
          new URL("./local-otlp.fixture.ts", import.meta.url).pathname,
          mode,
        ],
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(30_000),
      }).output();
      assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    });
  }
});

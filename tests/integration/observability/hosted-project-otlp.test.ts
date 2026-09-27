import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("managed project trace export", () => {
  for (const mode of ["shared", "dedicated"]) {
    it(`exports isolated HTTP/custom traces through the ${mode} settings path`, async () => {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-check",
          "--unstable-worker-options",
          "--unstable-net",
          "--allow-read",
          "--allow-write",
          "--allow-run",
          "--allow-env",
          "--allow-sys",
          "--allow-ffi",
          "--allow-net=127.0.0.1",
          new URL("./hosted-project-otlp.fixture.ts", import.meta.url).pathname,
          mode,
        ],
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(60_000),
      }).output();
      assertEquals(
        output.code,
        0,
        new TextDecoder().decode(output.stderr) + new TextDecoder().decode(output.stdout),
      );
    });
  }
});

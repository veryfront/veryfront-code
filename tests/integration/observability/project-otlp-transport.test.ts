import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("project SDK export transport", () => {
  it("sends SDK-serialized OTLP through the production guarded transport", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--check",
        "--frozen",
        "--allow-read",
        "--allow-env",
        "--allow-sys",
        "--allow-net=127.0.0.1",
        new URL("./project-otlp-transport.fixture.ts", import.meta.url).pathname,
      ],
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(30_000),
    }).output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  });
});

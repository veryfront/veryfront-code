import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("logger serialization", () => {
  it("cannot throw through a hostile redacted JSON fallback", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--quiet",
        new URL("./serialization-hostile-fallback.fixture.ts", import.meta.url).pathname,
      ],
      cwd: Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.success, true, stderr);
    assertEquals(new TextDecoder().decode(output.stdout).trim(), "[REDACTED]");
  });

  it("does not expose credentials from a fallback component name", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--quiet",
        "--allow-env",
        new URL("./logger-hostile-fallback.fixture.ts", import.meta.url).pathname,
      ],
      cwd: Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.success, true, stderr);
    const line = new TextDecoder().decode(output.stdout).trim();
    assertEquals(line.includes("synthetic-component-secret"), false);
    assertEquals(JSON.parse(line).component, "token=[REDACTED]");
  });
});

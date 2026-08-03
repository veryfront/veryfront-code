import { assertEquals } from "#veryfront/testing/assert.ts";

Deno.test("redacted JSON serialization cannot throw through a hostile fallback", async () => {
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

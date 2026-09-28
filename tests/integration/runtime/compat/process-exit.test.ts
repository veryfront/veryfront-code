import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("compat process exit", () => {
  for (const code of [0, 7]) {
    it(`runs Node exit cleanup in Deno and preserves exit code ${code}`, async () => {
      const lifecycle = new URL(
        "../../../../src/platform/compat/process/lifecycle.ts",
        import.meta.url,
      ).href;
      const result = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--no-config",
          "--no-lock",
          "--deny-net",
          "--allow-read",
          "--allow-env",
          "data:application/javascript," + encodeURIComponent(`import process from "node:process";
           const { exit } = await import(${JSON.stringify(lifecycle)});
           process.once("exit", code => console.log("cleanup:" + code));
           exit(${code});`),
        ],
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(10_000),
      }).output();
      assertEquals(result.code, code, new TextDecoder().decode(result.stderr));
      assertEquals(new TextDecoder().decode(result.stdout).trim(), `cleanup:${code}`);
      assertEquals(new TextDecoder().decode(result.stderr), "");
    });
  }
});

import { assertEquals } from "#veryfront/testing/assert.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

// Exercise the public barrel with the same async_hooks replacement served to browsers.
// The child process keeps its module graph separate from the native test runner's ALS.
describe("browser HTTP async-context compatibility", () => {
  it("imports the public HTTP barrel with the browser async_hooks polyfill", async () => {
    const directory = await makeTempDir({ prefix: "vf-browser-http-context-" });
    try {
      const config = `${directory}/deno.json`;
      await Deno.writeTextFile(
        config,
        JSON.stringify({
          extends: new URL("../../../scripts/test.deno.json", import.meta.url).href,
          imports: {
            "veryfront/platform/http": new URL(
              "../../../src/platform/compat/http/index.ts",
              import.meta.url,
            ).href,
            "node:async_hooks": new URL(
              "../../../src/platform/polyfills/node-async-hooks.ts",
              import.meta.url,
            ).href,
          },
        }),
      );
      const result = await new Deno.Command(Deno.execPath(), {
        args: [
          "eval",
          "--config",
          config,
          'const http = await import("veryfront/platform/http"); if (typeof http.createHttpServer !== "function") throw new Error("missing public HTTP export");',
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  });
});

import { fileURLToPath } from "node:url";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("cache producer retirement", () => {
  it("drains detached failing reads without an unhandled rejection", async () => {
    const fixture = await Deno.makeTempFile({ suffix: ".ts" });
    const code = `
      import ${JSON.stringify(import.meta.resolve("../../../src/schemas/_test-setup.ts"))};
      import {getCachedWithBatching, getRequestCacheContext, runWithCacheBatching}
        from ${JSON.stringify(import.meta.resolve("../../../src/cache/request-cache-batcher.ts"))};
      for (const cancelled of [false, true]) {
        const failure = new Error("detached backend failure");
        const cancellation = new Error("request cancelled");
        const backend = {type: "memory" as const, get: () => Promise.reject(failure),
          set: () => Promise.resolve(), del: () => Promise.resolve()};
        let producer: Promise<string | null> | undefined;
        try {
          await runWithCacheBatching(() => {
            void getCachedWithBatching(backend, "admitted");
            producer = getRequestCacheContext()?.pending.get("admitted");
            return cancelled ? Promise.reject(cancellation) : Promise.resolve();
          });
        } catch (error) {
          if (!cancelled || error !== cancellation) throw error;
        }
        if (!producer) throw new Error("No admitted producer");
        await producer.then(() => {throw new Error("Expected backend failure");},
          error => {if (error !== failure) throw error;});
        // A turn after actual settlement lets the runtime report any unhandled rejection.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      console.log("detached reads drained");
    `;
    try {
      await Deno.writeTextFile(fixture, code);
      const result = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--frozen",
          "--cached-only",
          "--allow-read",
          "--allow-env",
          "--deny-net",
          "--config",
          fileURLToPath(new URL("../../../deno.json", import.meta.url)),
          fixture,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      assertEquals(
        new TextDecoder().decode(result.stdout).includes("detached reads drained"),
        true,
      );
    } finally {
      await Deno.remove(fixture);
    }
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { stub } from "#std/testing/mock";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { registerExtractedEsbuildCleanup } from "./esbuild-cleanup.ts";

describe("extracted compiler cleanup", () => {
  for (const failure of [undefined, new Deno.errors.NotFound(), new Error("remove denied")]) {
    it(`defers owned removal until unload and handles ${failure?.name ?? "successful removal"}`, () => {
      const callbacks: EventListener[] = [];
      const removed: string[] = [];
      const warnings: unknown[][] = [];
      const listen = stub(globalThis, "addEventListener", (name, callback, options) => {
        assertEquals(name, "unload");
        assertEquals(options, { once: true });
        callbacks.push(callback as EventListener);
      });
      const remove = stub(Deno, "removeSync", (path) => {
        removed.push(String(path));
        if (failure) throw failure;
      });
      const warn = stub(serverLogger, "warn", (...args: unknown[]) => {
        warnings.push(args);
      });
      try {
        registerExtractedEsbuildCleanup("/owned/compiler/esbuild", "/owned/compiler");
        assertEquals(removed, []);
        assertEquals(callbacks.length, 1);
        callbacks[0]!(new Event("unload"));
        assertEquals(removed, ["/owned/compiler/esbuild", "/owned/compiler"]);
        assertEquals(
          warnings.length,
          failure && !(failure instanceof Deno.errors.NotFound) ? 2 : 0,
        );
        if (warnings.length) {
          assertEquals(warnings[0], ["[esbuild] Failed to clean up extracted binary", {
            extractionDir: "/owned/compiler",
            path: "/owned/compiler/esbuild",
            cleanupError: failure,
          }]);
        }
      } finally {
        warn.restore();
        remove.restore();
        listen.restore();
      }
    });
  }
});

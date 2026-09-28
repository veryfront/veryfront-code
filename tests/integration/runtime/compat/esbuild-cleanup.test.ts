import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { registerExtractedEsbuildCleanup } from "#veryfront/platform/compat/esbuild-cleanup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("compiled Deno compiler cleanup", () => {
  for (const code of [undefined, 0, 7]) {
    it(`removes its private extraction after ${code === undefined ? "natural exit" : `exit(${code})`}`, async () => {
      const root = await makeTempDir();
      const target = `${root}/esbuild`;
      const cleanup = new URL(
        "../../../../src/platform/compat/esbuild-cleanup.ts",
        import.meta.url,
      );
      const lifecycle = new URL(
        "../../../../src/platform/compat/process/lifecycle.ts",
        import.meta.url,
      );
      const config = new URL("../../../../deno.json", import.meta.url);
      try {
        await Deno.writeTextFile(target, "owned extraction fixture");
        const source = `
          const { registerExtractedEsbuildCleanup } = await import(${JSON.stringify(cleanup.href)});
          const { exit } = await import(${JSON.stringify(lifecycle.href)});
          registerExtractedEsbuildCleanup(${JSON.stringify(target)}, ${JSON.stringify(root)});
          ${code === undefined ? "" : `exit(${code});`}
        `;
        const result = await new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--config",
            config.pathname,
            "--cached-only",
            "--frozen",
            "--deny-net",
            "--allow-read",
            "--allow-env",
            `--allow-write=${root}`,
            "data:application/javascript," + encodeURIComponent(source),
          ],
          stdout: "piped",
          stderr: "piped",
          signal: AbortSignal.timeout(10_000),
        }).output();
        assertEquals(result.code, code ?? 0, new TextDecoder().decode(result.stderr));
        await assertRejects(() => Deno.stat(target), Deno.errors.NotFound);
        await assertRejects(() => Deno.stat(root), Deno.errors.NotFound);
      } finally {
        await Deno.remove(root, { recursive: true }).catch((error: unknown) => {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        });
      }
    });
  }
});

describe("extracted compiler cleanup", () => {
  for (const failure of [undefined, new Deno.errors.NotFound(), new Error("remove denied")]) {
    it(`defers owned removal until unload and handles ${failure?.name ?? "successful removal"}`, () => {
      const callbacks: EventListener[] = [];
      const removed: string[] = [];
      const warnings: unknown[][] = [];
      const originalListen = globalThis.addEventListener;
      const originalRemove = Deno.removeSync;
      const originalWarn = serverLogger.warn;
      try {
        globalThis.addEventListener = (
          name: string,
          callback: unknown,
          options?: AddEventListenerOptions | boolean,
        ) => {
          assertEquals(name, "unload");
          assertEquals(options, { once: true });
          callbacks.push(callback as EventListener);
        };
        Deno.removeSync = (path) => {
          removed.push(String(path));
          if (failure) throw failure;
        };
        serverLogger.warn = (...args: unknown[]) => {
          warnings.push(args);
        };
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
        serverLogger.warn = originalWarn;
        Deno.removeSync = originalRemove;
        globalThis.addEventListener = originalListen;
      }
    });
  }
});

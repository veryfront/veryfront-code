import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
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

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RenderGeneration } from "#veryfront/rendering/render-generation.ts";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { execPath, runCommand } from "#veryfront/platform/compat/process.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { fromFileUrl, join, toFileUrl } from "#veryfront/compat/path";
import { prepareModuleESM } from "#veryfront/transforms/mdx/esm-module-loader/module-writer.ts";

describe("render generation process lifetime", () => {
  for (const completion of ["drain", "cancel"] as const) {
    it(`retains a prepared lazy graph until process exit after ${completion}`, async () => {
      const fs = createFileSystem();
      const adapter = await runtime.get();
      const artifacts = await fs.makeTempDir();
      const cache = await fs.makeTempDir();
      const ready = Promise.withResolvers<number>();
      const continueImport = Promise.withResolvers<void>();
      const stop = new AbortController();
      const coordinator = await adapter.serve(async (request) => {
        if (new URL(request.url).pathname === "/ready") {
          ready.resolve(Number(await request.text()));
        } else {
          await continueImport.promise;
        }
        return new Response(null, { status: 204 });
      }, { hostname: "127.0.0.1", port: 0 });
      let processExited = false;
      let artifactsReleased = false;
      let processResult: ReturnType<typeof runCommand> | undefined;
      let generation: RenderGeneration | undefined;
      try {
        const childPath = join(artifacts, "child.mjs");
        await fs.writeTextFile(childPath, 'export const load = () => import("./leaf.mjs");');
        await fs.writeTextFile(join(artifacts, "leaf.mjs"), 'export const value = "original";');
        const prepared = await prepareModuleESM(
          `export async function load() {
  const child = await import(${JSON.stringify(toFileUrl(childPath).href)});
  return (await child.load()).value;
}`,
          {
            adapter,
            projectDir: artifacts,
            projectId: "generation-test",
            contentSourceId: "release-test",
            esmCacheDir: artifacts,
            dependencyPinningCacheKey: "off",
          },
        );
        const fixture = fromFileUrl(new URL("./fixtures/generation-executor.mjs", import.meta.url));
        processResult = runCommand(execPath(), {
          args: [
            ...(isDeno ? ["run", "--no-config", "--allow-read", "--allow-net=127.0.0.1"] : []),
            fixture,
            prepared.importUrl,
            `http://127.0.0.1:${coordinator.addr.port}`,
          ],
          clearEnv: true,
          capture: true,
          signal: stop.signal,
          timeoutMs: 15_000,
          maxOutputBytes: 16_384,
          terminateProcessTreeOnExit: true,
        });
        const terminated = processResult.then((result) => {
          processExited = true;
          return result;
        });
        const port = await Promise.race([
          ready.promise,
          terminated.then(() => {
            throw new Error("Fixture exited before readiness");
          }),
        ]);
        generation = new RenderGeneration({
          maxConcurrentRenders: 2,
          drainTimeoutMs: completion === "drain" ? 10_000 : 0,
          executor: {
            render: () => fetch(`http://127.0.0.1:${port}/page`),
            stop: async () => {
              stop.abort();
              await terminated;
            },
          },
          releaseArtifacts: async () => {
            assertEquals(processExited, true, "termination must complete before artifact deletion");
            await fs.remove(artifacts, { recursive: true });
            artifactsReleased = true;
          },
        });
        const request = () => new Request("http://localhost/page");
        const [first, second] = await Promise.all([
          generation.render(request()),
          generation.render(request()),
        ]);
        await fs.remove(cache, { recursive: true });
        assertEquals(await fs.exists(childPath), true);
        const closing = generation.close();
        await assertRejects(() => generation!.render(request()), Error, "draining");
        if (completion === "drain") {
          continueImport.resolve();
          assertEquals(await first.text(), "<main>original</main>");
          assertEquals(artifactsReleased, false, "the second response still owns its admission");
          assertEquals(await second.text(), "<main>original</main>");
        } else {
          await Promise.all([first.body!.cancel(), second.body!.cancel()]);
        }
        await closing;
        assertEquals(processExited, true);
        assertEquals(await fs.exists(artifacts), false);
      } finally {
        continueImport.resolve();
        stop.abort();
        await Promise.allSettled([processResult, generation?.close()]);
        await coordinator.stop();
        if (await fs.exists(cache)) await fs.remove(cache, { recursive: true });
        if (await fs.exists(artifacts)) await fs.remove(artifacts, { recursive: true });
      }
    });
  }
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { RenderGeneration } from "#veryfront/rendering/render-generation.ts";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { execPath, runCommand } from "#veryfront/platform/compat/process.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { fromFileUrl, join, relative, toFileUrl } from "#veryfront/compat/path";
import {
  type RenderArtifactInput,
  RenderArtifacts,
} from "#veryfront/transforms/esm/render-artifacts.ts";
import { linkRenderModules } from "#veryfront/transforms/esm/link-render-modules.ts";
import {
  prepareModuleESM,
  prepareModuleGraphESM,
} from "#veryfront/transforms/mdx/esm-module-loader/module-writer.ts";
import { build, stop as stopBundler } from "veryfront/extensions/bundler";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { __setDistributedCacheAccessorForTests } from "#veryfront/transforms/esm/http-cache-wrapper.ts";

describe("render generation process lifetime", () => {
  afterAll(stopBundler);
  for (
    const [preparation, completion] of [
      ["bundled", "drain"],
      ["bundled", "cancel"],
      ["mdx", "drain"],
      ["mdx", "cancel"],
      ["captured-http", "drain"],
      ["captured-http", "cancel"],
    ] as const
  ) {
    it(`retains a ${preparation} lazy graph until process exit after ${completion}`, async () => {
      const fs = createFileSystem();
      const adapter = await runtime.get();
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
      let artifacts: RenderArtifacts | undefined;
      let peerArtifacts: RenderArtifacts | undefined;
      try {
        await fs.writeTextFile(
          join(cache, "child.mjs"),
          'export const load = () => import("./leaf.mjs");',
        );
        await fs.writeTextFile(join(cache, "leaf.mjs"), 'export const value = "original";');
        await fs.writeTextFile(
          join(cache, "entry.mjs"),
          `export async function load() {
  const child = await import("./child.mjs");
  return (await child.load()).value;
}`,
        );
        let graph: RenderArtifactInput;
        if (preparation === "captured-http") {
          __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
          try {
            graph = await runWithCacheDir(cache, () =>
              withMockFetch(async (input) => {
                const source = new URL(String(input)).pathname === "/child.mjs"
                  ? 'export const load = () => import("./leaf.mjs");'
                  : 'export const value = "original";';
                return new Response(source);
              }, () =>
                prepareModuleGraphESM(
                  `export async function load() {
  const child = await import("https://example.invalid/child.mjs");
  return (await child.load()).value;
}`,
                  {
                    adapter,
                    projectDir: cache,
                    projectId: "generation-test",
                    contentSourceId: "release-test",
                    dependencyPinningCacheKey: "off",
                  },
                  { maxEntries: 8, maxBytes: 4096 },
                )));
          } finally {
            __setDistributedCacheAccessorForTests(null);
          }
        } else if (preparation === "mdx") {
          const childUrl = toFileUrl(join(cache, "child.mjs")).href;
          const prepared = await prepareModuleESM(
            `export async function load() {
  const child = await import(${JSON.stringify(childUrl + "?v=first")});
  const repeated = await import(${JSON.stringify(childUrl + "?v=first")});
  const other = await import(${JSON.stringify(childUrl + "?v=second")});
  if (child !== repeated || child === other) throw new Error("Module identity changed");
  return (await child.load()).value;
}`,
            {
              adapter,
              projectDir: cache,
              projectId: "generation-test",
              contentSourceId: "release-test",
              esmCacheDir: cache,
              dependencyPinningCacheKey: "off",
            },
          );
          // Capture only test-owned files. Production capture must establish
          // authorization and consistency, not crawl arbitrary cache paths.
          const modules = [
            { url: toFileUrl(prepared.filePath).href, source: prepared.source },
            ...await Promise.all(
              [join(cache, "child.mjs"), join(cache, "leaf.mjs")].map(
                async (path) => ({
                  url: toFileUrl(path).href,
                  source: await fs.readTextFile(path),
                }),
              ),
            ),
          ];
          await fs.remove(prepared.filePath);
          graph = await linkRenderModules({
            modules,
            entrypoints: [toFileUrl(prepared.filePath).href],
          }, { maxEntries: 8, maxBytes: 4096 });
        } else {
          const output = join(cache, "output");
          const bundled = await build({
            entryPoints: { entry: join(cache, "entry.mjs") },
            outdir: output,
            bundle: true,
            splitting: true,
            format: "esm",
            platform: "neutral",
            outExtension: { ".js": ".mjs" },
            write: false,
          });
          graph = {
            files: bundled.outputFiles.map((file) => ({
              path: relative(output, file.path).replaceAll("\\", "/"),
              source: file.text,
            })),
            entrypoints: ["entry.mjs"],
          };
        }
        artifacts = new RenderArtifacts(graph, { maxEntries: 8, maxBytes: 4096 });
        peerArtifacts = new RenderArtifacts(graph, { maxEntries: 8, maxBytes: 4096 });
        const [prepared, peer] = await Promise.all([artifacts.prepare(), peerArtifacts.prepare()]);
        assertEquals(prepared.id, peer.id, "replicas agree on the immutable graph identity");
        assertEquals(
          prepared.directory === peer.directory,
          false,
          "publication roots are replica-local",
        );
        assertEquals(
          prepared.fileCount >= 3,
          true,
          "the fixture must contain separate lazy chunks",
        );
        await fs.writeTextFile(join(cache, "leaf.mjs"), 'export const value = "changed";');
        const fixture = fromFileUrl(new URL("./fixtures/generation-executor.mjs", import.meta.url));
        processResult = runCommand(execPath(), {
          args: [
            ...(isDeno ? ["run", "--no-config", "--allow-read", "--allow-net=127.0.0.1"] : []),
            fixture,
            prepared.entrypointUrls[0]!,
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
            await artifacts!.release();
            artifactsReleased = true;
          },
        });
        const request = () => new Request("http://localhost/page");
        const [first, second] = await Promise.all([
          generation.render(request()),
          generation.render(request()),
        ]);
        await fs.remove(cache, { recursive: true });
        // Another replica can discard its unexecuted copy without touching
        // this executor's live graph, even when both copies share a filesystem.
        await peerArtifacts.release();
        assertEquals(await fs.exists(peer.directory), false);
        assertEquals(await fs.exists(fromFileUrl(prepared.entrypointUrls[0]!)), true);
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
        assertEquals(await fs.exists(prepared.directory), false);
      } finally {
        continueImport.resolve();
        stop.abort();
        await Promise.allSettled([processResult, generation?.close()]);
        await artifacts?.release();
        await peerArtifacts?.release();
        await coordinator.stop();
        if (await fs.exists(cache)) await fs.remove(cache, { recursive: true });
      }
    });
  }
});

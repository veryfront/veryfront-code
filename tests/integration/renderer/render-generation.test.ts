import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { RenderGeneration } from "#veryfront/rendering/render-generation.ts";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { execPath, getEnv, runCommand } from "#veryfront/platform/compat/process.ts";
import { isBun, isDeno } from "#veryfront/platform/compat/runtime.ts";
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
import { createRequire } from "node:module";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { MdxContentProcessor } from "@veryfront/ext-content-mdx";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";

describe("render generation process lifetime", () => {
  let previousContentProcessor: unknown;
  beforeAll(() => {
    previousContentProcessor = tryResolve("ContentProcessor");
    register("ContentProcessor", new MdxContentProcessor());
  });
  afterAll(async () => {
    if (previousContentProcessor === undefined) unregister("ContentProcessor");
    else register("ContentProcessor", previousContentProcessor);
    await stopBundler();
  });
  for (
    const [preparation, completion] of [
      ["bundled", "drain"],
      ["bundled", "cancel"],
      ["mdx", "drain"],
      ["mdx", "cancel"],
      ["captured-http", "drain"],
      ["captured-http", "cancel"],
      ["project-ssr", "drain"],
      ["project-ssr", "cancel"],
      ["project-pipeline", "drain"],
    ] as const
  ) {
    it(`retains a ${preparation} lazy graph until process exit after ${completion}`, async () => {
      const fs = createFileSystem();
      const adapter = await runtime.get();
      const cache = await fs.makeTempDir();
      const pipeline = preparation === "project-pipeline";
      // Routing and client asset generation retain an immutable source view.
      // Executable modules belong exclusively to the published artifacts.
      const project = pipeline ? await fs.makeTempDir() : cache;
      const limits = preparation === "project-ssr" || pipeline
        ? { maxEntries: 64, maxBytes: 2 * 1024 * 1024 }
        : { maxEntries: 8, maxBytes: 4096 };
      const ready = Promise.withResolvers<number>();
      const admitted = Promise.withResolvers<void>();
      let admissions = 0;
      const continueImport = Promise.withResolvers<void>();
      const stop = new AbortController();
      const coordinator = await adapter.serve(async (request) => {
        if (new URL(request.url).pathname === "/ready") {
          ready.resolve(Number(await request.text()));
        } else if (new URL(request.url).pathname === "/admitted") {
          if (++admissions === 2) admitted.resolve();
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
        if (preparation === "project-ssr" || pipeline) {
          const require = createRequire(import.meta.url);
          const reactPath = require.resolve("react");
          const reactBundle = await build({
            stdin: {
              resolveDir: cache,
              contents: `import * as React from ${jsonForInlineScript(require.resolve("react"))};
export default React;
export { createContext, createElement, useContext, useEffect, lazy, Suspense, useId, version } from ${
                jsonForInlineScript(require.resolve("react"))
              };
export { jsx, jsxs, Fragment } from ${jsonForInlineScript(require.resolve("react/jsx-runtime"))};
export { renderToReadableStream, renderToString, renderToStaticMarkup } from ${
                jsonForInlineScript(require.resolve("react-dom/server.browser"))
              };`,
              loader: "js",
            },
            bundle: true,
            format: "esm",
            platform: "browser",
            write: false,
            minify: true,
            define: { "process.env.NODE_ENV": '"production"' },
            plugins: [{
              name: "fixture-react-singleton",
              setup(builder) {
                builder.onResolve({ filter: /^react$/ }, () => ({ path: reactPath }));
              },
            }],
          });
          await fs.writeTextFile(
            join(cache, "page.mdx"),
            `import Layout from "./layout.tsx"
import { lazy, Suspense } from "react"

export const Lazy = lazy(() => import("./child.tsx"))

<Layout><Suspense fallback={<span>loading</span>}><Lazy /></Suspense></Layout>`,
          );
          await fs.writeTextFile(
            join(cache, "layout.tsx"),
            `import { useId } from "react";
export default function Layout({ children }) { return <article id={useId()}>{children}</article>; }`,
          );
          await fs.writeTextFile(
            join(cache, "child.tsx"),
            'import { Head } from "veryfront/head"; export default function Child() { return <><Head><title>Captured head</title><script>{"globalThis.fixture = true;"}</script></Head><span>original</span></>; }',
          );
          if (pipeline) {
            await fs.mkdir(join(project, "app/page"), { recursive: true });
            await fs.mkdir(join(project, "dist/_veryfront"), { recursive: true });
            await fs.writeTextFile(
              join(project, "app/page/page.mdx"),
              `import { usePageContext } from "veryfront/context"
import { lazy, Suspense } from "react"

export const Lazy = lazy(() => import("./child.tsx"))
export const generateMetadata = ({query}) => ({title: "Metadata " + query.marker})
export function Context() { const context = usePageContext(); return <span>route:{context.slug}</span>; }

<Context />
<Suspense fallback={<span>pending</span>}><Lazy /></Suspense>`,
            );
            await fs.writeTextFile(
              join(project, "app/layout.tsx"),
              `import { useId } from "react";
export async function getServerData({query}) { return {props: {marker: query.get("marker")}}; }
export default function Layout({children, marker}) { return <article id={useId()}><div>data:{marker}</div>{children}</article>; }`,
            );
            await fs.writeTextFile(
              join(project, "app/page/child.tsx"),
              "export default function Child() { return <span>original</span>; }",
            );
            await fs.writeTextFile(
              join(project, "app/page/layout.mdx"),
              "export default function Frame({ children }) { return <aside data-mdx-layout>{children}</aside>; }",
            );
          }
          __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
          try {
            graph = await runWithCacheDir(cache, () =>
              withMockFetch(async (input) => {
                const source = new URL(String(input)).pathname === "/shared-react.mjs"
                  ? reactBundle.outputFiles[0]!.text
                  : 'export * from "https://example.invalid/shared-react.mjs"; export { default } from "https://example.invalid/shared-react.mjs";';
                return new Response(source);
              }, () =>
                prepareModuleGraphESM(
                  pipeline
                    ? `export { default as react } from "react";
export const packages = {
  "react": () => import("react"),
  "react-dom/server": () => import("react-dom/server"),
  "veryfront/context": () => import("veryfront/context"),
  "veryfront/router": () => import("veryfront/router"),
};
export const sources = {
  "app/page/page.mdx": () => import("/_vf_modules/app/page/page.mdx.js"),
  "app/layout.tsx": () => import("/_vf_modules/app/layout.tsx.js"),
  "app/page/layout.mdx": () => import("/_vf_modules/app/page/layout.mdx.js"),
};`
                    : `export * as server from "react-dom/server";
export { default as react } from "react";
import { jsx } from "react/jsx-runtime";
export async function createPage() {
  const { default: Page } = await import("/_vf_modules/page.mdx.js");
  return jsx(Page, {});
}`,
                  {
                    adapter,
                    projectDir: project,
                    projectId: "generation-test",
                    contentSourceId: "release-test",
                    dependencyPinningCacheKey: "off",
                  },
                  limits,
                )));
          } finally {
            __setDistributedCacheAccessorForTests(null);
          }
        } else if (preparation === "captured-http") {
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
        artifacts = new RenderArtifacts(graph, limits);
        peerArtifacts = new RenderArtifacts(graph, limits);
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
        const frameworkSSR = preparation === "project-ssr" || pipeline;
        const root = fromFileUrl(new URL("../../../", import.meta.url));
        const fixture = fromFileUrl(
          new URL(
            pipeline
              ? "./fixtures/generation-page-executor.ts"
              : frameworkSSR
              ? "./fixtures/generation-ssr-executor.ts"
              : "./fixtures/generation-executor.mjs",
            import.meta.url,
          ),
        );
        const runtimeArgs = frameworkSSR
          ? isDeno
            ? [
              "run",
              "--cached-only",
              `--config=${join(root, "deno.json")}`,
              "--allow-read",
              "--allow-env",
              "--allow-net=127.0.0.1",
              ...(pipeline ? ["--allow-write", "--allow-run", "--allow-sys"] : []),
            ]
            : isBun
            ? ["--preload", join(root, "tests/bun/preload.ts")]
            : ["--import", join(root, "tests/node/register-hooks.mjs")]
          : isDeno
          ? ["run", "--no-config", "--allow-read", "--allow-net=127.0.0.1"]
          : [];
        const denoDir = isDeno ? getEnv("DENO_DIR") : undefined;
        processResult = runCommand(execPath(), {
          args: [
            ...runtimeArgs,
            fixture,
            prepared.entrypointUrls[0]!,
            `http://127.0.0.1:${coordinator.addr.port}`,
            ...(pipeline ? [project] : []),
          ],
          clearEnv: true,
          env: {
            DENO_TESTING: "1",
            VF_DISABLE_LRU_INTERVAL: "1",
            NODE_ENV: "production",
            ...(pipeline ? { VERYFRONT_CACHE_DIR: cache } : {}),
            ...(denoDir === undefined ? {} : { DENO_DIR: denoDir }),
          },
          capture: true,
          signal: stop.signal,
          timeoutMs: frameworkSSR ? 30_000 : 15_000,
          maxOutputBytes: 16_384,
          terminateProcessTreeOnExit: true,
        });
        const terminated = processResult.then((result) => {
          processExited = true;
          return result;
        });
        const port = await Promise.race([
          ready.promise,
          terminated.then((result) => {
            throw new Error(`Fixture exited before readiness: ${result.stderr}`);
          }),
        ]);
        generation = new RenderGeneration({
          maxConcurrentRenders: 2,
          drainTimeoutMs: completion === "drain" ? 10_000 : 0,
          executor: {
            render: (request) =>
              fetch(`http://127.0.0.1:${port}/page`, { headers: request.headers }),
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
        const request = (nonce = "first-nonce") =>
          new Request("http://localhost/page", { headers: { "x-fixture-nonce": nonce } });
        const responses = Promise.all([
          generation.render(request()),
          generation.render(request("second-nonce")),
        ]);
        // Observe failures while waiting for the native executor to admit both requests.
        void responses.catch(() => {});
        if (pipeline) {
          await Promise.race([
            admitted.promise,
            terminated.then(() => {
              throw new Error("Page executor exited before admission");
            }),
          ]);
        } else {
          await responses;
        }
        await fs.remove(cache, { recursive: true });
        // Another replica can discard its unexecuted copy without touching
        // this executor's live graph, even when both copies share a filesystem.
        await peerArtifacts.release();
        assertEquals(await fs.exists(peer.directory), false);
        assertEquals(await fs.exists(fromFileUrl(prepared.entrypointUrls[0]!)), true);
        const closing = generation.close();
        await assertRejects(() => generation!.render(request()), Error, "draining");
        if (pipeline) continueImport.resolve();
        const [first, second] = await responses;
        if (pipeline) {
          for (const response of [first, second]) {
            assertEquals(response.status, 200, "the page handler owns the HTTP status");
            assertStringIncludes(
              response.headers.get("content-type")!,
              "text/html",
              "the page handler owns the HTTP headers",
            );
          }
        }
        if (completion === "drain") {
          continueImport.resolve();
          const verifyHtml = (html: string, nonce: string) => {
            if (pipeline) {
              assertStringIncludes(html, `Metadata ${nonce}`);
              assertStringIncludes(html, `data:<!-- -->${nonce}`);
              assertStringIncludes(html, "route:<!-- -->page");
              assertStringIncludes(html, "<article id=");
              assertStringIncludes(html, '<aside data-mdx-layout="true">');
              assertStringIncludes(html, "<span>original</span>");
              assertEquals(
                html.includes(nonce === "first-nonce" ? "second-nonce" : "first-nonce"),
                false,
              );
            } else if (preparation === "project-ssr") {
              assertStringIncludes(html, "<article id=");
              assertStringIncludes(html, "<span>original</span>");
              assertStringIncludes(html, `nonce="${nonce}"`);
              assertEquals(
                html.includes(
                  `nonce="${nonce === "first-nonce" ? "second-nonce" : "first-nonce"}"`,
                ),
                false,
                "concurrent renders must retain their own nonce",
              );
            } else assertEquals(html, "<main>original</main>");
          };
          verifyHtml(await first.text(), "first-nonce");
          assertEquals(artifactsReleased, false, "the second response still owns its admission");
          verifyHtml(await second.text(), "second-nonce");
        } else {
          await Promise.all([first.body!.cancel(), second.body!.cancel()]);
        }
        await closing;
        assertEquals(processExited, true);
        assertEquals(await fs.exists(prepared.directory), false);
      } catch (error) {
        stop.abort();
        const result = await processResult;
        if (result?.stderr) console.error(result.stderr);
        throw error;
      } finally {
        continueImport.resolve();
        stop.abort();
        await Promise.allSettled([processResult, generation?.close()]);
        await artifacts?.release();
        await peerArtifacts?.release();
        await coordinator.stop();
        if (await fs.exists(cache)) await fs.remove(cache, { recursive: true });
        if (pipeline && await fs.exists(project)) await fs.remove(project, { recursive: true });
      }
    });
  }
});

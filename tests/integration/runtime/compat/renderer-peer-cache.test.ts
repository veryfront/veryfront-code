import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBun, isNode } from "#veryfront/platform/compat/runtime.ts";
import { captureLocalReactPeers } from "#veryfront/platform/compat/react-paths.ts";
import { Renderer } from "#veryfront/rendering/renderer.ts";
import { createRenderContext } from "#veryfront/rendering/context/render-context.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { CachePayload, CacheStore } from "#veryfront/rendering/cache/types.ts";
import type { RenderOptions, RenderResult } from "#veryfront/rendering/orchestrator/types.ts";

describe("Renderer React peer cache", () => {
  for (const cacheKey of [undefined, "explicit-page"]) {
    it(`isolates cached HTML and concurrent renders by peers with override ${cacheKey}`, async () => {
      if (!isNode && !isBun) return;
      const data = new Map<string, CachePayload>();
      const store: CacheStore = {
        get: (key) => Promise.resolve(data.get(key)),
        set: (key, value) => {
          data.set(key, value);
          return Promise.resolve();
        },
        deleteByPrefix: (prefix) => {
          let deleted = 0;
          for (const key of data.keys()) {
            if (key.startsWith(prefix)) {
              data.delete(key);
              deleted++;
            }
          }
          return Promise.resolve(deleted);
        },
        delete: (key) => {
          data.delete(key);
          return Promise.resolve();
        },
        clear: () => {
          data.clear();
          return Promise.resolve();
        },
        destroy: () => Promise.resolve(),
      };
      const renderer = new Renderer({ cache: { store } });
      (renderer as unknown as { initialized: boolean }).initialized = true;
      let renders = 0;
      const state = renderer as unknown as {
        createServicesForContext: () => {
          pipeline: {
            renderPage: (slug: string, options?: RenderOptions) => Promise<RenderResult>;
          };
        };
      };
      state.createServicesForContext = () => ({
        pipeline: {
          renderPage: async (_slug, options) => {
            renders++;
            assertExists(options?.reactPeers);
            await new Promise((resolve) => setTimeout(resolve, 5));
            return {
              html: `<html>${options.reactPeers.paths.react}</html>`,
              frontmatter: {},
              stream: null,
            };
          },
        },
      });
      const ctx = createRenderContext({
        projectDir: "/peer-render",
        projectId: "peer-render",
        projectSlug: "peer-render",
        adapter: createMockAdapter(),
        config: {},
        isLocalProject: true,
        securityConfig: null,
      });
      const first = captureLocalReactPeers();
      const second = { ...first, paths: { ...first.paths, react: "file:///replacement/react.js" } };
      try {
        const [a, b] = await Promise.all([
          renderer.renderPage("/", ctx, {
            reactPeers: first,
            cacheKey,
            releaseAssetManifest: null,
          }),
          renderer.renderPage("/", ctx, {
            reactPeers: second,
            cacheKey,
            releaseAssetManifest: null,
          }),
        ]);
        assertEquals(a.html === b.html, false);
        const cached = await renderer.renderPage("/", ctx, {
          reactPeers: second,
          cacheKey,
          releaseAssetManifest: null,
        });
        assertEquals(cached.html, b.html);
        assertEquals(renders, 2);
        const fresh = await renderer.renderPage("/fresh", ctx, { releaseAssetManifest: null });
        assertEquals(
          fresh.html,
          a.html,
          "admission captures host peers before invoking the pipeline",
        );
      } finally {
        await renderer.destroy();
      }
    });
  }
});

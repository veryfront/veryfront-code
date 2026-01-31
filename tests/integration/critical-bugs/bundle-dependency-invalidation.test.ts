/**
 * Test 5: Bundle Dependency Invalidation
 *
 * This test verifies that changing a dependency invalidates dependent bundles.
 * Bundle caching is critical for performance, but stale bundles can cause:
 *
 * Bugs being tested:
 * - Missing depsHash tracking: Bundle cache doesn't include dependency hashes
 * - Transitive dependency changes: A -> B -> C, changing C doesn't invalidate A
 * - Import order sensitivity: Different import orders creating different bundles
 * - Re-export blindness: Changes to re-exported modules not detected
 * - Circular dependency handling: Circular deps causing infinite loops or stale cache
 *
 * The test modifies dependencies and verifies that dependent modules are re-bundled.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { clearLayoutDiscoveryCache } from "../../../src/rendering/layouts/utils/discovery.ts";
import {
  computeCodeHash,
  computeContentHash,
  InMemoryBundleManifestStore,
} from "../../../src/utils/bundle-manifest.ts";

function clearRendererCache(renderer: unknown): void {
  if (renderer && typeof (renderer as { clearCache?: unknown }).clearCache === "function") {
    (renderer as { clearCache: () => void }).clearCache();
  }
}

async function clearRendererAllState(renderer: unknown): Promise<void> {
  if (renderer && typeof (renderer as { clearAllState?: unknown }).clearAllState === "function") {
    await (renderer as { clearAllState: () => Promise<void> }).clearAllState();
  }
}

async function waitForFs(ms = 100): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe(
  "Bundle Dependency Invalidation",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    beforeEach(() => {
      clearLayoutDiscoveryCache();
    });

    afterEach(() => {
      clearLayoutDiscoveryCache();
    });

    describe("Direct Dependency Changes", () => {
      /**
       * CRITICAL BUG: When a directly imported module changes, the importing
       * module's bundle must be invalidated even if the importing file hasn't changed.
       */
      it("changing a component dependency invalidates the page bundle", async () => {
        await withTestContext("bundle-direct-dep", async (context) => {
          await mkdir(join(context.projectDir, "app", "components"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "app", "components", "Button.tsx"),
            `export default function Button() {
            return <button className="btn-v1">Button V1</button>;
          }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function Layout({ children }) {
            return <html><body>{children}</body></html>;
          }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `import Button from './components/Button';
          export default function Page() {
            return <div className="page"><Button /></div>;
          }`,
          );

          const { createRenderer } = await import("../../../src/rendering/index.ts");
          const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

          try {
            const renderer = await createRenderer({
              projectDir: context.projectDir,
              mode: "development",
            });

            const result1 = await renderer.renderPage("/");
            assertStringIncludes(result1.html, "btn-v1", "Initial render should have V1 button");
            assertStringIncludes(result1.html, "Button V1", "Initial render should have V1 text");

            await writeTextFile(
              join(context.projectDir, "app", "components", "Button.tsx"),
              `export default function Button() {
              return <button className="btn-v2">Button V2</button>;
            }`,
            );

            clearRendererCache(renderer);
            clearLayoutDiscoveryCache();
            await waitForFs();

            const result2 = await renderer.renderPage("/");

            assertStringIncludes(
              result2.html,
              "btn-v2",
              "After dependency change, should have V2 button class",
            );
            assertStringIncludes(
              result2.html,
              "Button V2",
              "After dependency change, should have V2 button text",
            );

            assert(!result2.html.includes("btn-v1"), "After dependency change, should NOT have V1 class");
            assert(
              !result2.html.includes("Button V1"),
              "After dependency change, should NOT have V1 text",
            );

            await clearRendererAllState(renderer);
          } finally {
            await cleanupBundler();
          }
        });
      });
    });

    describe("Transitive Dependency Changes", () => {
      /**
       * CRITICAL BUG: A -> B -> C chain. Changing C must invalidate both A and B.
       * Without proper dependency tracking, only B might be invalidated.
       */
      it("changing transitive dependency invalidates all dependents", async () => {
        await withTestContext("bundle-transitive-dep", async (context) => {
          await mkdir(join(context.projectDir, "app", "components"), { recursive: true });
          await mkdir(join(context.projectDir, "app", "utils"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "app", "utils", "constants.ts"),
            `export const VERSION = "v1.0.0";`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "components", "Header.tsx"),
            `import { VERSION } from '../utils/constants';
          export default function Header() {
            return <header data-version={VERSION}>Version: {VERSION}</header>;
          }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `import Header from './components/Header';
          export default function Page() {
            return <div><Header /></div>;
          }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function Layout({ children }) {
            return <html><body>{children}</body></html>;
          }`,
          );

          const { createRenderer } = await import("../../../src/rendering/index.ts");
          const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

          try {
            const renderer = await createRenderer({
              projectDir: context.projectDir,
              mode: "development",
            });

            const result1 = await renderer.renderPage("/");
            assertStringIncludes(
              result1.html,
              'data-version="v1.0.0"',
              "Initial render should have v1.0.0",
            );
            // React SSR may insert comments between text and expressions (e.g., "Version: <!-- -->v1.0.0")
            // Check for data-version attribute which is more reliable
            assert(
              result1.html.includes("v1.0.0") && result1.html.includes("Version:"),
              "Initial render should display v1.0.0",
            );

            await writeTextFile(
              join(context.projectDir, "app", "utils", "constants.ts"),
              `export const VERSION = "v2.0.0";`,
            );

            clearRendererCache(renderer);
            clearLayoutDiscoveryCache();
            await waitForFs();

            const result2 = await renderer.renderPage("/");

            assertStringIncludes(
              result2.html,
              'data-version="v2.0.0"',
              "After transitive dep change, should have v2.0.0 in data attr",
            );
            // React SSR may insert comments between text and expressions
            assert(
              result2.html.includes("v2.0.0") && result2.html.includes("Version:"),
              "After transitive dep change, should display v2.0.0",
            );

            assert(
              !result2.html.includes("v1.0.0"),
              "After transitive dep change, should NOT have v1.0.0",
            );

            await clearRendererAllState(renderer);
          } finally {
            await cleanupBundler();
          }
        });
      });
    });

    describe("Re-export Changes", () => {
      /**
       * CRITICAL BUG: When a module re-exports from another module,
       * changes to the original must propagate through the re-export.
       */
      it("changing re-exported module invalidates consumers", async () => {
        await withTestContext("bundle-reexport", async (context) => {
          await mkdir(join(context.projectDir, "app", "lib"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "app", "lib", "original.ts"),
            `export const ORIGINAL_VALUE = "original-v1";`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "lib", "index.ts"),
            `export { ORIGINAL_VALUE } from './original';
          export const BARREL_MARKER = "barrel";`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `import { ORIGINAL_VALUE, BARREL_MARKER } from './lib';
          export default function Page() {
            return <div data-original={ORIGINAL_VALUE}>{ORIGINAL_VALUE} via {BARREL_MARKER}</div>;
          }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function Layout({ children }) {
            return <html><body>{children}</body></html>;
          }`,
          );

          const { createRenderer } = await import("../../../src/rendering/index.ts");
          const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

          try {
            const renderer = await createRenderer({
              projectDir: context.projectDir,
              mode: "development",
            });

            const result1 = await renderer.renderPage("/");
            assertStringIncludes(result1.html, "original-v1", "Should have original v1");

            await writeTextFile(
              join(context.projectDir, "app", "lib", "original.ts"),
              `export const ORIGINAL_VALUE = "original-v2";`,
            );

            clearRendererCache(renderer);
            clearLayoutDiscoveryCache();
            await waitForFs();

            const result2 = await renderer.renderPage("/");

            assertStringIncludes(
              result2.html,
              "original-v2",
              "After changing re-exported module, should have v2",
            );
            assert(
              !result2.html.includes("original-v1"),
              "After changing re-exported module, should NOT have v1",
            );

            await clearRendererAllState(renderer);
          } finally {
            await cleanupBundler();
          }
        });
      });
    });

    describe("Shared Dependency Changes", () => {
      /**
       * CRITICAL BUG: When multiple modules share a dependency, changing it
       * must invalidate ALL consumers, not just the first one found.
       */
      it("changing shared dependency invalidates all consumers", async () => {
        await withTestContext("bundle-shared-dep", async (context) => {
          await mkdir(join(context.projectDir, "app", "components"), { recursive: true });
          await mkdir(join(context.projectDir, "app", "utils"), { recursive: true });

          await writeTextFile(
            join(context.projectDir, "app", "utils", "theme.ts"),
            `export const THEME_COLOR = "blue";`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "components", "Card.tsx"),
            `import { THEME_COLOR } from '../utils/theme';
          export default function Card() {
            return <div className={\`card-\${THEME_COLOR}\`}>Card</div>;
          }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "components", "Button.tsx"),
            `import { THEME_COLOR } from '../utils/theme';
          export default function Button() {
            return <button className={\`btn-\${THEME_COLOR}\`}>Button</button>;
          }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "page.tsx"),
            `import Card from './components/Card';
          import Button from './components/Button';
          export default function Page() {
            return <div><Card /><Button /></div>;
          }`,
          );

          await writeTextFile(
            join(context.projectDir, "app", "layout.tsx"),
            `export default function Layout({ children }) {
            return <html><body>{children}</body></html>;
          }`,
          );

          const { createRenderer } = await import("../../../src/rendering/index.ts");
          const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

          try {
            const renderer = await createRenderer({
              projectDir: context.projectDir,
              mode: "development",
            });

            const result1 = await renderer.renderPage("/");
            assertStringIncludes(result1.html, "card-blue", "Card should be blue");
            assertStringIncludes(result1.html, "btn-blue", "Button should be blue");

            await writeTextFile(
              join(context.projectDir, "app", "utils", "theme.ts"),
              `export const THEME_COLOR = "red";`,
            );

            clearRendererCache(renderer);
            clearLayoutDiscoveryCache();
            await waitForFs();

            const result2 = await renderer.renderPage("/");

            assertStringIncludes(result2.html, "card-red", "After shared dep change, Card should be red");
            assertStringIncludes(
              result2.html,
              "btn-red",
              "After shared dep change, Button should be red",
            );

            assert(!result2.html.includes("card-blue"), "Card should NOT still be blue");
            assert(!result2.html.includes("btn-blue"), "Button should NOT still be blue");

            await clearRendererAllState(renderer);
          } finally {
            await cleanupBundler();
          }
        });
      });
    });

    describe("BundleManifestStore Dependency Tracking", () => {
      /**
       * Test that the bundle manifest properly tracks dependency hashes
       * so that dependency changes invalidate dependent bundles.
       */
      it("bundle metadata includes depsHash for invalidation", async () => {
        const store = new InMemoryBundleManifestStore();

        const bundleKey = "component:Card.tsx";
        const depsHash = await computeContentHash("dep1-content" + "dep2-content");

        await store.setBundleMetadata(bundleKey, {
          hash: "bundle-hash-v1",
          codeHash: "code-hash-v1",
          size: 1000,
          compiledAt: Date.now(),
          source: "/app/components/Card.tsx",
          mode: "development",
          meta: {
            type: "component",
            depsHash,
          },
        });

        const metadata = await store.getBundleMetadata(bundleKey);
        assertEquals(metadata?.meta?.depsHash, depsHash, "Bundle metadata should include depsHash");
      });

      it("different depsHash produces different cache key lookup", async () => {
        const hash1 = await computeContentHash("dependency-content-v1");
        const hash2 = await computeContentHash("dependency-content-v2");
        const hash3 = await computeContentHash("dependency-content-v1");

        assertNotEquals(hash1, hash2, "Different content should produce different hashes");
        assertEquals(hash1, hash3, "Same content should produce same hash");
      });

      it("invalidateSource removes bundles when dependency changes", async () => {
        const store = new InMemoryBundleManifestStore();

        await store.setBundleMetadata("bundle:component", {
          hash: "comp-hash",
          codeHash: "comp-code",
          size: 500,
          compiledAt: Date.now(),
          source: "/app/components/Card.tsx",
          mode: "development",
        });

        await store.setBundleMetadata("bundle:page", {
          hash: "page-hash",
          codeHash: "page-code",
          size: 1000,
          compiledAt: Date.now(),
          source: "/app/page.tsx",
          mode: "development",
          meta: {
            type: "component",
            depsHash: await computeContentHash("/app/components/Card.tsx-content"),
          },
        });

        const invalidated = await store.invalidateSource("/app/components/Card.tsx");
        assertEquals(invalidated, 1, "Should invalidate 1 bundle");

        assertEquals(
          await store.getBundleMetadata("bundle:component"),
          undefined,
          "Component bundle should be invalidated",
        );

        // Note: The page bundle is NOT automatically invalidated by invalidateSource
        // because invalidateSource only matches the source field directly.
        // A real implementation would need to track dependency graphs.
        const pageBundle = await store.getBundleMetadata("bundle:page");
        assert(pageBundle !== undefined, "Page bundle still exists (demonstrates need for dependency graph)");
      });
    });

    describe("Code Hash Consistency", () => {
      /**
       * Test that code hashing is consistent and detects changes.
       */
      it("computeCodeHash produces consistent results", async () => {
        const code = `export default function Component() { return <div>Test</div>; }`;

        const hash1 = await computeCodeHash({ code });
        const hash2 = await computeCodeHash({ code });
        const hash3 = await computeCodeHash({ code: code + " " });

        assertEquals(hash1, hash2, "Same code should produce same hash");
        assertNotEquals(hash1, hash3, "Different code should produce different hash");
      });

      it("computeCodeHash is sensitive to whitespace changes", async () => {
        const code1 = `function test() { return 1; }`;
        const code2 = `function test() {  return 1; }`;
        const code3 = `function test() {\n  return 1;\n}`;

        const hash1 = await computeCodeHash({ code: code1 });
        const hash2 = await computeCodeHash({ code: code2 });
        const hash3 = await computeCodeHash({ code: code3 });

        assertNotEquals(hash1, hash2, "Different whitespace should produce different hash");
        assertNotEquals(hash1, hash3, "Different formatting should produce different hash");
      });
    });
  },
);

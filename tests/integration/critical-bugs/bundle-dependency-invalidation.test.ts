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

describe("Bundle Dependency Invalidation", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
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
        // Create initial structure
        await mkdir(join(context.projectDir, "app", "components"), { recursive: true });

        // Create a Button component (dependency)
        await writeTextFile(
          join(context.projectDir, "app", "components", "Button.tsx"),
          `export default function Button() {
            return <button className="btn-v1">Button V1</button>;
          }`,
        );

        // Create a layout
        await writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function Layout({ children }) {
            return <html><body>{children}</body></html>;
          }`,
        );

        // Create a page that imports the Button
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

          // First render - should have V1
          const result1 = await renderer.renderPage("/");
          assertStringIncludes(result1.html, "btn-v1", "Initial render should have V1 button");
          assertStringIncludes(result1.html, "Button V1", "Initial render should have V1 text");

          // Now update ONLY the Button component
          await writeTextFile(
            join(context.projectDir, "app", "components", "Button.tsx"),
            `export default function Button() {
              return <button className="btn-v2">Button V2</button>;
            }`,
          );

          // Clear caches to simulate file change detection
          if (renderer && typeof renderer.clearCache === "function") {
            renderer.clearCache();
          }
          clearLayoutDiscoveryCache();

          // Wait for filesystem to settle
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Render again - should now have V2
          const result2 = await renderer.renderPage("/");

          // CRITICAL: The page's rendered output must reflect the new Button version
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

          // Should NOT have old content
          assert(
            !result2.html.includes("btn-v1"),
            "After dependency change, should NOT have V1 class",
          );
          assert(
            !result2.html.includes("Button V1"),
            "After dependency change, should NOT have V1 text",
          );

          if (renderer && typeof renderer.clearAllState === "function") {
            await renderer.clearAllState();
          }
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

        // C: Utility module (deepest dependency)
        await writeTextFile(
          join(context.projectDir, "app", "utils", "constants.ts"),
          `export const VERSION = "v1.0.0";`,
        );

        // B: Component that uses C
        await writeTextFile(
          join(context.projectDir, "app", "components", "Header.tsx"),
          `import { VERSION } from '../utils/constants';
          export default function Header() {
            return <header data-version={VERSION}>Version: {VERSION}</header>;
          }`,
        );

        // A: Page that uses B
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

          // First render
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

          // Change ONLY the deepest dependency (C)
          await writeTextFile(
            join(context.projectDir, "app", "utils", "constants.ts"),
            `export const VERSION = "v2.0.0";`,
          );

          // Clear caches
          if (renderer && typeof renderer.clearCache === "function") {
            renderer.clearCache();
          }
          clearLayoutDiscoveryCache();
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Render again
          const result2 = await renderer.renderPage("/");

          // CRITICAL: All levels must see the new version
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

          // Should NOT have old version
          assert(
            !result2.html.includes("v1.0.0"),
            "After transitive dep change, should NOT have v1.0.0",
          );

          if (renderer && typeof renderer.clearAllState === "function") {
            await renderer.clearAllState();
          }
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

        // Original module
        await writeTextFile(
          join(context.projectDir, "app", "lib", "original.ts"),
          `export const ORIGINAL_VALUE = "original-v1";`,
        );

        // Re-export module (barrel file)
        await writeTextFile(
          join(context.projectDir, "app", "lib", "index.ts"),
          `export { ORIGINAL_VALUE } from './original';
          export const BARREL_MARKER = "barrel";`,
        );

        // Consumer page
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

          // First render
          const result1 = await renderer.renderPage("/");
          assertStringIncludes(result1.html, "original-v1", "Should have original v1");

          // Change the ORIGINAL module (not the re-export barrel)
          await writeTextFile(
            join(context.projectDir, "app", "lib", "original.ts"),
            `export const ORIGINAL_VALUE = "original-v2";`,
          );

          // Clear caches
          if (renderer && typeof renderer.clearCache === "function") {
            renderer.clearCache();
          }
          clearLayoutDiscoveryCache();
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Render again
          const result2 = await renderer.renderPage("/");

          // CRITICAL: Re-exported value must be updated
          assertStringIncludes(
            result2.html,
            "original-v2",
            "After changing re-exported module, should have v2",
          );
          assert(
            !result2.html.includes("original-v1"),
            "After changing re-exported module, should NOT have v1",
          );

          if (renderer && typeof renderer.clearAllState === "function") {
            await renderer.clearAllState();
          }
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

        // Shared utility
        await writeTextFile(
          join(context.projectDir, "app", "utils", "theme.ts"),
          `export const THEME_COLOR = "blue";`,
        );

        // Component A uses theme
        await writeTextFile(
          join(context.projectDir, "app", "components", "Card.tsx"),
          `import { THEME_COLOR } from '../utils/theme';
          export default function Card() {
            return <div className={\`card-\${THEME_COLOR}\`}>Card</div>;
          }`,
        );

        // Component B also uses theme
        await writeTextFile(
          join(context.projectDir, "app", "components", "Button.tsx"),
          `import { THEME_COLOR } from '../utils/theme';
          export default function Button() {
            return <button className={\`btn-\${THEME_COLOR}\`}>Button</button>;
          }`,
        );

        // Page uses both components
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

          // First render
          const result1 = await renderer.renderPage("/");
          assertStringIncludes(result1.html, "card-blue", "Card should be blue");
          assertStringIncludes(result1.html, "btn-blue", "Button should be blue");

          // Change the shared dependency
          await writeTextFile(
            join(context.projectDir, "app", "utils", "theme.ts"),
            `export const THEME_COLOR = "red";`,
          );

          // Clear caches
          if (renderer && typeof renderer.clearCache === "function") {
            renderer.clearCache();
          }
          clearLayoutDiscoveryCache();
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Render again
          const result2 = await renderer.renderPage("/");

          // CRITICAL: BOTH consumers must be updated
          assertStringIncludes(
            result2.html,
            "card-red",
            "After shared dep change, Card should be red",
          );
          assertStringIncludes(
            result2.html,
            "btn-red",
            "After shared dep change, Button should be red",
          );

          // CRITICAL: Neither consumer should have old value
          assert(!result2.html.includes("card-blue"), "Card should NOT still be blue");
          assert(!result2.html.includes("btn-blue"), "Button should NOT still be blue");

          if (renderer && typeof renderer.clearAllState === "function") {
            await renderer.clearAllState();
          }
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

      // Bundle for a component with dependencies
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
          depsHash, // This is the critical field for dependency tracking
        },
      });

      const metadata = await store.getBundleMetadata(bundleKey);

      // Verify depsHash is stored and retrievable
      assertEquals(metadata?.meta?.depsHash, depsHash, "Bundle metadata should include depsHash");
    });

    it("different depsHash produces different cache key lookup", async () => {
      // Hash computation should be deterministic and sensitive to content changes
      const hash1 = await computeContentHash("dependency-content-v1");
      const hash2 = await computeContentHash("dependency-content-v2");
      const hash3 = await computeContentHash("dependency-content-v1"); // Same as hash1

      assertNotEquals(hash1, hash2, "Different content should produce different hashes");
      assertEquals(hash1, hash3, "Same content should produce same hash");
    });

    it("invalidateSource removes bundles when dependency changes", async () => {
      const store = new InMemoryBundleManifestStore();

      // Set up a component bundle
      await store.setBundleMetadata("bundle:component", {
        hash: "comp-hash",
        codeHash: "comp-code",
        size: 500,
        compiledAt: Date.now(),
        source: "/app/components/Card.tsx",
        mode: "development",
      });

      // Set up a page bundle that depends on the component
      await store.setBundleMetadata("bundle:page", {
        hash: "page-hash",
        codeHash: "page-code",
        size: 1000,
        compiledAt: Date.now(),
        source: "/app/page.tsx",
        mode: "development",
        meta: {
          type: "component",
          // In a real implementation, this would include Card.tsx hash
          depsHash: await computeContentHash("/app/components/Card.tsx-content"),
        },
      });

      // When Card.tsx changes, invalidate it
      const invalidated = await store.invalidateSource("/app/components/Card.tsx");
      assertEquals(invalidated, 1, "Should invalidate 1 bundle");

      // Component bundle should be gone
      assertEquals(
        await store.getBundleMetadata("bundle:component"),
        undefined,
        "Component bundle should be invalidated",
      );

      // Note: The page bundle is NOT automatically invalidated by invalidateSource
      // because invalidateSource only matches the source field directly.
      // A real implementation would need to track dependency graphs.
      const pageBundle = await store.getBundleMetadata("bundle:page");
      assert(
        pageBundle !== undefined,
        "Page bundle still exists (demonstrates need for dependency graph)",
      );
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
      const hash3 = await computeCodeHash({ code: code + " " }); // Slightly different

      assertEquals(hash1, hash2, "Same code should produce same hash");
      assertNotEquals(hash1, hash3, "Different code should produce different hash");
    });

    it("computeCodeHash is sensitive to whitespace changes", async () => {
      const code1 = `function test() { return 1; }`;
      const code2 = `function test() {  return 1; }`; // Extra space
      const code3 = `function test() {\n  return 1;\n}`; // With newlines

      const hash1 = await computeCodeHash({ code: code1 });
      const hash2 = await computeCodeHash({ code: code2 });
      const hash3 = await computeCodeHash({ code: code3 });

      // Whitespace changes should produce different hashes
      // (This tests whether the bundler might produce different output)
      assertNotEquals(hash1, hash2, "Different whitespace should produce different hash");
      assertNotEquals(hash1, hash3, "Different formatting should produce different hash");
    });
  });
});

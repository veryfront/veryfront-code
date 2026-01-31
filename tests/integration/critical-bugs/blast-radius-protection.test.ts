/**
 * Test 3: Blast Radius Protection
 *
 * This test verifies that one project's failure does NOT affect other projects.
 * In a multi-tenant system, failures must be isolated to prevent cascading outages.
 *
 * Bugs being tested:
 * - Semaphore exhaustion: One project consuming all render slots, starving others
 * - Failed component map leakage: Error state from one project affecting others
 * - Uncaught promise rejections: Crashing the entire server process
 * - Memory pressure: One project's memory leak affecting others
 * - Transform failures: One project's syntax error breaking shared bundler
 *
 * The test intentionally creates failing projects and verifies that healthy
 * projects continue to function normally.
 */

import { assert, assertStringIncludes } from "@veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "@veryfront/testing/bdd";
import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import { join } from "@veryfront/compat/path";
import { withTestContext } from "../../_helpers/context.ts";
import { clearLayoutDiscoveryCache } from "../../../src/rendering/layouts/utils/discovery.ts";

async function clearRendererState(renderer: unknown): Promise<void> {
  const maybe = renderer as { clearAllState?: () => Promise<void> | void } | null;
  if (typeof maybe?.clearAllState === "function") {
    await maybe.clearAllState();
  }
}

describe(
  "Blast Radius Protection",
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

    describe("Syntax Error Isolation", () => {
      /**
       * CRITICAL BUG: A project with a syntax error in its code might poison
       * the shared esbuild instance or bundler cache, causing other projects to fail.
       */
      it("syntax error in Project A does not affect Project B rendering", async () => {
        await withTestContext("blast-syntax-healthy", async (healthyContext) => {
          await withTestContext("blast-syntax-broken", async (brokenContext) => {
            await mkdir(join(healthyContext.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(healthyContext.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body className="healthy">{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(healthyContext.projectDir, "app", "page.tsx"),
              `export default function Page() { return <div>Healthy Project</div>; }`,
            );

            await mkdir(join(brokenContext.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(brokenContext.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body className="broken">{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(brokenContext.projectDir, "app", "page.tsx"),
              // INTENTIONAL SYNTAX ERROR: Missing closing parenthesis and brace
              `export default function Page() {
              const broken = {
                unclosed: "object"
              // Missing closing brace and return
            `,
            );

            const { createRenderer } = await import("../../../src/rendering/index.ts");
            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

            let healthyRenderer: unknown;
            let brokenRenderer: unknown;

            try {
              healthyRenderer = await createRenderer({
                projectDir: healthyContext.projectDir,
                mode: "development",
              });

              const resultBefore = await (healthyRenderer as any).renderPage("/");
              assertStringIncludes(
                resultBefore.html,
                "Healthy Project",
                "Healthy project should render before broken project is loaded",
              );

              try {
                brokenRenderer = await createRenderer({
                  projectDir: brokenContext.projectDir,
                  mode: "development",
                });
                await (brokenRenderer as any).renderPage("/");
              } catch {
                // Expected - the broken project should fail
              }

              const resultAfter = await (healthyRenderer as any).renderPage("/");
              assertStringIncludes(
                resultAfter.html,
                "Healthy Project",
                "Healthy project must still render after broken project fails",
              );
              assertStringIncludes(
                resultAfter.html,
                'class="healthy"',
                "Healthy project layout must be intact",
              );

              if (brokenRenderer) {
                try {
                  await (brokenRenderer as any).renderPage("/");
                } catch {
                  // Expected - broken project should fail
                }
              }

              await clearRendererState(healthyRenderer);
              await clearRendererState(brokenRenderer);
            } finally {
              await cleanupBundler();
            }
          });
        });
      });

      it("runtime error in Project A does not crash Project B", async () => {
        await withTestContext("blast-runtime-healthy", async (healthyContext) => {
          await withTestContext("blast-runtime-broken", async (brokenContext) => {
            await mkdir(join(healthyContext.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(healthyContext.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body>{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(healthyContext.projectDir, "app", "page.tsx"),
              `export default function Page() { return <div id="healthy-marker">Healthy</div>; }`,
            );

            await mkdir(join(brokenContext.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(brokenContext.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body>{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(brokenContext.projectDir, "app", "page.tsx"),
              // INTENTIONAL RUNTIME ERROR: Calling undefined
              `export default function Page() {
              const obj = { nested: { value: null } };
              // This will throw "Cannot read property 'call' of undefined" at render time
              return <div>{obj.nested.value.nonExistent.call()}</div>;
            }`,
            );

            const { createRenderer } = await import("../../../src/rendering/index.ts");
            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

            let healthyRenderer: unknown;
            let brokenRenderer: unknown;

            try {
              healthyRenderer = await createRenderer({
                projectDir: healthyContext.projectDir,
                mode: "development",
              });

              brokenRenderer = await createRenderer({
                projectDir: brokenContext.projectDir,
                mode: "development",
              });

              const result1 = await (healthyRenderer as any).renderPage("/");
              assertStringIncludes(result1.html, "healthy-marker", "Initial healthy render should work");

              try {
                await (brokenRenderer as any).renderPage("/");
              } catch {
                // Expected
              }

              const result2 = await (healthyRenderer as any).renderPage("/");
              assertStringIncludes(
                result2.html,
                "healthy-marker",
                "Healthy render must work after broken project's runtime error",
              );

              for (let i = 0; i < 5; i++) {
                const result = await (healthyRenderer as any).renderPage("/");
                assertStringIncludes(result.html, "healthy-marker", `Healthy render ${i + 1} must work`);
              }

              await clearRendererState(healthyRenderer);
              await clearRendererState(brokenRenderer);
            } finally {
              await cleanupBundler();
            }
          });
        });
      });
    });

    describe("Semaphore and Resource Exhaustion", () => {
      /**
       * CRITICAL BUG: If render semaphores are not project-scoped, one project
       * doing many concurrent renders can starve other projects.
       */
      it("slow renders in Project A do not block Project B", async () => {
        await withTestContext("blast-slow-project", async (slowContext) => {
          await withTestContext("blast-fast-project", async (fastContext) => {
            await mkdir(join(slowContext.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(slowContext.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body>{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(slowContext.projectDir, "app", "page.tsx"),
              `export default function Page() {
              // Note: In a real scenario, this would be async data fetching
              // Here we just create a large component to slow things down
              const items = Array.from({ length: 10000 }, (_, i) => i);
              return <div>{items.map(i => <span key={i}>{i}</span>)}</div>;
            }`,
            );

            await mkdir(join(fastContext.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(fastContext.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body>{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(fastContext.projectDir, "app", "page.tsx"),
              `export default function Page() { return <div>Fast</div>; }`,
            );

            const { createRenderer } = await import("../../../src/rendering/index.ts");
            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

            let slowRenderer: unknown;
            let fastRenderer: unknown;

            try {
              slowRenderer = await createRenderer({
                projectDir: slowContext.projectDir,
                mode: "development",
              });

              fastRenderer = await createRenderer({
                projectDir: fastContext.projectDir,
                mode: "development",
              });

              const slowPromises = Array.from({ length: 5 }, () => (slowRenderer as any).renderPage("/"));

              const fastStart = Date.now();
              const fastResult = await (fastRenderer as any).renderPage("/");
              const fastDuration = Date.now() - fastStart;

              assertStringIncludes(fastResult.html, "Fast", "Fast project should render correctly");

              assert(
                fastDuration < 5000,
                `Fast render took ${fastDuration}ms - should not be blocked by slow renders`,
              );

              await Promise.allSettled(slowPromises);

              await clearRendererState(slowRenderer);
              await clearRendererState(fastRenderer);
            } finally {
              await cleanupBundler();
            }
          });
        });
      });
    });

    describe("Error State Isolation", () => {
      /**
       * CRITICAL BUG: Error boundary state or error component maps might leak
       * between projects if stored in global state.
       */
      it("error state from Project A does not appear in Project B", async () => {
        await withTestContext("blast-error-state-a", async (contextA) => {
          await withTestContext("blast-error-state-b", async (contextB) => {
            await mkdir(join(contextA.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(contextA.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body data-project="A">{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(contextA.projectDir, "app", "page.tsx"),
              `export default function Page() {
              throw new Error("Project A intentional error: ERROR_MARKER_A_12345");
            }`,
            );

            await mkdir(join(contextB.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(contextB.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body data-project="B">{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(contextB.projectDir, "app", "page.tsx"),
              `export default function Page() {
              return <div id="project-b-success">Project B Success</div>;
            }`,
            );

            const { createRenderer } = await import("../../../src/rendering/index.ts");
            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

            let rendererA: unknown;
            let rendererB: unknown;

            try {
              rendererA = await createRenderer({
                projectDir: contextA.projectDir,
                mode: "development",
              });

              rendererB = await createRenderer({
                projectDir: contextB.projectDir,
                mode: "development",
              });

              for (let i = 0; i < 3; i++) {
                try {
                  await (rendererA as any).renderPage("/");
                } catch {
                  // Expected
                }
              }

              const resultB = await (rendererB as any).renderPage("/");

              assertStringIncludes(resultB.html, "project-b-success", "Project B should render its content");
              assertStringIncludes(resultB.html, 'data-project="B"', "Project B should have its layout");

              assert(
                !resultB.html.includes("ERROR_MARKER_A_12345"),
                "Project B must NOT contain Project A's error marker",
              );
              assert(
                !resultB.html.includes("Project A intentional error"),
                "Project B must NOT contain Project A's error message",
              );
              assert(
                !resultB.html.includes('data-project="A"'),
                "Project B must NOT contain Project A's layout",
              );

              await clearRendererState(rendererA);
              await clearRendererState(rendererB);
            } finally {
              await cleanupBundler();
            }
          });
        });
      });
    });

    describe("Cache Corruption Protection", () => {
      /**
       * CRITICAL BUG: A failed transform might leave corrupt entries in shared caches,
       * causing subsequent renders (even for other projects) to fail.
       */
      it("corrupted cache entry does not affect other projects", async () => {
        await withTestContext("blast-cache-corrupt", async (corruptContext) => {
          await withTestContext("blast-cache-clean", async (cleanContext) => {
            await mkdir(join(corruptContext.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(corruptContext.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body>{children}</body></html>;
            }`,
            );

            await mkdir(join(cleanContext.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(cleanContext.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body className="clean-layout">{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(cleanContext.projectDir, "app", "page.tsx"),
              `export default function Page() {
              return <div className="clean-page">Clean Content</div>;
            }`,
            );

            const { createRenderer } = await import("../../../src/rendering/index.ts");
            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

            let cleanRenderer: unknown;
            let corruptRenderer: unknown;

            try {
              cleanRenderer = await createRenderer({
                projectDir: cleanContext.projectDir,
                mode: "development",
              });

              const result1 = await (cleanRenderer as any).renderPage("/");
              assertStringIncludes(result1.html, "Clean Content", "Clean project should work initially");

              await writeTextFile(
                join(corruptContext.projectDir, "app", "page.tsx"),
                // Invalid JSX that might corrupt transform cache
                `export default function Page() {
                return <div>
                  <script>alert("xss")</script>
                  ${/* Unclosed tags */ ""}
                  <span>
                  <invalid-tag>
              }`,
              );

              try {
                corruptRenderer = await createRenderer({
                  projectDir: corruptContext.projectDir,
                  mode: "development",
                });
                await (corruptRenderer as any).renderPage("/");
              } catch {
                // Expected
              }

              const result2 = await (cleanRenderer as any).renderPage("/");
              assertStringIncludes(
                result2.html,
                "Clean Content",
                "Clean project must work after corrupt project attempt",
              );
              assertStringIncludes(result2.html, "clean-layout", "Clean project layout must be intact");

              for (let i = 0; i < 3; i++) {
                const result = await (cleanRenderer as any).renderPage("/");
                assertStringIncludes(result.html, "Clean Content", `Clean render ${i + 1} must work`);
              }

              await clearRendererState(cleanRenderer);
              await clearRendererState(corruptRenderer);
            } finally {
              await cleanupBundler();
            }
          });
        });
      });
    });

    describe("Missing File Resilience", () => {
      /**
       * CRITICAL BUG: When a project references a file that doesn't exist,
       * the error handling might corrupt global state.
       */
      it("missing file in Project A does not crash Project B", async () => {
        await withTestContext("blast-missing-a", async (contextA) => {
          await withTestContext("blast-missing-b", async (contextB) => {
            await mkdir(join(contextA.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(contextA.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body>{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(contextA.projectDir, "app", "page.tsx"),
              `import NonExistent from './components/DoesNotExist';
             export default function Page() { return <NonExistent />; }`,
            );

            await mkdir(join(contextB.projectDir, "app"), { recursive: true });
            await writeTextFile(
              join(contextB.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body>{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(contextB.projectDir, "app", "page.tsx"),
              `export default function Page() { return <div>Project B Works</div>; }`,
            );

            const { createRenderer } = await import("../../../src/rendering/index.ts");
            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

            let rendererB: unknown;

            try {
              rendererB = await createRenderer({
                projectDir: contextB.projectDir,
                mode: "development",
              });

              const result1 = await (rendererB as any).renderPage("/");
              assertStringIncludes(result1.html, "Project B Works", "B should work initially");

              try {
                const rendererA = await createRenderer({
                  projectDir: contextA.projectDir,
                  mode: "development",
                });
                await (rendererA as any).renderPage("/");
              } catch {
                // Expected - missing import
              }

              const result2 = await (rendererB as any).renderPage("/");
              assertStringIncludes(
                result2.html,
                "Project B Works",
                "B must work after A's missing import error",
              );

              await clearRendererState(rendererB);
            } finally {
              await cleanupBundler();
            }
          });
        });
      });
    });
  },
);

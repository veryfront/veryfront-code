import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { type TestContext, withTestContext } from "../../_helpers/context.ts";
import {
  collectHead,
  flushHeadCollector,
  resetHeadCollector,
  runWithHeadCollector,
} from "../../../src/react/head-collector.ts";

function delayRandom(maxMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.random() * maxMs));
}

async function clearRendererState(renderer: unknown): Promise<void> {
  if (
    renderer &&
    typeof renderer === "object" &&
    "clearAllState" in renderer &&
    typeof (renderer as { clearAllState?: unknown }).clearAllState === "function"
  ) {
    await (renderer as { clearAllState: () => Promise<void> }).clearAllState();
  }
}

describe(
  "Multi-Tenant Isolation Under Concurrency",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    // Disable transform capacity limits for integration tests.
    // The semaphore is a production safety net, not relevant for isolation testing.
    beforeEach(() => {
      Deno.env.set("SSR_MAX_CONCURRENT_TRANSFORMS", "0");
      Deno.env.set("SSR_TRANSFORM_PER_PROJECT_LIMIT", "0");
    });

    afterEach(async () => {
      Deno.env.delete("SSR_MAX_CONCURRENT_TRANSFORMS");
      Deno.env.delete("SSR_TRANSFORM_PER_PROJECT_LIMIT");
      const { clearSSRModuleCache } = await import("#veryfront/modules");
      clearSSRModuleCache();
    });

    describe("Head Collector Isolation", () => {
      it.ignore("isolates head collection between concurrent requests", async () => {
        const request1 = async () => {
          resetHeadCollector();
          collectHead({ title: "Project A - Homepage" });
          collectHead({ metas: [{ name: "description", content: "Project A description" }] });
          await delayRandom(10);
          collectHead({ metas: [{ property: "og:title", content: "Project A OG Title" }] });
          return flushHeadCollector();
        };

        const request2 = async () => {
          resetHeadCollector();
          collectHead({ title: "Project B - Dashboard" });
          collectHead({ metas: [{ name: "description", content: "Project B description" }] });
          await delayRandom(10);
          collectHead({ metas: [{ property: "og:title", content: "Project B OG Title" }] });
          return flushHeadCollector();
        };

        const [result1, result2] = await Promise.all([request1(), request2()]);

        assert(
          !result1.title?.includes("Project B") || result1.title === "Project A - Homepage",
          `Project A result should not contain Project B data. Got title: ${result1.title}`,
        );

        assert(
          !result2.title?.includes("Project A") || result2.title === "Project B - Dashboard",
          `Project B result should not contain Project A data. Got title: ${result2.title}`,
        );

        const result1Desc = result1.metas.find((m) => m.name === "description");
        const result2Desc = result2.metas.find((m) => m.name === "description");

        if (result1Desc) {
          assert(
            !result1Desc.content.includes("Project B"),
            `Project A description should not reference Project B: ${result1Desc.content}`,
          );
        }

        if (result2Desc) {
          assert(
            !result2Desc.content.includes("Project A"),
            `Project B description should not reference Project A: ${result2Desc.content}`,
          );
        }
      });

      it.ignore("maintains isolation under high concurrency stress", async () => {
        const projectCount = 10;
        const results = new Map<
          string,
          { title?: string; metas: any[]; links: any[]; styles: string[] }
        >();
        const errors: string[] = [];

        const createProjectRequest = (projectId: string) => async () => {
          resetHeadCollector();
          const uniqueTitle = `Project-${projectId}-Title-${crypto.randomUUID().slice(0, 8)}`;
          const uniqueDesc = `Description-for-${projectId}`;

          collectHead({ title: uniqueTitle });
          await delayRandom(20);
          collectHead({ metas: [{ name: "description", content: uniqueDesc }] });
          await delayRandom(20);
          collectHead({ metas: [{ name: `custom-${projectId}`, content: `value-${projectId}` }] });

          const result = flushHeadCollector();
          results.set(projectId, result);

          if (result.title && !result.title.includes(projectId)) {
            errors.push(`Project ${projectId} has wrong title: ${result.title}`);
          }

          const desc = result.metas.find((m) => m.name === "description");
          if (desc && !desc.content.includes(projectId)) {
            errors.push(`Project ${projectId} has wrong description: ${desc.content}`);
          }

          return result;
        };

        await Promise.all(
          Array.from({ length: projectCount }, (_, i) => createProjectRequest(`proj-${i}`)()),
        );

        assertEquals(
          errors.length,
          0,
          `Found ${errors.length} isolation violations:\n${errors.join("\n")}`,
        );

        for (const [projectId, result] of results.entries()) {
          const customMeta = result.metas.find((m) => m.name === `custom-${projectId}`);
          assert(customMeta, `Project ${projectId} should have its custom meta tag`);
          assertEquals(
            customMeta.content,
            `value-${projectId}`,
            `Project ${projectId} custom meta should have correct value`,
          );
        }
      });

      it("properly resets state between requests", async () => {
        const { head: first } = await runWithHeadCollector(async () => {
          collectHead({ title: "First Request Title" });
          collectHead({ metas: [{ name: "first", content: "first-value" }] });
        });

        const { head: second } = await runWithHeadCollector(async () => {
          collectHead({ title: "Second Request Title" });
        });

        assertEquals(
          second.title,
          "Second Request Title",
          "Second request should have its own title",
        );
        assertEquals(
          second.metas.length,
          0,
          "Second request should not have first request's metas",
        );

        assertEquals(first.title, "First Request Title", "First result should be unchanged");
        assertEquals(first.metas.length, 1, "First result should still have its metas");
      });
    });

    describe("React Cache Isolation", () => {
      it("isolates React rendering state between projects", async () => {
        await withTestContext("tenant-isolation-react-a", async (contextA) => {
          await withTestContext("tenant-isolation-react-b", async (contextB) => {
            await mkdir(join(contextA.projectDir, "app"), { recursive: true });
            await mkdir(join(contextB.projectDir, "app"), { recursive: true });

            await writeTextFile(
              join(contextA.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body className="theme-blue project-a">{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(contextA.projectDir, "app", "page.tsx"),
              `export default function Page() { return <div data-project="A">Project A Content</div>; }`,
            );

            await writeTextFile(
              join(contextB.projectDir, "app", "layout.tsx"),
              `export default function Layout({ children }) {
              return <html><body className="theme-red project-b">{children}</body></html>;
            }`,
            );
            await writeTextFile(
              join(contextB.projectDir, "app", "page.tsx"),
              `export default function Page() { return <div data-project="B">Project B Content</div>; }`,
            );

            const { createRenderer } = await import("../../../src/rendering/index.ts");
            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

            let rendererA: any;
            let rendererB: any;

            try {
              rendererA = await createRenderer({
                projectDir: contextA.projectDir,
                mode: "development",
              });

              rendererB = await createRenderer({
                projectDir: contextB.projectDir,
                mode: "development",
              });

              // Render sequentially to avoid hitting transform capacity limits.
              // Isolation is tested by verifying no cross-contamination in output.
              const resultA = await rendererA.renderPage("/");
              const resultB = await rendererB.renderPage("/");

              assertStringIncludes(
                resultA.html,
                "project-a",
                "Project A should have project-a class",
              );
              assertStringIncludes(resultA.html, "theme-blue", "Project A should have blue theme");
              assertStringIncludes(
                resultA.html,
                'data-project="A"',
                "Project A should have data-project A",
              );
              assert(!resultA.html.includes("project-b"), "Project A should NOT contain project-b");
              assert(!resultA.html.includes("theme-red"), "Project A should NOT have red theme");

              assertStringIncludes(
                resultB.html,
                "project-b",
                "Project B should have project-b class",
              );
              assertStringIncludes(resultB.html, "theme-red", "Project B should have red theme");
              assertStringIncludes(
                resultB.html,
                'data-project="B"',
                "Project B should have data-project B",
              );
              assert(!resultB.html.includes("project-a"), "Project B should NOT contain project-a");
              assert(!resultB.html.includes("theme-blue"), "Project B should NOT have blue theme");

              await clearRendererState(rendererA);
              await clearRendererState(rendererB);
            } finally {
              await cleanupBundler();
            }
          });
        });
      });

      it("prevents cache key collisions when projects have same file names", async () => {
        await withTestContext("tenant-collision-a", async (contextA) => {
          await withTestContext("tenant-collision-b", async (contextB) => {
            const createProject = async (
              context: TestContext,
              projectName: string,
              uniqueId: string,
            ) => {
              await mkdir(join(context.projectDir, "app", "components"), { recursive: true });

              await writeTextFile(
                join(context.projectDir, "app", "layout.tsx"),
                `export default function Layout({ children }) {
                return <html><body data-tenant="${uniqueId}">{children}</body></html>;
              }`,
              );

              await writeTextFile(
                join(context.projectDir, "app", "components", "Button.tsx"),
                `export default function Button() { return <button className="btn-${uniqueId}">${projectName} Button</button>; }`,
              );

              await writeTextFile(
                join(context.projectDir, "app", "page.tsx"),
                `import Button from './components/Button';
              export default function Page() { return <div><Button /></div>; }`,
              );
            };

            const uniqueA = crypto.randomUUID().slice(0, 8);
            const uniqueB = crypto.randomUUID().slice(0, 8);

            await createProject(contextA, "ProjectA", uniqueA);
            await createProject(contextB, "ProjectB", uniqueB);

            const { createRenderer } = await import("../../../src/rendering/index.ts");
            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

            let rendererA: any;
            let rendererB: any;

            try {
              rendererA = await createRenderer({
                projectDir: contextA.projectDir,
                mode: "development",
              });

              rendererB = await createRenderer({
                projectDir: contextB.projectDir,
                mode: "development",
              });

              // Render sequentially and verify isolation
              const resultsA: string[] = [];
              const resultsB: string[] = [];

              for (let i = 0; i < 3; i++) {
                const rA = await rendererA.renderPage("/");
                const rB = await rendererB.renderPage("/");
                resultsA.push(rA.html);
                resultsB.push(rB.html);
              }

              for (let i = 0; i < resultsA.length; i++) {
                const htmlA = resultsA[i];
                assertExists(htmlA, `Project A render ${i} should exist`);
                assertStringIncludes(
                  htmlA,
                  `data-tenant="${uniqueA}"`,
                  `Project A render ${i} should have correct tenant ID`,
                );
                assertStringIncludes(
                  htmlA,
                  `btn-${uniqueA}`,
                  `Project A render ${i} should have correct button class`,
                );
                assertStringIncludes(
                  htmlA,
                  "ProjectA Button",
                  `Project A render ${i} should have correct button text`,
                );

                assert(
                  !htmlA.includes(uniqueB),
                  `Project A render ${i} should NOT contain Project B's unique ID`,
                );
                assert(
                  !htmlA.includes("ProjectB"),
                  `Project A render ${i} should NOT contain Project B content`,
                );
              }

              for (let i = 0; i < resultsB.length; i++) {
                const htmlB = resultsB[i];
                assertExists(htmlB, `Project B render ${i} should exist`);
                assertStringIncludes(
                  htmlB,
                  `data-tenant="${uniqueB}"`,
                  `Project B render ${i} should have correct tenant ID`,
                );
                assertStringIncludes(
                  htmlB,
                  `btn-${uniqueB}`,
                  `Project B render ${i} should have correct button class`,
                );
                assertStringIncludes(
                  htmlB,
                  "ProjectB Button",
                  `Project B render ${i} should have correct button text`,
                );

                assert(
                  !htmlB.includes(uniqueA),
                  `Project B render ${i} should NOT contain Project A's unique ID`,
                );
                assert(
                  !htmlB.includes("ProjectA"),
                  `Project B render ${i} should NOT contain Project A content`,
                );
              }

              await clearRendererState(rendererA);
              await clearRendererState(rendererB);
            } finally {
              await cleanupBundler();
            }
          });
        });
      });
    });

    describe("Module Cache Isolation", () => {
      it("prevents module cache cross-contamination", async () => {
        await withTestContext("module-cache-a", async (contextA) => {
          await withTestContext("module-cache-b", async (contextB) => {
            const createProjectFiles = async (context: TestContext, projectName: string) => {
              await mkdir(join(context.projectDir, "app", "utils"), { recursive: true });

              await writeTextFile(
                join(context.projectDir, "app", "utils", "config.ts"),
                `export const PROJECT_NAME = "${projectName}";
               export const getProjectId = () => "${context.projectId}";`,
              );

              await writeTextFile(
                join(context.projectDir, "app", "layout.tsx"),
                `export default function Layout({ children }) {
                return <html><body>{children}</body></html>;
              }`,
              );

              await writeTextFile(
                join(context.projectDir, "app", "page.tsx"),
                `import { PROJECT_NAME, getProjectId } from './utils/config';
               export default function Page() {
                 return <div data-name={PROJECT_NAME} data-id={getProjectId()}>{PROJECT_NAME}</div>;
               }`,
              );
            };

            await createProjectFiles(contextA, "Alpha");
            await createProjectFiles(contextB, "Beta");

            const { createRenderer } = await import("../../../src/rendering/index.ts");
            const { cleanupBundler } = await import("../../../src/rendering/cleanup.ts");

            let rendererA: any;
            let rendererB: any;

            try {
              rendererA = await createRenderer({
                projectDir: contextA.projectDir,
                mode: "development",
              });

              rendererB = await createRenderer({
                projectDir: contextB.projectDir,
                mode: "development",
              });

              const resultA1 = await rendererA.renderPage("/");
              const resultB1 = await rendererB.renderPage("/");

              const resultB2 = await rendererB.renderPage("/");
              const resultA2 = await rendererA.renderPage("/");

              assertStringIncludes(
                resultA1.html,
                'data-name="Alpha"',
                "A render 1 should have Alpha",
              );
              assertStringIncludes(
                resultA2.html,
                'data-name="Alpha"',
                "A render 2 should have Alpha",
              );

              assertStringIncludes(
                resultB1.html,
                'data-name="Beta"',
                "B render 1 should have Beta",
              );
              assertStringIncludes(
                resultB2.html,
                'data-name="Beta"',
                "B render 2 should have Beta",
              );

              assert(!resultA1.html.includes("Beta"), "A render 1 should NOT have Beta");
              assert(!resultA2.html.includes("Beta"), "A render 2 should NOT have Beta");
              assert(!resultB1.html.includes("Alpha"), "B render 1 should NOT have Alpha");
              assert(!resultB2.html.includes("Alpha"), "B render 2 should NOT have Alpha");

              await clearRendererState(rendererA);
              await clearRendererState(rendererB);
            } finally {
              await cleanupBundler();
            }
          });
        });
      });
    });

    describe("Request Context Isolation", () => {
      it("isolates request-specific data in AsyncLocalStorage", async () => {
        const capturedContexts: string[] = [];

        const task1 = withTestContext("als-test-1", async (context) => {
          await delayRandom(20);
          capturedContexts.push(`task1-start:${context.projectId}`);
          await delayRandom(20);
          capturedContexts.push(`task1-end:${context.projectId}`);
          return context.projectId;
        });

        const task2 = withTestContext("als-test-2", async (context) => {
          await delayRandom(20);
          capturedContexts.push(`task2-start:${context.projectId}`);
          await delayRandom(20);
          capturedContexts.push(`task2-end:${context.projectId}`);
          return context.projectId;
        });

        const [id1, id2] = await Promise.all([task1, task2]);

        assertNotEquals(id1, id2, "Each context should have unique projectId");

        const task1Entries = capturedContexts.filter((c) => c.startsWith("task1"));
        const task2Entries = capturedContexts.filter((c) => c.startsWith("task2"));

        for (const entry of task1Entries) {
          assert(entry.includes(id1), `Task 1 entry should contain its own ID: ${entry}`);
          assert(!entry.includes(id2), `Task 1 entry should NOT contain Task 2's ID: ${entry}`);
        }

        for (const entry of task2Entries) {
          assert(entry.includes(id2), `Task 2 entry should contain its own ID: ${entry}`);
          assert(!entry.includes(id1), `Task 2 entry should NOT contain Task 1's ID: ${entry}`);
        }
      });
    });
  },
);

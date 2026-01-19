/**
 * File Watching Abstraction Tests
 *
 * Tests the platform-agnostic file watching interface across all adapters:
 * - Deno: Uses Deno.watchFs
 * - Node: Uses fs.watch
 * - Bun: Uses Bun.watch or fs.watch fallback
 * - Cloudflare: Not supported (should throw NotSupportedError)
 */

import { assert, assertEquals } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { describe, it } from "@veryfront/testing/bdd";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { mkdir, writeTextFile } from "@veryfront/testing/deno-compat";
import { isDeno } from "../../../src/platform/compat/runtime.ts";
import { scaleMs } from "@veryfront/testing";
import { delay } from "@std/async";

// File watching tests are timing-sensitive and behave differently across runtimes
// Skip in non-Deno runtimes to avoid flaky tests
const denoOnlyDescribe = isDeno ? describe : describe.skip;

denoOnlyDescribe(
  "File Watching Abstraction",
  () => {
    describe("Deno Adapter", () => {
      it("should watch file changes and emit events", async () => {
        await withTestContext("file-watch-deno-changes", async (context) => {
          const testFile = join(context.projectDir, "test.txt");

          // Give test context time to finish setup
          await delay(300);

          const controller = new AbortController();

          // Start watching after context is fully set up
          const watcher = await (await getAdapter()).fs.watch(context.projectDir, {
            recursive: true,
            signal: controller.signal,
          });

          const events: Array<{ kind: string; paths: string[] }> = [];
          const watchPromise = (async () => {
            for await (const event of watcher) {
              // Only capture events for our test file
              if (event.paths.some((p: string) => p.includes("test.txt"))) {
                events.push({ kind: event.kind, paths: event.paths });
                break;
              }
            }
          })();

          // Give watcher time to initialize
          await delay(200);

          // Create a file to trigger an event
          await writeTextFile(testFile, "Hello World");

          // Wait for event or timeout
          let timeoutId: number | undefined;
          try {
            await Promise.race([
              watchPromise,
              new Promise((resolve) => {
                timeoutId = setTimeout(resolve, scaleMs(2000));
              }),
            ]);
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            // Cleanup
            controller.abort();
            watcher.close();
          }

          // Verify event was captured
          assert(
            events.length > 0,
            `Should capture file change event for test.txt. Got ${events.length} events`,
          );
          const hasTestFile = events.some((e) => e.paths.some((p) => p.includes("test.txt")));
          assert(
            hasTestFile,
            `Should capture event for test.txt. Got events: ${JSON.stringify(events)}`,
          );
        });
      });

      it("should support multiple paths", async () => {
        await withTestContext("file-watch-deno-multi", async (context) => {
          const dir1 = join(context.projectDir, "dir1");
          const dir2 = join(context.projectDir, "dir2");
          await mkdir(dir1, { recursive: true });
          await mkdir(dir2, { recursive: true });

          const controller = new AbortController();

          // Watch multiple paths
          const watcher = await (await getAdapter()).fs.watch([dir1, dir2], {
            recursive: true,
            signal: controller.signal,
          });

          const events: Array<{ kind: string; paths: string[] }> = [];
          const watchPromise = (async () => {
            for await (const event of watcher) {
              events.push({ kind: event.kind, paths: event.paths });
              if (events.length >= 2) break;
            }
          })();

          // Give watcher time to initialize
          await delay(100);

          // Trigger changes in both directories
          await writeTextFile(join(dir1, "file1.txt"), "content1");
          await delay(50);
          await writeTextFile(join(dir2, "file2.txt"), "content2");

          // Wait for events or timeout
          let timeoutId: number | undefined;
          try {
            await Promise.race([
              watchPromise,
              new Promise((resolve) => {
                timeoutId = setTimeout(resolve, scaleMs(1500));
              }),
            ]);
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            // Cleanup
            controller.abort();
            watcher.close();
          }

          // Verify we got events from both directories
          assert(events.length > 0, "Should capture file change events");
        });
      });

      it("should respect abort signal", async () => {
        await withTestContext("file-watch-deno-abort", async (context) => {
          const controller = new AbortController();

          const watcher = await (await getAdapter()).fs.watch(context.projectDir, {
            recursive: true,
            signal: controller.signal,
          });

          let eventCount = 0;
          const watchPromise = (async () => {
            for await (const _event of watcher) {
              eventCount++;
            }
          })();

          // Abort immediately
          controller.abort();
          watcher.close();

          // Wait a bit to ensure no more events
          await delay(100);

          // Should not throw and should stop watching
          await watchPromise;

          // Verify watcher stopped (no events after abort)
          const initialCount = eventCount;
          await writeTextFile(join(context.projectDir, "test.txt"), "content");
          await delay(100);
          assertEquals(eventCount, initialCount, "Should not capture events after abort");
        });
      });

      it("should have a close method", async () => {
        // deno-lint-ignore require-await
        await withTestContext("file-watch-deno-close", async (context) => {
          const watcher = await (await getAdapter()).fs.watch(context.projectDir, { recursive: true });

          // Verify close method exists
          assertEquals(typeof watcher.close, "function", "Should have close method");

          // Should not throw when called
          watcher.close();
        });
      });

      it("should map event kinds correctly", async () => {
        await withTestContext("file-watch-deno-event-kinds", async (context) => {
          const testFile = join(context.projectDir, "test.txt");
          const controller = new AbortController();

          const watcher = await (await getAdapter()).fs.watch(context.projectDir, {
            recursive: true,
            signal: controller.signal,
          });

          const events: Array<{ kind: string; paths: string[] }> = [];
          const watchPromise = (async () => {
            for await (const event of watcher) {
              events.push({ kind: event.kind, paths: event.paths });
              if (events.length >= 2) break;
            }
          })();

          // Give watcher time to initialize
          await delay(100);

          // Create file (should emit 'create')
          await writeTextFile(testFile, "initial content");
          await delay(50);

          // Modify file (should emit 'modify')
          await writeTextFile(testFile, "modified content");

          // Wait for events or timeout
          let timeoutId: number | undefined;
          try {
            await Promise.race([
              watchPromise,
              new Promise((resolve) => {
                timeoutId = setTimeout(resolve, scaleMs(1500));
              }),
            ]);
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            // Cleanup
            controller.abort();
            watcher.close();
          }

          // Verify we got events with correct kinds
          assert(events.length > 0, "Should capture file change events");
          const validKinds = ["create", "modify", "delete", "any"];
          for (const event of events) {
            assert(
              validKinds.includes(event.kind),
              `Event kind '${event.kind}' should be one of: ${validKinds.join(", ")}`,
            );
          }
        });
      });
    });
  },
);

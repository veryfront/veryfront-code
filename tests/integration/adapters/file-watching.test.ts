/**
 * File Watching Abstraction Tests
 *
 * Tests the platform-agnostic file watching interface across all adapters:
 * - Deno: Uses Deno.watchFs
 * - Node: Uses fs.watch
 * - Bun: Uses Bun.watch or fs.watch fallback
 * - Cloudflare: Not supported (should throw NotSupportedError)
 */

import { assert, assertEquals } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat";
import { isDeno } from "../../../src/platform/compat/runtime.ts";
import { scaleMs } from "#veryfront/testing";
import { delay } from "#std/async";

const denoOnlyDescribe = isDeno ? describe : describe.skip;

async function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<void> {
  let timeoutId: number | undefined;

  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, scaleMs(timeoutMs));
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

denoOnlyDescribe(
  "File Watching Abstraction",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    describe("Deno Adapter", () => {
      it("should watch file changes and emit events", async () => {
        await withTestContext("file-watch-deno-changes", async (context) => {
          const testFile = join(context.projectDir, "test.txt");

          await delay(300);

          const controller = new AbortController();
          const watcher = await (await getAdapter()).fs.watch(context.projectDir, {
            recursive: true,
            signal: controller.signal,
          });

          const events: Array<{ kind: string; paths: string[] }> = [];
          const watchPromise = (async () => {
            for await (const event of watcher) {
              if (!event.paths.some((p: string) => p.includes("test.txt"))) continue;
              events.push({ kind: event.kind, paths: event.paths });
              break;
            }
          })();

          await delay(200);
          await writeTextFile(testFile, "Hello World");

          try {
            await raceWithTimeout(watchPromise, 2000);
          } finally {
            controller.abort();
            watcher.close();
          }

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

          await delay(100);

          await writeTextFile(join(dir1, "file1.txt"), "content1");
          await delay(50);
          await writeTextFile(join(dir2, "file2.txt"), "content2");

          try {
            await raceWithTimeout(watchPromise, 1500);
          } finally {
            controller.abort();
            watcher.close();
          }

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

          controller.abort();
          watcher.close();

          await delay(100);
          await watchPromise;

          const initialCount = eventCount;
          await writeTextFile(join(context.projectDir, "test.txt"), "content");
          await delay(100);
          assertEquals(eventCount, initialCount, "Should not capture events after abort");
        });
      });

      it("should have a close method", async () => {
        await withTestContext("file-watch-deno-close", async (context) => {
          const watcher = await (await getAdapter()).fs.watch(context.projectDir, {
            recursive: true,
          });

          assertEquals(typeof watcher.close, "function", "Should have close method");
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

          await delay(100);

          await writeTextFile(testFile, "initial content");
          await delay(50);
          await writeTextFile(testFile, "modified content");

          try {
            await raceWithTimeout(watchPromise, 1500);
          } finally {
            controller.abort();
            watcher.close();
          }

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

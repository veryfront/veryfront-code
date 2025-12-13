
import { assert, assertEquals } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { denoAdapter } from "@veryfront/platform/adapters/deno.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe(
  "File Watching Abstraction",
  
  () => {
    describe("Deno Adapter", () => {
      it("should watch file changes and emit events", async () => {
        await withTestContext("file-watch-deno-changes", async (context) => {
          const testFile = join(context.projectDir, "test.txt");

          await new Promise((resolve) => setTimeout(resolve, 300));

          const controller = new AbortController();

          const watcher = denoAdapter.fs.watch(context.projectDir, {
            recursive: true,
            signal: controller.signal,
          });

          const events: Array<{ kind: string; paths: string[] }> = [];
          const watchPromise = (async () => {
            for await (const event of watcher) {
              if (event.paths.some((p) => p.includes("test.txt"))) {
                events.push({ kind: event.kind, paths: event.paths });
                break;
              }
            }
          })();

          await new Promise((resolve) => setTimeout(resolve, 200));

          await Deno.writeTextFile(testFile, "Hello World");

          let timeoutId: number | undefined;
          try {
            await Promise.race([
              watchPromise,
              new Promise((resolve) => { timeoutId = setTimeout(resolve, 2000); }),
            ]);
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
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
          await Deno.mkdir(dir1, { recursive: true });
          await Deno.mkdir(dir2, { recursive: true });

          const controller = new AbortController();

          const watcher = denoAdapter.fs.watch([dir1, dir2], {
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

          await new Promise((resolve) => setTimeout(resolve, 100));

          await Deno.writeTextFile(join(dir1, "file1.txt"), "content1");
          await new Promise((resolve) => setTimeout(resolve, 50));
          await Deno.writeTextFile(join(dir2, "file2.txt"), "content2");

          let timeoutId: number | undefined;
          try {
            await Promise.race([
              watchPromise,
              new Promise((resolve) => { timeoutId = setTimeout(resolve, 1500); }),
            ]);
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            controller.abort();
            watcher.close();
          }

          assert(events.length > 0, "Should capture file change events");
        });
      });

      it("should respect abort signal", async () => {
        await withTestContext("file-watch-deno-abort", async (context) => {
          const controller = new AbortController();

          const watcher = denoAdapter.fs.watch(context.projectDir, {
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

          await new Promise((resolve) => setTimeout(resolve, 100));

          await watchPromise;

          const initialCount = eventCount;
          await Deno.writeTextFile(join(context.projectDir, "test.txt"), "content");
          await new Promise((resolve) => setTimeout(resolve, 100));
          assertEquals(eventCount, initialCount, "Should not capture events after abort");
        });
      });

      it("should have a close method", async () => {
        // deno-lint-ignore require-await
        await withTestContext("file-watch-deno-close", async (context) => {
          const watcher = denoAdapter.fs.watch(context.projectDir, { recursive: true });

          assertEquals(typeof watcher.close, "function", "Should have close method");

          watcher.close();
        });
      });

      it("should map event kinds correctly", async () => {
        await withTestContext("file-watch-deno-event-kinds", async (context) => {
          const testFile = join(context.projectDir, "test.txt");
          const controller = new AbortController();

          const watcher = denoAdapter.fs.watch(context.projectDir, {
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

          await new Promise((resolve) => setTimeout(resolve, 100));

          await Deno.writeTextFile(testFile, "initial content");
          await new Promise((resolve) => setTimeout(resolve, 50));

          await Deno.writeTextFile(testFile, "modified content");

          let timeoutId: number | undefined;
          try {
            await Promise.race([
              watchPromise,
              new Promise((resolve) => { timeoutId = setTimeout(resolve, 1500); }),
            ]);
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
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

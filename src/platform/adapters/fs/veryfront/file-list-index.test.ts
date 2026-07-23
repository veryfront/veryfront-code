import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { FileListIndex } from "./file-list-index.ts";

describe("platform/adapters/fs/veryfront/file-list-index", () => {
  describe("lookup without getFileListCache", () => {
    it("should return undefined when no cache function provided", async () => {
      const index = new FileListIndex();
      assertEquals(await index.lookup("pages/index.tsx"), undefined);
    });
  });

  describe("lookup with cache function", () => {
    it("should return content for a cached path", async () => {
      const index = new FileListIndex(async () => [
        { path: "pages/index.tsx", content: "export default () => <div/>" },
        { path: "pages/about.tsx", content: "about page" },
      ]);
      assertEquals(await index.lookup("pages/index.tsx"), "export default () => <div/>");
    });

    it("does not write cached source content to debug logs", async () => {
      const previousLevel = Deno.env.get("LOG_LEVEL");
      const originalDebug = console.debug;
      const entries: LogEntry[] = [];
      const source = "PRIVATE_SOURCE_CANARY export default function Page() {}";
      Deno.env.set("LOG_LEVEL", "DEBUG");
      console.debug = () => {};
      __resetLoggerConfigForTests();
      __registerLogRecordEmitter((entry) => entries.push(entry));

      try {
        const index = new FileListIndex(async () => [
          { path: "pages/welcome.tsx", content: source },
        ]);
        assertEquals(await index.lookup("pages/welcome.tsx"), source);
        assertEquals(JSON.stringify(entries).includes("PRIVATE_SOURCE_CANARY"), false);
      } finally {
        __resetLogRecordEmitterForTests();
        console.debug = originalDebug;
        if (previousLevel === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", previousLevel);
        __resetLoggerConfigForTests();
      }
    });

    it("should return undefined for a path not in cache", async () => {
      const index = new FileListIndex(async () => [
        { path: "pages/index.tsx", content: "content" },
      ]);
      assertEquals(await index.lookup("pages/missing.tsx"), undefined);
    });

    it("should return undefined for entries without content", async () => {
      const index = new FileListIndex(async () => [
        { path: "pages/no-content.tsx" },
      ]);
      assertEquals(await index.lookup("pages/no-content.tsx"), undefined);
    });

    it("should return undefined when cache returns undefined", async () => {
      const index = new FileListIndex(async () => undefined);
      assertEquals(await index.lookup("anything"), undefined);
    });

    it("refreshes inline content when the file list shape is unchanged", async () => {
      let content = "first version";
      const index = new FileListIndex(async () => [
        { path: "pages/index.tsx", content },
      ]);

      assertEquals(await index.lookup("pages/index.tsx"), "first version");
      content = "second version";
      assertEquals(await index.lookup("pages/index.tsx"), "second version");
    });

    it("should handle empty file list", async () => {
      const index = new FileListIndex(async () => []);
      assertEquals(await index.lookup("test.ts"), undefined);
    });

    it("should report exact path presence even when inline content is missing", async () => {
      const index = new FileListIndex(async () => [
        { path: "deno.json" },
      ]);

      assertEquals(await index.match("deno.json"), {
        status: "present_without_content",
        fresh: true,
        path: "deno.json",
      });
    });

    it("should find the first existing candidate path in priority order", async () => {
      const index = new FileListIndex(async () => [
        { path: "pages/home.tsx" },
        { path: "pages/home.jsx", content: "jsx content" },
      ]);

      assertEquals(
        await index.findFirstMatch(["pages/home.tsx", "pages/home.jsx"]),
        {
          status: "present_without_content",
          fresh: true,
          path: "pages/home.tsx",
        },
      );
    });
  });

  describe("clear", () => {
    it("should clear the built index", async () => {
      let callCount = 0;
      const index = new FileListIndex(async () => {
        callCount++;
        return [{ path: "a.ts", content: "content-a" }];
      });

      assertEquals(await index.lookup("a.ts"), "content-a");
      assertEquals(callCount, 1);

      index.clear();
      assertEquals(await index.lookup("a.ts"), "content-a");
      // After clear, it should re-fetch from cache function
      assertEquals(callCount, 2);
    });

    it("should be safe to call when index is empty", () => {
      const index = new FileListIndex();
      index.clear(); // Should not throw
    });
  });

  describe("setReadyPromise", () => {
    it("should wait for ready promise before lookup", async () => {
      let resolved = false;
      const readyPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          resolved = true;
          resolve();
        }, 10);
      });

      const index = new FileListIndex(async () => [
        { path: "test.ts", content: "hello" },
      ]);
      index.setReadyPromise(readyPromise);

      const result = await index.lookup("test.ts");
      assertEquals(resolved, true);
      assertEquals(result, "hello");
    });

    it("should handle rejected ready promise gracefully", async () => {
      const index = new FileListIndex(async () => [
        { path: "test.ts", content: "hello" },
      ]);
      index.setReadyPromise(Promise.reject(new Error("init failed")));

      // Should not throw, should fall through to cache lookup
      const result = await index.lookup("test.ts");
      assertEquals(result, "hello");
    });
  });

  describe("index reuse", () => {
    it("should reuse index when cache key is unchanged", async () => {
      let callCount = 0;
      const fileList = [{ path: "a.ts", content: "content" }];
      const index = new FileListIndex(async () => {
        callCount++;
        return fileList;
      });

      await index.lookup("a.ts");
      await index.lookup("a.ts");
      // Both lookups call getFileListCache but second should reuse the built index
      assertEquals(callCount, 2); // getFileListCache is called each time, but index is reused
    });
  });
});

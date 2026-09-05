import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FileListIndex } from "./file-list-index.ts";

describe("platform/adapters/fs/veryfront/file-list-index", () => {
  it("rebuilds the index when request authority changes", async () => {
    const requestedScopes: string[] = [];
    const index = new FileListIndex((cacheKey) => {
      requestedScopes.push(cacheKey ?? "");
      return Promise.resolve([{
        path: "styles.css",
        content: cacheKey?.endsWith("authority-a") ? "authority a" : "authority b",
      }]);
    }, () => 1);

    assertEquals(
      await index.lookup("styles.css", "files:branch:test:main|authority-a"),
      "authority a",
    );
    assertEquals(
      await index.lookup("styles.css", "files:branch:test:main|authority-b"),
      "authority b",
    );
    assertEquals(requestedScopes, [
      "files:branch:test:main|authority-a",
      "files:branch:test:main|authority-b",
    ]);
  });

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

    it("should return empty inline content as a cache hit", async () => {
      const index = new FileListIndex(async () => [
        { path: "globals.css", content: "" },
      ]);

      assertEquals(await index.lookup("globals.css"), "");
      assertEquals(await index.match("globals.css"), {
        status: "hit",
        fresh: true,
        path: "globals.css",
        content: "",
      });
    });

    it("should return undefined when cache returns undefined", async () => {
      const index = new FileListIndex(async () => undefined);
      assertEquals(await index.lookup("anything"), undefined);
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
    it("tracks the fetched listing across local snapshot versions", async () => {
      const files = [{ path: "a.ts", content: "v1" }];
      let snapshotVersion = 1;
      const index = new FileListIndex(
        () => Promise.resolve(files),
        () => snapshotVersion,
      );

      assertEquals(await index.lookup("a.ts"), "v1");
      files[0]!.content = "v2";
      assertEquals(
        await index.lookup("a.ts"),
        "v2",
        "a shared listing change must rebuild even without a local version change",
      );

      snapshotVersion += 1;
      files[0]!.content = "v3";
      assertEquals(
        await index.lookup("a.ts"),
        "v3",
        "a new source snapshot must rebuild the map",
      );
    });

    it("re-reads a listing that spans a snapshot change", async () => {
      let snapshotVersion = 1;
      let reads = 0;
      const index = new FileListIndex(
        () => {
          reads++;
          if (reads === 1) {
            // The snapshot advances while this read is open, so the listing it
            // returns describes the superseded snapshot.
            snapshotVersion += 1;
            return Promise.resolve([{ path: "old.css", content: "old" }]);
          }
          return Promise.resolve([{ path: "new.css", content: "new" }]);
        },
        () => snapshotVersion,
      );

      assertEquals(
        await index.match("old.css"),
        { status: "missing", fresh: true },
        "a listing superseded during the read must not be republished as the index",
      );
      assertEquals(reads, 2, "the superseded read must be retried against the settled snapshot");
      assertEquals(await index.lookup("new.css"), "new");
    });

    it("discards the listing when the snapshot keeps changing during the read", async () => {
      let snapshotVersion = 1;
      let reads = 0;
      const index = new FileListIndex(
        () => {
          reads++;
          snapshotVersion += 1;
          return Promise.resolve([{ path: "a.css", content: "a" }]);
        },
        () => snapshotVersion,
      );

      assertEquals(
        await index.match("a.css"),
        { status: "unavailable", fresh: false },
        "a listing that never settles must be discarded rather than marked fresh",
      );
      assertEquals(reads, 2, "the read is retried a bounded number of times");
    });

    it("discards a settled retry while the source prefix remains invalidated", async () => {
      let snapshotVersion = 1;
      let invalidated = false;
      let reads = 0;
      const index = new FileListIndex(
        () => {
          reads++;
          if (reads === 1) {
            snapshotVersion += 1;
            invalidated = true;
          }
          return Promise.resolve([{ path: "stale.css", content: "stale" }]);
        },
        () => snapshotVersion,
        () => invalidated,
      );

      assertEquals(await index.match("stale.css"), {
        status: "unavailable",
        fresh: false,
      });
      assertEquals(reads, 2);
    });

    it("rebuilds when a refreshed listing changes inline content", async () => {
      let callCount = 0;
      const entry = { path: "a.ts", content: "v1" };
      const fileList: Array<{ path: string; content: string }> = [entry];
      const index = new FileListIndex(async () => {
        callCount++;
        return fileList;
      });

      assertEquals(await index.lookup("a.ts"), "v1", "the first lookup builds the index");

      // Path-only identity is unchanged, but the refreshed inline bytes are
      // authoritative and must replace the old content map.
      entry.content = "v2";
      assertEquals(
        await index.lookup("a.ts"),
        "v2",
        "a refreshed listing must rebuild the content map",
      );

      // Both lookups call getFileListCache and rebuild from its current bytes.
      assertEquals(callCount, 2, "getFileListCache is consulted on every lookup");

      fileList.push({ path: "b.ts", content: "v3" });
      assertEquals(
        await index.lookup("b.ts"),
        "v3",
        "a changed file-list key must rebuild the index",
      );
    });

    it("rebuilds when a shared listing changes without a local snapshot bump", async () => {
      let files = [{ path: "a.ts", content: "a" }];
      const index = new FileListIndex(() => Promise.resolve(files), () => 1);

      assertEquals(await index.lookup("a.ts", "branch-key"), "a");
      files = [...files, { path: "b.ts", content: "b" }];

      assertEquals(
        await index.lookup("b.ts", "branch-key"),
        "b",
        "a listing updated by another process must replace the local index",
      );
    });
  });

  describe("expired cache entry", () => {
    it("refreshes the fallback age after validating an unchanged listing", async () => {
      let listing: Array<{ path: string; content?: string }> | undefined = [
        { path: "a.ts", content: "content-a" },
      ];
      const index = new FileListIndex(() => Promise.resolve(listing));

      assertEquals(await index.lookup("a.ts"), "content-a");
      (index as unknown as { indexBuiltAt: number }).indexBuiltAt = Date.now() -
        (5 * 60 * 1000 + 1);
      assertEquals(await index.lookup("a.ts"), "content-a");

      listing = undefined;
      assertEquals(
        await index.lookup("a.ts"),
        "content-a",
        "a freshly validated index must remain available when the cache later expires",
      );
    });

    it("keeps serving a warm index after the cache entry expires", async () => {
      let calls = 0;
      const index = new FileListIndex(async () => {
        calls++;
        return calls === 1 ? [{ path: "a.ts", content: "content-a" }] : undefined;
      });

      assertEquals(await index.lookup("a.ts"), "content-a", "the first read builds the index");
      assertEquals(await index.match("a.ts"), {
        status: "hit",
        fresh: false,
        path: "a.ts",
        content: "content-a",
      }, "an expired cache entry must keep serving the warm index, marked stale");
    });

    it("discards an index older than the staleness limit", async () => {
      let calls = 0;
      const index = new FileListIndex(async () => {
        calls++;
        return calls === 1 ? [{ path: "a.ts", content: "content-a" }] : undefined;
      });

      assertEquals(await index.lookup("a.ts"), "content-a", "the first read builds the index");

      // Age the index past the limit rather than sleeping through it.
      (index as unknown as { indexBuiltAt: number }).indexBuiltAt = Date.now() -
        (5 * 60 * 1000 + 1);

      assertEquals(
        await index.match("a.ts"),
        { status: "unavailable", fresh: false },
        "a too-stale in-memory index must be discarded rather than served",
      );
    });
  });
});

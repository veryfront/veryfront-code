import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { observeFetchRequestInit } from "#veryfront/testing/mock-fetch.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { FSAdapterWrapper } from "../wrapper.ts";
import { validatePath, ValidationPresets } from "#veryfront/security/path-validation/index.ts";
import type { RuntimeAdapter } from "../../base.ts";
import { GitHubFSAdapter } from "./adapter.ts";
import { createGitHubConfig } from "./types.ts";

const mockTreeResponse = {
  sha: "abc123",
  tree: [
    { path: "README.md", type: "blob", sha: "sha1", size: 11 },
    { path: "src/index.ts", type: "blob", sha: "sha2", size: 200 },
    { path: "src/utils/helper.ts", type: "blob", sha: "sha3", size: 150 },
    { path: "src", type: "tree", sha: "sha4" },
    { path: "src/utils", type: "tree", sha: "sha5" },
  ],
  truncated: false,
};

const mockFileContent = {
  type: "file",
  name: "README.md",
  path: "README.md",
  sha: "sha1",
  size: 11,
  content: btoa("hello world"),
  encoding: "base64",
};

function createAdapter(projectDir?: string): GitHubFSAdapter {
  return new GitHubFSAdapter({
    type: "github",
    projectDir,
    github: { token: "test", owner: "owner", repo: "repo" },
  });
}

function createTreeFetch(tree: unknown): typeof fetch {
  return (url) => {
    if (!String(url).includes("/git/trees/")) {
      return Promise.resolve(new Response("Not found", { status: 404 }));
    }

    return Promise.resolve(new Response(JSON.stringify(tree), { status: 200 }));
  };
}

function assertThrowsMessageIncludes(fn: () => void, includes: string): void {
  try {
    fn();
    throw new Error("Should have thrown");
  } catch (error) {
    assertEquals(
      error instanceof Error && error.message.includes(includes),
      true,
    );
  }
}

describe("GitHubFSAdapter", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("createGitHubConfig", () => {
    it("should throw if token is missing", () => {
      assertThrowsMessageIncludes(() => {
        createGitHubConfig({ token: "", owner: "test", repo: "test" });
      }, "token");
    });

    it("should throw if owner/repo is missing", () => {
      assertThrowsMessageIncludes(() => {
        createGitHubConfig({ token: "token", owner: "", repo: "test" });
      }, "owner");
    });

    it("should apply defaults", () => {
      const config = createGitHubConfig({
        token: "token",
        owner: "owner",
        repo: "repo",
      });

      assertEquals(config.ref, "main");
      assertEquals(config.cache.enabled, true);
      assertEquals(config.cache.ttl, 60_000);
      assertEquals(config.retry.maxRetries, 3);
    });
  });

  describe("initialization", () => {
    it("should fetch tree on initialize", async () => {
      let treeRequested = false;

      globalThis.fetch = (url) => {
        if (!String(url).includes("/git/trees/")) {
          return Promise.resolve(new Response("Not found", { status: 404 }));
        }

        treeRequested = true;
        return Promise.resolve(
          new Response(JSON.stringify(mockTreeResponse), { status: 200 }),
        );
      };

      const adapter = createAdapter();
      await adapter.initialize();

      assertEquals(treeRequested, true);
    });

    it("re-initializes against the current tree after dispose", async () => {
      globalThis.fetch = createTreeFetch(mockTreeResponse);

      const adapter = createAdapter();
      await adapter.initialize();
      assertEquals(await adapter.exists("src/index.ts"), true, "the first tree is indexed");

      adapter.dispose();
      assertEquals(adapter.getCacheStats().cache.size, 0, "dispose clears the blob cache");

      globalThis.fetch = createTreeFetch({
        sha: "def456",
        tree: [{ path: "docs/new.md", type: "blob", sha: "sha9", size: 5 }],
        truncated: false,
      });

      assertEquals(
        await adapter.exists("docs/new.md"),
        true,
        "a disposed adapter re-fetches the tree",
      );
      assertEquals(
        await adapter.exists("src/index.ts"),
        false,
        "the pre-dispose tree index must not survive dispose",
      );
    });

    it("admits ordinary files through the real wrapper while excluding Git symlinks", async () => {
      globalThis.fetch = createTreeFetch({
        sha: "abc123",
        tree: [
          { path: "README.md", mode: "100644", type: "blob", sha: "sha1", size: 100 },
          { path: "outside.md", mode: "120000", type: "blob", sha: "sha2", size: 9 },
        ],
        truncated: false,
      });

      const adapter = createAdapter("/project");
      const wrapped = new FSAdapterWrapper(adapter);
      const result = await validatePath("README.md", {
        ...ValidationPresets.internal("/project"),
        adapter: { fs: wrapped } as unknown as RuntimeAdapter,
      });

      assertEquals(wrapped.symlinkSemantics, "none");
      assertEquals(result.valid, true);
      assertEquals(result.canonicalPath, "/project/README.md");
      assertEquals(await wrapped.exists("/project/outside.md"), false);
    });
  });

  describe("file operations", () => {
    let adapter: GitHubFSAdapter;

    beforeEach(async () => {
      globalThis.fetch = (url, init) => {
        const urlStr = String(url);

        if (urlStr.includes("/git/trees/")) {
          return Promise.resolve(
            new Response(JSON.stringify(mockTreeResponse), { status: 200 }),
          );
        }

        if (urlStr.includes("/contents/README.md")) {
          return Promise.resolve(
            new Response(JSON.stringify(mockFileContent), { status: 200 }),
          );
        }

        if (urlStr.includes("/git/blobs/sha1")) {
          const accept = new Headers(observeFetchRequestInit(init).headers).get("Accept");
          if (accept === "application/vnd.github.raw+json") {
            return Promise.resolve(new Response("hello world", { status: 200 }));
          }
          return Promise.resolve(
            new Response(JSON.stringify(mockFileContent), { status: 200 }),
          );
        }

        return Promise.resolve(new Response("Not found", { status: 404 }));
      };

      adapter = createAdapter();
      await adapter.initialize();
    });

    it("should check file exists from index", async () => {
      assertEquals(await adapter.exists("README.md"), true);
      assertEquals(await adapter.exists("src/index.ts"), true);
      assertEquals(await adapter.exists("nonexistent.ts"), false);
    });

    it("should check directory exists from index", async () => {
      assertEquals(await adapter.exists("src"), true);
      assertEquals(await adapter.exists("src/utils"), true);
      assertEquals(await adapter.exists("nonexistent"), false);
    });

    it("should stat file", async () => {
      const stat = await adapter.stat("README.md");
      assertEquals(stat.isFile, true);
      assertEquals(stat.isDirectory, false);
      assertEquals(stat.size, 11);
    });

    it("should stat directory", async () => {
      const stat = await adapter.stat("src");
      assertEquals(stat.isFile, false);
      assertEquals(stat.isDirectory, true);
    });

    it("should read file content", async () => {
      const content = await adapter.readTextFile("README.md");
      assertEquals(content, "hello world");
    });

    it("admits indexed files before fetching their complete bytes", async () => {
      const wrapped = new FSAdapterWrapper(adapter);
      const exactReader = wrapped.readFileBytesWithinLimit;
      assertEquals(typeof exactReader, "function");
      const bytes = await exactReader!("README.md", 11);

      assertEquals(new TextDecoder().decode(bytes), "hello world");
    });

    it("rejects an indexed oversized file without fetching its content", async () => {
      let contentRequested = false;
      globalThis.fetch = (url) => {
        const urlString = String(url);
        if (urlString.includes("/git/trees/")) {
          return Promise.resolve(
            new Response(JSON.stringify(mockTreeResponse), { status: 200 }),
          );
        }
        if (urlString.includes("/contents/README.md")) contentRequested = true;
        return Promise.resolve(
          new Response(JSON.stringify(mockFileContent), { status: 200 }),
        );
      };
      const boundedAdapter = createAdapter();

      await assertRejects(
        () => boundedAdapter.readFileBytesWithinLimit("README.md", 10),
        RangeError,
        "exceeds 10 bytes",
      );
      assertEquals(contentRequested, false);
    });

    it("fails closed before fetching when the tree omits authoritative size", async () => {
      let blobRequested = false;
      globalThis.fetch = (url) => {
        const urlString = String(url);
        if (urlString.includes("/git/trees/")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                sha: "tree",
                tree: [{ path: "README.md", type: "blob", sha: "sha1" }],
                truncated: false,
              }),
              { status: 200 },
            ),
          );
        }
        blobRequested = true;
        return Promise.resolve(new Response(JSON.stringify(mockFileContent), { status: 200 }));
      };
      const boundedAdapter = createAdapter();

      await assertRejects(
        () => boundedAdapter.readFileBytesWithinLimit("README.md", 11),
        TypeError,
        "size is unavailable",
      );
      assertEquals(blobRequested, false);
    });

    it("rejects a raw blob that does not match its admitted immutable tree entry", async () => {
      globalThis.fetch = (url, init) => {
        const urlString = String(url);
        if (urlString.includes("/git/trees/")) {
          return Promise.resolve(
            new Response(JSON.stringify(mockTreeResponse), { status: 200 }),
          );
        }
        const accept = new Headers(observeFetchRequestInit(init).headers).get("Accept");
        assertEquals(accept, "application/vnd.github.raw+json");
        return Promise.resolve(new Response("hello worl", { status: 200 }));
      };
      const boundedAdapter = createAdapter();

      await assertRejects(
        () => boundedAdapter.readFileBytesWithinLimit("README.md", 11),
        Error,
        "does not match its admitted 11-byte tree entry",
      );
    });

    it("cancels a raw blob stream at the first chunk beyond its admitted size", async () => {
      let cancelled = false;
      let blobRequests = 0;
      globalThis.fetch = (url) => {
        const urlString = String(url);
        if (urlString.includes("/git/trees/")) {
          return Promise.resolve(
            new Response(JSON.stringify(mockTreeResponse), { status: 200 }),
          );
        }
        blobRequests++;
        return Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(12));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { status: 200 },
          ),
        );
      };
      const boundedAdapter = createAdapter();

      await assertRejects(
        () => boundedAdapter.readFileBytesWithinLimit("README.md", 11),
        Error,
        "does not match its admitted 11-byte tree entry",
      );
      assertEquals(blobRequests, 1);
      assertEquals(cancelled, true);
    });

    it("should throw a recognized not-found error for a nonexistent file", async () => {
      const error = await assertRejects(
        () => adapter.stat("nonexistent.ts"),
        Error,
        "not found",
      );

      assertEquals(isNotFoundError(error), true);
    });
  });

  describe("directory operations", () => {
    let adapter: GitHubFSAdapter;

    beforeEach(async () => {
      globalThis.fetch = createTreeFetch(mockTreeResponse);

      adapter = createAdapter();
      await adapter.initialize();
    });

    it("should list root directory", async () => {
      const entries = await adapter.readdir("");
      const names = entries.map((e) => e.name);

      assertEquals(names.includes("README.md"), true);
      assertEquals(names.includes("src"), true);
    });

    it("should list subdirectory", async () => {
      const entries = await adapter.readdir("src");
      const names = entries.map((e) => e.name);

      assertEquals(names.includes("index.ts"), true);
      assertEquals(names.includes("utils"), true);
    });
  });

  describe("file resolution", () => {
    let adapter: GitHubFSAdapter;

    beforeEach(async () => {
      const treeWithExtensions = {
        ...mockTreeResponse,
        tree: [
          { path: "pages/index.tsx", type: "blob", sha: "s1", size: 100 },
          { path: "pages/about.mdx", type: "blob", sha: "s2", size: 100 },
          { path: "lib/utils.ts", type: "blob", sha: "s3", size: 100 },
          { path: "pages", type: "tree", sha: "s4" },
          { path: "lib", type: "tree", sha: "s5" },
        ],
      };

      globalThis.fetch = createTreeFetch(treeWithExtensions);

      adapter = createAdapter();
      await adapter.initialize();
    });

    it("should resolve file with extension", async () => {
      const resolved = await adapter.resolveFile("lib/utils");
      assertEquals(resolved, "lib/utils.ts");
    });

    it("should resolve index file", async () => {
      const resolved = await adapter.resolveFile("pages");
      assertEquals(resolved, "pages/index.tsx");
    });

    it("should return null for unresolvable path", async () => {
      const resolved = await adapter.resolveFile("nonexistent");
      assertEquals(resolved, null);
    });
  });

  describe("error handling", () => {
    it("should handle 401 authentication error", async () => {
      globalThis.fetch = () => Promise.resolve(new Response("Unauthorized", { status: 401 }));

      const adapter = new GitHubFSAdapter({
        type: "github",
        github: { token: "bad-token", owner: "owner", repo: "repo" },
      });

      await assertRejects(() => adapter.initialize(), Error, "authentication");
    });

    it("should handle 404 repo not found", async () => {
      globalThis.fetch = () => Promise.resolve(new Response("Not found", { status: 404 }));

      const adapter = new GitHubFSAdapter({
        type: "github",
        github: { token: "token", owner: "owner", repo: "nonexistent" },
      });

      await assertRejects(() => adapter.initialize(), Error, "Not found");
    });
  });
});

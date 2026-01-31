import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { GitHubFSAdapter } from "./adapter.ts";
import { createGitHubConfig } from "./types.ts";

const mockTreeResponse = {
  sha: "abc123",
  tree: [
    { path: "README.md", type: "blob", sha: "sha1", size: 100 },
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

function createAdapter(): GitHubFSAdapter {
  return new GitHubFSAdapter({
    type: "github",
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
  });

  describe("file operations", () => {
    let adapter: GitHubFSAdapter;

    beforeEach(async () => {
      globalThis.fetch = (url) => {
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
      assertEquals(stat.size, 100);
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

    it("should throw on nonexistent file", async () => {
      await assertRejects(() => adapter.stat("nonexistent.ts"), Error, "not found");
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

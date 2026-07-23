import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { GitHubFSAdapter } from "./adapter.ts";
import { createGitHubConfig } from "./types.ts";
import { FS_ADAPTER_KIND } from "../veryfront/types.ts";

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

function jsonTreeResponse(tree: unknown[]): Response {
  return new Response(JSON.stringify({ sha: "root", tree, truncated: false }), { status: 200 });
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

  it("exposes a stable built-in adapter identity", () => {
    assertEquals(createAdapter()[FS_ADAPTER_KIND], "github");
  });

  it("preserves an absolute project directory when normalizing absolute file paths", async () => {
    globalThis.fetch = createTreeFetch(mockTreeResponse);
    const adapter = new GitHubFSAdapter({
      type: "github",
      projectDir: "/workspace/project",
      github: { token: "test", owner: "owner", repo: "repo" },
    });

    await adapter.initialize();

    assertEquals(await adapter.exists("/workspace/project/src/index.ts"), true);
    adapter.dispose();
  });

  it("rejects unreadable adapter configuration without retaining trap data", () => {
    const secret = "PRIVATE_ADAPTER_CONFIG/project-321";
    const input = Object.create(null);
    Object.defineProperty(input, "github", {
      get() {
        throw new Error(secret);
      },
    });

    let error: unknown;
    try {
      new GitHubFSAdapter(input);
    } catch (caught) {
      error = caught;
    }

    assertEquals(error instanceof VeryfrontError, true);
    assertEquals(JSON.stringify(error).includes(secret), false);
  });

  it("rejects unreadable nested GitHub configuration without retaining trap data", () => {
    const secret = "PRIVATE_GITHUB_TOKEN/project-654";
    const github = Object.create(null);
    Object.defineProperty(github, "token", {
      get() {
        throw new Error(secret);
      },
    });

    let error: unknown;
    try {
      new GitHubFSAdapter({ github });
    } catch (caught) {
      error = caught;
    }

    assertEquals(error instanceof VeryfrontError, true);
    assertEquals(JSON.stringify(error).includes(secret), false);
  });

  describe("createGitHubConfig", () => {
    it("should throw if token is missing", () => {
      assertThrowsMessageIncludes(() => {
        createGitHubConfig({ token: "", owner: "test", repo: "test" });
      }, "token");
    });

    it("should reject a token containing only whitespace", () => {
      assertThrowsMessageIncludes(() => {
        createGitHubConfig({ token: "   ", owner: "test", repo: "test" });
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
      assertEquals(config.retry.requestTimeout, 30_000);
      assertEquals(config.retry.totalTimeout, 120_000);
      assertEquals(config.retry.maxResponseBytes, 64 * 1024 * 1024);
    });

    it("reads hostile configuration once and returns an immutable snapshot", () => {
      const secret = "PRIVATE_GITHUB_CONFIG/project-123";
      let tokenReads = 0;
      const retry = { maxRetries: 1 };
      const input = {
        get token() {
          tokenReads++;
          if (tokenReads > 1) throw new Error(secret);
          return "token";
        },
        owner: "owner",
        repo: "repo",
        retry,
      };

      const config = createGitHubConfig(input);
      retry.maxRetries = 2;

      assertEquals(tokenReads, 1);
      assertEquals(config.retry.maxRetries, 1);
      assertEquals(Object.isFrozen(config), true);
      assertEquals(Object.isFrozen(config.retry), true);
      assertEquals(JSON.stringify(config).includes(secret), false);
    });

    it("rejects unreadable configuration without retaining trap data", () => {
      const secret = "PRIVATE_GITHUB_CONFIG/project-456";
      const input = Object.create(null);
      Object.defineProperty(input, "token", {
        get() {
          throw new Error(secret);
        },
      });

      let error: unknown;
      try {
        createGitHubConfig(input);
      } catch (caught) {
        error = caught;
      }

      assertEquals(error instanceof VeryfrontError, true);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });

    for (
      const [field, retry] of [
        ["maxRetries", { maxRetries: -1 }],
        ["maxRetries", { maxRetries: 1.5 }],
        ["maxRetries", { maxRetries: 21 }],
        ["initialDelay", { initialDelay: -1 }],
        ["initialDelay", { initialDelay: 1.5 }],
        ["maxDelay", { initialDelay: 2, maxDelay: 1 }],
        ["requestTimeout", { requestTimeout: 0 }],
        ["requestTimeout", { requestTimeout: 1.5 }],
        ["totalTimeout", { totalTimeout: 0 }],
        ["maxResponseBytes", { maxResponseBytes: 0 }],
      ] as const
    ) {
      it(`should reject invalid retry.${field}`, () => {
        assertThrowsMessageIncludes(() => {
          createGitHubConfig({ token: "token", owner: "owner", repo: "repo", retry });
        }, field);
      });
    }

    for (const field of ["owner", "repo", "ref"] as const) {
      it(`should reject unsafe ${field}`, () => {
        assertThrowsMessageIncludes(() => {
          createGitHubConfig({
            token: "token",
            owner: field === "owner" ? "bad\nowner" : "owner",
            repo: field === "repo" ? "bad\0repo" : "repo",
            ref: field === "ref" ? "bad\rref" : "main",
          });
        }, field);
      });
    }

    for (
      const [field, cache] of [
        ["ttl", { ttl: 0 }],
        ["ttl", { ttl: 1.5 }],
        ["maxSize", { maxSize: 1.5 }],
        ["maxMemory", { maxMemory: Number.POSITIVE_INFINITY }],
      ] as const
    ) {
      it(`should reject invalid cache.${field}`, () => {
        assertThrowsMessageIncludes(() => {
          createGitHubConfig({ token: "token", owner: "owner", repo: "repo", cache });
        }, field);
      });
    }

    it("should reject a non-boolean cache.enabled value", () => {
      assertThrowsMessageIncludes(() => {
        createGitHubConfig({
          token: "token",
          owner: "owner",
          repo: "repo",
          cache: { enabled: "yes" as unknown as boolean },
        });
      }, "enabled");
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

    it("should refresh the repository snapshot", async () => {
      let revision = 1;
      let requests = 0;
      globalThis.fetch = (url) => {
        if (!String(url).includes("/git/trees/")) {
          return Promise.resolve(new Response("Not found", { status: 404 }));
        }
        requests++;
        return Promise.resolve(jsonTreeResponse([
          { path: `revision-${revision}.ts`, type: "blob", sha: `sha-${revision}`, size: 1 },
        ]));
      };

      const adapter = createAdapter();
      await adapter.initialize();
      assertEquals(await adapter.exists("revision-1.ts"), true);

      revision = 2;
      await adapter.refreshSourceSnapshot("test-refresh");
      assertEquals(await adapter.exists("revision-1.ts"), false);
      assertEquals(await adapter.exists("revision-2.ts"), true);
      assertEquals(requests, 2);
    });

    it("should not restore a stale index after disposal during initialization", async () => {
      let releaseFirstResponse: ((response: Response) => void) | undefined;
      const firstResponse = new Promise<Response>((resolve) => {
        releaseFirstResponse = resolve;
      });
      let requests = 0;
      globalThis.fetch = () => {
        requests++;
        if (requests === 1) return firstResponse;
        return Promise.resolve(jsonTreeResponse([
          { path: "current.ts", type: "blob", sha: "current", size: 1 },
        ]));
      };

      const adapter = createAdapter();
      const staleInitialization = adapter.initialize();
      adapter.dispose();
      releaseFirstResponse?.(jsonTreeResponse([
        { path: "stale.ts", type: "blob", sha: "stale", size: 1 },
      ]));
      await staleInitialization;

      await adapter.initialize();
      assertEquals(await adapter.exists("stale.ts"), false);
      assertEquals(await adapter.exists("current.ts"), true);
      assertEquals(requests, 2);
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

import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import type { HandlerContext } from "../types.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MarkdownPreviewHandler } from "./markdown-preview.handler.ts";
import { GitHubFSAdapter } from "#veryfront/platform/adapters/fs/github/adapter.ts";
import { FSAdapterWrapper } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { VeryfrontError } from "#veryfront/errors";
import { seedPreviewDocumentSourceSnapshot } from "../request/source-snapshot-freshness.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    ...overrides,
  } as HandlerContext;
}

describe("MarkdownPreviewHandler.metadata.enabled", () => {
  it("is enabled for a local project", () => {
    const handler = new MarkdownPreviewHandler();
    const ctx = makeCtx({ isLocalProject: true });
    assertEquals(handler.metadata.enabled?.(ctx), true);
  });

  it("is enabled for host-derived preview (mode: preview)", () => {
    // After VULN-SRV-1/2 fix, requestContext.mode === 'preview' only happens
    // when the Host / X-Forwarded-Host is server-trusted preview. The
    // x-environment client header is ignored — see request-context.test.ts.
    const handler = new MarkdownPreviewHandler();
    const ctx = makeCtx({
      isLocalProject: false,
      requestContext: { mode: "preview" } as HandlerContext["requestContext"],
    });
    assertEquals(handler.metadata.enabled?.(ctx), true);
  });

  it("is NOT enabled for a non-local production request", () => {
    const handler = new MarkdownPreviewHandler();
    const ctx = makeCtx({
      isLocalProject: false,
      requestContext: { mode: "production" } as HandlerContext["requestContext"],
    });
    assertEquals(handler.metadata.enabled?.(ctx), false);
  });

  it("is NOT enabled when no request context and not a local project", () => {
    const handler = new MarkdownPreviewHandler();
    const ctx = makeCtx({ isLocalProject: false });
    assertEquals(handler.metadata.enabled?.(ctx), false);
  });
});

Deno.test("MarkdownPreviewHandler admits the resolver result before reading", async () => {
  let reads = 0;
  const handler = new MarkdownPreviewHandler();
  const ctx = {
    projectDir: "/project",
    isLocalProject: true,
    adapter: {
      fs: {
        resolveFile: () => Promise.resolve("../outside/secret.md"),
        readFile: () => {
          reads += 1;
          return Promise.resolve("secret");
        },
      },
    },
  } as unknown as HandlerContext;

  const result = await handler.handle(new Request("http://localhost/README.md"), ctx);
  assertEquals(result.continue, true);
  assertEquals(reads, 0);
});

Deno.test("MarkdownPreviewHandler fails closed before shared source reads", async () => {
  let reads = 0;
  const ctx = {
    projectDir: "/project",
    isLocalProject: false,
    requestContext: { mode: "preview" },
    adapter: {
      fs: {
        isMultiProjectMode: () => true,
        readFile: () => {
          reads++;
          throw new Error("shared markdown preview read project source");
        },
      },
    },
    securityConfig: null,
  } as unknown as HandlerContext;

  const result = await new MarkdownPreviewHandler().handle(
    new Request("https://tenant.example/README.md"),
    ctx,
  );

  assertEquals(result.response?.status, 503);
  assertEquals(result.response?.headers.get("content-type"), "application/problem+json");
  assertEquals(reads, 0);
});

describe("MarkdownPreviewHandler host-execution capability", () => {
  it("renders once the host grants execution", async () => {
    // The granted counterpart of the shared-runtime denial above. #3364
    // collapsed the execution surfaces onto requiresIsolatedProjectRuntime so
    // they could not drift apart, but markdown preview kept a bare
    // isSharedProjectRuntime check and denied unconditionally. Without this
    // case, an unconditional denial here is indistinguishable from a correct
    // fail-closed guard.
    let reads = 0;
    const ctx = {
      projectDir: "/remote/project",
      projectSlug: "project",
      proxyToken: "token",
      isLocalProject: false,
      requestContext: { mode: "preview" },
      adapter: {
        fs: {
          symlinkSemantics: "none" as const,
          isMultiProjectMode: () => true,
          isContextualMode: () => true,
          runWithContext: async (
            _slug: string,
            _token: string,
            fn: () => Promise<unknown>,
          ) => await fn(),
          exists: () => Promise.resolve(true),
          stat: () =>
            Promise.resolve({
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              size: 0,
              mtime: new Date(),
            }),
          readFile: () => {
            reads++;
            return Promise.resolve("# Readme\n");
          },
        },
      },
      securityConfig: null,
      allowHostProjectCodeExecution: true,
    } as unknown as HandlerContext;

    const result = await new MarkdownPreviewHandler().handle(
      new Request("https://tenant.example/README.md"),
      ctx,
    );

    assertEquals(
      result.response?.status,
      200,
      "a granted shared executor must serve the rendered preview",
    );
    assertEquals(
      result.response?.headers.get("content-type"),
      "text/html; charset=utf-8",
      "the granted preview must be served as HTML",
    );
    assertStringIncludes(
      await result.response!.text(),
      "Readme",
      "the rendered HTML must carry the markdown heading",
    );
    // Not merely "did not 503": the granted request has to actually reach the
    // shared filesystem, otherwise a fallthrough returning no response passes.
    assertNotEquals(reads, 0, "the granted path must reach the project source read");
  });
});

Deno.test("MarkdownPreviewHandler rejects a generation newer than its bound config", async () => {
  let sourceVersion = 1;
  let sourceReads = 0;
  const ctx = {
    projectDir: "/remote/project",
    projectSlug: "project",
    projectId: "project-1",
    proxyToken: "token",
    isLocalProject: false,
    requestContext: { branch: "feature", mode: "preview" },
    parsedDomain: { branch: null },
    adapter: {
      fs: {
        isMultiProjectMode: () => true,
        runWithContext: async (
          _slug: string,
          _token: string,
          fn: () => Promise<unknown>,
        ) => {
          sourceVersion = 2;
          return await fn();
        },
        getSourceSnapshotIdentity: () => "branch:project:feature",
        getSourceSnapshotVersion: () => sourceVersion,
        readFile: () => {
          sourceReads++;
          return Promise.resolve("# stale");
        },
      },
    },
    securityConfig: null,
    allowHostProjectCodeExecution: true,
  } as unknown as HandlerContext;
  seedPreviewDocumentSourceSnapshot(ctx, {
    identity: "branch:project:feature",
    version: 1,
  });

  const rejection = await assertRejects(() =>
    new MarkdownPreviewHandler().handle(
      new Request("https://tenant.example/notes.md"),
      ctx,
    )
  );

  assertInstanceOf(rejection, VeryfrontError);
  assertEquals(rejection.slug, "source-snapshot-freshness-unavailable");
  assertEquals(sourceReads, 0, "Markdown must reject before reading the newer generation");
});

Deno.test("MarkdownPreviewHandler admits and reads through a real wrapped GitHub adapter", async () => {
  const originalFetch = globalThis.fetch;
  let contentReads = 0;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.includes("/git/trees/")) {
      return Promise.resolve(Response.json({
        sha: "tree",
        tree: [{
          path: "README.md",
          mode: "100644",
          type: "blob",
          sha: "readme",
          size: 7,
        }],
        truncated: false,
      }));
    }
    if (url.includes("/contents/README.md")) {
      contentReads += 1;
      const content = "---\nprose: false\n---\n# Hello";
      return Promise.resolve(Response.json({
        type: "file",
        name: "README.md",
        path: "README.md",
        sha: "readme",
        size: content.length,
        content: btoa(content),
        encoding: "base64",
        download_url: null,
      }));
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  };

  const github = new GitHubFSAdapter({
    type: "github",
    projectDir: "/project",
    github: { token: "token", owner: "owner", repo: "repo" },
  });
  const fs = new FSAdapterWrapper(github);
  try {
    const result = await new MarkdownPreviewHandler().handle(
      new Request("http://localhost/README.md"),
      makeCtx({
        isLocalProject: true,
        adapter: { fs } as unknown as HandlerContext["adapter"],
      }),
    );
    assertEquals(result.continue, true);
    assertEquals(contentReads, 1);
  } finally {
    await fs.shutdown();
    globalThis.fetch = originalFetch;
  }
});

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ContentSource, ResolvedContentContext } from "./types.ts";
import {
  fetchFileListForContext,
  hasContentContextChanged,
  isSourceFile,
  resolveContentContext,
  summarizeFileList,
  toClientContext,
} from "./adapter-content-context.ts";

type ContextResolverClient = Parameters<typeof resolveContentContext>[0];
type FileListClient = Parameters<typeof fetchFileListForContext>[0];

function makeProjectFile(path: string) {
  return {
    path,
    type: "file" as const,
    size: 0,
    updated_at: new Date(0).toISOString(),
  };
}

describe("veryfront/adapter-content-context", () => {
  it("recognizes source files and summarizes file lists", () => {
    assertEquals(isSourceFile("pages/index.tsx"), true);
    assertEquals(isSourceFile("assets/logo.svg"), false);

    assertEquals(
      summarizeFileList([
        { path: "pages/index.tsx", content: "export default function Page() {}" },
        { path: "docs/intro.mdx" },
        { path: "assets/logo.svg", content: "<svg />" },
      ]),
      {
        totalFiles: 3,
        filesWithContent: 2,
        sourceFiles: 2,
        sourceFilesWithContent: 1,
      },
    );
  });

  it("detects when content context has changed", () => {
    const branchContext: ResolvedContentContext = {
      sourceType: "branch",
      projectSlug: "demo",
      branch: "main",
    };

    assertEquals(hasContentContextChanged(null, branchContext), true);
    assertEquals(hasContentContextChanged(branchContext, branchContext), false);
    assertEquals(
      hasContentContextChanged(branchContext, {
        sourceType: "branch",
        projectSlug: "demo",
        branch: "feature/auth",
      }),
      true,
    );
  });

  it("maps resolved content context to client context", () => {
    assertEquals(
      toClientContext({ sourceType: "branch", projectSlug: "demo" }),
      { type: "branch", name: "main" },
    );
    assertEquals(
      toClientContext({
        sourceType: "environment",
        projectSlug: "demo",
        environmentName: "preview",
      }),
      { type: "environment", name: "preview" },
    );
    assertEquals(
      toClientContext({
        sourceType: "release",
        projectSlug: "demo",
        releaseId: "rel-123",
      }),
      { type: "release", version: "rel-123" },
    );
  });

  it("resolves content context for each source type", async () => {
    const resolverClient: ContextResolverClient = {
      listEnvironmentFiles: async () => ({ release_id: "env-rel-1" } as any),
      lookupProjectByDomain: async () => ({
        project_slug: "demo-from-domain",
        environment: { name: "production" },
        release_id: "domain-rel-1",
      } as any),
    };

    assertEquals(
      await resolveContentContext(
        resolverClient,
        { type: "branch", branch: "develop" },
        "demo",
      ),
      {
        sourceType: "branch",
        projectSlug: "demo",
        branch: "develop",
      },
    );

    assertEquals(
      await resolveContentContext(
        resolverClient,
        { type: "environment", name: "preview" },
        "demo",
      ),
      {
        sourceType: "environment",
        projectSlug: "demo",
        environmentName: "preview",
        releaseId: "env-rel-1",
      },
    );

    assertEquals(
      await resolveContentContext(
        resolverClient,
        { type: "domain", domain: "example.com" },
        "demo",
      ),
      {
        sourceType: "environment",
        projectSlug: "demo-from-domain",
        environmentName: "production",
        releaseId: "domain-rel-1",
      },
    );
  });

  it("throws for invalid domain/release source configuration", async () => {
    const missingDomainClient: ContextResolverClient = {
      listEnvironmentFiles: async () => ({ release_id: "env-rel-1" } as any),
      lookupProjectByDomain: async () => null,
    };

    await assertRejects(
      async () =>
        await resolveContentContext(
          missingDomainClient,
          { type: "domain", domain: "missing.example.com" },
          "demo",
        ),
      Error,
      "Domain lookup failed for: missing.example.com",
    );

    await assertRejects(
      async () =>
        await resolveContentContext(
          missingDomainClient,
          { type: "release" } as ContentSource,
          "demo",
        ),
      Error,
      "Missing releaseId for release sourceType",
    );
  });

  it("fetches file lists by resolved content context", async () => {
    const calls: string[] = [];
    const fileListClient: FileListClient = {
      listAllFiles: () => {
        calls.push("branch");
        return Promise.resolve([makeProjectFile("pages/index.tsx")]);
      },
      listAllEnvironmentFiles: (environmentName?: string) => {
        calls.push(`environment:${environmentName}`);
        return Promise.resolve([makeProjectFile("pages/index.tsx")]);
      },
      listPublishedFiles: (_projectId?: string, releaseId?: string) => {
        calls.push(`release:${releaseId}`);
        return Promise.resolve([makeProjectFile("pages/index.tsx")]);
      },
    };

    await fetchFileListForContext(fileListClient, {
      sourceType: "branch",
      projectSlug: "demo",
      branch: "main",
    });
    await fetchFileListForContext(fileListClient, {
      sourceType: "environment",
      projectSlug: "demo",
      environmentName: "preview",
    });
    await fetchFileListForContext(fileListClient, {
      sourceType: "release",
      projectSlug: "demo",
      releaseId: "rel-1",
    });

    assertEquals(calls, ["branch", "environment:preview", "release:rel-1"]);
  });
});

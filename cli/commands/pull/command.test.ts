import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for pull command
 * @module cli/commands/pull.test
 */

import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  buildFileContentUrl,
  buildFilesListUrl,
  getFileContent,
  listAllFiles,
  pullCommand,
  type PullOptions,
  type PullSource,
  resolvePullSource,
} from "./command.ts";
import type { ApiClient } from "#cli/shared/config";
import { join } from "veryfront/platform/path";
import { DEFAULT_LIMITS } from "veryfront/security";

function createMockClient(overrides: {
  get?: (url: string, params?: unknown) => Promise<unknown>;
} = {}): ApiClient {
  return {
    get: overrides.get ?? (() => Promise.resolve({ data: [] })),
    post: () => Promise.resolve({}),
    put: () => Promise.resolve({}),
    patch: () => Promise.resolve({}),
    delete: () => Promise.resolve({}),
  } as ApiClient;
}

function mockFilesResponse(paths: string[], next?: string): Promise<unknown> {
  return Promise.resolve({
    data: paths.map((path) => ({
      path,
      size: 100,
      type: "file",
      created_at: "",
      updated_at: "",
    })),
    page_info: { next },
  });
}

function mockFileContentResponse(content: string): Promise<unknown> {
  return Promise.resolve({
    path: "pages/index.tsx",
    content,
    size: content.length,
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Deno.env.delete(name);
    return;
  }
  Deno.env.set(name, value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

describe("resolvePullSource", () => {
  it("should return main source when no options", () => {
    const options: PullOptions = {};
    assertEquals(resolvePullSource(options), { type: "main" });
  });

  it("should return branch source when branch is specified", () => {
    const options: PullOptions = { branch: "feature-x" };
    assertEquals(resolvePullSource(options), { type: "branch", name: "feature-x" });
  });

  it("should return main for branch='main'", () => {
    const options: PullOptions = { branch: "main" };
    assertEquals(resolvePullSource(options), { type: "main" });
  });

  it("should return environment source when env is specified", () => {
    const options: PullOptions = { env: "production" };
    assertEquals(resolvePullSource(options), { type: "environment", name: "production" });
  });

  it("should return release source when release is specified", () => {
    const options: PullOptions = { release: "v1.2.0" };
    assertEquals(resolvePullSource(options), { type: "release", version: "v1.2.0" });
  });

  it("should prioritize env over release", () => {
    const options: PullOptions = { env: "production", release: "v1.2.0" };
    assertEquals(resolvePullSource(options), { type: "environment", name: "production" });
  });

  it("should prioritize env over branch", () => {
    const options: PullOptions = { env: "production", branch: "feature-x" };
    assertEquals(resolvePullSource(options), { type: "environment", name: "production" });
  });

  it("should prioritize release over branch", () => {
    const options: PullOptions = { release: "v1.2.0", branch: "feature-x" };
    assertEquals(resolvePullSource(options), { type: "release", version: "v1.2.0" });
  });

  it("should prioritize env over release and branch", () => {
    const options: PullOptions = { env: "staging", release: "v1.2.0", branch: "feature-x" };
    assertEquals(resolvePullSource(options), { type: "environment", name: "staging" });
  });
});

describe("buildFilesListUrl", () => {
  it("should build main files URL", () => {
    const source: PullSource = { type: "main" };
    assertEquals(buildFilesListUrl("my-project", source), "/projects/my-project/files");
  });

  it("should build branch files URL", () => {
    const source: PullSource = { type: "branch", name: "feature-x" };
    assertEquals(
      buildFilesListUrl("my-project", source),
      "/projects/my-project/files?branch=feature-x",
    );
  });

  it("should encode branch name in URL", () => {
    const source: PullSource = { type: "branch", name: "feature/new stuff" };
    assertEquals(
      buildFilesListUrl("my-project", source),
      "/projects/my-project/files?branch=feature%2Fnew%20stuff",
    );
  });

  it("should build environment files URL", () => {
    const source: PullSource = { type: "environment", name: "production" };
    assertEquals(
      buildFilesListUrl("my-project", source),
      "/projects/my-project/environments/production/files",
    );
  });

  it("should encode environment name in URL", () => {
    const source: PullSource = { type: "environment", name: "my env" };
    assertEquals(
      buildFilesListUrl("my-project", source),
      "/projects/my-project/environments/my%20env/files",
    );
  });

  it("should build release files URL", () => {
    const source: PullSource = { type: "release", version: "v1.2.0" };
    assertEquals(
      buildFilesListUrl("my-project", source),
      "/projects/my-project/releases/v1.2.0/files",
    );
  });

  it("should encode release version in URL", () => {
    const source: PullSource = { type: "release", version: "v1.2.0+build" };
    assertEquals(
      buildFilesListUrl("my-project", source),
      "/projects/my-project/releases/v1.2.0%2Bbuild/files",
    );
  });
});

describe("buildFileContentUrl", () => {
  it("should build main file content URL", () => {
    const source: PullSource = { type: "main" };
    assertEquals(
      buildFileContentUrl("my-project", "pages/index.tsx", source),
      "/projects/my-project/files/pages%2Findex.tsx",
    );
  });

  it("should build branch file content URL", () => {
    const source: PullSource = { type: "branch", name: "feature-x" };
    assertEquals(
      buildFileContentUrl("my-project", "pages/index.tsx", source),
      "/projects/my-project/files/pages%2Findex.tsx?branch=feature-x",
    );
  });

  it("should build environment file content URL", () => {
    const source: PullSource = { type: "environment", name: "production" };
    assertEquals(
      buildFileContentUrl("my-project", "pages/index.tsx", source),
      "/projects/my-project/environments/production/files/pages%2Findex.tsx",
    );
  });

  it("should build release file content URL", () => {
    const source: PullSource = { type: "release", version: "v1.2.0" };
    assertEquals(
      buildFileContentUrl("my-project", "pages/index.tsx", source),
      "/projects/my-project/releases/v1.2.0/files/pages%2Findex.tsx",
    );
  });

  it("should encode file path with special characters", () => {
    const source: PullSource = { type: "main" };
    assertEquals(
      buildFileContentUrl("my-project", "pages/[id]/index.tsx", source),
      "/projects/my-project/files/pages%2F%5Bid%5D%2Findex.tsx",
    );
  });
});

describe("listAllFiles", () => {
  async function testListAllFiles(
    source: PullSource,
    expectedUrl: string,
  ): Promise<void> {
    let capturedUrl = "";
    const mockClient = createMockClient({
      get: (url: string) => {
        capturedUrl = url;
        return mockFilesResponse(["pages/index.tsx"]);
      },
    });

    const files = await listAllFiles(mockClient, "my-project", source);

    assertEquals(capturedUrl, expectedUrl);
    assertEquals(files.length, 1);
    assertEquals(files[0]?.path, "pages/index.tsx");
  }

  it("should fetch files from main", async () => {
    await testListAllFiles({ type: "main" }, "/projects/my-project/files");
  });

  it("should fetch files from branch", async () => {
    await testListAllFiles(
      { type: "branch", name: "feature-x" },
      "/projects/my-project/files?branch=feature-x",
    );
  });

  it("should fetch files from environment", async () => {
    await testListAllFiles(
      { type: "environment", name: "production" },
      "/projects/my-project/environments/production/files",
    );
  });

  it("should fetch files from release", async () => {
    await testListAllFiles(
      { type: "release", version: "v1.2.0" },
      "/projects/my-project/releases/v1.2.0/files",
    );
  });

  it("should handle pagination", async () => {
    let callCount = 0;
    const mockClient = createMockClient({
      get: () => {
        callCount++;
        if (callCount === 1) return mockFilesResponse(["pages/index.tsx"], "cursor1");
        return mockFilesResponse(["pages/about.tsx"]);
      },
    });

    const source: PullSource = { type: "main" };
    const files = await listAllFiles(mockClient, "my-project", source);

    assertEquals(callCount, 2);
    assertEquals(files.length, 2);
    assertEquals(files[0]?.path, "pages/index.tsx");
    assertEquals(files[1]?.path, "pages/about.tsx");
  });
});

describe("getFileContent", () => {
  async function testGetFileContent(
    source: PullSource,
    expectedUrl: string,
  ): Promise<void> {
    let capturedUrl = "";
    const mockClient = createMockClient({
      get: (url: string) => {
        capturedUrl = url;
        return mockFileContentResponse("export default function Home() {}");
      },
    });

    const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", source);

    assertEquals(capturedUrl, expectedUrl);
    assertEquals(content, "export default function Home() {}\n");
  }

  it("should fetch file content from main", async () => {
    await testGetFileContent(
      { type: "main" },
      "/projects/my-project/files/pages%2Findex.tsx",
    );
  });

  it("should fetch file content from branch", async () => {
    await testGetFileContent(
      { type: "branch", name: "feature-x" },
      "/projects/my-project/files/pages%2Findex.tsx?branch=feature-x",
    );
  });

  it("should fetch file content from environment", async () => {
    await testGetFileContent(
      { type: "environment", name: "production" },
      "/projects/my-project/environments/production/files/pages%2Findex.tsx",
    );
  });

  it("should fetch file content from release", async () => {
    await testGetFileContent(
      { type: "release", version: "v1.2.0" },
      "/projects/my-project/releases/v1.2.0/files/pages%2Findex.tsx",
    );
  });

  it("should add trailing newline if missing", async () => {
    const mockClient = createMockClient({
      get: () => mockFileContentResponse("export default function Home() {}"),
    });

    const source: PullSource = { type: "main" };
    const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", source);

    assertEquals(content.endsWith("\n"), true);
  });

  it("should not add extra newline if already present", async () => {
    const mockClient = createMockClient({
      get: () => mockFileContentResponse("export default function Home() {}\n"),
    });

    const source: PullSource = { type: "main" };
    const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", source);

    assertEquals(content, "export default function Home() {}\n");
    assertEquals(content.endsWith("\n\n"), false);
  });

  it("rejects content larger than the shared file-size limit", async () => {
    const mockClient = createMockClient({
      get: () => mockFileContentResponse("x".repeat(DEFAULT_LIMITS.maxFileSize + 1)),
    });

    await assertRejects(
      () => getFileContent(mockClient, "my-project", "oversized.ts", { type: "main" }),
      Error,
      "size limit",
    );
  });
});

describe("pullCommand", () => {
  it("fails with an actionable message instead of silently cancelling when confirmation cannot be shown", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");

    try {
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      _resetEnvironmentConfig();

      globalThis.fetch = ((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/files?")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [{
                  path: "app/page.tsx",
                  size: 10,
                  type: "file",
                  created_at: "",
                  updated_at: "",
                }],
                page_info: {},
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ path: "app/page.tsx", content: "export default null;" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }) as typeof fetch;

      const error = await assertRejects(
        () =>
          pullCommand({
            projectDir: tempDir,
            projectSlug: "alpha",
          }),
        Error,
      );
      const message = error instanceof Error ? error.message : String(error);
      assertEquals((error as { slug?: string }).slug, "invalid-argument");
      assertStringIncludes(message, "requires confirmation");
      assertStringIncludes(message, "--force");
      assertEquals(await exists(join(tempDir, "app", "page.tsx")), false);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      restoreEnv("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("does not write through a symbolic link inside the target directory", async () => {
    const tempDir = await Deno.makeTempDir();
    const outsideDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");

    try {
      await Deno.symlink(outsideDir, join(tempDir, "linked"));
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      _resetEnvironmentConfig();

      globalThis.fetch = ((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/files?")) {
          return Promise.resolve(
            Response.json({
              data: [{
                path: "linked/escape.ts",
                size: 10,
                type: "file",
                created_at: "",
                updated_at: "",
              }],
              page_info: {},
            }),
          );
        }
        return Promise.resolve(Response.json({ content: "malicious" }));
      }) as typeof fetch;

      await pullCommand({
        projectDir: tempDir,
        projectSlug: "alpha",
        force: true,
        quiet: true,
      });

      assertEquals(await exists(join(outsideDir, "escape.ts")), false);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      restoreEnv("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
      await Deno.remove(outsideDir, { recursive: true });
    }
  });

  it("rejects traversal in multi-project directory names before fetching", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
    let fetchCalls = 0;

    try {
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      _resetEnvironmentConfig();
      globalThis.fetch = (() => {
        fetchCalls++;
        return Promise.resolve(Response.json({ data: [], page_info: {} }));
      }) as typeof fetch;

      await assertRejects(
        () =>
          pullCommand({
            projectDir: tempDir,
            projects: ["../escape"],
            force: true,
            quiet: true,
          }),
        Error,
        "Invalid project slug",
      );
      assertEquals(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      restoreEnv("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("does not create a project directory or report success when a --projects pull fails before writing", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");

    try {
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      _resetEnvironmentConfig();

      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "not_found", message: "Project not found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
        )) as typeof fetch;

      const error = await assertRejects(
        () =>
          pullCommand({
            projectDir: tempDir,
            projects: ["missing-project"],
            force: true,
          }),
        Error,
      );
      const message = error instanceof Error ? error.message : String(error);
      assertEquals((error as { slug?: string }).slug, "resource-not-found");
      assertStringIncludes(message, "Failed to pull 1 project");
      assertStringIncludes(message, "missing-project");
      assertEquals(await exists(join(tempDir, "missing-project")), false);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      restoreEnv("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("preserves invalid-argument classification when --projects cannot prompt for confirmation", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");

    try {
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      _resetEnvironmentConfig();

      globalThis.fetch = ((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/projects/alpha/files") && !url.includes("app%2Fpage.tsx")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [{
                  path: "app/page.tsx",
                  size: 12,
                  type: "file",
                  created_at: "2026-01-01T00:00:00Z",
                  updated_at: "2026-01-01T00:00:00Z",
                }],
                page_info: {},
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }

        return Promise.resolve(
          new Response(JSON.stringify({ path: "app/page.tsx", content: "export default null;" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }) as typeof fetch;

      const error = await assertRejects(
        () =>
          pullCommand({
            projectDir: tempDir,
            projects: ["alpha"],
          }),
        Error,
      );
      const message = error instanceof Error ? error.message : String(error);
      assertEquals((error as { slug?: string }).slug, "invalid-argument");
      assertStringIncludes(message, "requires confirmation");
      assertStringIncludes(message, "--force");
      assertEquals(await exists(join(tempDir, "alpha")), false);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      restoreEnv("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("uses explicit env API base URL before veryfront.json apiUrl in the --projects fallback", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
    const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
    const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
    const originalTenantProjectSlug = Deno.env.get("TENANT_PROJECT_SLUG");
    const originalTenantProjectId = Deno.env.get("TENANT_PROJECT_ID");
    const requestedUrls: string[] = [];

    try {
      await Deno.writeTextFile(
        join(tempDir, "veryfront.json"),
        JSON.stringify({
          projects: ["alpha"],
          apiToken: "file-token",
          apiUrl: "https://api.from-file.test",
        }),
      );

      Deno.env.set("VERYFRONT_API_BASE_URL", "https://api.from-env.test");
      Deno.env.delete("VERYFRONT_API_URL");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("TENANT_PROJECT_SLUG");
      Deno.env.delete("TENANT_PROJECT_ID");
      _resetEnvironmentConfig();

      globalThis.fetch = ((input: string | URL | Request) => {
        requestedUrls.push(String(input));
        return Promise.resolve(
          new Response(JSON.stringify({ data: [], page_info: {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }) as typeof fetch;

      await pullCommand({
        projectDir: tempDir + "/",
        dryRun: true,
        quiet: true,
      });

      assertEquals(
        requestedUrls.some((url) => url.startsWith("https://api.from-env.test/projects/alpha/")),
        true,
      );
      assertEquals(
        requestedUrls.some((url) => url.startsWith("https://api.from-file.test/projects/alpha/")),
        false,
      );
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
      restoreEnv("VERYFRONT_API_URL", originalApiUrl);
      restoreEnv("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
      restoreEnv("TENANT_PROJECT_SLUG", originalTenantProjectSlug);
      restoreEnv("TENANT_PROJECT_ID", originalTenantProjectId);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });
});

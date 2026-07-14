import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for pull command
 * @module cli/commands/pull.test
 */

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
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
  validateRemoteFilePath,
} from "./command.ts";
import type { ApiClient } from "#cli/shared/config";
import { join } from "veryfront/platform/path";

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

function describeTestError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function runTestGit(projectDir: string, ...args: string[]): Promise<string> {
  const result = await new Deno.Command("git", {
    cwd: projectDir,
    args,
    clearEnv: true,
    env: Object.fromEntries(
      Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
    ),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = new TextDecoder().decode(result.stderr);
  assertEquals(result.success, true, stderr);
  return new TextDecoder().decode(result.stdout).trim();
}

async function initializeCleanTestGit(projectDir: string): Promise<void> {
  await runTestGit(projectDir, "init", "--quiet");
  await runTestGit(projectDir, "config", "user.email", "test@example.com");
  await runTestGit(projectDir, "config", "user.name", "Test User");
  await runTestGit(projectDir, "add", "--all");
  await runTestGit(projectDir, "commit", "--quiet", "--allow-empty", "-m", "initial");
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

describe("validateRemoteFilePath", () => {
  it("accepts canonical relative POSIX paths", () => {
    assertEquals(validateRemoteFilePath("app/components/page.tsx"), "app/components/page.tsx");
  });

  it("rejects non-canonical and absolute path spellings", () => {
    for (
      const path of [
        "",
        "./app.ts",
        "dir/../app.ts",
        "dir//app.ts",
        "dir/app.ts/",
        "../app.ts",
        "/app.ts",
        "C:/app.ts",
        "C:\\app.ts",
        "\\\\server\\share\\app.ts",
        ".git/config.ts",
        "src/.veryfront/cache.ts",
        "SRC/.GIT/config.ts",
      ]
    ) {
      assertThrows(() => validateRemoteFilePath(path), Error, "Invalid file path");
    }
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
    assertEquals(content, "export default function Home() {}");
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

  it("should preserve content without a trailing newline", async () => {
    const mockClient = createMockClient({
      get: () => mockFileContentResponse("export default function Home() {}"),
    });

    const source: PullSource = { type: "main" };
    const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", source);

    assertEquals(content, "export default function Home() {}");
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

  it("should preserve empty, CRLF, and multiple trailing newlines exactly", async () => {
    for (const expected of ["", "line one\r\nline two\r\n", "line\n\n"]) {
      const mockClient = createMockClient({
        get: () => mockFileContentResponse(expected),
      });

      const content = await getFileContent(mockClient, "my-project", "pages/index.tsx", {
        type: "main",
      });
      assertEquals(content, expected);
    }
  });
});

describe("pullCommand", () => {
  it("prunes managed local files missing from the selected Studio branch", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
    const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");

    try {
      await Deno.mkdir(join(tempDir, "app"), { recursive: true });
      await Deno.writeTextFile(join(tempDir, "app", "keep.ts"), "old\n");
      await Deno.writeTextFile(join(tempDir, "app", "remove.ts"), "remove\n");
      await Deno.writeTextFile(join(tempDir, "app", "asset.bin"), "keep binary\n");
      await Deno.writeTextFile(join(tempDir, "app", "local-only.ts"), "keep ignored\n");
      await Deno.writeTextFile(join(tempDir, ".env.local"), "keep secret\n");
      await Deno.writeTextFile(join(tempDir, ".vfignore"), "app/local-only.ts\n");
      await initializeCleanTestGit(tempDir);

      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      _resetEnvironmentConfig();

      globalThis.fetch = ((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/files?branch=studio-change")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [{
                  path: "app/keep.ts",
                  size: 12,
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
          new Response(JSON.stringify({ path: "app/keep.ts", content: "export default 1;" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }) as typeof fetch;

      await pullCommand({
        projectDir: tempDir,
        projectSlug: "alpha",
        branch: "studio-change",
        prune: true,
        force: true,
        quiet: true,
      });

      assertEquals(await Deno.readTextFile(join(tempDir, "app", "keep.ts")), "export default 1;");
      assertEquals(await exists(join(tempDir, "app", "remove.ts")), false);
      assertEquals(await exists(join(tempDir, "app", "asset.bin")), true);
      assertEquals(await exists(join(tempDir, "app", "local-only.ts")), true);
      assertEquals(await exists(join(tempDir, ".env.local")), true);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      restoreEnv("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("does not overwrite files protected by .vfignore during a pruning pull", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      await Deno.mkdir(join(tempDir, "app"), { recursive: true });
      await Deno.writeTextFile(join(tempDir, "app", "local-only.ts"), "local\n");
      await Deno.writeTextFile(join(tempDir, ".vfignore"), "app/local-only.ts\n");
      await initializeCleanTestGit(tempDir);
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      _resetEnvironmentConfig();

      globalThis.fetch = ((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/files?branch=studio-change")) {
          return Promise.resolve(
            Response.json({
              data: [
                { path: "app/local-only.ts", size: 7, type: "file" },
                { path: "assets/image.png", size: 7, type: "file" },
              ],
              page_info: {},
            }),
          );
        }
        throw new Error(`Pruning pull fetched excluded content: ${url}`);
      }) as typeof fetch;

      await pullCommand({
        projectDir: tempDir,
        projectSlug: "alpha",
        branch: "studio-change",
        prune: true,
        force: true,
        quiet: true,
      });

      assertEquals(await Deno.readTextFile(join(tempDir, "app", "local-only.ts")), "local\n");
      assertEquals(await exists(join(tempDir, "assets", "image.png")), false);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("rejects supported local symlinks before pruning", async () => {
    if (Deno.build.os === "windows") return;

    const tempDir = await Deno.makeTempDir();
    const externalFile = await Deno.makeTempFile({ suffix: ".ts" });
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      await Deno.symlink(externalFile, join(tempDir, "linked.ts"));
      await initializeCleanTestGit(tempDir);
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      _resetEnvironmentConfig();
      globalThis.fetch = (() =>
        Promise.resolve(Response.json({ data: [], page_info: {} }))) as typeof fetch;

      const error = await assertRejects(
        () =>
          pullCommand({
            projectDir: tempDir,
            projectSlug: "alpha",
            branch: "studio-change",
            prune: true,
            force: true,
            quiet: true,
          }),
        Error,
      );

      assertStringIncludes(describeTestError(error), "does not support symbolic links");
      assertEquals((await Deno.lstat(join(tempDir, "linked.ts"))).isSymlink, true);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
      await Deno.remove(externalFile);
    }
  });

  it("rejects duplicate remote paths before writing files", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      _resetEnvironmentConfig();
      globalThis.fetch = (() =>
        Promise.resolve(
          Response.json({
            data: [
              { path: "app/page.ts", size: 7, type: "file" },
              { path: "app/page.ts", size: 7, type: "file" },
            ],
            page_info: {},
          }),
        )) as typeof fetch;

      const error = await assertRejects(
        () =>
          pullCommand({
            projectDir: tempDir,
            projectSlug: "alpha",
            force: true,
            quiet: true,
          }),
        Error,
      );

      assertStringIncludes(describeTestError(error), "Duplicate remote file path");
      assertEquals(await exists(join(tempDir, "app", "page.ts")), false);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("prunes managed local files when the selected Studio branch is empty", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      await Deno.mkdir(join(tempDir, "app"), { recursive: true });
      await Deno.writeTextFile(join(tempDir, "app", "keep.ts"), "old\n");
      await Deno.writeTextFile(join(tempDir, "app", "remove.ts"), "remove\n");
      await initializeCleanTestGit(tempDir);
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      _resetEnvironmentConfig();

      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: [], page_info: {} }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )) as typeof fetch;

      await pullCommand({
        projectDir: tempDir,
        projectSlug: "alpha",
        branch: "empty-branch",
        prune: true,
        force: true,
        quiet: true,
      });

      assertEquals(await exists(join(tempDir, "app", "remove.ts")), false);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("shows prune operations in dry-run without changing local files", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      await Deno.mkdir(join(tempDir, "app"), { recursive: true });
      await Deno.writeTextFile(join(tempDir, "app", "keep.ts"), "old\n");
      await Deno.writeTextFile(join(tempDir, "app", "remove.ts"), "remove\n");
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      _resetEnvironmentConfig();

      globalThis.fetch = ((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/files?branch=studio-change")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [{
                  path: "app/keep.ts",
                  size: 12,
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
        throw new Error(`Dry run fetched file content: ${url}`);
      }) as typeof fetch;

      await pullCommand({
        projectDir: tempDir,
        projectSlug: "alpha",
        branch: "studio-change",
        prune: true,
        dryRun: true,
        quiet: true,
      });

      assertEquals(await Deno.readTextFile(join(tempDir, "app", "keep.ts")), "old\n");
      assertEquals(await Deno.readTextFile(join(tempDir, "app", "remove.ts")), "remove\n");
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("requires Git before a mutating pruning pull", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      await Deno.writeTextFile(join(tempDir, "local.ts"), "unchanged\n");
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      _resetEnvironmentConfig();
      globalThis.fetch = (() => {
        throw new Error("Non-Git prune should fail before network access");
      }) as typeof fetch;

      const error = await assertRejects(
        () =>
          pullCommand({
            projectDir: tempDir,
            projectSlug: "alpha",
            branch: "studio-change",
            prune: true,
            force: true,
            quiet: true,
          }),
        Error,
      );

      assertStringIncludes(describeTestError(error), "inside a Git worktree");
      assertEquals(await Deno.readTextFile(join(tempDir, "local.ts")), "unchanged\n");
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("keeps prune candidates and fails when a remote file cannot be written", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      await Deno.mkdir(join(tempDir, "app"), { recursive: true });
      await Deno.writeTextFile(join(tempDir, "app", "keep.ts"), "old\n");
      await Deno.writeTextFile(join(tempDir, "app", "remove.ts"), "remove\n");
      await initializeCleanTestGit(tempDir);
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      _resetEnvironmentConfig();

      globalThis.fetch = ((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/files?branch=studio-change")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [
                  {
                    path: "app/keep.ts",
                    size: 12,
                    type: "file",
                    created_at: "",
                    updated_at: "",
                  },
                  {
                    path: "app/broken.ts",
                    size: 12,
                    type: "file",
                    created_at: "",
                    updated_at: "",
                  },
                ],
                page_info: {},
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        if (url.includes("app%2Fkeep.ts")) {
          return Promise.resolve(
            Response.json({ path: "app/keep.ts", content: "new\n" }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ error: "failed" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        );
      }) as typeof fetch;

      const error = await assertRejects(
        () =>
          pullCommand({
            projectDir: tempDir,
            projectSlug: "alpha",
            branch: "studio-change",
            prune: true,
            force: true,
            quiet: true,
          }),
        Error,
      );

      assertStringIncludes(describeTestError(error), "Failed to pull");
      assertEquals(await Deno.readTextFile(join(tempDir, "app", "keep.ts")), "old\n");
      assertEquals(await exists(join(tempDir, "app", "remove.ts")), true);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("refuses a pruning pull into a dirty Git worktree", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      await runTestGit(tempDir, "init");
      await runTestGit(tempDir, "config", "user.email", "test@example.com");
      await runTestGit(tempDir, "config", "user.name", "Test User");
      await Deno.writeTextFile(join(tempDir, "app.ts"), "export default 1;\n");
      await runTestGit(tempDir, "add", "app.ts");
      await runTestGit(tempDir, "commit", "-m", "initial");
      await Deno.writeTextFile(join(tempDir, "app.ts"), "export default 2;\n");

      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      _resetEnvironmentConfig();

      const error = await assertRejects(
        () =>
          pullCommand({
            projectDir: tempDir,
            projectSlug: "alpha",
            branch: "studio-change",
            prune: true,
            force: true,
            quiet: true,
          }),
        Error,
      );

      assertStringIncludes(describeTestError(error), "clean Git worktree");
      assertEquals(await Deno.readTextFile(join(tempDir, "app.ts")), "export default 2;\n");
    } finally {
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("checks every nested Git repository before a multi-project prune", async () => {
    const tempDir = await Deno.makeTempDir();
    const projectDir = join(tempDir, "alpha");
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      await Deno.mkdir(projectDir);
      await runTestGit(projectDir, "init", "--quiet");
      await runTestGit(projectDir, "config", "user.email", "test@example.com");
      await runTestGit(projectDir, "config", "user.name", "Test User");
      await Deno.writeTextFile(join(projectDir, "app.ts"), "export default 1;\n");
      await runTestGit(projectDir, "add", "app.ts");
      await runTestGit(projectDir, "commit", "--quiet", "-m", "initial");
      await Deno.writeTextFile(join(projectDir, "app.ts"), "export default 2;\n");

      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      _resetEnvironmentConfig();
      globalThis.fetch = (() => {
        throw new Error("Dirty worktree should be rejected before network access");
      }) as typeof fetch;

      const error = await assertRejects(
        () =>
          pullCommand({
            projectDir: tempDir,
            projects: ["alpha"],
            branch: "studio-change",
            prune: true,
            force: true,
            quiet: true,
          }),
        Error,
      );

      assertStringIncludes(describeTestError(error), "clean Git worktree");
      assertEquals(await Deno.readTextFile(join(projectDir, "app.ts")), "export default 2;\n");
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("preflights a shared monorepo once and ignores nested push receipts", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      for (const project of ["alpha", "beta"]) {
        await Deno.mkdir(join(tempDir, project, ".veryfront"), { recursive: true });
        await Deno.writeTextFile(join(tempDir, project, "app.ts"), `${project} old\n`);
      }
      await runTestGit(tempDir, "init", "--quiet");
      await runTestGit(tempDir, "config", "user.email", "test@example.com");
      await runTestGit(tempDir, "config", "user.name", "Test User");
      await runTestGit(tempDir, "add", "alpha/app.ts", "beta/app.ts");
      await runTestGit(tempDir, "commit", "--quiet", "-m", "initial");
      for (const project of ["alpha", "beta"]) {
        await Deno.writeTextFile(
          join(tempDir, project, ".veryfront", "push-receipt.json"),
          "{}\n",
        );
      }

      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      _resetEnvironmentConfig();
      globalThis.fetch = ((input: string | URL | Request) => {
        const url = String(input);
        const project = url.includes("/projects/alpha/") ? "alpha" : "beta";
        if (!url.includes("app.ts")) {
          return Promise.resolve(
            Response.json({
              data: [{ path: "app.ts", size: 10, type: "file" }],
              page_info: {},
            }),
          );
        }
        return Promise.resolve(Response.json({ path: "app.ts", content: `${project} new\n` }));
      }) as typeof fetch;

      await pullCommand({
        projectDir: tempDir,
        projects: ["alpha", "beta"],
        branch: "studio-change",
        prune: true,
        force: true,
        quiet: true,
      });

      assertEquals(await Deno.readTextFile(join(tempDir, "alpha", "app.ts")), "alpha new\n");
      assertEquals(await Deno.readTextFile(join(tempDir, "beta", "app.ts")), "beta new\n");
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("rejects an invalid remote path before changing local files", async () => {
    const tempDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      await Deno.writeTextFile(join(tempDir, "keep.ts"), "unchanged\n");
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      _resetEnvironmentConfig();

      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [{
                path: "../outside.ts",
                size: 12,
                type: "file",
                created_at: "",
                updated_at: "",
              }],
              page_info: {},
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )) as typeof fetch;

      const error = await assertRejects(
        () =>
          pullCommand({
            projectDir: tempDir,
            projectSlug: "alpha",
            force: true,
            quiet: true,
          }),
        Error,
      );

      assertStringIncludes(describeTestError(error), "invalid file path");
      assertEquals(await Deno.readTextFile(join(tempDir, "keep.ts")), "unchanged\n");
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("rejects a remote write through a symlinked directory", async () => {
    if (Deno.build.os === "windows") return;

    const tempDir = await Deno.makeTempDir();
    const externalDir = await Deno.makeTempDir();
    const originalFetch = globalThis.fetch;
    const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");

    try {
      await Deno.symlink(externalDir, join(tempDir, "app"));
      Deno.env.set("VERYFRONT_API_TOKEN", "token");
      _resetEnvironmentConfig();

      globalThis.fetch = ((input: string | URL | Request) => {
        const url = String(input);
        if (!url.includes("app%2Fpage.tsx")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [{
                  path: "app/page.tsx",
                  size: 12,
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
          new Response(JSON.stringify({ path: "app/page.tsx", content: "outside" }), {
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
            force: true,
            quiet: true,
          }),
        Error,
      );

      assertStringIncludes(describeTestError(error), "symbolic link");
      assertEquals(await exists(join(externalDir, "page.tsx")), false);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
      _resetEnvironmentConfig();
      await Deno.remove(tempDir, { recursive: true });
      await Deno.remove(externalDir, { recursive: true });
    }
  });

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
      assertStringIncludes(message, "--yes");
      assertEquals(await exists(join(tempDir, "app", "page.tsx")), false);
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
      assertStringIncludes(message, "--yes");
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

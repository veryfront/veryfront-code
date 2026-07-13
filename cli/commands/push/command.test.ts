import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for push command
 * @module cli/commands/push.test
 */

import {
  assertEquals,
  assertExists,
  assertMatch,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  capturePushSourceSnapshot,
  createBranch,
  ensureBranch,
  generateBranchName,
  pushCommand,
  recordPushReceipt,
  resolvePushRemoteFiles,
  uploadFiles,
  type UploadOp,
} from "./command.ts";
import { type ApiClient, resolveConfig } from "#cli/shared/config";
import {
  createDefaultIgnoreChecker,
  createIgnoreChecker,
  loadIgnorePatterns,
} from "../../sync/ignore.ts";
import { readPushReceipt, writePushReceipt } from "../../shared/deployment-provenance.ts";

type MockClientOverrides = Partial<{
  get: (path: string, params?: Record<string, string>) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
  put: (path: string, body?: unknown) => Promise<unknown>;
}>;

function createMockClient(overrides: MockClientOverrides = {}): ApiClient {
  return {
    get: async <T>(path: string, params?: Record<string, string>): Promise<T> => {
      const result = await (overrides.get?.(path, params) ?? Promise.resolve({ data: [] }));
      return result as T;
    },
    post: async <T>(path: string, body?: unknown): Promise<T> => {
      const result = await (overrides.post?.(path, body) ?? Promise.resolve({}));
      return result as T;
    },
    put: async <T>(path: string, body?: unknown): Promise<T> => {
      const result = await (overrides.put?.(path, body) ?? Promise.resolve({}));
      return result as T;
    },
    patch: <T>(): Promise<T> => Promise.resolve({} as T),
    delete: <T>(): Promise<T> => Promise.resolve({} as T),
  };
}

interface GitProject {
  projectDir: string;
  runGit: (...args: string[]) => Promise<string>;
}

async function withGitProject(test: (project: GitProject) => Promise<void>): Promise<void> {
  const projectDir = await Deno.makeTempDir();
  const originalGithubSha = Deno.env.get("GITHUB_SHA");
  const runGit = async (...args: string[]): Promise<string> => {
    const result = await new Deno.Command("git", {
      args,
      cwd: projectDir,
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
  };

  try {
    Deno.env.delete("GITHUB_SHA");
    await runGit("init", "--quiet");
    await runGit("config", "user.email", "test@veryfront.com");
    await runGit("config", "user.name", "Veryfront Test");
    await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 1;\n");
    await runGit("add", ".");
    await runGit("commit", "--quiet", "-m", "initial");
    await test({ projectDir, runGit });
  } finally {
    if (originalGithubSha === undefined) Deno.env.delete("GITHUB_SHA");
    else Deno.env.set("GITHUB_SHA", originalGithubSha);
    await Deno.remove(projectDir, { recursive: true });
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) Deno.env.delete(key);
  else Deno.env.set(key, value);
}

describe("generateBranchName", () => {
  it("should generate a branch name with push- prefix", () => {
    const name = generateBranchName();
    assertMatch(name, /^push-/);
  });

  it("should generate a branch name with timestamp", () => {
    const name = generateBranchName();
    assertMatch(name, /^push-\d{8}T\d{6}$/);
  });

  it("should generate unique names on successive calls", () => {
    const name1 = generateBranchName();
    const name2 = generateBranchName();
    assertMatch(name1, /^push-\d{8}T\d{6}$/);
    assertMatch(name2, /^push-\d{8}T\d{6}$/);
  });
});

describe("createBranch", () => {
  it("should call POST with correct URL and body", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (url: string, body?: unknown) => {
        capturedUrl = url;
        capturedBody = body;
        return Promise.resolve({
          id: "branch-123",
          name: "feature-x",
          projectId: "proj-456",
        });
      },
    });

    const result = await createBranch(mockClient, "my-project", "feature-x");

    assertEquals(capturedUrl, "/projects/my-project/branches");
    assertEquals(capturedBody, { name: "feature-x" });
    assertEquals(result.id, "branch-123");
    assertEquals(result.name, "feature-x");
  });

  it("should handle branch names with special characters", async () => {
    let capturedBody: unknown = null;

    const mockClient = createMockClient({
      post: (_url: string, body?: unknown) => {
        capturedBody = body;
        return Promise.resolve({
          id: "branch-123",
          name: "feature/new-stuff",
          projectId: "proj-456",
        });
      },
    });

    await createBranch(mockClient, "my-project", "feature/new-stuff");

    assertEquals(capturedBody, { name: "feature/new-stuff" });
  });
});

describe("ensureBranch", () => {
  it("creates a branch when it does not already exist", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    const mockClient = createMockClient({
      post: (url: string, body?: unknown) => {
        requests.push({ method: "POST", url, body });
        return Promise.resolve({
          id: "branch-created",
          name: "feature-x",
          projectId: "proj-456",
        });
      },
    });

    const result = await ensureBranch(mockClient, "my-project", "feature-x");

    assertEquals(result.id, "branch-created");
    assertEquals(result.name, "feature-x");
    assertEquals(requests, [
      {
        method: "POST",
        url: "/projects/my-project/branches",
        body: { name: "feature-x" },
      },
    ]);
  });

  it("returns an existing branch after a create conflict", async () => {
    const getRequests: Array<{ url: string; params?: Record<string, string> }> = [];
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const mockClient = createMockClient({
      post: () => Promise.reject(conflict),
      get: (url: string, params?: Record<string, string>) => {
        getRequests.push({ url, params });
        return Promise.resolve({
          data: [
            { id: "other-branch", name: "feature-x-old", project_id: "proj-456" },
            { id: "branch-existing", name: "feature-x", project_id: "proj-456" },
          ],
        });
      },
    });

    const result = await ensureBranch(mockClient, "my-project", "feature-x");

    assertEquals(result.id, "branch-existing");
    assertEquals(result.name, "feature-x");
    assertEquals(getRequests, [
      {
        url: "/projects/my-project/branches",
        params: { search: "feature-x", limit: "100" },
      },
    ]);
  });

  it("rethrows a create conflict when the existing branch cannot be found", async () => {
    const conflict = Object.assign(new Error("conflict"), { status: 409 });
    const mockClient = createMockClient({
      post: () => Promise.reject(conflict),
      get: () => Promise.resolve({ data: [] }),
    });

    const error = await assertRejects(
      () => ensureBranch(mockClient, "my-project", "feature-x"),
      Error,
      "conflict",
    );

    assertEquals((error as Error & { status?: number }).status, 409);
  });

  it("rethrows non-conflict create failures without branch lookup", async () => {
    let getCalls = 0;
    const serverError = Object.assign(new Error("server unavailable"), { status: 503 });
    const mockClient = createMockClient({
      post: () => Promise.reject(serverError),
      get: () => {
        getCalls++;
        return Promise.resolve({ data: [] });
      },
    });

    await assertRejects(
      () => ensureBranch(mockClient, "my-project", "feature-x"),
      Error,
      "server unavailable",
    );
    assertEquals(getCalls, 0);
  });
});

describe("resolvePushRemoteFiles", () => {
  it("uses main files when pushing to main", async () => {
    let getCalls = 0;
    const mockClient = createMockClient({
      get: () => {
        getCalls++;
        return Promise.resolve({ data: [] });
      },
    });
    const mainFiles = [{ path: "app/page.tsx" }];

    const result = await resolvePushRemoteFiles(mockClient, "my-project", "main", mainFiles);

    assertEquals(result.branchId, null);
    assertEquals(result.source, { type: "main" });
    assertEquals(result.remoteFiles, mainFiles);
    assertEquals(getCalls, 0);
  });

  it("uses main files when a named branch does not exist yet", async () => {
    const getRequests: Array<{ url: string; params?: Record<string, string> }> = [];
    const mockClient = createMockClient({
      get: (url: string, params?: Record<string, string>) => {
        getRequests.push({ url, params });
        return Promise.resolve({ data: [] });
      },
    });
    const mainFiles = [{ path: "app/page.tsx" }];

    const result = await resolvePushRemoteFiles(
      mockClient,
      "my-project",
      "feature-x",
      mainFiles,
    );

    assertEquals(result.branchId, null);
    assertEquals(result.source, { type: "main" });
    assertEquals(result.remoteFiles, mainFiles);
    assertEquals(getRequests, [
      {
        url: "/projects/my-project/branches",
        params: { search: "feature-x", limit: "100" },
      },
    ]);
  });

  it("uses branch files when the named branch already exists", async () => {
    const getRequests: Array<{ url: string; params?: Record<string, string> }> = [];
    const mockClient = createMockClient({
      get: (url: string, params?: Record<string, string>) => {
        getRequests.push({ url, params });
        if (url === "/projects/my-project/branches") {
          return Promise.resolve({
            data: [
              { id: "branch-existing", name: "feature-x", project_id: "proj-456" },
            ],
          });
        }
        return Promise.resolve({
          data: [
            { path: "app/page.tsx", size: 12, type: "file", created_at: "", updated_at: "" },
            { path: "stale.ts", size: 8, type: "file", created_at: "", updated_at: "" },
          ],
        });
      },
    });

    const result = await resolvePushRemoteFiles(
      mockClient,
      "my-project",
      "feature-x",
      [{ path: "app/page.tsx" }],
    );

    assertEquals(result.branchId, "branch-existing");
    assertEquals(result.source, { type: "branch", name: "feature-x" });
    assertEquals(result.remoteFiles.map((file) => file.path), ["app/page.tsx", "stale.ts"]);
    assertEquals(getRequests, [
      {
        url: "/projects/my-project/branches",
        params: { search: "feature-x", limit: "100" },
      },
      {
        url: "/projects/my-project/files?branch=feature-x",
        params: { limit: "100", sort_by: "updated_at", sort_order: "desc" },
      },
    ]);
  });
});

describe("push receipt source snapshot", () => {
  const config = {
    apiUrl: "https://api.veryfront.com",
    apiToken: "<TOKEN>",
    projectSlug: "my-project",
  };
  const client = createMockClient({
    get: () => Promise.resolve({ id: "project-123", slug: "my-project" }),
  });

  it("records the Git source captured with the uploaded files", async () => {
    await withGitProject(async ({ projectDir }) => {
      const ignoreChecker = createDefaultIgnoreChecker();
      const snapshot = await capturePushSourceSnapshot(projectDir, ignoreChecker);

      await recordPushReceipt(
        client,
        config,
        projectDir,
        "main",
        snapshot,
        ignoreChecker,
      );

      const receipt = await readPushReceipt(projectDir);
      assertExists(receipt);
      assertEquals(receipt.commitSha, snapshot.gitSource.commitSha);
      assertEquals(receipt.clean, snapshot.gitSource.clean);
      assertEquals(receipt.sourceDigest, snapshot.sourceDigest);
    });
  });

  it("clears the receipt when source bytes change without changing Git state", async () => {
    await withGitProject(async ({ projectDir }) => {
      const ignoreChecker = createDefaultIgnoreChecker();
      await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 2;\n");
      const snapshot = await capturePushSourceSnapshot(projectDir, ignoreChecker);
      assertEquals(snapshot.gitSource.clean, false);
      await recordPushReceipt(
        client,
        config,
        projectDir,
        "main",
        snapshot,
        ignoreChecker,
      );
      assertExists(await readPushReceipt(projectDir));

      await Deno.writeTextFile(`${projectDir}/app.ts`, "export const value = 3;\n");

      await assertRejects(
        () =>
          recordPushReceipt(
            client,
            config,
            projectDir,
            "main",
            snapshot,
            ignoreChecker,
          ),
        Error,
        "Local source changed during push",
      );
      assertEquals(await readPushReceipt(projectDir), null);
    });
  });

  it("rejects a later commit even when its source bytes are unchanged", async () => {
    await withGitProject(async ({ projectDir, runGit }) => {
      const ignoreChecker = createDefaultIgnoreChecker();
      const snapshot = await capturePushSourceSnapshot(projectDir, ignoreChecker);
      await runGit("commit", "--quiet", "--allow-empty", "-m", "advance HEAD");

      await assertRejects(
        () =>
          recordPushReceipt(
            client,
            config,
            projectDir,
            "main",
            snapshot,
            ignoreChecker,
          ),
        Error,
        "Local source changed during push",
      );
      assertEquals(await readPushReceipt(projectDir), null);
    });
  });

  it("rejects a clean tracked symlink whose target bytes are outside the commit", async () => {
    if (Deno.build.os === "windows") return;

    const externalDir = await Deno.makeTempDir();
    try {
      await withGitProject(async ({ projectDir, runGit }) => {
        const targetPath = `${externalDir}/outside.ts`;
        await Deno.writeTextFile(targetPath, "export const value = 1;\n");
        await Deno.symlink(targetPath, `${projectDir}/linked.ts`);
        await runGit("add", "linked.ts");
        await runGit("commit", "--quiet", "-m", "add linked source");

        await Deno.writeTextFile(targetPath, "export const value = 2;\n");
        assertEquals(await runGit("status", "--porcelain=v1"), "");

        await assertRejects(
          () => capturePushSourceSnapshot(projectDir, createDefaultIgnoreChecker()),
          Error,
          "Veryfront push does not support symbolic links",
        );
      });
    } finally {
      await Deno.remove(externalDir, { recursive: true });
    }
  });

  it("marks an uploaded Git-ignored source as unclean", async () => {
    await withGitProject(async ({ projectDir, runGit }) => {
      await Deno.writeTextFile(`${projectDir}/.gitignore`, "ignored.ts\n");
      await runGit("add", ".gitignore");
      await runGit("commit", "--quiet", "-m", "ignore generated source");
      await Deno.writeTextFile(`${projectDir}/ignored.ts`, "export const ignored = true;\n");
      assertEquals(await runGit("status", "--porcelain=v1", "--untracked-files=all"), "");

      const snapshot = await capturePushSourceSnapshot(
        projectDir,
        createDefaultIgnoreChecker(),
      );

      assertEquals(snapshot.files.some((file) => file.path === "ignored.ts"), true);
      assertEquals(snapshot.gitSource.clean, false);
    });
  });

  it("keeps a tracked .vfignore in the clean Git provenance", async () => {
    await withGitProject(async ({ projectDir, runGit }) => {
      await Deno.writeTextFile(`${projectDir}/.vfignore`, "generated.ts\n");
      await runGit("add", ".vfignore");
      await runGit("commit", "--quiet", "-m", "add Veryfront ignore rules");
      const checker = createIgnoreChecker(await loadIgnorePatterns(projectDir));

      const snapshot = await capturePushSourceSnapshot(projectDir, checker);

      assertEquals(snapshot.gitSource.clean, true);
    });
  });

  it("marks a Git-ignored .vfignore as unclean", async () => {
    await withGitProject(async ({ projectDir, runGit }) => {
      await Deno.writeTextFile(`${projectDir}/.gitignore`, ".vfignore\n");
      await runGit("add", ".gitignore");
      await runGit("commit", "--quiet", "-m", "ignore Veryfront rules");
      await Deno.writeTextFile(`${projectDir}/.vfignore`, "generated.ts\n");
      assertEquals(await runGit("status", "--porcelain=v1", "--untracked-files=all"), "");
      const checker = createIgnoreChecker(await loadIgnorePatterns(projectDir));

      const snapshot = await capturePushSourceSnapshot(projectDir, checker);

      assertEquals(snapshot.gitSource.clean, false);
    });
  });

  it("recognizes tracked source paths containing newlines", async () => {
    if (Deno.build.os === "windows") return;

    await withGitProject(async ({ projectDir, runGit }) => {
      const path = "line\nbreak.ts";
      await Deno.writeTextFile(`${projectDir}/${path}`, "export const tracked = true;\n");
      await runGit("add", path);
      await runGit("commit", "--quiet", "-m", "add unusual source path");

      const snapshot = await capturePushSourceSnapshot(
        projectDir,
        createDefaultIgnoreChecker(),
      );

      assertEquals(snapshot.files.some((file) => file.path === path), true);
      assertEquals(snapshot.gitSource.clean, true);
    });
  });

  it("persists a renamed inferred slug for later push and deploy commands", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = [
      "VERYFRONT_API_TOKEN",
      "VERYFRONT_API_URL",
      "VERYFRONT_API_BASE_URL",
      "VERYFRONT_PROJECT_SLUG",
      "TENANT_PROJECT_SLUG",
      "VERYFRONT_PROJECT_ID",
      "TENANT_PROJECT_ID",
    ];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    await withGitProject(async ({ projectDir }) => {
      let reservedSlug = "";
      let projectCreateRequests = 0;
      const uploaded = new Map<string, string>();

      try {
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.delete("VERYFRONT_API_BASE_URL");
        for (const key of envKeys.slice(3)) Deno.env.delete(key);
        await Deno.writeTextFile(
          `${projectDir}/package.json`,
          `${JSON.stringify({ name: "my-project" }, null, 2)}\n`,
        );
        _resetEnvironmentConfig();

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);

          if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
            return Response.json({ error: "not found" }, { status: 404 });
          }
          if (request.method === "POST" && url.pathname === "/projects") {
            projectCreateRequests++;
            const body = await request.json() as { slug: string };
            if (body.slug === "my-project") {
              return Response.json({ error: "slug taken" }, { status: 409 });
            }
            reservedSlug = body.slug;
            return Response.json({ id: "project-123" }, { status: 201 });
          }
          if (
            request.method === "GET" &&
            url.pathname === `/projects/${reservedSlug}/files`
          ) {
            return Response.json({ data: [], page_info: {} });
          }
          if (
            request.method === "PUT" &&
            url.pathname.startsWith(`/projects/${reservedSlug}/files/`)
          ) {
            const path = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
            const body = await request.json() as { content: string };
            uploaded.set(path, body.content);
            return Response.json({});
          }
          if (
            request.method === "GET" &&
            url.pathname === `/projects/${reservedSlug}`
          ) {
            return Response.json({ id: "project-123", slug: reservedSlug });
          }

          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await pushCommand({
          projectDir,
          branch: "main",
          force: true,
          quiet: true,
        });

        const config = JSON.parse(await Deno.readTextFile(`${projectDir}/veryfront.json`));
        assertEquals(config.projectSlug, reservedSlug);
        assertEquals((await resolveConfig(projectDir)).projectSlug, reservedSlug);

        await pushCommand({
          projectDir,
          branch: "main",
          force: true,
          quiet: true,
        });

        assertEquals(projectCreateRequests, 2);
        assertEquals([...uploaded.keys()].sort(), ["app.ts", "package.json", "veryfront.json"]);
        assertEquals(JSON.parse(uploaded.get("veryfront.json") ?? "{}").projectSlug, reservedSlug);
        assertEquals((await readPushReceipt(projectDir))?.projectSlug, reservedSlug);
      } finally {
        globalThis.fetch = originalFetch;
        envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
        _resetEnvironmentConfig();
      }
    });
  });

  it("does not reserve alternative projects for explicit slug sources", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));
    const requestedSlugs: string[] = [];

    try {
      Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
      Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
          return Response.json({ error: "not found" }, { status: 404 });
        }
        if (request.method === "POST" && url.pathname === "/projects") {
          requestedSlugs.push((await request.json() as { slug: string }).slug);
          return Response.json({ error: "taken" }, { status: 409 });
        }
        throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
      }) as typeof fetch;

      const scenarios: Array<{
        prepare: (projectDir: string) => Promise<void>;
        options?: { projectSlug: string };
        message: string;
      }> = [
        {
          prepare: () => {
            Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
            return Promise.resolve();
          },
          message: "Update or remove VERYFRONT_PROJECT_SLUG",
        },
        {
          prepare: async (projectDir) => {
            Deno.env.delete("VERYFRONT_PROJECT_SLUG");
            await Deno.writeTextFile(
              `${projectDir}/veryfront.config.ts`,
              'export default { projectSlug: "my-project" };\n',
            );
          },
          message: "Update projectSlug in veryfront.config.ts",
        },
        {
          prepare: () => {
            Deno.env.delete("VERYFRONT_PROJECT_SLUG");
            return Promise.resolve();
          },
          options: { projectSlug: "my-project" },
          message: "Use a different --project-slug value",
        },
      ];

      for (const scenario of scenarios) {
        await withGitProject(async ({ projectDir }) => {
          await scenario.prepare(projectDir);
          _resetEnvironmentConfig();
          await assertRejects(
            () =>
              pushCommand({
                projectDir,
                branch: "main",
                force: true,
                quiet: true,
                ...scenario.options,
              }),
            Error,
            scenario.message,
          );
        });
      }

      assertEquals(requestedSlugs, ["my-project", "my-project", "my-project"]);
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });
});

describe("uploadFiles", () => {
  it("should upload files to branch endpoint when branchId is provided", async () => {
    const capturedUrls: string[] = [];
    const capturedBodies: unknown[] = [];

    const mockClient = createMockClient({
      put: (url: string, body?: unknown) => {
        capturedUrls.push(url);
        capturedBodies.push(body);
        return Promise.resolve({});
      },
    });

    const ops: UploadOp[] = [
      { path: "pages/index.tsx", content: "export default function Home() {}" },
    ];

    const result = await uploadFiles(mockClient, "my-project", "branch-123", ops, false);

    assertEquals(capturedUrls.length, 1);
    assertEquals(
      capturedUrls[0],
      "/projects/my-project/files/pages%2Findex.tsx?branch_id=branch-123",
    );
    assertEquals(capturedBodies[0], { content: "export default function Home() {}" });
    assertEquals(result.uploaded, 1);
    assertEquals(result.failed, 0);
  });

  it("should upload files to main endpoint when branchId is null", async () => {
    const capturedUrls: string[] = [];

    const mockClient = createMockClient({
      put: (url: string) => {
        capturedUrls.push(url);
        return Promise.resolve({});
      },
    });

    const ops: UploadOp[] = [
      { path: "pages/index.tsx", content: "export default function Home() {}" },
    ];

    const result = await uploadFiles(mockClient, "my-project", null, ops, false);

    assertEquals(capturedUrls.length, 1);
    assertEquals(capturedUrls[0], "/projects/my-project/files/pages%2Findex.tsx");
    assertEquals(result.uploaded, 1);
    assertEquals(result.failed, 0);
  });

  it("should handle multiple files", async () => {
    const capturedUrls: string[] = [];

    const mockClient = createMockClient({
      put: (url: string) => {
        capturedUrls.push(url);
        return Promise.resolve({});
      },
    });

    const ops: UploadOp[] = [
      { path: "pages/index.tsx", content: "content1" },
      { path: "pages/about.tsx", content: "content2" },
      { path: "api/users.ts", content: "content3" },
    ];

    const result = await uploadFiles(mockClient, "my-project", "branch-123", ops, false);

    assertEquals(capturedUrls.length, 3);
    assertEquals(result.uploaded, 3);
    assertEquals(result.failed, 0);
  });

  it("should encode file paths with special characters", async () => {
    const capturedUrls: string[] = [];

    const mockClient = createMockClient({
      put: (url: string) => {
        capturedUrls.push(url);
        return Promise.resolve({});
      },
    });

    const ops: UploadOp[] = [
      { path: "pages/[id]/index.tsx", content: "content" },
    ];

    const result = await uploadFiles(mockClient, "my-project", null, ops, false);

    assertEquals(capturedUrls[0], "/projects/my-project/files/pages%2F%5Bid%5D%2Findex.tsx");
    assertEquals(result.uploaded, 1);
  });

  it("should handle dry run without making API calls", async () => {
    let putCalled = false;

    const mockClient = createMockClient({
      put: () => {
        putCalled = true;
        return Promise.resolve({});
      },
    });

    const ops: UploadOp[] = [
      { path: "pages/index.tsx", content: "content" },
      { path: "pages/about.tsx", content: "content2" },
    ];

    const result = await uploadFiles(mockClient, "my-project", "branch-123", ops, true);

    assertEquals(putCalled, false);
    assertEquals(result.uploaded, 2);
    assertEquals(result.failed, 0);
  });

  it("should count failed uploads correctly", async () => {
    let callCount = 0;

    const mockClient = createMockClient({
      put: () => {
        callCount++;
        if (callCount === 2) return Promise.reject(new Error("API error"));
        return Promise.resolve({});
      },
    });

    const ops: UploadOp[] = [
      { path: "pages/index.tsx", content: "content1" },
      { path: "pages/about.tsx", content: "content2" },
      { path: "pages/contact.tsx", content: "content3" },
    ];

    const result = await uploadFiles(mockClient, "my-project", "branch-123", ops, false);

    assertEquals(result.uploaded, 2);
    assertEquals(result.failed, 1);
  });

  it("should handle empty ops array", async () => {
    const mockClient = createMockClient({
      put: () => Promise.resolve({}),
    });

    const result = await uploadFiles(mockClient, "my-project", "branch-123", [], false);

    assertEquals(result.uploaded, 0);
    assertEquals(result.failed, 0);
  });
});

describe("push failure ordering", () => {
  it("does not delete remote files after an upload fails", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      await withGitProject(async ({ projectDir, runGit }) => {
        await Deno.writeTextFile(`${projectDir}/second.ts`, "export const second = true;\n");
        await runGit("add", "second.ts");
        await runGit("commit", "--quiet", "-m", "add second source file");
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
        _resetEnvironmentConfig();
        await writePushReceipt(projectDir, {
          controlPlane: "https://control.example.test",
          projectId: "project-old",
          projectSlug: "my-project",
          branch: "main",
          commitSha: await runGit("rev-parse", "HEAD"),
          sourceDigest: `sha256:${"0".repeat(64)}`,
          clean: true,
          pushedAt: new Date().toISOString(),
        });
        assertExists(await readPushReceipt(projectDir));

        const requests: string[] = [];
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          requests.push(`${request.method} ${url.pathname}`);

          if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
            return Response.json({
              data: [{
                path: "stale.ts",
                size: 8,
                type: "file",
                created_at: "",
                updated_at: "",
              }],
              page_info: {},
            });
          }
          if (request.method === "PUT" && url.pathname.endsWith("/files/app.ts")) {
            return Response.json({ error: "upload failed" }, { status: 500 });
          }
          if (request.method === "PUT" && url.pathname.endsWith("/files/second.ts")) {
            return Response.json({});
          }
          if (request.method === "DELETE") {
            return Response.json({});
          }
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await assertRejects(
          () =>
            pushCommand({
              projectDir,
              branch: "main",
              force: true,
              quiet: true,
            }),
          Error,
          "Remote files were not deleted",
        );

        assertEquals(requests.some((request) => request.startsWith("DELETE ")), false);
        assertEquals(await readPushReceipt(projectDir), null);
      });
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });
});

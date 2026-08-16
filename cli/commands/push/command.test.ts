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
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  buildPushUrls,
  capturePushSourceSnapshot,
  createBranch,
  createStagedPushOptions,
  deleteFiles,
  ensureBranch,
  generateBranchName,
  pushCommand,
  recordPushReceipt,
  resolvePushRemoteFiles,
  uploadFiles,
  type UploadOp,
} from "./command.ts";
import { type ApiClient, type ApiReadOptions, resolveConfig } from "#cli/shared/config";
import {
  createDefaultIgnoreChecker,
  createIgnoreChecker,
  loadIgnorePatterns,
} from "../../sync/ignore.ts";
import {
  computeSourceDigest,
  readPushReceipt,
  writePushReceipt,
} from "../../shared/deployment-provenance.ts";
import { setJsonMode } from "../../shared/json-output.ts";
import { readProjectLink, writeProjectLink } from "../../shared/project-link.ts";
import { stripAnsi } from "../../ui/ansi.ts";
import { computeContentDigest, writeSyncTarget } from "../../sync/state.ts";

type MockClientOverrides = Partial<{
  get: (path: string, params?: Record<string, string>) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
  put: (
    path: string,
    body?: unknown,
    options?: ApiReadOptions,
  ) => Promise<unknown>;
  delete: (path: string) => Promise<unknown>;
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
    put: async <T>(
      path: string,
      body?: unknown,
      options?: ApiReadOptions,
    ): Promise<T> => {
      const result = await (overrides.put?.(path, body, options) ?? Promise.resolve({}));
      return result as T;
    },
    patch: <T>(): Promise<T> => Promise.resolve({} as T),
    delete: async <T>(path: string): Promise<T> => {
      const result = await (overrides.delete?.(path) ?? Promise.resolve({}));
      return result as T;
    },
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

function captureConsoleLog(output: string[]): (...args: unknown[]) => void {
  return (...args: unknown[]) => output.push(args.map(String).join(" "));
}

async function assertMissingProjectDryRunDoesNotMutate(branch: string): Promise<void> {
  const originalFetch = globalThis.fetch;
  const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
  const savedEnv = envKeys.map((key) => Deno.env.get(key));

  try {
    await withGitProject(async ({ projectDir }) => {
      Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
      Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
      Deno.env.set("VERYFRONT_PROJECT_SLUG", "missing-project");
      _resetEnvironmentConfig();

      const requests: string[] = [];
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}`);

        if (
          request.method === "GET" &&
          (url.pathname === "/projects/missing-project" ||
            url.pathname === "/projects/missing-project/files")
        ) {
          return Response.json({ error: "not found" }, { status: 404 });
        }
        if (request.method === "POST" && url.pathname === "/projects") {
          return Response.json({ id: "project-created-by-dry-run" }, { status: 201 });
        }
        if (
          request.method === "GET" &&
          url.pathname === "/projects/missing-project/branches"
        ) {
          return Response.json({ data: [], page_info: {} });
        }

        throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
      }) as typeof fetch;

      await pushCommand({
        projectDir,
        branch,
        dryRun: true,
        quiet: true,
      });

      assertEquals(requests, ["GET /projects/missing-project"]);
      assertEquals(await readPushReceipt(projectDir), null);
    });
  } finally {
    globalThis.fetch = originalFetch;
    envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
    _resetEnvironmentConfig();
  }
}

describe("generateBranchName", () => {
  it("should generate a branch name with push- prefix", () => {
    assertMatch(generateBranchName(), /^push-/);
  });

  it("should generate a branch name with timestamp", () => {
    assertMatch(generateBranchName(), /^push-\d{8}t\d{6}-[0-9a-f]{6}$/);
  });

  it("should generate unique names on successive calls", () => {
    // Two pushes within the same second share a timestamp, so without the
    // random suffix the second upload would land in the first's staging branch.
    const name1 = generateBranchName();
    const name2 = generateBranchName();
    assertMatch(name1, /^push-\d{8}t\d{6}-[0-9a-f]{6}$/);
    assertMatch(name2, /^push-\d{8}t\d{6}-[0-9a-f]{6}$/);
    assertEquals(name1 === name2, false);
  });

  it("stays DNS-safe so preview URLs can be built from it", () => {
    const branch = generateBranchName();
    assertEquals(buildPushUrls("my-project", branch), {
      studio: `https://veryfront.com/projects/my-project?branch=${branch}`,
      preview: `https://my-project--${branch}.preview.veryfront.com`,
    });
  });

  it("never targets main", () => {
    assertEquals(generateBranchName() === "main", false);
  });
});

describe("createStagedPushOptions", () => {
  it("stages programmatic pushes on an isolation branch instead of main", () => {
    const options = createStagedPushOptions("my-project", "/tmp/project");

    assertEquals(options.projectSlug, "my-project");
    assertEquals(options.projectDir, "/tmp/project");
    assertEquals(options.force, true);
    assertEquals(options.quiet, true);
    assertMatch(options.branch ?? "", /^push-\d{8}t\d{6}-[0-9a-f]{6}$/);
  });

  it("never resolves to main, which pushCommand would overwrite in place", () => {
    assertEquals(createStagedPushOptions("my-project", "/tmp/project").branch === "main", false);
  });
});

describe("buildPushUrls", () => {
  it("uses the stable project preview for main", () => {
    assertEquals(buildPushUrls("my-project", "main"), {
      studio: "https://veryfront.com/projects/my-project?branch=main",
      preview: "https://my-project.preview.veryfront.com",
    });
  });

  it("uses the exact branch name in named preview URLs", () => {
    assertEquals(buildPushUrls("my-project", "feature-auth"), {
      studio: "https://veryfront.com/projects/my-project?branch=feature-auth",
      preview: "https://my-project--feature-auth.preview.veryfront.com",
    });
  });

  it("rejects branch names that cannot round-trip through preview DNS", () => {
    assertThrows(
      () => buildPushUrls("my-project", "Feature/auth"),
      Error,
      'Preview branch "Feature/auth" is not DNS-safe. Use "feature-auth" instead.',
    );
  });

  it("keeps suggested branch names DNS-safe after truncation", () => {
    const branch = `${"A".repeat(62)}-extra`;
    const suggestion = "a".repeat(62);

    assertThrows(
      () => buildPushUrls("my-project", branch),
      Error,
      `Preview branch "${branch}" is not DNS-safe. Use "${suggestion}" instead.`,
    );
  });

  it("rejects combined project and branch labels over the DNS limit", () => {
    assertThrows(
      () => buildPushUrls("p".repeat(40), "b".repeat(22)),
      Error,
      "Preview hostname is too long. Shorten the project slug or branch name.",
    );
  });
});

describe("push JSON output", () => {
  it("uses the canonical project slug for project-ID targets", async () => {
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    const envKeys = [
      "VERYFRONT_API_TOKEN",
      "VERYFRONT_API_URL",
      "VERYFRONT_PROJECT_SLUG",
      "TENANT_PROJECT_SLUG",
      "VERYFRONT_PROJECT_ID",
      "TENANT_PROJECT_ID",
    ];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
      Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("TENANT_PROJECT_SLUG");
      Deno.env.set("VERYFRONT_PROJECT_ID", "project-123");
      Deno.env.delete("TENANT_PROJECT_ID");
      _resetEnvironmentConfig();
      setJsonMode(true);

      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/projects/project-123/files") {
          return Response.json({ data: [], page_info: {} });
        }
        if (request.method === "GET" && url.pathname === "/projects/project-123") {
          return Response.json({ id: "project-123", slug: "canonical-slug" });
        }
        throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
      }) as typeof fetch;

      for (const dryRun of [true, false]) {
        const projectDir = await Deno.makeTempDir();
        const output: string[] = [];
        console.log = captureConsoleLog(output);
        try {
          await pushCommand({ projectDir, dryRun });

          const result = JSON.parse(output.at(-1)!);
          assertEquals(result.data.projectSlug, "canonical-slug");
          assertEquals(
            result.data.previewUrl,
            "https://canonical-slug.preview.veryfront.com",
          );
        } finally {
          await Deno.remove(projectDir, { recursive: true });
        }
      }

      setJsonMode(false);
      const projectDir = await Deno.makeTempDir();
      const output: string[] = [];
      console.log = captureConsoleLog(output);
      try {
        await pushCommand({ projectDir, dryRun: false });

        const humanOutput = output.map(stripAnsi);
        assertEquals(
          humanOutput.includes(
            "  Studio:  https://veryfront.com/projects/canonical-slug?branch=main",
          ),
          true,
        );
        assertEquals(
          humanOutput.includes(
            "  Preview: https://canonical-slug.preview.veryfront.com",
          ),
          true,
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    } finally {
      setJsonMode(false);
      console.log = originalLog;
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });

  it("keeps an up-to-date dry run on the dry-run schema", async () => {
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));
    const projectDir = await Deno.makeTempDir();
    const output: string[] = [];

    try {
      Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
      Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
      Deno.env.set("VERYFRONT_PROJECT_SLUG", "json-project");
      _resetEnvironmentConfig();
      setJsonMode(true);
      console.log = captureConsoleLog(output);

      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/projects/json-project") {
          return Response.json({ id: "proj_json", slug: "json-project" });
        }
        if (request.method === "GET" && url.pathname === "/projects/json-project/files") {
          return Response.json({ data: [], page_info: {} });
        }
        throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
      }) as typeof fetch;

      await pushCommand({ projectDir, dryRun: true });

      assertEquals(output.length, 1);
      assertEquals(JSON.parse(output[0]!), {
        type: "result",
        success: true,
        data: {
          projectSlug: "json-project",
          branch: "main",
          dryRun: true,
          projectExists: true,
          wouldUpload: 0,
          wouldDelete: 0,
          studioUrl: "https://veryfront.com/projects/json-project?branch=main",
          previewUrl: "https://json-project.preview.veryfront.com",
        },
      });
    } finally {
      setJsonMode(false);
      console.log = originalLog;
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("emits one result line and no human output for a dry run", async () => {
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));
    const output: string[] = [];

    try {
      await withGitProject(async ({ projectDir }) => {
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "json-project");
        _resetEnvironmentConfig();
        setJsonMode(true);
        console.log = captureConsoleLog(output);

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          if (request.method === "GET" && url.pathname === "/projects/json-project") {
            return Response.json({ id: "proj_json", slug: "json-project" });
          }
          if (request.method === "GET" && url.pathname === "/projects/json-project/files") {
            return Response.json({ data: [], page_info: {} });
          }
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await pushCommand({ projectDir, dryRun: true });
      });

      assertEquals(output.length, 1);
      assertEquals(JSON.parse(output[0]!), {
        type: "result",
        success: true,
        data: {
          projectSlug: "json-project",
          branch: "main",
          dryRun: true,
          projectExists: true,
          wouldUpload: 1,
          wouldDelete: 0,
          studioUrl: "https://veryfront.com/projects/json-project?branch=main",
          previewUrl: "https://json-project.preview.veryfront.com",
        },
      });
    } finally {
      setJsonMode(false);
      console.log = originalLog;
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });

  it("emits one result line and no human output after a successful push", async () => {
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));
    const output: string[] = [];

    try {
      await withGitProject(async ({ projectDir }) => {
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "json-project");
        _resetEnvironmentConfig();
        setJsonMode(true);
        console.log = captureConsoleLog(output);

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          if (request.method === "GET" && url.pathname === "/projects/json-project") {
            return Response.json({ id: "proj_json", slug: "json-project" });
          }
          if (request.method === "GET" && url.pathname === "/projects/json-project/files") {
            return Response.json({ data: [], page_info: {} });
          }
          if (
            request.method === "PUT" &&
            url.pathname === "/projects/json-project/files/app.ts"
          ) {
            return Response.json({});
          }
          if (request.method === "GET" && url.pathname === "/projects/json-project") {
            return Response.json({ id: "project-123", slug: "json-project" });
          }
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await pushCommand({ projectDir });
      });

      assertEquals(output.length, 1);
      const result = JSON.parse(output[0]!);
      assertEquals(result.type, "result");
      assertEquals(result.success, true);
      assertEquals(result.data.projectSlug, "json-project");
      assertEquals(result.data.branch, "main");
      assertEquals(result.data.dryRun, false);
      assertEquals(result.data.uploaded, 1);
      assertEquals(result.data.deleted, 0);
      assertEquals(result.data.previewUrl, "https://json-project.preview.veryfront.com");
    } finally {
      setJsonMode(false);
      console.log = originalLog;
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });

  it("reports no dry-run deletions unless prune is requested", async () => {
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      await withGitProject(async ({ projectDir }) => {
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "json-project");
        _resetEnvironmentConfig();
        setJsonMode(true);

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          if (request.method === "GET" && url.pathname === "/projects/json-project") {
            return Response.json({ id: "proj_json", slug: "json-project" });
          }
          if (request.method === "GET" && url.pathname === "/projects/json-project/files") {
            return Response.json({
              data: [
                {
                  path: "remote-only.ts",
                  content: "remote\n",
                  size: 8,
                  type: "file",
                  created_at: "",
                  updated_at: "",
                },
              ],
              page_info: {},
            });
          }
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        const withoutPruneOutput: string[] = [];
        console.log = captureConsoleLog(withoutPruneOutput);
        await pushCommand({ projectDir, dryRun: true });
        assertEquals(JSON.parse(withoutPruneOutput[0]!).data.wouldDelete, 0);

        const withPruneOutput: string[] = [];
        console.log = captureConsoleLog(withPruneOutput);
        await pushCommand({ projectDir, dryRun: true, prune: true, force: true });
        assertEquals(JSON.parse(withPruneOutput[0]!).data.wouldDelete, 1);
      });
    } finally {
      setJsonMode(false);
      console.log = originalLog;
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
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
    assertEquals(result.created, true);
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
    assertEquals(result.created, false);
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
    assertEquals(result.branchExists, true);
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
    assertEquals(result.branchExists, false);
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
    assertEquals(result.branchExists, true);
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

  it("persists a renamed inferred project link for later push and deploy commands", async () => {
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
      const requests: string[] = [];
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
          requests.push(`${request.method} ${url.pathname}`);

          if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
            return Response.json({ error: "not found" }, { status: 404 });
          }
          if (request.method === "GET" && url.pathname === "/projects/project-123/files") {
            return Response.json({
              data: [...uploaded].map(([path, content], index) => ({
                path,
                content,
                version_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
              })),
              page_info: {},
            });
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
            (url.pathname.startsWith(`/projects/${reservedSlug}/files/`) ||
              url.pathname.startsWith("/projects/project-123/files/"))
          ) {
            const path = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
            const body = await request.json() as { content: string };
            uploaded.set(path, body.content);
            return Response.json({});
          }
          if (
            request.method === "GET" &&
            (url.pathname === `/projects/${reservedSlug}` ||
              url.pathname === "/projects/project-123")
          ) {
            return Response.json({ id: "project-123", slug: reservedSlug });
          }

          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await pushCommand({ projectDir, quiet: true });

        const link = await readProjectLink(projectDir);
        assertEquals(link?.projectId, "project-123");
        assertEquals(link?.projectSlug, reservedSlug);
        assertEquals((await resolveConfig(projectDir)).projectId, "project-123");
        assertEquals((await resolveConfig(projectDir)).projectSlug, reservedSlug);
        await assertRejects(
          () => Deno.stat(`${projectDir}/veryfront.json`),
          Deno.errors.NotFound,
        );

        const projectCreateRequestsAfterFirstPush = projectCreateRequests;
        await pushCommand({ projectDir, quiet: true });

        assertEquals(projectCreateRequests, projectCreateRequestsAfterFirstPush);
        assertEquals(
          requests.filter((request) => request === "GET /projects/project-123/files").length > 0,
          true,
        );
        assertEquals([...uploaded.keys()].sort(), ["app.ts", "package.json"]);
        assertEquals((await readPushReceipt(projectDir))?.projectSlug, reservedSlug);
      } finally {
        globalThis.fetch = originalFetch;
        envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
        _resetEnvironmentConfig();
      }
    });
  });

  it("creates a new project instead of linking an inferred existing-project slug", async () => {
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
      const createSlugs: string[] = [];
      let reservedSlug = "";

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

          if (request.method === "POST" && url.pathname === "/projects") {
            const body = await request.json() as { slug: string };
            createSlugs.push(body.slug);
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
            (url.pathname.startsWith(`/projects/${reservedSlug}/files/`) ||
              url.pathname.startsWith("/projects/project-123/files/"))
          ) {
            return Response.json({ error: "upload failed" }, { status: 500 });
          }

          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await assertRejects(
          () => pushCommand({ projectDir, quiet: true }),
          Error,
          "failed",
        );

        assertEquals(createSlugs[0], "my-project");
        assertEquals(createSlugs.length, 2);
        assertEquals(/^my-project-[a-z0-9]{6}$/.test(reservedSlug), true);
        const link = await readProjectLink(projectDir);
        assertEquals(link?.projectId, "project-123");
        assertEquals(link?.projectSlug, reservedSlug);
        await assertRejects(
          () => Deno.stat(`${projectDir}/veryfront.json`),
          Deno.errors.NotFound,
        );
      } finally {
        globalThis.fetch = originalFetch;
        envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
        _resetEnvironmentConfig();
      }
    });
  });

  it("persists an accepted inferred slug before uploading project files", async () => {
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
            assertEquals((await request.json() as { slug: string }).slug, "my-project");
            return Response.json({ id: "project-123" }, { status: 201 });
          }
          if (
            request.method === "PUT" &&
            (url.pathname.startsWith("/projects/my-project/files/") ||
              url.pathname.startsWith("/projects/project-123/files/"))
          ) {
            const link = await readProjectLink(projectDir);
            assertEquals(link?.projectId, "project-123");
            assertEquals(link?.projectSlug, "my-project");
            await assertRejects(
              () => Deno.stat(`${projectDir}/veryfront.json`),
              Deno.errors.NotFound,
            );
            return Response.json({ error: "upload failed" }, { status: 500 });
          }

          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await assertRejects(
          () => pushCommand({ projectDir, quiet: true }),
          Error,
          "failed",
        );

        const link = await readProjectLink(projectDir);
        assertEquals(link?.projectId, "project-123");
        assertEquals(link?.projectSlug, "my-project");
        await assertRejects(
          () => Deno.stat(`${projectDir}/veryfront.json`),
          Deno.errors.NotFound,
        );
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
        if (
          request.method === "GET" &&
          (url.pathname === "/projects/my-project" ||
            url.pathname === "/projects/my-project/files")
        ) {
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
          message: "Use a different --project value",
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

  it("fails closed when an explicit project ID is missing", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = [
      "VERYFRONT_API_TOKEN",
      "VERYFRONT_API_URL",
      "VERYFRONT_PROJECT_SLUG",
      "TENANT_PROJECT_SLUG",
      "VERYFRONT_PROJECT_ID",
      "TENANT_PROJECT_ID",
    ];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));
    const requests: string[] = [];

    try {
      Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
      Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.delete("TENANT_PROJECT_SLUG");
      Deno.env.set("VERYFRONT_PROJECT_ID", "missing-project-id");
      Deno.env.delete("TENANT_PROJECT_ID");
      _resetEnvironmentConfig();

      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}`);
        return Response.json({ error: "not found" }, { status: 404 });
      }) as typeof fetch;

      for (const dryRun of [true, false]) {
        await withGitProject(async ({ projectDir }) => {
          await assertRejects(
            () => pushCommand({ projectDir, dryRun, quiet: true }),
            Error,
            'Project "missing-project-id" was not found',
          );
        });
      }

      assertEquals(requests, [
        "GET /projects/missing-project-id",
        "GET /projects/missing-project-id",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });
});

describe("push dry-run project bootstrap", () => {
  it("does not create a missing project when targeting main", async () => {
    await assertMissingProjectDryRunDoesNotMutate("main");
  });

  it("does not create a missing project or branch when targeting a named branch", async () => {
    await assertMissingProjectDryRunDoesNotMutate("feature-x");
  });

  it("does not rewrite an existing local project link", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = [
      "VERYFRONT_API_TOKEN",
      "VERYFRONT_API_URL",
      "VERYFRONT_PROJECT_SLUG",
      "VERYFRONT_PROJECT_ID",
    ];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      await withGitProject(async ({ projectDir }) => {
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        for (const key of envKeys.slice(2)) Deno.env.delete(key);
        _resetEnvironmentConfig();

        await writeProjectLink(projectDir, {
          controlPlane: "https://control.example.test",
          projectId: "project-123",
          projectSlug: "stale-slug",
        });
        const linkPath = `${projectDir}/.veryfront/project.json`;
        const originalLink = await Deno.readTextFile(linkPath);

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);

          if (request.method === "GET" && url.pathname === "/projects/project-123/files") {
            return Response.json({ data: [], page_info: {} });
          }
          if (request.method === "GET" && url.pathname === "/projects/project-123") {
            return Response.json({ id: "project-123", slug: "canonical-slug" });
          }

          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await pushCommand({
          projectDir,
          dryRun: true,
          quiet: true,
        });

        assertEquals(await Deno.readTextFile(linkPath), originalLink);
      });
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });
});

describe("uploadFiles", () => {
  it("sends update and create preconditions", async () => {
    const capturedBodies: unknown[] = [];
    const capturedOptions: unknown[] = [];
    const mockClient = createMockClient({
      put: (_url: string, body?: unknown, options?: unknown) => {
        capturedBodies.push(body);
        capturedOptions.push(options);
        return Promise.resolve({});
      },
    });

    const result = await uploadFiles(
      mockClient,
      "my-project",
      null,
      [
        {
          path: "existing.ts",
          content: "updated",
          expectedVersionId: "version-current",
        },
        { path: "new.ts", content: "new", expectedAbsent: true },
      ],
      false,
    );

    assertEquals(capturedBodies, [
      { content: "updated", expected_version_id: "version-current" },
      { content: "new", expected_absent: true },
    ]);
    assertEquals(capturedOptions, [
      { retryPolicy: "none" },
      { retryPolicy: "none" },
    ]);
    assertEquals(result, { uploaded: 2, failed: 0, conflicts: [] });
  });

  it("should upload files to branch endpoint when branchId is provided", async () => {
    const capturedUrls: string[] = [];
    const capturedBodies: unknown[] = [];
    const capturedOptions: Array<ApiReadOptions | undefined> = [];

    const mockClient = createMockClient({
      put: (url: string, body?: unknown, options?: ApiReadOptions) => {
        capturedUrls.push(url);
        capturedBodies.push(body);
        capturedOptions.push(options);
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
    assertEquals(capturedOptions, [undefined]);
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

  it("reports a precondition conflict with its path", async () => {
    const conflict = Object.assign(new Error("File changed"), { status: 409 });
    const mockClient = createMockClient({
      put: () => Promise.reject(conflict),
    });

    const result = await uploadFiles(
      mockClient,
      "my-project",
      null,
      [{ path: "app.ts", content: "local", expectedVersionId: "version-current" }],
      false,
    );

    assertEquals(result, { uploaded: 0, failed: 0, conflicts: ["app.ts"] });
  });
});

describe("deleteFiles", () => {
  it("sends the observed version as a delete precondition", async () => {
    const urls: string[] = [];
    const mockClient = createMockClient({
      delete: (url: string) => {
        urls.push(url);
        return Promise.resolve({});
      },
    });

    const result = await deleteFiles(
      mockClient,
      "my-project",
      "00000000-0000-4000-8000-000000000010",
      [{ path: "old.ts", expectedVersionId: "00000000-0000-4000-8000-000000000020" }],
      false,
    );

    assertEquals(urls, [
      "/projects/my-project/files/old.ts?branch_id=00000000-0000-4000-8000-000000000010&expected_version_id=00000000-0000-4000-8000-000000000020",
    ]);
    assertEquals(result, { deleted: 1, failed: 0, conflicts: [] });
  });

  it("reports a precondition conflict with its path", async () => {
    const conflict = Object.assign(new Error("File changed"), { status: 409 });
    const mockClient = createMockClient({ delete: () => Promise.reject(conflict) });

    const result = await deleteFiles(
      mockClient,
      "my-project",
      null,
      [{ path: "old.ts", expectedVersionId: "version-current" }],
      false,
    );

    assertEquals(result, { deleted: 0, failed: 0, conflicts: ["old.ts"] });
  });
});

describe("push divergence guard", () => {
  it("validates corrupt sync state before creating a missing preview branch", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      await withGitProject(async ({ projectDir }) => {
        await Deno.mkdir(`${projectDir}/.veryfront`);
        await Deno.writeTextFile(`${projectDir}/.veryfront/sync-state.json`, "{invalid\n");
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
        _resetEnvironmentConfig();

        let remoteRequestCount = 0;
        globalThis.fetch = (() => {
          remoteRequestCount++;
          throw new Error("Push must validate local sync state before remote requests");
        }) as typeof fetch;

        const error = await assertRejects(
          () => pushCommand({ projectDir, branch: "feature-x", quiet: true }),
          Error,
          "could not read .veryfront/sync-state.json",
        );

        assertEquals((error as Error & { slug?: string }).slug, "sync-state-invalid");
        assertEquals(remoteRequestCount, 0);
      });
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });

  it("creates a missing preview branch from main and safely uploads local changes", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      await withGitProject(async ({ projectDir }) => {
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
        _resetEnvironmentConfig();

        let branchCreated = false;
        const putRequests: Array<{ branchId: string | null; body: unknown }> = [];
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          if (request.method === "GET" && url.pathname === "/projects/my-project") {
            return Response.json({ id: "project-123", slug: "my-project" });
          }
          if (request.method === "GET" && url.pathname === "/projects/my-project/branches") {
            return Response.json({
              data: branchCreated
                ? [{ id: "branch-123", name: "feature-x", project_id: "project-123" }]
                : [],
            });
          }
          if (request.method === "POST" && url.pathname === "/projects/my-project/branches") {
            branchCreated = true;
            return Response.json({
              id: "branch-123",
              name: "feature-x",
              projectId: "project-123",
            });
          }
          if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
            return Response.json({
              data: [{
                path: "app.ts",
                content: "export const value = 0;\n",
                version_id: "00000000-0000-4000-8000-000000000010",
              }],
              page_info: {},
            });
          }
          if (request.method === "PUT" && url.pathname.endsWith("/files/app.ts")) {
            putRequests.push({
              branchId: url.searchParams.get("branch_id"),
              body: await request.json(),
            });
            return Response.json({});
          }
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await pushCommand({ projectDir, branch: "feature-x", quiet: true });

        assertEquals(branchCreated, true);
        assertEquals(putRequests, [{
          branchId: "branch-123",
          body: {
            content: "export const value = 1;\n",
            expected_version_id: "00000000-0000-4000-8000-000000000010",
          },
        }]);
      });
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });

  it("creates a missing preview branch even when it already matches local source", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      await withGitProject(async ({ projectDir }) => {
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
        _resetEnvironmentConfig();

        let branchCreateCalls = 0;
        let putCalled = false;
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          if (request.method === "GET" && url.pathname === "/projects/my-project") {
            return Response.json({ id: "project-123", slug: "my-project" });
          }
          if (request.method === "GET" && url.pathname === "/projects/my-project/branches") {
            return Response.json({ data: [] });
          }
          if (request.method === "POST" && url.pathname === "/projects/my-project/branches") {
            branchCreateCalls++;
            return Response.json({
              id: "branch-123",
              name: "feature-x",
              projectId: "project-123",
            });
          }
          if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
            return Response.json({
              data: [{
                path: "app.ts",
                content: "export const value = 1;\n",
                version_id: "00000000-0000-4000-8000-000000000010",
              }],
              page_info: {},
            });
          }
          if (request.method === "PUT") {
            putCalled = true;
            return Response.json({});
          }
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await pushCommand({ projectDir, branch: "feature-x", quiet: true });

        assertEquals(branchCreateCalls, 1);
        assertEquals(putCalled, false);
      });
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });

  it("rejects a raced preview branch that changed before creation", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      await withGitProject(async ({ projectDir }) => {
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
        _resetEnvironmentConfig();

        let createAttempted = false;
        let putCalled = false;
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          if (request.method === "GET" && url.pathname === "/projects/my-project") {
            return Response.json({ id: "project-123", slug: "my-project" });
          }
          if (request.method === "GET" && url.pathname === "/projects/my-project/branches") {
            return Response.json({
              data: createAttempted
                ? [{ id: "branch-123", name: "feature-x", project_id: "project-123" }]
                : [],
            });
          }
          if (request.method === "POST" && url.pathname === "/projects/my-project/branches") {
            createAttempted = true;
            return Response.json({ error: "already exists" }, { status: 409 });
          }
          if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
            const branchContent = url.searchParams.get("branch") === "feature-x";
            return Response.json({
              data: [{
                path: "app.ts",
                content: branchContent
                  ? "export const value = 'studio';\n"
                  : "export const value = 0;\n",
                version_id: branchContent
                  ? "00000000-0000-4000-8000-000000000011"
                  : "00000000-0000-4000-8000-000000000010",
              }],
              page_info: {},
            });
          }
          if (request.method === "PUT") {
            putCalled = true;
            return Response.json({});
          }
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await assertRejects(
          () => pushCommand({ projectDir, branch: "feature-x", quiet: true }),
          Error,
          "Push rejected",
        );

        assertEquals(createAttempted, true);
        assertEquals(putCalled, false);
      });
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });

  it("rejects a Studio edit made after the local baseline without sending a PUT", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      await withGitProject(async ({ projectDir }) => {
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
        _resetEnvironmentConfig();
        await writeSyncTarget(projectDir, {
          controlPlane: "https://control.example.test",
          projectId: "project-123",
          projectSlug: "my-project",
          branch: "main",
          files: {
            "app.ts": { digest: await computeContentDigest("export const value = 0;\n") },
          },
        });

        let putCalled = false;
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          if (request.method === "GET" && url.pathname === "/projects/my-project") {
            return Response.json({ id: "project-123", slug: "my-project" });
          }
          if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
            return Response.json({
              data: [{
                path: "app.ts",
                content: "export const value = 'studio';\n",
                version_id: "00000000-0000-4000-8000-000000000010",
              }],
              page_info: {},
            });
          }
          if (request.method === "PUT") {
            putCalled = true;
            return Response.json({});
          }
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        const error = await assertRejects(
          () => pushCommand({ projectDir, quiet: true }),
          Error,
          "Push rejected",
        );
        if (!(error instanceof Error)) throw new Error("Expected push to reject with an Error");
        assertEquals((error as Error & { slug?: string }).slug, "push-conflict");
        assertStringIncludes(error.message, '"app.ts"');
        assertStringIncludes(error.message, "veryfront push --force");
        assertEquals(putCalled, false);
      });
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });

  it("lets --force intentionally overwrite without a precondition", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      await withGitProject(async ({ projectDir }) => {
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
        _resetEnvironmentConfig();

        const putBodies: unknown[] = [];
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          if (request.method === "GET" && url.pathname === "/projects/my-project") {
            return Response.json({ id: "project-123", slug: "my-project" });
          }
          if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
            return Response.json({
              data: [{
                path: "app.ts",
                content: "export const value = 'studio';\n",
                version_id: "00000000-0000-4000-8000-000000000010",
              }],
              page_info: {},
            });
          }
          if (request.method === "PUT") {
            putBodies.push(await request.json());
            return Response.json({});
          }
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await pushCommand({ projectDir, force: true, quiet: true });

        assertEquals(putBodies, [{ content: "export const value = 1;\n" }]);
      });
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
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

          if (request.method === "GET" && url.pathname === "/projects/my-project") {
            return Response.json({ id: "project-old", slug: "my-project" });
          }
          if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
            return Response.json({
              data: [{
                path: "stale.ts",
                content: "stale",
                version_id: "00000000-0000-4000-8000-000000000099",
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
              prune: true,
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

describe("push deletion ownership", () => {
  it("preserves remote-only files unless prune is requested", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      await withGitProject(async ({ projectDir }) => {
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
        _resetEnvironmentConfig();

        const requests: string[] = [];
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          requests.push(`${request.method} ${url.pathname}`);

          if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
            return Response.json({
              data: [{ path: "remote-only.ts", content: "remote\n" }],
              page_info: {},
            });
          }
          if (request.method === "GET" && url.pathname === "/projects/my-project") {
            return Response.json({ id: "project-123", slug: "my-project" });
          }
          if (request.method === "PUT") return Response.json({});
          if (request.method === "DELETE") return Response.json({});
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await pushCommand({ projectDir, branch: "main", quiet: true });

        assertEquals(requests.some((request) => request.startsWith("DELETE ")), false);
        const receipt = await readPushReceipt(projectDir);
        assertExists(receipt);
        assertEquals(
          receipt.sourceDigest,
          await computeSourceDigest([
            { path: "app.ts", content: "export const value = 1;\n" },
            { path: "remote-only.ts", content: "remote\n" },
          ]),
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });

  it("does not delete remote files protected by .vfignore", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      await withGitProject(async ({ projectDir, runGit }) => {
        await Deno.writeTextFile(`${projectDir}/.vfignore`, "inbox/**\nsubmissions/**\n");
        await runGit("add", ".vfignore");
        await runGit("commit", "--quiet", "-m", "protect runtime files");
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
        _resetEnvironmentConfig();

        const deleted: string[] = [];
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);

          if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
            return Response.json({
              data: [
                { path: "app.ts", content: "stale app" },
                { path: "stale.ts", content: "stale source" },
                { path: "inbox/seen/runtime.json", content: '{"seen":true}\n' },
                { path: "submissions/submitted/runtime.md", content: "runtime\n" },
              ],
              page_info: {},
            });
          }
          if (request.method === "GET" && url.pathname === "/projects/my-project") {
            return Response.json({ id: "project-123", slug: "my-project" });
          }
          if (request.method === "PUT") return Response.json({});
          if (request.method === "DELETE") {
            deleted.push(decodeURIComponent(url.pathname.split("/files/")[1] ?? ""));
            return Response.json({});
          }
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await pushCommand({ projectDir, branch: "main", prune: true, force: true, quiet: true });

        assertEquals(deleted, ["stale.ts"]);
        const receipt = await readPushReceipt(projectDir);
        assertExists(receipt);
        assertEquals(
          receipt.sourceDigest,
          await computeSourceDigest([
            { path: "app.ts", content: "export const value = 1;\n" },
            { path: "inbox/seen/runtime.json", content: '{"seen":true}\n' },
            { path: "submissions/submitted/runtime.md", content: "runtime\n" },
          ]),
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });

  it("preserves unsupported remote files during prune", async () => {
    const originalFetch = globalThis.fetch;
    const envKeys = ["VERYFRONT_API_TOKEN", "VERYFRONT_API_URL", "VERYFRONT_PROJECT_SLUG"];
    const savedEnv = envKeys.map((key) => Deno.env.get(key));

    try {
      await withGitProject(async ({ projectDir }) => {
        Deno.env.set("VERYFRONT_API_TOKEN", "<TOKEN>");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test");
        Deno.env.set("VERYFRONT_PROJECT_SLUG", "my-project");
        _resetEnvironmentConfig();

        const deleted: string[] = [];
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);

          if (request.method === "GET" && url.pathname === "/projects/my-project/files") {
            return Response.json({
              data: [
                { path: "app.ts", content: "stale app" },
                { path: "stale.ts", content: "stale source" },
                { path: "assets/logo.png", content: "<PNG>" },
              ],
              page_info: {},
            });
          }
          if (request.method === "GET" && url.pathname === "/projects/my-project") {
            return Response.json({ id: "project-123", slug: "my-project" });
          }
          if (request.method === "PUT") return Response.json({});
          if (request.method === "DELETE") {
            deleted.push(decodeURIComponent(url.pathname.split("/files/")[1] ?? ""));
            return Response.json({});
          }
          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await pushCommand({ projectDir, branch: "main", prune: true, force: true, quiet: true });

        assertEquals(deleted, ["stale.ts"]);
        const receipt = await readPushReceipt(projectDir);
        assertExists(receipt);
        assertEquals(
          receipt.sourceDigest,
          await computeSourceDigest([
            { path: "app.ts", content: "export const value = 1;\n" },
            { path: "assets/logo.png", content: "<PNG>" },
          ]),
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
      envKeys.forEach((key, index) => restoreEnv(key, savedEnv[index]));
      _resetEnvironmentConfig();
    }
  });
});

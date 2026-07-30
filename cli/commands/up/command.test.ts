import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetEnvironmentConfig,
  createTestEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { join } from "veryfront/platform/path";
import { parseUpArgs, UpArgsSchema, upCommand } from "./index.ts";
import type { ParsedArgs } from "#cli/shared/types";
import { normalizeProjectSlug } from "#cli/shared/slug";
import { capitalizeSeparatedWords } from "veryfront/utils/case-utils";
import { resetInteractiveMode, setNonInteractive } from "../../shared/interactive.ts";
import { setJsonMode } from "../../shared/json-output.ts";

function createArgs(flags: Record<string, unknown> = {}): ParsedArgs {
  return { _: ["up"], ...flags };
}

function assertSuccess<T extends { success: boolean; data?: unknown }>(
  result: T,
): asserts result is T & { success: true; data: NonNullable<T["data"]> } {
  assertEquals(result.success, true);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Deno.env.delete(name);
    return;
  }
  Deno.env.set(name, value);
}

function readyReleaseAssetManifestResponse(projectId: string) {
  return {
    state: "ready",
    manifest_version: 1,
    manifest: {
      schemaVersion: 2,
      projectId,
      releaseId: "release-1",
      releaseVersion: 1,
      manifestVersion: 1,
      builderVersion: "test",
      sourceContentHash: "a".repeat(64),
      createdAt: "2026-07-30T00:00:00.000Z",
      assetBasePath: "/_vf/assets",
      modules: {},
      css: [],
      routes: {},
      dependencyMode: "source",
      dependencies: {},
    },
  };
}

class ExitSentinel extends Error {
  constructor(readonly code: number) {
    super(`exit(${code})`);
  }
}

async function captureExit(run: () => Promise<void>): Promise<number> {
  const originalExit = Deno.exit;
  // deno-lint-ignore no-explicit-any
  (Deno as any).exit = (code = 0) => {
    throw new ExitSentinel(code);
  };

  try {
    await run();
    throw new Error("Expected command to exit");
  } catch (error) {
    if (error instanceof ExitSentinel) return error.code;
    throw error;
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = originalExit;
  }
}

describe("Up Command", () => {
  describe("UpArgsSchema", () => {
    it("should have correct defaults", () => {
      const result = UpArgsSchema.parse({});
      assertEquals(result.force, false);
      assertEquals(result.dryRun, false);
    });

    it("should accept force option", () => {
      const result = UpArgsSchema.parse({ force: true });
      assertEquals(result.force, true);
    });

    it("should accept dryRun option", () => {
      const result = UpArgsSchema.parse({ dryRun: true });
      assertEquals(result.dryRun, true);
    });
  });

  describe("parseUpArgs", () => {
    it("should parse empty args with defaults", () => {
      const result = parseUpArgs(createArgs());
      assertSuccess(result);
      assertEquals(result.data.force, false);
      assertEquals(result.data.dryRun, false);
    });

    it("should parse --force flag", () => {
      const result = parseUpArgs(createArgs({ force: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse -f short flag", () => {
      const result = parseUpArgs(createArgs({ f: true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
    });

    it("should parse --dry-run flag", () => {
      const result = parseUpArgs(createArgs({ "dry-run": true }));
      assertSuccess(result);
      assertEquals(result.data.dryRun, true);
    });

    it("should parse multiple flags", () => {
      const result = parseUpArgs(createArgs({ force: true, "dry-run": true }));
      assertSuccess(result);
      assertEquals(result.data.force, true);
      assertEquals(result.data.dryRun, true);
    });
  });

  describe("upCommand", () => {
    it("exits nonzero after an unauthenticated JSON result", async () => {
      const originalConsoleLog = console.log;
      const tempDir = await Deno.makeTempDir();
      const output: string[] = [];

      try {
        setJsonMode(true);
        console.log = (message?: unknown) => output.push(String(message));
        const env = createTestEnvironmentConfig({
          apiToken: undefined,
          homeDir: tempDir,
          xdgConfigHome: tempDir,
        });

        const exitCode = await captureExit(() => upCommand({ projectDir: tempDir }, env));

        assertEquals(exitCode, 1);
        assertEquals(output.length, 1);
        assertEquals(JSON.parse(output[0]!), {
          type: "result",
          success: false,
          error: "Not authenticated. Set VERYFRONT_API_TOKEN or run veryfront login.",
          errorDetails: {
            code: "RUNTIME_ERROR",
            slug: "authentication-required",
            message: "Not authenticated. Set VERYFRONT_API_TOKEN or run veryfront login.",
          },
        });
      } finally {
        console.log = originalConsoleLog;
        setJsonMode(false);
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("exits nonzero after an empty-folder JSON result", async () => {
      const originalFetch = globalThis.fetch;
      const originalConsoleLog = console.log;
      const tempDir = await Deno.makeTempDir();
      const output: string[] = [];

      try {
        setJsonMode(true);
        console.log = (message?: unknown) => output.push(String(message));
        globalThis.fetch = (() =>
          Promise.resolve(
            Response.json({ id: "user-1", email: "dev@example.com" }),
          )) as typeof fetch;
        const env = createTestEnvironmentConfig({
          apiBaseUrl: "https://auth.example.test",
          apiToken: "session-token",
          homeDir: tempDir,
          xdgConfigHome: tempDir,
        });

        const exitCode = await captureExit(() => upCommand({ projectDir: tempDir }, env));

        assertEquals(exitCode, 1);
        assertEquals(output.length, 1);
        assertEquals(JSON.parse(output[0]!), {
          type: "result",
          success: false,
          error: "This folder is empty. Add project files or run veryfront init.",
          errorDetails: {
            code: "RUNTIME_ERROR",
            slug: "project-source-empty",
            message: "This folder is empty. Add project files or run veryfront init.",
          },
        });
      } finally {
        globalThis.fetch = originalFetch;
        console.log = originalConsoleLog;
        setJsonMode(false);
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("uses VERYFRONT_API_BASE_URL when creating a project", async () => {
      const originalFetch = globalThis.fetch;
      const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
      const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
      const tempDir = await Deno.makeTempDir();
      const expectedSlug = normalizeProjectSlug(tempDir.split(/[/\\]/).pop() ?? "");
      const requestedUrls: string[] = [];
      let projectCreateBody: unknown;
      const uploadedFiles = new Map<string, string>();
      let deploymentCreated = false;
      const output: string[] = [];
      const originalConsoleLog = console.log;

      try {
        console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));
        await Deno.writeTextFile(join(tempDir, "package.json"), "{}");
        Deno.env.set("VERYFRONT_API_TOKEN", "env-token");
        Deno.env.set("VERYFRONT_API_BASE_URL", "https://api.from-env.test");
        Deno.env.delete("VERYFRONT_API_URL");
        _resetEnvironmentConfig();

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = request.url;
          const method = request.method;
          requestedUrls.push(url);

          if (url.endsWith("/me")) {
            return Promise.resolve(
              new Response(JSON.stringify({ id: "user-1", email: "dev@example.com" }), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }

          if (url.endsWith("/projects") && method === "POST") {
            projectCreateBody = await request.clone().json();
            return Promise.resolve(
              new Response(JSON.stringify({ id: "project-1", slug: expectedSlug }), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }

          if (
            url.endsWith(`/projects/${expectedSlug}`) &&
            method === "GET"
          ) {
            return Promise.resolve(
              Response.json({ id: "project-1", slug: expectedSlug }),
            );
          }

          if (
            url.includes(`/projects/${expectedSlug}/files/`) &&
            method === "PUT"
          ) {
            const path = decodeURIComponent(new URL(url).pathname.split("/files/")[1] ?? "");
            const body = await request.clone().json() as { content: string };
            uploadedFiles.set(path, body.content);
            return Promise.resolve(Response.json({}));
          }

          if (url.endsWith("/branches") && method === "POST") {
            return Promise.resolve(
              new Response(
                JSON.stringify({ id: "branch-1", name: "main", projectId: "project-1" }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                },
              ),
            );
          }

          if (url.includes("/environments")) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  data: [{
                    id: "env-1",
                    name: "preview",
                    protected: false,
                    project_id: "project-1",
                    deployment: deploymentCreated
                      ? {
                        id: "deployment-1",
                        release: { id: "release-1", name: "Preview" },
                      }
                      : null,
                  }],
                  page_info: {},
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                },
              ),
            );
          }

          if (url.endsWith("/releases") && method === "POST") {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: "release-1",
                  name: "Preview",
                  version: "v1",
                  export_status: "complete",
                  build_status: "complete",
                  deploy_status: "pending",
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                },
              ),
            );
          }

          if (url.endsWith("/deployments") && method === "POST") {
            deploymentCreated = true;
            return Promise.resolve(
              new Response(
                JSON.stringify({ id: "deployment-1", release: "release-1", environment: "env-1" }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                },
              ),
            );
          }

          if (url.endsWith("/releases/release-1") && method === "GET") {
            return Promise.resolve(
              Response.json({
                id: "release-1",
                name: "Preview",
                version: "v1",
                project_id: "project-1",
                export_status: "complete",
                build_status: "complete",
                deploy_status: "pending",
              }),
            );
          }

          if (new URL(url).pathname.endsWith("/releases/release-1/versions")) {
            return Promise.resolve(
              Response.json({
                data: [...uploadedFiles].map(([path, content]) => ({
                  path,
                  data: JSON.stringify({ body: content, path }),
                })),
                page_info: {},
              }),
            );
          }

          if (url.endsWith("/releases/release-1/asset-manifest")) {
            return Promise.resolve(
              Response.json(readyReleaseAssetManifestResponse("project-1")),
            );
          }

          if (url.endsWith("/deployments/deployment-1")) {
            return Promise.resolve(
              Response.json({
                id: "deployment-1",
                release_id: "release-1",
                environment_id: "env-1",
              }),
            );
          }

          return Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }) as typeof fetch;

        setNonInteractive(true);
        await upCommand({ projectDir: tempDir, force: false, dryRun: false });

        assertEquals(
          requestedUrls.some((url) => url.startsWith("https://api.from-env.test/projects")),
          true,
        );
        assertEquals(
          requestedUrls.some((url) => url.startsWith("https://api.veryfront.com/projects")),
          false,
        );
        const expectedName = capitalizeSeparatedWords(expectedSlug, "-", " ");
        assertEquals(projectCreateBody, { slug: expectedSlug, name: expectedName });
        const humanOutput = output.join("\n");
        assertEquals(humanOutput.includes("Studio:"), true);
        assertEquals(humanOutput.includes("Preview:"), true);
        assertEquals(humanOutput.includes("Deploy:"), true);
      } finally {
        console.log = originalConsoleLog;
        globalThis.fetch = originalFetch;
        restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
        restoreEnv("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
        restoreEnv("VERYFRONT_API_URL", originalApiUrl);
        resetInteractiveMode();
        _resetEnvironmentConfig();
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("owns one JSON result while nested dry-run commands stay quiet", async () => {
      const originalFetch = globalThis.fetch;
      const originalConsoleLog = console.log;
      const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
      const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
      const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
      const tempDir = await Deno.makeTempDir();
      const output: string[] = [];

      try {
        await Deno.writeTextFile(join(tempDir, "package.json"), "{}");
        await Deno.writeTextFile(
          join(tempDir, "veryfront.json"),
          `${JSON.stringify({ projectSlug: "json-up" }, null, 2)}\n`,
        );
        Deno.env.set("VERYFRONT_API_TOKEN", "env-token");
        Deno.env.set("VERYFRONT_API_URL", "https://api.from-env.test");
        Deno.env.delete("VERYFRONT_API_BASE_URL");
        Deno.env.delete("VERYFRONT_PROJECT_SLUG");
        _resetEnvironmentConfig();
        setJsonMode(true);
        console.log = (message?: unknown) => output.push(String(message));

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);

          if (request.method === "GET" && url.pathname === "/me") {
            return Response.json({ id: "user-1", email: "dev@example.com" });
          }
          if (request.method === "GET" && url.pathname === "/projects/json-up/files") {
            return Response.json({ data: [], page_info: {} });
          }

          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        await upCommand({ projectDir: tempDir, dryRun: true });

        assertEquals(output.length, 1);
        assertEquals(JSON.parse(output[0]!), {
          type: "result",
          success: true,
          data: {
            projectSlug: "json-up",
            dryRun: true,
            plannedActions: ["push-source", "deploy-preview"],
          },
        });
      } finally {
        console.log = originalConsoleLog;
        setJsonMode(false);
        globalThis.fetch = originalFetch;
        restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
        restoreEnv("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
        restoreEnv("VERYFRONT_API_URL", originalApiUrl);
        restoreEnv("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
        _resetEnvironmentConfig();
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("uses a pulled local project link without creating veryfront.json", async () => {
      const originalFetch = globalThis.fetch;
      const originalConsoleLog = console.log;
      const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
      const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
      const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
      const tempDir = await Deno.makeTempDir();
      const output: string[] = [];
      const requested: Array<{ method: string; pathname: string }> = [];
      const uploadedFiles = new Map<string, string>();
      let projectPostCount = 0;
      let deploymentCreated = false;

      try {
        await Deno.mkdir(join(tempDir, ".veryfront"), { recursive: true });
        await Deno.writeTextFile(join(tempDir, "package.json"), "{}");
        await Deno.writeTextFile(
          join(tempDir, ".veryfront", "project.json"),
          `${
            JSON.stringify(
              {
                version: 1,
                controlPlane: "https://api.from-env.test",
                projectId: "project-linked",
                projectSlug: "pulled-up",
              },
              null,
              2,
            )
          }\n`,
        );
        Deno.env.set("VERYFRONT_API_TOKEN", "env-token");
        Deno.env.set("VERYFRONT_API_URL", "https://api.from-env.test");
        Deno.env.delete("VERYFRONT_API_BASE_URL");
        Deno.env.delete("VERYFRONT_PROJECT_SLUG");
        _resetEnvironmentConfig();
        console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));

        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = new URL(request.url);
          requested.push({ method: request.method, pathname: url.pathname });

          if (request.method === "GET" && url.pathname === "/me") {
            return Response.json({ id: "user-1", email: "dev@example.com" });
          }

          if (request.method === "POST" && url.pathname === "/projects") {
            projectPostCount++;
            return Response.json({ id: "unexpected-project", slug: "unexpected" });
          }

          if (request.method === "GET" && url.pathname === "/projects/project-linked") {
            return Response.json({ id: "project-linked", slug: "pulled-up" });
          }

          if (request.method === "GET" && url.pathname === "/projects/project-linked/files") {
            return Response.json({ data: [], page_info: {} });
          }

          if (
            request.method === "PUT" &&
            url.pathname.startsWith("/projects/project-linked/files/")
          ) {
            const path = decodeURIComponent(url.pathname.split("/files/")[1] ?? "");
            const body = await request.clone().json() as { content: string };
            uploadedFiles.set(path, body.content);
            return Response.json({});
          }

          if (request.method === "POST" && url.pathname === "/projects/project-linked/branches") {
            return Response.json({ id: "branch-1", name: "main", projectId: "project-linked" });
          }

          if (
            request.method === "GET" && url.pathname === "/projects/project-linked/environments"
          ) {
            return Response.json({
              data: [{
                id: "env-1",
                name: "preview",
                protected: false,
                project_id: "project-linked",
                deployment: deploymentCreated
                  ? { id: "deployment-1", release: { id: "release-1", name: "Preview" } }
                  : null,
              }],
              page_info: {},
            });
          }

          if (request.method === "POST" && url.pathname === "/projects/project-linked/releases") {
            return Response.json({
              id: "release-1",
              name: "Preview",
              version: "v1",
              export_status: "complete",
              build_status: "complete",
              deploy_status: "pending",
            });
          }

          if (
            request.method === "POST" && url.pathname === "/projects/project-linked/deployments"
          ) {
            deploymentCreated = true;
            return Response.json({
              id: "deployment-1",
              release: "release-1",
              environment: "env-1",
            });
          }

          if (
            request.method === "GET" &&
            [
              "/projects/project-linked/releases/release-1",
              "/projects/pulled-up/releases/release-1",
            ]
              .includes(url.pathname)
          ) {
            return Response.json({
              id: "release-1",
              name: "Preview",
              version: "v1",
              project_id: "project-linked",
              export_status: "complete",
              build_status: "complete",
              deploy_status: "pending",
            });
          }

          if (
            request.method === "GET" &&
            [
              "/projects/project-linked/releases/release-1/versions",
              "/projects/pulled-up/releases/release-1/versions",
            ].includes(url.pathname)
          ) {
            return Response.json({
              data: [...uploadedFiles].map(([path, content]) => ({
                path,
                data: JSON.stringify({ body: content, path }),
              })),
              page_info: {},
            });
          }

          if (
            request.method === "GET" &&
            [
              "/projects/project-linked/releases/release-1/asset-manifest",
              "/projects/pulled-up/releases/release-1/asset-manifest",
            ].includes(url.pathname)
          ) {
            return Response.json(readyReleaseAssetManifestResponse("project-linked"));
          }

          if (
            request.method === "GET" &&
            [
              "/projects/project-linked/deployments/deployment-1",
              "/projects/pulled-up/deployments/deployment-1",
            ].includes(url.pathname)
          ) {
            return Response.json({
              id: "deployment-1",
              release_id: "release-1",
              environment_id: "env-1",
            });
          }

          throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
        }) as typeof fetch;

        setNonInteractive(true);
        await upCommand({ projectDir: tempDir, force: false, dryRun: false });

        assertEquals(projectPostCount, 0);
        assertEquals(
          requested.some((request) =>
            request.method === "GET" && request.pathname === "/projects/project-linked/files"
          ),
          true,
        );
        assertEquals(
          requested.some((request) =>
            request.method === "POST" && request.pathname === "/projects/project-linked/deployments"
          ),
          true,
        );

        let veryfrontJsonExists = true;
        try {
          await Deno.stat(join(tempDir, "veryfront.json"));
        } catch {
          veryfrontJsonExists = false;
        }
        assertEquals(veryfrontJsonExists, false);
        assertEquals(output.join("\n").includes("pulled-up"), true);
      } finally {
        console.log = originalConsoleLog;
        globalThis.fetch = originalFetch;
        restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
        restoreEnv("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
        restoreEnv("VERYFRONT_API_URL", originalApiUrl);
        restoreEnv("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
        resetInteractiveMode();
        _resetEnvironmentConfig();
        await Deno.remove(tempDir, { recursive: true });
      }
    });
  });
});

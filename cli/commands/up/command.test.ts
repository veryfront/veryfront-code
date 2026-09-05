import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
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
import { stripAnsi } from "../../ui/ansi.ts";
import { setLoggerPreset } from "#cli/logger-config";
import type {
  DeployEvent,
  DeployPlan,
  DeployProject,
  DeployProjectOutcome,
  DeployProjectRequest,
} from "../../shared/deployment/deploy-project.ts";
import type { DeployResult } from "../../shared/deployment/result.ts";

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

async function rejectExit(run: () => Promise<void>): Promise<void> {
  const originalExit = Deno.exit;
  // deno-lint-ignore no-explicit-any
  (Deno as any).exit = (code = 0) => {
    throw new ExitSentinel(code);
  };

  try {
    await run();
  } catch (error) {
    if (error instanceof ExitSentinel) {
      throw new Error(`Command exited unexpectedly with code ${error.code}`);
    }
    throw error;
  } finally {
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = originalExit;
  }
}

async function captureLog<T>(run: () => Promise<T>): Promise<{ result: T; output: string[] }> {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };
  try {
    return { result: await run(), output };
  } finally {
    console.log = originalLog;
  }
}

/**
 * Everything a human sees, in order, across both console streams.
 *
 * Spinner frames land on stderr and results on stdout, so a test that reads
 * only `console.log` cannot tell whether the run narrated something it never
 * did. The logger runs under the same "cli" preset `cli/main.ts` installs, so
 * a captured line is byte-for-byte the line a user reads.
 */
async function captureConsole<T>(
  run: () => Promise<T>,
): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const record = (...args: unknown[]) => {
    lines.push(stripAnsi(args.map(String).join(" ")));
  };
  console.log = record;
  console.error = record;
  setLoggerPreset("cli");
  try {
    return { result: await run(), lines };
  } finally {
    setLoggerPreset("server");
    console.log = originalLog;
    console.error = originalError;
  }
}

/** Deploy Execution recorded, never executed: what did `up` ask deploy to do? */
function recordingDeployProject(
  outcome: DeployProjectOutcome,
  events: DeployEvent[] = [],
): { deployProject: DeployProject; requests: DeployProjectRequest[] } {
  const requests: DeployProjectRequest[] = [];
  return {
    requests,
    deployProject: {
      async execute(request, observer) {
        requests.push(request);
        for (const event of events) await observer?.onEvent(event);
        return outcome;
      },
    },
  };
}

/**
 * A verified deployment whose URL shares no pattern with the preview hostname
 * `up` used to rebuild locally, so tests can tell the two apart.
 */
const VERIFIED_RESULT: DeployResult = {
  projectId: "project-verified",
  projectSlug: "verified-slug",
  release: { id: "release-1", name: "main", version: "2026.07.31-1" },
  environment: "preview",
  environmentId: "environment-1",
  deploymentId: "deployment-1",
  url: "https://verified.example.test/dashboard",
  urlVerification: "served",
  protected: false,
  routingConvergence: null,
  commitSha: "a".repeat(40),
  sourceDigest: "sha256:verified",
  controlPlane: "https://control.example.test/api",
  branch: "main",
};

const VERIFIED_OUTCOME: DeployProjectOutcome = { kind: "deployed", result: VERIFIED_RESULT };

function dryRunOutcome(overrides: Partial<DeployPlan> = {}): DeployProjectOutcome {
  return {
    kind: "dry-run",
    plan: {
      branch: "main",
      projectId: "project-verified",
      projectSlug: "verified-slug",
      environment: "preview",
      environmentId: "environment-1",
      controlPlane: "https://control.example.test/api",
      plannedActions: ["push-source", "create-release", "deploy"],
      ...overrides,
    },
  };
}

function identityResponse(): Response {
  return Response.json({ id: "user-1", email: "dev@example.com" });
}

/**
 * Fetch stub for the cases whose only legitimate call is the auth check.
 *
 * Everything else rejects: with Deploy Execution injected, up should reach the
 * network for nothing but `GET /me`, and a stub that answers anything would
 * hide the day up starts calling the control plane again.
 */
function authCheckOnlyFetch(): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/me") {
      return Promise.resolve(identityResponse());
    }
    throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
  }) as typeof fetch;
}

async function createLinkedProjectDir(): Promise<string> {
  const projectDir = await Deno.makeTempDir();
  await Deno.writeTextFile(join(projectDir, "package.json"), "{}");
  await Deno.writeTextFile(
    join(projectDir, "veryfront.json"),
    `${JSON.stringify({ projectSlug: "linked-up" }, null, 2)}\n`,
  );
  return projectDir;
}

function authenticatedEnv(homeDir: string) {
  return createTestEnvironmentConfig({
    apiBaseUrl: "https://auth.example.test",
    apiToken: "session-token",
    homeDir,
    xdgConfigHome: homeDir,
  });
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
    it("authenticates from the explicit project directory", async () => {
      const projectDir = await Deno.makeTempDir();
      const authHome = await Deno.makeTempDir();
      const { deployProject, requests } = recordingDeployProject(VERIFIED_OUTCOME);
      let requestedUrl = "";
      let requestedAuth = "";

      try {
        setNonInteractive(true);
        await Deno.writeTextFile(join(projectDir, "package.json"), "{}\n");
        await Deno.writeTextFile(
          join(projectDir, "veryfront.json"),
          `${
            JSON.stringify(
              {
                projectSlug: "target-project",
                apiToken: "target-config-token",
                apiUrl: "https://target-control.example.test/api",
              },
              null,
              2,
            )
          }\n`,
        );
        const env = createTestEnvironmentConfig({
          apiToken: undefined,
          homeDir: authHome,
          xdgConfigHome: authHome,
        });

        await withMockFetch(
          ((input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            requestedUrl = request.url;
            requestedAuth = request.headers.get("Authorization") ?? "";
            return Promise.resolve(identityResponse());
          }) as typeof fetch,
          () => rejectExit(() => upCommand({ projectDir }, env, { deployProject })),
        );

        assertEquals(requestedUrl, "https://target-control.example.test/api/me");
        assertEquals(requestedAuth, "Bearer target-config-token");
        assertEquals(requests.length, 1);
        assertEquals(requests[0]?.projectDir, projectDir);
      } finally {
        resetInteractiveMode();
        await Deno.remove(projectDir, { recursive: true });
        await Deno.remove(authHome, { recursive: true });
      }
    });

    it("exits nonzero after an unauthenticated JSON result", async () => {
      const tempDir = await Deno.makeTempDir();

      try {
        setJsonMode(true);
        const env = createTestEnvironmentConfig({
          apiToken: undefined,
          homeDir: tempDir,
          xdgConfigHome: tempDir,
        });

        const { result: exitCode, output } = await captureLog(() =>
          captureExit(() => upCommand({ projectDir: tempDir }, env))
        );

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
        setJsonMode(false);
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("exits nonzero after an empty-folder JSON result", async () => {
      const tempDir = await Deno.makeTempDir();
      const { deployProject, requests } = recordingDeployProject(VERIFIED_OUTCOME);

      try {
        setJsonMode(true);
        const env = authenticatedEnv(tempDir);

        const { result: exitCode, output } = await captureLog(() =>
          withMockFetch(
            authCheckOnlyFetch(),
            () => captureExit(() => upCommand({ projectDir: tempDir }, env, { deployProject })),
          )
        );

        assertEquals(exitCode, 1);
        assertEquals(requests, []);
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
        setJsonMode(false);
        await Deno.remove(tempDir, { recursive: true });
      }
    });

    it("asks Deploy Execution for one verified preview of main", async () => {
      const projectDir = await createLinkedProjectDir();
      const { deployProject, requests } = recordingDeployProject(VERIFIED_OUTCOME);

      try {
        setNonInteractive(true);
        const { output } = await captureLog(() =>
          withMockFetch(
            authCheckOnlyFetch(),
            () => upCommand({ projectDir }, authenticatedEnv(projectDir), { deployProject }),
          )
        );

        assertEquals(requests, [{
          projectDir,
          branch: "main",
          environment: "preview",
          mode: "apply",
          source: { kind: "ensure-pushed", refreshStaleSource: true },
        }]);

        const lines = output.map(stripAnsi);
        assertEquals(lines.includes("  Preview: https://verified.example.test/dashboard"), true);
        assertEquals(
          lines.includes("  Studio:  https://veryfront.com/projects/verified-slug?branch=main"),
          true,
        );
        assertEquals(lines.includes("  Deploy:  veryfront deploy"), true);
        assertEquals(lines.includes("  ✓ verified-slug is ready"), true);
        // The printed preview URL is the deployment that was verified, never a
        // hostname rebuilt from the local slug.
        assertEquals(lines.some((line) => line.includes("preview.veryfront.com")), false);
      } finally {
        resetInteractiveMode();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("reports the verified deployment URL as the single JSON result", async () => {
      const projectDir = await createLinkedProjectDir();
      const { deployProject, requests } = recordingDeployProject(VERIFIED_OUTCOME);

      try {
        setJsonMode(true);
        setNonInteractive(true);
        const { output } = await captureLog(() =>
          withMockFetch(
            authCheckOnlyFetch(),
            () => upCommand({ projectDir }, authenticatedEnv(projectDir), { deployProject }),
          )
        );

        assertEquals(requests.length, 1);
        assertEquals(output.length, 1);
        assertEquals(JSON.parse(output[0]!), {
          type: "result",
          success: true,
          data: {
            projectSlug: "verified-slug",
            dryRun: false,
            studioUrl: "https://veryfront.com/projects/verified-slug?branch=main",
            previewUrl: VERIFIED_RESULT.url,
            nextCommand: "veryfront deploy",
          },
        });
      } finally {
        setJsonMode(false);
        resetInteractiveMode();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("owns one JSON result for a dry run planned by Deploy Execution", async () => {
      const projectDir = await createLinkedProjectDir();
      const { deployProject, requests } = recordingDeployProject(dryRunOutcome());

      try {
        setJsonMode(true);
        setNonInteractive(true);
        const { output } = await captureLog(() =>
          withMockFetch(
            authCheckOnlyFetch(),
            () =>
              upCommand({ projectDir, dryRun: true }, authenticatedEnv(projectDir), {
                deployProject,
              }),
          )
        );

        assertEquals(requests[0]?.mode, "dry-run");
        assertEquals(output.length, 1);
        assertEquals(JSON.parse(output[0]!), {
          type: "result",
          success: true,
          data: {
            projectSlug: "linked-up",
            dryRun: true,
            plannedActions: ["push-source", "deploy-preview"],
          },
        });
      } finally {
        setJsonMode(false);
        resetInteractiveMode();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("tells a human what the dry run would do, and never renders an empty status line", async () => {
      const projectDir = await createLinkedProjectDir();
      const { deployProject } = recordingDeployProject(dryRunOutcome(), [
        { kind: "step", step: "resolve-config", phase: "started" },
        // A dry run reaches the environment lookup, whose non-verbose progress
        // text is "Building release..." — a build no dry run performs.
        { kind: "step", step: "resolve-target", phase: "started" },
      ]);

      try {
        setNonInteractive(true);
        const { lines } = await captureConsole(() =>
          withMockFetch(
            authCheckOnlyFetch(),
            () =>
              upCommand({ projectDir, dryRun: true }, authenticatedEnv(projectDir), {
                deployProject,
              }),
          )
        );

        // A status glyph with no message is a rendered line that says nothing.
        assertEquals(lines.some((line) => line.trim() === "●"), false);
        assertEquals(lines.some((line) => line.includes("Building release")), false);
        // The name comes from the plan ("verified-slug"), not from the local
        // link ("linked-up"): a project renamed after linking still resolves by
        // id, and the apply would target the plan's slug.
        assertEquals(
          lines.includes(
            '  › Would push source to "main", create release, and deploy to "preview" for project verified-slug',
          ),
          true,
        );
        assertEquals(lines.includes("  ✓ Dry run complete"), true);
      } finally {
        resetInteractiveMode();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("names the project a human dry run would create", async () => {
      const projectDir = await Deno.makeTempDir();
      const expectedSlug = normalizeProjectSlug(projectDir.split(/[/\\]/).pop() ?? "");
      const { deployProject } = recordingDeployProject(
        dryRunOutcome({
          projectId: null,
          // No project exists yet, so the plan carries the slug it would create.
          projectSlug: expectedSlug,
          environmentId: null,
          plannedActions: ["create-project", "push-source", "create-release", "deploy"],
        }),
      );

      try {
        await Deno.writeTextFile(join(projectDir, "package.json"), "{}");
        setNonInteractive(true);
        const { lines } = await captureConsole(() =>
          withMockFetch(
            authCheckOnlyFetch(),
            () =>
              upCommand({ projectDir, dryRun: true }, authenticatedEnv(projectDir), {
                deployProject,
              }),
          )
        );

        assertEquals(lines.some((line) => line.trim() === "●"), false);
        assertEquals(
          lines.includes(
            `  › Would create the project, push source to "main", create release, and deploy to "preview" for project ${expectedSlug}`,
          ),
          true,
        );
      } finally {
        resetInteractiveMode();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("reports a planned project creation from the dry-run plan", async () => {
      const projectDir = await Deno.makeTempDir();
      const expectedSlug = normalizeProjectSlug(projectDir.split(/[/\\]/).pop() ?? "");
      const { deployProject } = recordingDeployProject(
        dryRunOutcome({
          projectId: null,
          environmentId: null,
          plannedActions: ["create-project", "push-source", "create-release", "deploy"],
        }),
      );

      try {
        await Deno.writeTextFile(join(projectDir, "package.json"), "{}");
        setJsonMode(true);
        setNonInteractive(true);
        const { output } = await captureLog(() =>
          withMockFetch(
            authCheckOnlyFetch(),
            () =>
              upCommand({ projectDir, dryRun: true }, authenticatedEnv(projectDir), {
                deployProject,
              }),
          )
        );

        assertEquals(output.length, 1);
        assertEquals(JSON.parse(output[0]!), {
          type: "result",
          success: true,
          data: {
            projectSlug: expectedSlug,
            dryRun: true,
            plannedActions: ["create-project", "push-source", "deploy-preview"],
          },
        });
      } finally {
        setJsonMode(false);
        resetInteractiveMode();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("creates the project against VERYFRONT_API_BASE_URL before deploying", async () => {
      const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
      const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
      const projectDir = await Deno.makeTempDir();
      const expectedSlug = normalizeProjectSlug(projectDir.split(/[/\\]/).pop() ?? "");
      const requestedUrls: string[] = [];
      let projectCreateBody: unknown;
      const { deployProject, requests } = recordingDeployProject(VERIFIED_OUTCOME);

      try {
        await Deno.writeTextFile(join(projectDir, "package.json"), "{}");
        Deno.env.set("VERYFRONT_API_TOKEN", "env-token");
        Deno.env.set("VERYFRONT_API_BASE_URL", "https://api.from-env.test");
        Deno.env.delete("VERYFRONT_API_URL");
        _resetEnvironmentConfig();
        setNonInteractive(true);

        await captureLog(() =>
          withMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = new URL(request.url);
            requestedUrls.push(request.url);

            if (url.pathname === "/me") return identityResponse();
            if (request.method === "POST" && url.pathname === "/projects") {
              projectCreateBody = await request.clone().json();
              return Response.json({ id: "project-1", slug: expectedSlug });
            }
            throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
          }, () =>
            upCommand({ projectDir, force: false, dryRun: false }, undefined, {
              deployProject,
            }))
        );

        assertEquals(
          requestedUrls.some((url) => url.startsWith("https://api.from-env.test/projects")),
          true,
        );
        assertEquals(
          requestedUrls.some((url) => url.startsWith("https://api.veryfront.com/projects")),
          false,
        );
        assertEquals(projectCreateBody, {
          slug: expectedSlug,
          name: capitalizeSeparatedWords(expectedSlug, "-", " "),
        });
        assertEquals(requests.length, 1);

        assertEquals(
          JSON.parse(await Deno.readTextFile(join(projectDir, ".veryfront", "project.json"))),
          {
            version: 1,
            controlPlane: "https://api.from-env.test",
            projectId: "project-1",
            projectSlug: expectedSlug,
          },
        );
        assertEquals(await exists(join(projectDir, "veryfront.json")), false);
      } finally {
        restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
        restoreEnv("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
        restoreEnv("VERYFRONT_API_URL", originalApiUrl);
        resetInteractiveMode();
        _resetEnvironmentConfig();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("deploys a pulled local project link without creating a project", async () => {
      const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const originalApiBaseUrl = Deno.env.get("VERYFRONT_API_BASE_URL");
      const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
      const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
      const projectDir = await Deno.makeTempDir();
      const projectPosts: string[] = [];
      const { deployProject, requests } = recordingDeployProject({
        kind: "deployed",
        result: { ...VERIFIED_RESULT, projectSlug: "pulled-up" },
      });

      try {
        await Deno.mkdir(join(projectDir, ".veryfront"), { recursive: true });
        await Deno.writeTextFile(join(projectDir, "package.json"), "{}");
        await Deno.writeTextFile(
          join(projectDir, ".veryfront", "project.json"),
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
        setNonInteractive(true);

        const { output } = await captureLog(() =>
          withMockFetch((input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = new URL(request.url);
            if (request.method === "POST" && url.pathname === "/projects") {
              projectPosts.push(request.url);
              return Promise.resolve(Response.json({ id: "unexpected", slug: "unexpected" }));
            }
            if (url.pathname === "/me") return Promise.resolve(identityResponse());
            throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
          }, () =>
            upCommand({ projectDir, force: false, dryRun: false }, undefined, {
              deployProject,
            }))
        );

        assertEquals(projectPosts, []);
        assertEquals(requests.length, 1);
        assertEquals(requests[0]?.source, { kind: "ensure-pushed", refreshStaleSource: true });
        assertEquals(await exists(join(projectDir, "veryfront.json")), false);
        assertEquals(output.map(stripAnsi).includes("  ✓ pulled-up is ready"), true);
      } finally {
        restoreEnv("VERYFRONT_API_TOKEN", originalApiToken);
        restoreEnv("VERYFRONT_API_BASE_URL", originalApiBaseUrl);
        restoreEnv("VERYFRONT_API_URL", originalApiUrl);
        restoreEnv("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
        resetInteractiveMode();
        _resetEnvironmentConfig();
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("reports a failed deployment as a preview deployment failure", async () => {
      const projectDir = await createLinkedProjectDir();
      const deployProject: DeployProject = {
        execute() {
          return Promise.reject(new Error("environment URL did not become ready"));
        },
      };

      try {
        setNonInteractive(true);
        let message = "";
        await captureLog(async () => {
          try {
            await withMockFetch(
              authCheckOnlyFetch(),
              () => upCommand({ projectDir }, authenticatedEnv(projectDir), { deployProject }),
            );
          } catch (error) {
            message = error instanceof Error ? error.message : String(error);
          }
        });

        assertEquals(
          message,
          "Preview deployment failed: environment URL did not become ready",
        );
      } finally {
        resetInteractiveMode();
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

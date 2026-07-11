import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP deploy tool
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { computeSourceDigest, writePushReceipt } from "../../shared/deployment-provenance.ts";
import { triggerDeploy, vfTriggerDeploy } from "./deploy-tool.ts";

// ---------------------------------------------------------------------------
// Tool definition (shape)
// ---------------------------------------------------------------------------

describe("mcp/tools/deploy-tool", () => {
  describe("vfTriggerDeploy tool definition", () => {
    it("has correct tool name", () => {
      assertEquals(vfTriggerDeploy.name, "vf_trigger_deploy");
    });

    it("has title", () => {
      assertEquals(vfTriggerDeploy.title, "Trigger Deploy");
    });

    it("has description mentioning deploy", () => {
      assertExists(vfTriggerDeploy.description);
      assertEquals(vfTriggerDeploy.description.includes("deploy"), true);
    });

    it("has description cross-referencing vf_build", () => {
      assertEquals(vfTriggerDeploy.description.includes("vf_build"), true);
    });

    it("has description cross-referencing vf_run_tests", () => {
      assertEquals(vfTriggerDeploy.description.includes("vf_run_tests"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfTriggerDeploy.execute, "function");
    });

    it("has correct annotations — not read-only, not destructive, not idempotent, open-world", () => {
      assertEquals(vfTriggerDeploy.annotations?.readOnlyHint, false);
      assertEquals(vfTriggerDeploy.annotations?.destructiveHint, false);
      assertEquals(vfTriggerDeploy.annotations?.idempotentHint, false);
      assertEquals(vfTriggerDeploy.annotations?.openWorldHint, true);
    });
  });

  // ---------------------------------------------------------------------------
  // Input schema validation
  // ---------------------------------------------------------------------------

  describe("input schema", () => {
    const schema = vfTriggerDeploy.inputSchema;

    it("requires projectSlug", () => {
      const result = schema.safeParse({});
      assertEquals(result.success, false);
    });

    it("accepts valid input with only projectSlug", () => {
      const result = schema.safeParse({ projectSlug: "my-app" });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.projectSlug, "my-app");
        assertEquals(result.data.environment, "production");
        assertEquals(result.data.branch, "main");
      }
    });

    it("applies default environment when not provided", () => {
      const result = schema.safeParse({ projectSlug: "my-app" });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.environment, "production");
      }
    });

    it("applies default branch when not provided", () => {
      const result = schema.safeParse({ projectSlug: "my-app" });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.branch, "main");
      }
    });

    it("accepts custom environment and branch", () => {
      const result = schema.safeParse({
        projectSlug: "my-app",
        environment: "staging",
        branch: "develop",
      });
      assertEquals(result.success, true);
      if (result.success) {
        assertEquals(result.data.environment, "staging");
        assertEquals(result.data.branch, "develop");
      }
    });

    it("rejects non-string projectSlug", () => {
      const result = schema.safeParse({ projectSlug: 123 });
      assertEquals(result.success, false);
    });

    it("rejects non-string environment", () => {
      const result = schema.safeParse({
        projectSlug: "my-app",
        environment: 42,
      });
      assertEquals(result.success, false);
    });

    it("rejects non-string branch", () => {
      const result = schema.safeParse({
        projectSlug: "my-app",
        branch: true,
      });
      assertEquals(result.success, false);
    });
  });

  // ---------------------------------------------------------------------------
  // Auth error handling
  // ---------------------------------------------------------------------------

  describe("triggerDeploy auth error", () => {
    it("returns structured error when VERYFRONT_API_TOKEN is not set", async () => {
      const originalToken = Deno.env.get("VERYFRONT_API_TOKEN");
      try {
        Deno.env.delete("VERYFRONT_API_TOKEN");

        const result = await triggerDeploy({
          projectSlug: "my-app",
          environment: "production",
          branch: "main",
        });

        assertEquals(result.success, false);
        assertEquals(
          result.error,
          "Not authenticated. Run 'veryfront login' first.",
        );
      } finally {
        if (originalToken !== undefined) {
          Deno.env.set("VERYFRONT_API_TOKEN", originalToken);
        } else {
          Deno.env.delete("VERYFRONT_API_TOKEN");
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Happy path with mock fetch
  // ---------------------------------------------------------------------------

  describe("triggerDeploy happy path", () => {
    it("creates release and deployment, returns structured result", async () => {
      const originalToken = Deno.env.get("VERYFRONT_API_TOKEN");
      const originalApiUrl = Deno.env.get("VERYFRONT_API_URL");
      const originalGithubSha = Deno.env.get("GITHUB_SHA");
      const projectDir = await Deno.makeTempDir();
      try {
        Deno.env.set("VERYFRONT_API_TOKEN", "test-token-abc");
        Deno.env.set("VERYFRONT_API_URL", "https://control.example.test/api");
        _resetEnvironmentConfig();

        const runGit = async (...args: string[]) => {
          const output = await new Deno.Command("git", {
            args,
            cwd: projectDir,
            clearEnv: true,
            env: Object.fromEntries(
              Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
            ),
            stdout: "null",
            stderr: "piped",
          }).output();
          assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
        };
        await runGit("init", "--quiet");
        await runGit("config", "user.email", "test@veryfront.com");
        await runGit("config", "user.name", "Veryfront Test");
        await runGit("commit", "--allow-empty", "--quiet", "-m", "initial");
        const commitSha = new TextDecoder().decode(
          (await new Deno.Command("git", {
            args: ["rev-parse", "HEAD"],
            cwd: projectDir,
            clearEnv: true,
            env: Object.fromEntries(
              Object.entries(Deno.env.toObject()).filter(([key]) => !key.startsWith("GIT_")),
            ),
            stdout: "piped",
          }).output()).stdout,
        ).trim();
        Deno.env.set("GITHUB_SHA", commitSha);
        const sourceDigest = await computeSourceDigest([]);
        await writePushReceipt(projectDir, {
          controlPlane: "https://control.example.test/api",
          projectId: "project-1",
          projectSlug: "my-app",
          branch: "main",
          commitSha,
          sourceDigest,
          clean: true,
        });

        const capturedRequests: { method: string; url: string }[] = [];
        let environmentReads = 0;
        let releaseFiles: Array<{ path: string; data: string }> = [];

        const handleRequest = async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const url = request.url;
          const pathname = new URL(url).pathname;
          const method = request.method;
          capturedRequests.push({ method, url });

          if (method === "GET" && pathname.endsWith("/projects/my-app")) {
            return Response.json({ id: "project-1", slug: "my-app" });
          }

          if (method === "GET" && url.includes("/environments")) {
            environmentReads++;
            return Response.json({
              data: [
                {
                  id: "env-1",
                  name: "production",
                  protected: true,
                  deployment: environmentReads === 1
                    ? null
                    : { id: "deploy-99", release: { id: "rel-42" } },
                },
              ],
            });
          }

          if (method === "POST" && url.includes("/releases")) {
            return Response.json({
              id: "rel-42",
              name: "Release 42",
              version: "v1.0.42",
              export_status: "completed",
              build_status: "completed",
              deploy_status: "pending",
            });
          }

          if (method === "POST" && url.includes("/deployments")) {
            return Response.json({
              id: "deploy-99",
              release: "rel-42",
              environment: "env-1",
            });
          }

          if (method === "GET" && pathname.endsWith("/deployments/deploy-99")) {
            return Response.json({
              id: "deploy-99",
              release: { id: "rel-42" },
              environment: { id: "env-1" },
            });
          }

          if (method === "GET" && pathname.endsWith("/releases/rel-42/versions")) {
            return Response.json({ data: releaseFiles, page_info: {} });
          }

          if (method === "GET" && pathname.endsWith("/releases/rel-42")) {
            return Response.json({
              id: "rel-42",
              name: "Release 42",
              version: "v1.0.42",
            });
          }

          return new Response("Not Found", { status: 404 });
        };
        const runDeploy = () =>
          triggerDeploy({
            projectSlug: "my-app",
            environment: "production",
            branch: "main",
          }, { projectDir });

        const result = await withMockFetch(handleRequest, runDeploy);

        assertEquals(result.success, true, result.error);
        assertEquals(result.deploymentId, "deploy-99");
        assertEquals(result.release, {
          id: "rel-42",
          name: "Release 42",
          version: "v1.0.42",
        });
        assertEquals(result.environment, {
          id: "env-1",
          name: "production",
        });
        assertEquals(result.project, { id: "project-1", slug: "my-app" });
        assertEquals(result.commitSha, commitSha);
        assertEquals(result.sourceDigest, sourceDigest);
        assertEquals(result.controlPlane, "https://control.example.test/api");

        // Verify correct API calls were made
        assertEquals(
          capturedRequests.map(({ method, url }) => `${method} ${new URL(url).pathname}`),
          [
            "GET /api/projects/my-app",
            "GET /api/projects/project-1/environments",
            "POST /api/projects/project-1/releases",
            "GET /api/projects/project-1/releases/rel-42",
            "GET /api/projects/project-1/releases/rel-42/versions",
            "POST /api/projects/project-1/deployments",
            "GET /api/projects/project-1/deployments/deploy-99",
            "GET /api/projects/project-1/environments",
          ],
        );

        releaseFiles = [{
          path: "app.ts",
          data: JSON.stringify({ body: "changed after push\n", path: "app.ts" }),
        }];
        capturedRequests.length = 0;
        environmentReads = 0;
        const mismatchResult = await withMockFetch(handleRequest, runDeploy);

        assertEquals(mismatchResult.success, false);
        assertEquals(mismatchResult.error?.includes("does not match pushed commit"), true);
        assertEquals(
          capturedRequests.map(({ method, url }) => `${method} ${new URL(url).pathname}`),
          [
            "GET /api/projects/my-app",
            "GET /api/projects/project-1/environments",
            "POST /api/projects/project-1/releases",
            "GET /api/projects/project-1/releases/rel-42",
            "GET /api/projects/project-1/releases/rel-42/versions",
          ],
        );
      } finally {
        if (originalToken !== undefined) {
          Deno.env.set("VERYFRONT_API_TOKEN", originalToken);
        } else {
          Deno.env.delete("VERYFRONT_API_TOKEN");
        }
        if (originalApiUrl !== undefined) Deno.env.set("VERYFRONT_API_URL", originalApiUrl);
        else Deno.env.delete("VERYFRONT_API_URL");
        if (originalGithubSha !== undefined) Deno.env.set("GITHUB_SHA", originalGithubSha);
        else Deno.env.delete("GITHUB_SHA");
        _resetEnvironmentConfig();
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Environment not found
  // ---------------------------------------------------------------------------

  describe("triggerDeploy environment not found", () => {
    it("returns structured error when environment does not exist", async () => {
      const originalToken = Deno.env.get("VERYFRONT_API_TOKEN");
      try {
        Deno.env.set("VERYFRONT_API_TOKEN", "test-token-abc");

        const result = await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);

            if (request.method === "GET" && request.url.endsWith("/projects/my-app")) {
              return Response.json({ id: "project-1", slug: "my-app" });
            }

            if (request.method === "GET" && request.url.includes("/environments")) {
              return Response.json({ data: [] });
            }

            return new Response("Not Found", { status: 404 });
          },
          async () =>
            await triggerDeploy({
              projectSlug: "my-app",
              environment: "nonexistent",
              branch: "main",
            }),
        );

        assertEquals(result.success, false);
        assertEquals(result.error, 'Environment "nonexistent" not found.');
      } finally {
        if (originalToken !== undefined) {
          Deno.env.set("VERYFRONT_API_TOKEN", originalToken);
        } else {
          Deno.env.delete("VERYFRONT_API_TOKEN");
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // API error handling
  // ---------------------------------------------------------------------------

  describe("triggerDeploy API error", () => {
    it("returns structured error on API failure", async () => {
      const originalToken = Deno.env.get("VERYFRONT_API_TOKEN");
      try {
        Deno.env.set("VERYFRONT_API_TOKEN", "test-token-abc");

        const result = await withMockFetch(
          async () =>
            Response.json(
              { error: "forbidden", message: "Access denied" },
              { status: 403 },
            ),
          async () =>
            await triggerDeploy({
              projectSlug: "my-app",
              environment: "production",
              branch: "main",
            }),
        );

        assertEquals(result.success, false);
        assertExists(result.error);
      } finally {
        if (originalToken !== undefined) {
          Deno.env.set("VERYFRONT_API_TOKEN", originalToken);
        } else {
          Deno.env.delete("VERYFRONT_API_TOKEN");
        }
      }
    });

    it("returns auth error on 401 response", async () => {
      const originalToken = Deno.env.get("VERYFRONT_API_TOKEN");
      try {
        Deno.env.set("VERYFRONT_API_TOKEN", "invalid-token");

        const result = await withMockFetch(
          async () =>
            Response.json(
              {
                error: "unauthorized",
                message: "API request failed: 401 Unauthorized",
              },
              { status: 401 },
            ),
          async () =>
            await triggerDeploy({
              projectSlug: "my-app",
              environment: "production",
              branch: "main",
            }),
        );

        assertEquals(result.success, false);
        assertEquals(
          result.error,
          "Not authenticated. Run 'veryfront login' first.",
        );
      } finally {
        if (originalToken !== undefined) {
          Deno.env.set("VERYFRONT_API_TOKEN", originalToken);
        } else {
          Deno.env.delete("VERYFRONT_API_TOKEN");
        }
      }
    });
  });
});

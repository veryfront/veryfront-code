import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP deploy tool
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
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
      try {
        Deno.env.set("VERYFRONT_API_TOKEN", "test-token-abc");

        const capturedRequests: { method: string; url: string }[] = [];

        const result = await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            const url = request.url;
            const method = request.method;
            capturedRequests.push({ method, url });

            // GET /projects/my-app/environments
            if (method === "GET" && url.includes("/environments")) {
              return Response.json({
                data: [
                  { id: "env-1", name: "production", protected: true },
                  { id: "env-2", name: "staging", protected: false },
                ],
              });
            }

            // POST /projects/my-app/releases
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

            // POST /projects/my-app/deployments
            if (method === "POST" && url.includes("/deployments")) {
              return Response.json({
                id: "deploy-99",
                release: "rel-42",
                environment: "env-1",
              });
            }

            return new Response("Not Found", { status: 404 });
          },
          async () =>
            await triggerDeploy({
              projectSlug: "my-app",
              environment: "production",
              branch: "main",
            }),
        );

        assertEquals(result.success, true);
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

        // Verify correct API calls were made
        assertEquals(capturedRequests.length, 3);
        assertEquals(capturedRequests[0].method, "GET");
        assertEquals(capturedRequests[0].url.includes("/environments"), true);
        assertEquals(capturedRequests[1].method, "POST");
        assertEquals(capturedRequests[1].url.includes("/releases"), true);
        assertEquals(capturedRequests[2].method, "POST");
        assertEquals(capturedRequests[2].url.includes("/deployments"), true);
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

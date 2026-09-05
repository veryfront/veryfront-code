import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP deploy tool
 */

import { assertEquals, assertExists, assertMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteHostSecret, setHostSecret } from "#cli/process-env";
import { triggerDeploy, vfTriggerDeploy } from "./deploy-tool.ts";
import { createDeployProject, type DeployProject } from "../../shared/deployment/deploy-project.ts";
import {
  createPushedProject,
  InMemoryDeployControlPlane,
  PROJECT_SLUG,
  withDeployEnv,
  withFetchStub,
} from "../../test-utils/deploy-test-support.ts";

function toolDeployProject(controlPlane: InMemoryDeployControlPlane): DeployProject {
  return createDeployProject({
    polling: {
      assetManifestPollIntervalMs: 1,
      assetManifestTimeoutMs: 100,
      environmentPollIntervalMs: 1,
      environmentTimeoutMs: 1_000,
    },
    controlPlaneFactory: () => controlPlane,
  });
}

function throwingDeployProject(error: unknown): DeployProject {
  return {
    execute() {
      return Promise.reject(error);
    },
  };
}

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
      const result = await withDeployEnv(
        () =>
          triggerDeploy({
            projectSlug: "my-app",
            environment: "production",
            branch: "main",
          }),
        { VERYFRONT_API_TOKEN: null },
      );

      assertEquals(result.success, false);
      if (result.success) throw new Error("unreachable");
      assertEquals(
        result.error,
        "Not authenticated. Run 'veryfront login' first.",
      );
    });

    it("passes the auth gate with a host-private stored login token", async () => {
      // A stored `veryfront login` token is registered host-privately instead
      // of being exported, so the environment snapshot never carries it. The
      // gate must still open and hand off to Deploy Execution.
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
      try {
        const result = await withDeployEnv(
          () =>
            triggerDeploy(
              { projectSlug: "my-app", environment: "production", branch: "main" },
              { deployProject: throwingDeployProject(new Error("deploy execution reached")) },
            ),
          { VERYFRONT_API_TOKEN: null },
        );

        assertEquals(result.success, false);
        if (result.success) throw new Error("unreachable");
        assertEquals(result.error, "deploy execution reached");
      } finally {
        deleteHostSecret("VERYFRONT_API_TOKEN");
      }
    });

    it("does not let a blank exported token shadow the stored login token", async () => {
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
      try {
        const result = await withDeployEnv(
          () =>
            triggerDeploy(
              { projectSlug: "my-app", environment: "production", branch: "main" },
              { deployProject: throwingDeployProject(new Error("deploy execution reached")) },
            ),
          { VERYFRONT_API_TOKEN: "   " },
        );

        assertEquals(result.success, false);
        if (result.success) throw new Error("unreachable");
        assertEquals(result.error, "deploy execution reached");
      } finally {
        deleteHostSecret("VERYFRONT_API_TOKEN");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Deploy Execution (real module over the fake control plane)
  // ---------------------------------------------------------------------------

  describe("triggerDeploy happy path", () => {
    it("returns deployment evidence with the live URL after a verified deploy", async () => {
      await withDeployEnv(async () => {
        const { projectDir } = await createPushedProject();
        const controlPlane = new InMemoryDeployControlPlane();
        let readinessProbes = 0;
        try {
          const result = await withFetchStub(
            () => {
              readinessProbes++;
              return new Response("ready");
            },
            () =>
              triggerDeploy(
                { projectSlug: PROJECT_SLUG, environment: "production", branch: "main" },
                { projectDir, deployProject: toolDeployProject(controlPlane) },
              ),
          );

          assertEquals(result.success, true, "verified deploy should succeed");
          if (!result.success) throw new Error("unreachable");
          assertEquals(result.deploymentId, "deployment-1", "deployment evidence returned");
          assertEquals(result.projectSlug, PROJECT_SLUG, "canonical project slug returned");
          assertEquals(result.release.id, "release-1", "release evidence returned");
          assertMatch(result.url, /^https:\/\//, "live URL returned");
          assertEquals(
            controlPlane.deploymentReadCount >= 1,
            true,
            "deployment verification must run before success",
          );
          assertEquals(
            readinessProbes >= 1,
            true,
            "environment readiness must be probed before success",
          );
        } finally {
          await Deno.remove(projectDir, { recursive: true });
        }
      });
    });

    it("targets the requested project slug instead of local configuration", async () => {
      await withDeployEnv(async () => {
        const { projectDir } = await createPushedProject();
        const controlPlane = new InMemoryDeployControlPlane();
        try {
          const result = await withFetchStub(
            () => new Response("ready"),
            () =>
              triggerDeploy(
                { projectSlug: "other-project", environment: "production", branch: "main" },
                { projectDir, deployProject: toolDeployProject(controlPlane) },
              ),
          );

          assertEquals(result.success, true, "request-scoped deploy should succeed");
          assertEquals(
            controlPlane.projectLookups[0],
            "other-project",
            "project lookup must use the tool input slug",
          );
        } finally {
          await Deno.remove(projectDir, { recursive: true });
        }
      });
    });
  });

  describe("triggerDeploy environment not found", () => {
    it("returns structured error when environment does not exist", async () => {
      await withDeployEnv(async () => {
        const { projectDir } = await createPushedProject();
        const controlPlane = new InMemoryDeployControlPlane();
        controlPlane.environment = null;
        try {
          const result = await withFetchStub(
            () => new Response("ready"),
            () =>
              triggerDeploy(
                { projectSlug: PROJECT_SLUG, environment: "missing", branch: "main" },
                { projectDir, deployProject: toolDeployProject(controlPlane) },
              ),
          );

          assertEquals(result.success, false, "missing environment must fail");
          if (result.success) throw new Error("unreachable");
          assertMatch(result.error, /[Ee]nvironment/, "failure reason surfaced");
        } finally {
          await Deno.remove(projectDir, { recursive: true });
        }
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Error mapping (tool envelope over Deploy Execution failures)
  // ---------------------------------------------------------------------------

  describe("triggerDeploy API error", () => {
    it("returns structured error on API failure", async () => {
      const result = await withDeployEnv(() =>
        triggerDeploy(
          { projectSlug: "my-app", environment: "production", branch: "main" },
          {
            deployProject: throwingDeployProject(
              Object.assign(new Error("Access denied"), { status: 403 }),
            ),
          },
        )
      );

      assertEquals(result.success, false);
      if (result.success) throw new Error("unreachable");
      assertExists(result.error);
    });

    it("returns auth error on 401 failures", async () => {
      const result = await withDeployEnv(() =>
        triggerDeploy(
          { projectSlug: "my-app", environment: "production", branch: "main" },
          {
            deployProject: throwingDeployProject(
              Object.assign(new Error("API request failed: 401 Unauthorized"), {
                status: 401,
              }),
            ),
          },
        )
      );

      assertEquals(result.success, false);
      if (result.success) throw new Error("unreachable");
      assertEquals(
        result.error,
        "Not authenticated. Run 'veryfront login' first.",
      );
    });

    it("does not treat 401 digits embedded in another error as an auth failure", async () => {
      const sourceError =
        "Release rel-42 source does not match pushed commit abc401def0000000000000000000000000000000";

      const result = await withDeployEnv(() =>
        triggerDeploy(
          { projectSlug: "my-app", environment: "production", branch: "main" },
          { deployProject: throwingDeployProject(new Error(sourceError)) },
        )
      );

      assertEquals(result.success, false);
      if (result.success) throw new Error("unreachable");
      assertEquals(result.error, sourceError);
    });
  });
});

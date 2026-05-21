import "#veryfront/schemas/_test-setup.ts";
import {
  getCurrentRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getFinalRunExitCode, getTenantFromEnv, runWithTenantContext } from "./shared.ts";

const ENV_KEYS = [
  "TENANT_PROJECT_SLUG",
  "TENANT_TOKEN",
  "TENANT_PROJECT_ID",
  "TENANT_PRODUCTION_MODE",
  "TENANT_RELEASE_ID",
  "TENANT_BRANCH_ID",
  "VERYFRONT_BRANCH_REF",
  "TENANT_ENVIRONMENT_NAME",
  "VERYFRONT_ENVIRONMENT_NAME",
] as const;

const savedEnv = new Map<string, string | undefined>();

function rememberEnv(): void {
  for (const key of ENV_KEYS) {
    if (!savedEnv.has(key)) {
      savedEnv.set(key, Deno.env.get(key));
    }
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  savedEnv.clear();
}

function createLogger() {
  return {
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
}

describe("workflow worker shared helpers", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("reads tenant context from env only when the required values are present", () => {
    rememberEnv();

    Deno.env.delete("TENANT_PROJECT_SLUG");
    Deno.env.delete("TENANT_TOKEN");
    assertEquals(getTenantFromEnv(), undefined);

    Deno.env.set("TENANT_PROJECT_SLUG", "acme");
    Deno.env.set("TENANT_TOKEN", "secret");
    Deno.env.set("TENANT_PROJECT_ID", "project-123");
    Deno.env.set("TENANT_PRODUCTION_MODE", "1");
    Deno.env.set("TENANT_RELEASE_ID", "release-1");
    Deno.env.set("TENANT_BRANCH_ID", "branch-123");

    assertEquals(getTenantFromEnv(), {
      projectSlug: "acme",
      token: "secret",
      projectId: "project-123",
      productionMode: true,
      releaseId: "release-1",
      branch: "branch-123",
    });
  });

  it("prefers the explicit Veryfront branch ref over the tenant branch id", () => {
    rememberEnv();

    Deno.env.set("TENANT_PROJECT_SLUG", "acme");
    Deno.env.set("TENANT_TOKEN", "secret");
    Deno.env.set("TENANT_BRANCH_ID", "branch-123");
    Deno.env.set("VERYFRONT_BRANCH_REF", "feature/ref");

    assertEquals(getTenantFromEnv()?.branch, "feature/ref");
  });

  it("restores branch context while executing workflow work", async () => {
    await runWithTenantContext(
      {
        projectSlug: "acme",
        token: "secret",
        projectId: "project-123",
        productionMode: false,
        releaseId: null,
        branch: "branch-123",
      },
      async () => {
        const context = getCurrentRequestContext();
        assertEquals(context?.branch, "branch-123");
      },
    );
  });

  it("maps waiting and unexpected statuses to success exit codes", () => {
    const logger = createLogger();
    const exitCodes = { SUCCESS: 0, WORKFLOW_FAILED: 1 };

    assertEquals(
      getFinalRunExitCode(logger, exitCodes, "run-1", { status: "waiting" } as never, false),
      0,
    );
    assertEquals(getFinalRunExitCode(logger, exitCodes, "run-1", null, false), 0);
  });

  it("maps failed runs to the failure exit code", () => {
    const logger = createLogger();
    const exitCodes = { SUCCESS: 0, WORKFLOW_FAILED: 1 };

    assertEquals(
      getFinalRunExitCode(logger, exitCodes, "run-1", { status: "failed" } as never, false),
      1,
    );
  });
});

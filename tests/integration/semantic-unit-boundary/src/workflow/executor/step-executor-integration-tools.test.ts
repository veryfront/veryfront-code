/**
 * Workflow tool steps that call integration tools.
 *
 * These cases set process environment and host secrets and install a
 * process-global fetch transport, so they belong in the semantic integration suite.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { deleteHostSecret, setHostSecret } from "#veryfront/platform/compat/process/env.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { runRemoteIntegrationTool } from "#veryfront/integrations/remote-tools.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { ToolExecutionContext } from "#veryfront/tool";
import { tool } from "#veryfront/tool/factory.ts";
import { step } from "#veryfront/workflow/dsl/step.ts";
import type { CapturedTenantContext, WorkflowContext } from "#veryfront/workflow/types.ts";
import { runWithWorkflowTenant, StepExecutor } from "#veryfront/workflow/executor/step-executor.ts";

function makeContext(): WorkflowContext {
  return { input: {} };
}

describe("StepExecutor integration tool calls", () => {
  const ENV_KEYS = [
    "PROXY_MODE",
    "VERYFRONT_API_BASE_URL",
    "VERYFRONT_API_URL",
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_KEY",
    "VERYFRONT_PROJECT_SLUG",
  ] as const;
  const originalEnv = new Map(ENV_KEYS.map((key) => [key, getEnv(key)]));

  function setIntegrationEnv(overrides: Record<string, string>): void {
    for (const key of ENV_KEYS) deleteEnv(key);
    for (const [key, value] of Object.entries(overrides)) setEnv(key, value);
    refreshEnvironmentConfig();
  }

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) deleteEnv(key);
      else setEnv(key, value);
    }
    refreshEnvironmentConfig();
  });

  /** A workflow step whose tool calls `salesforce__list_cases` with the step context. */
  function runListCasesStep(): Promise<{ success: boolean; output?: unknown; error?: string }> {
    const executor = new StepExecutor({});
    const node = step("list-cases", {
      tool: {
        id: "list-cases",
        description: "List Salesforce cases",
        execute: (_input: unknown, context: ToolExecutionContext) =>
          runRemoteIntegrationTool(
            "salesforce__list_cases",
            { q: "SELECT Id FROM Case LIMIT 3" },
            context,
          ),
        // deno-lint-ignore no-explicit-any
      } as any,
    });
    return executor.execute(node, makeContext());
  }

  it("authenticates a tenantless run with the environment token", async () => {
    setIntegrationEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let authorization: string | null = null;
    const result = await withMockFetch(async (input, init) => {
      authorization = new Request(input, init).headers.get("Authorization");
      return Response.json({
        content: [{ type: "text", text: '{"data":[{"Id":"500A"}]}' }],
        structuredContent: { data: [{ Id: "500A" }] },
      });
    }, runListCasesStep);

    assertEquals(authorization, "Bearer env-token");
    assertEquals(result.success, true);
    assertEquals(result.output, { data: [{ Id: "500A" }] });
  });

  it("authenticates a tenant run with the tenant token", async () => {
    setIntegrationEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });
    const tenant: CapturedTenantContext = {
      projectSlug: "tenant-project",
      token: "tenant-token",
      productionMode: false,
    };

    let authorization: string | null = null;
    let projectSlug: string | null = null;
    const result = await withMockFetch(async (input, init) => {
      const request = new Request(input, init);
      authorization = request.headers.get("Authorization");
      projectSlug = request.headers.get("x-veryfront-project-slug");
      return Response.json({ structuredContent: { data: [] } });
    }, () => runWithWorkflowTenant(tenant, runListCasesStep));

    assertEquals(authorization, "Bearer tenant-token");
    assertEquals(projectSlug, "tenant-project");
    assertEquals(result.success, true);
  });

  it("fails the step with the reason when the API refuses the call", async () => {
    setIntegrationEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const result = await withMockFetch(
      () =>
        Promise.resolve(Response.json({
          error: "authorization-denied",
          status: 403,
          message: "Insufficient permissions to use this integration tool",
        }, { status: 403 })),
      runListCasesStep,
    );

    assertEquals(result.success, false);
    assertEquals(
      result.error,
      "Salesforce refused list_cases for this workflow run: Insufficient permissions to use this integration tool",
    );
  });

  it("fails the step with the reason when the integration returns a tool error", async () => {
    setIntegrationEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const result = await withMockFetch(
      () =>
        Promise.resolve(Response.json({
          isError: true,
          content: [{ type: "text", text: "MALFORMED_QUERY: unexpected token" }],
        })),
      runListCasesStep,
    );

    assertEquals(result.success, false);
    assertEquals(
      result.error,
      "Salesforce refused list_cases for this workflow run: MALFORMED_QUERY: unexpected token",
    );
  });

  it("fails the step when no API token is available", async () => {
    setIntegrationEnv({ VERYFRONT_API_BASE_URL: "https://api.test" });

    let fetchCalls = 0;
    const result = await withMockFetch(() => {
      fetchCalls++;
      return Promise.resolve(Response.json({}));
    }, runListCasesStep);

    assertEquals(fetchCalls, 0);
    assertEquals(result.success, false);
    assertEquals(
      result.error,
      "Salesforce list_cases did not run for this workflow run: no Veryfront API token. Set VERYFRONT_API_TOKEN or run `veryfront login`.",
    );
  });

  it("authenticates a tenantless run with the stored login token", async () => {
    setIntegrationEnv({});
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    let authorization: string | null = null;
    try {
      const result = await withMockFetch((input, init) => {
        authorization = new Request(input, init).headers.get("Authorization");
        return Promise.resolve(Response.json({ content: [], structuredContent: { data: [] } }));
      }, runListCasesStep);

      assertEquals(result.success, true);
      assertEquals(result.output, { data: [] });
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
    }
    assertEquals(authorization, "Bearer stored-login-token");
  });

  it("does not fall back to the environment token when the tenant token is unusable", async () => {
    setIntegrationEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });
    const tenant: CapturedTenantContext = {
      projectSlug: "tenant-project",
      token: "",
      productionMode: false,
    };

    let fetchCalls = 0;
    const result = await withMockFetch(() => {
      fetchCalls++;
      return Promise.resolve(Response.json({}));
    }, () => runWithWorkflowTenant(tenant, runListCasesStep));

    assertEquals(fetchCalls, 0, "a tenant run must never borrow the host environment token");
    assertEquals(result.success, false);
    assertEquals(
      result.error,
      "Salesforce list_cases did not run for this workflow run: no Veryfront API token. Set VERYFRONT_API_TOKEN or run `veryfront login`.",
    );
  });

  it("runs an integration call from a tool() factory step", async () => {
    setIntegrationEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });
    const listCases = tool({
      id: "list-cases",
      description: "List Salesforce cases",
      inputSchema: defineSchema((v) => v.object({ limit: v.number() }))(),
      execute: ({ limit }, context) =>
        runRemoteIntegrationTool(
          "salesforce__list_cases",
          { q: `SELECT Id FROM Case LIMIT ${limit}` },
          context,
        ),
    });
    const node = step("list-cases", {
      tool: listCases,
      input: { limit: 3 },
    });

    let authorization: string | null = null;
    const ok = await withMockFetch((input, init) => {
      authorization = new Request(input, init).headers.get("Authorization");
      return Promise.resolve(
        Response.json({ content: [], structuredContent: { data: [{ Id: "500A" }] } }),
      );
    }, () => new StepExecutor({}).execute(node, makeContext()));

    assertEquals(authorization, "Bearer env-token");
    assertEquals(ok.success, true);
    assertEquals(ok.output, { data: [{ Id: "500A" }] });

    const refused = await withMockFetch(
      () => Promise.resolve(Response.json({ message: "Forbidden" }, { status: 403 })),
      () => new StepExecutor({}).execute(node, makeContext()),
    );

    assertEquals(refused.success, false);
    assertEquals(
      refused.error,
      "Salesforce refused list_cases for this workflow run: Forbidden",
    );
  });
});

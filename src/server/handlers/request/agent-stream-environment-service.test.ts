import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AgentStreamEnvironmentSelectionError,
  buildAgentRunProjectEnvironment,
} from "./agent-stream-environment-service.ts";

describe("server/handlers/request/agent-stream-environment-service", () => {
  it("fails closed when the signed run has no API credential", async () => {
    await assertRejects(
      () =>
        buildAgentRunProjectEnvironment({
          projectSlug: "credential-required-project",
          token: "",
          runtimeTarget: { runtimeTargetKind: "main_branch" },
        }),
      AgentStreamEnvironmentSelectionError,
      "credential",
    );
  });

  it("does not load project secrets for a signed preview branch", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      return Promise.reject(new Error("Preview runs must not fetch environment secrets"));
    }) as typeof fetch;
    try {
      const environment = await buildAgentRunProjectEnvironment({
        projectSlug: "preview-project",
        token: "preview-token",
        runtimeTarget: {
          runtimeTargetKind: "preview_branch",
          runtimeTargetBranchId: "10000000-1000-4000-8000-100000000006",
        },
      });

      assertEquals(fetchCalls, 0);
      assertEquals(environment.VERYFRONT_API_TOKEN, "preview-token");
      assertEquals(environment.VERYFRONT_PROJECT_SLUG, "preview-project");
      assertEquals("PROJECT_SECRET" in environment, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed when production environment selection is unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 503 }))) as typeof fetch;
    try {
      let error: unknown;
      try {
        await buildAgentRunProjectEnvironment({
          projectSlug: `unavailable-${crypto.randomUUID()}`,
          token: "test-token",
          runtimeTarget: { runtimeTargetKind: "main_branch" },
        });
      } catch (caught) {
        error = caught;
      }
      assertEquals(error instanceof AgentStreamEnvironmentSelectionError, true);
      if (error instanceof AgentStreamEnvironmentSelectionError) {
        assertEquals(error.status, 503);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { executeRemoteIntegrationTool } from "#veryfront/integrations/remote-tools.ts";

const context = { authToken: "synthetic-test-token", projectSlug: "test-project" };

describe("remote integration failure conditions", () => {
  it("preserves typed platform conditions without replaying a mutating call", async () => {
    const condition = { slug: "external-service-error", status: 502, retryable: false };
    let calls = 0;
    const result = await withMockFetch(
      async () => {
        calls++;
        return Response.json({
          isError: true,
          content: [{ type: "text", text: "Outcome unknown" }],
          _meta: { condition },
        });
      },
      async () =>
        await executeRemoteIntegrationTool(
          "github__create_issue",
          { title: "Test issue" },
          context,
        ),
    );
    assertEquals(result, {
      error: "external-service-error",
      status: 502,
      message: "Outcome unknown",
      condition,
    });
    assertEquals(calls, 1);
  });

  it("adds conditions without replacing existing authentication actions", async () => {
    const condition = { slug: "provider-not-connected", status: 404, retryable: false };
    for (const error of ["authentication_required", "reconnect_required"]) {
      const action = {
        error,
        integration: "github",
        connectUrl: "/oauth/connect/github",
        message: "Connect GitHub",
      };
      const result = await withMockFetch(
        async () =>
          Response.json({
            isError: true,
            content: [{ type: "text", text: JSON.stringify(action) }],
            _meta: { condition },
          }),
        async () => await executeRemoteIntegrationTool("github__get_current_user", {}, context),
      );
      assertEquals(result, { ...action, condition });
    }
  });

  it("falls back for malformed conditions and ignores error metadata on success", async () => {
    for (
      const condition of [null, { slug: "bad slug", status: 403, retryable: false }, {
        slug: "authorization-denied",
        status: 200,
        retryable: false,
      }, { slug: "authorization-denied", status: 403, retryable: "false" }]
    ) {
      const result = await withMockFetch(
        async () =>
          Response.json({
            isError: true,
            content: [{ type: "text", text: "Denied" }],
            _meta: { condition },
          }),
        async () => await executeRemoteIntegrationTool("github__get_current_user", {}, context),
      );
      assertEquals(result, { error: "tool_error", message: "Denied" });
    }
    const success = await withMockFetch(async () =>
      Response.json({
        content: [{ type: "text", text: "Done" }],
        _meta: { condition: { slug: "authorization-denied", status: 403, retryable: false } },
      }), async () => await executeRemoteIntegrationTool("github__get_current_user", {}, context));
    assertEquals(success, "Done");
  });

  it("preserves conditions on structured errors and arbitrary JSON text", async () => {
    const condition = { slug: "provider-failed", status: 503, retryable: true };
    const structured = await withMockFetch(async () =>
      Response.json({
        isError: true,
        content: [],
        structuredContent: { error: "authentication_required", message: "Reconnect" },
        _meta: { condition },
      }), async () => await executeRemoteIntegrationTool("github__get_current_user", {}, context));
    assertEquals(structured, {
      error: "authentication_required",
      message: "Reconnect",
      condition,
    });

    const structuredMessage = await withMockFetch(async () =>
      Response.json({
        isError: true,
        content: [],
        structuredContent: { message: "Remote search failed" },
        _meta: { condition },
      }), async () => await executeRemoteIntegrationTool("github__get_current_user", {}, context));
    assertEquals(structuredMessage, {
      message: "Remote search failed",
      error: "provider-failed",
      status: 503,
      condition,
    });

    const whitespaceMessage = await withMockFetch(async () =>
      Response.json({
        isError: true,
        content: [{ type: "text", text: " " }, { type: "text", text: "\n" }],
        structuredContent: { message: "Remote search failed" },
        _meta: { condition },
      }), async () => await executeRemoteIntegrationTool("github__get_current_user", {}, context));
    assertEquals(whitespaceMessage, {
      message: "Remote search failed",
      error: "provider-failed",
      status: 503,
      condition,
    });

    const arbitraryJson = await withMockFetch(async () =>
      Response.json({
        isError: true,
        content: [{ type: "text", text: "{}" }],
        _meta: { condition },
      }), async () => await executeRemoteIntegrationTool("github__get_current_user", {}, context));
    assertEquals(arbitraryJson, {
      error: "provider-failed",
      status: 503,
      message: "{}",
      condition,
    });
  });
});

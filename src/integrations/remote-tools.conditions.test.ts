import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { executeRemoteIntegrationTool } from "./remote-tools.ts";

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
});

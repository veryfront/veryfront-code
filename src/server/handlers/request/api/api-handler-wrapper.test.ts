import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { ApiHandlerWrapper } from "./api-handler-wrapper.ts";

function createCtx(captured: { options?: Record<string, unknown> }): HandlerContext {
  return {
    projectDir: "/tmp/project",
    adapter: {
      fs: {
        isMultiProjectMode: () => true,
        runWithContext: async (
          _slug: string,
          _token: string,
          _fn: () => Promise<unknown>,
          _projectId?: string,
          options?: Record<string, unknown>,
        ) => {
          captured.options = options;
          return { continue: true };
        },
      },
      env: { get: () => undefined },
    },
    securityConfig: null,
    cspUserHeader: null,
    projectSlug: "my-project",
    projectId: "project-123",
    proxyToken: "vf_proxy_token",
    releaseId: "release-123",
    environmentName: "Staging",
    requestContext: {
      token: "vf_proxy_token",
      branch: null,
      mode: "production",
    },
  } as unknown as HandlerContext;
}

describe("ApiHandlerWrapper", () => {
  it("forwards environmentName into multi-project request context", async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const handler = new ApiHandlerWrapper("/tmp/project", createCtx(captured).adapter);

    await handler.handle(new Request("http://localhost/api/test"), createCtx(captured));

    assertEquals(captured.options?.environmentName, "Staging");
  });
});

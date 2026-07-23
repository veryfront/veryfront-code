import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { HandlerContext } from "../types.ts";
import { runWithProjectSourceContext } from "./project-source-context.ts";

describe("server/handlers/shared/project-source-context", () => {
  it("projects the exact request credential and preview source selector", async () => {
    let captured: unknown;
    const fs = {
      getUnderlyingAdapter: () => ({}),
      isVeryfrontAdapter: () => true,
      isMultiProjectMode: () => true,
      isContextualMode: () => true,
      runWithContext: async <T>(
        projectSlug: string,
        token: string,
        fn: () => Promise<T>,
        projectId?: string,
        options?: Record<string, unknown>,
      ): Promise<T> => {
        captured = { projectSlug, token, projectId, options };
        return await fn();
      },
    } as unknown as RuntimeAdapter["fs"];
    const ctx = {
      projectDir: "/project",
      adapter: { fs } as RuntimeAdapter,
      securityConfig: null,
      cspUserHeader: null,
      projectSlug: "demo-project",
      projectId: "project-id",
      proxyToken: "request-token",
      environmentName: "Preview",
      releaseId: "release-must-not-select-preview",
      requestContext: {
        token: "context-token-must-not-be-used",
        slug: "demo-project",
        branch: "feature",
        mode: "preview",
      },
      isLocalProject: false,
    } satisfies HandlerContext;

    const result = await runWithProjectSourceContext(ctx, () => Promise.resolve("ok"), {
      productionMode: false,
    });

    assertEquals(result, "ok");
    assertEquals(captured, {
      projectSlug: "demo-project",
      token: "request-token",
      projectId: "project-id",
      options: {
        productionMode: false,
        branch: "feature",
        environmentName: "Preview",
      },
    });
  });
});

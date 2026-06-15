import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import {
  createProjectNotFoundProxyContext,
  createProxyErrorContext,
  createReleaseNotFoundProxyContext,
} from "./proxy-error-context.ts";

describe("proxy/proxy-error-context", () => {
  const parsedDomain = parseProjectDomain("app.production.veryfront.com");
  const base = {
    scope: "production" as const,
    host: "app.production.veryfront.com",
    parsedDomain,
  };

  it("builds typed proxy error contexts with stable fallback fields", () => {
    const context = createProxyErrorContext(base, {
      status: 502,
      message: "Failed to authenticate project request",
      token: "api-token",
      slug: "authentication-failed",
    });

    assertEquals(context.token, "api-token");
    assertEquals(context.projectSlug, undefined);
    assertEquals(context.projectId, undefined);
    assertEquals(context.environment, "production");
    assertEquals(context.contentSourceId, "error");
    assertEquals(context.localPath, undefined);
    assertEquals(context.host, "app.production.veryfront.com");
    assertEquals(context.parsedDomain, parsedDomain);
    assertEquals(context.isLocalProject, false);
    assertEquals(context.error, {
      status: 502,
      message: "Failed to authenticate project request",
      slug: "authentication-failed",
      redirectUrl: undefined,
    });
  });

  it("standardizes project-not-found and release-not-found slugs", () => {
    assertEquals(
      createProjectNotFoundProxyContext(base, "Project not found", "api-token").error,
      {
        status: 404,
        message: "Project not found",
        slug: "project-not-found",
        redirectUrl: undefined,
      },
    );

    assertEquals(
      createReleaseNotFoundProxyContext(base, "api-token").error,
      {
        status: 404,
        message: "No active release found",
        slug: "release-not-found",
        redirectUrl: undefined,
      },
    );
  });
});

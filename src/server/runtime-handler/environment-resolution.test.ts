import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveEnvironment } from "./environment-resolution.ts";

describe("environment-resolution", () => {
  it("returns 404 when release not found in proxy production for remote project", () => {
    const result = resolveEnvironment({
      proxyEnv: "production",
      reqCtxMode: "production",
      releaseId: undefined,
      projectSlug: "my-project",
      projectId: "proj_123",
      environmentName: undefined,
      host: "my-project.production.veryfront.com",
      isLocalProject: false,
      isProxyMode: true,
      pathname: "/",
      defaultEnvironment: undefined,
    });

    assertEquals(result.errorResponse?.status, 404);
    assertEquals(
      result.errorResponse?.headers.get("Content-Type"),
      "text/html; charset=utf-8",
    );
    assertEquals(result.resolvedEnvironment, "production");
  });

  it("allows missing releaseId for local projects in proxy production", () => {
    const result = resolveEnvironment({
      proxyEnv: "production",
      reqCtxMode: "production",
      releaseId: undefined,
      projectSlug: "my-project",
      projectId: "proj_123",
      environmentName: undefined,
      host: "my-project.production.veryfront.com",
      isLocalProject: true,
      isProxyMode: true,
      pathname: "/",
      defaultEnvironment: undefined,
    });

    assertEquals(result.errorResponse, undefined);
    assertEquals(result.resolvedEnvironment, "production");
    assertEquals(result.releaseId, undefined);
  });

  it("falls back to preview in standalone production without releaseId", () => {
    const result = resolveEnvironment({
      proxyEnv: undefined,
      reqCtxMode: "production",
      releaseId: undefined,
      projectSlug: "my-project",
      projectId: "proj_123",
      environmentName: undefined,
      host: "localhost:3000",
      isLocalProject: false,
      isProxyMode: false,
      pathname: "/",
      defaultEnvironment: undefined,
    });

    assertEquals(result.errorResponse, undefined);
    assertEquals(result.resolvedEnvironment, "preview");
    assertEquals(result.releaseId, undefined);
  });

  it("uses synthetic releaseId for standalone production fallback", () => {
    const result = resolveEnvironment({
      proxyEnv: undefined,
      reqCtxMode: "production",
      releaseId: undefined,
      projectSlug: "my-project",
      projectId: "proj_123",
      environmentName: undefined,
      host: "localhost:3000",
      isLocalProject: false,
      isProxyMode: false,
      pathname: "/",
      defaultEnvironment: "production",
    });

    assertEquals(result.errorResponse, undefined);
    assertEquals(result.resolvedEnvironment, "production");
    assertEquals(result.releaseId, "standalone-dev");
  });
});

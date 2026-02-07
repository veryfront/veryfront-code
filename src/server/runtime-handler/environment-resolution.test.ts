import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveEnvironment } from "./environment-resolution.ts";

describe("environment-resolution", () => {
  it("returns 502 in proxy production when releaseId is missing for remote project", () => {
    const result = resolveEnvironment({
      proxyEnv: "production",
      reqCtxMode: "production",
      releaseId: undefined,
      projectSlug: "my-project",
      projectId: "proj_123",
      environmentName: undefined,
      host: "my-project.veryfront.com",
      isLocalProject: false,
      isProxyMode: true,
      pathname: "/",
      defaultEnvironment: undefined,
    });

    assertEquals(result.errorResponse?.status, 502);
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
      host: "my-project.veryfront.com",
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

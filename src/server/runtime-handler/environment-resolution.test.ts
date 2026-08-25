import "#veryfront/schemas/_test-setup.ts";
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

  it("prefers the proxy environment header over the request-context mode", () => {
    const result = resolveEnvironment({
      proxyEnv: "preview",
      reqCtxMode: "production",
      releaseId: undefined,
      projectSlug: "my-project",
      projectId: "proj_123",
      environmentName: undefined,
      host: "my-project.preview.veryfront.com",
      isLocalProject: false,
      isProxyMode: true,
      pathname: "/",
      defaultEnvironment: undefined,
    });

    assertEquals(
      result.resolvedEnvironment,
      "preview",
      "the proxy environment header wins over the request-context mode",
    );
    assertEquals(
      result.errorResponse,
      undefined,
      "a preview resolution must not hit production release validation",
    );
  });

  it("resolves production from the proxy header when the request context says preview", () => {
    const result = resolveEnvironment({
      proxyEnv: "production",
      reqCtxMode: "preview",
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

    assertEquals(
      result.resolvedEnvironment,
      "production",
      "the proxy environment header wins over the request-context mode",
    );
    assertEquals(
      result.errorResponse?.status,
      404,
      "a production resolution without a release returns the canonical 404",
    );
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

  it("allows signed control-plane run paths without releaseId in proxy production", () => {
    const result = resolveEnvironment({
      proxyEnv: "production",
      reqCtxMode: "production",
      releaseId: undefined,
      projectSlug: "my-project",
      projectId: "proj_123",
      environmentName: undefined,
      host: "10.192.2.245:20000",
      isLocalProject: false,
      isProxyMode: true,
      pathname: "/api/control-plane/runs/run_1",
      defaultEnvironment: undefined,
    });

    assertEquals(result.errorResponse, undefined);
    assertEquals(result.resolvedEnvironment, "production");
    assertEquals(result.releaseId, undefined);
  });

  it("allows public control-plane paths without releaseId in proxy production", () => {
    const result = resolveEnvironment({
      proxyEnv: "production",
      reqCtxMode: "production",
      releaseId: undefined,
      projectSlug: "my-project",
      projectId: "proj_123",
      environmentName: undefined,
      host: "10.192.2.245:20000",
      isLocalProject: false,
      isProxyMode: true,
      pathname: "/api/control-plane/runs/run_1",
      defaultEnvironment: undefined,
    });

    assertEquals(result.errorResponse, undefined);
    assertEquals(result.resolvedEnvironment, "production");
    assertEquals(result.releaseId, undefined);
  });

  it("still requires releaseId for non-control-plane proxy production paths", () => {
    const result = resolveEnvironment({
      proxyEnv: "production",
      reqCtxMode: "production",
      releaseId: undefined,
      projectSlug: "my-project",
      projectId: "proj_123",
      environmentName: undefined,
      host: "10.192.2.245:20000",
      isLocalProject: false,
      isProxyMode: true,
      pathname: "/api/health",
      defaultEnvironment: undefined,
    });

    assertEquals(result.errorResponse?.status, 404);
    assertEquals(result.resolvedEnvironment, "production");
    assertEquals(result.releaseId, undefined);
  });

  it("requires a release for both hosted browser module path variants", () => {
    for (
      const pathname of [
        "/_vf_modules/components/Secret.js",
        "/_veryfront/modules/components/Secret.js",
      ]
    ) {
      const result = resolveEnvironment({
        proxyEnv: "production",
        reqCtxMode: "production",
        releaseId: undefined,
        projectSlug: "my-project",
        projectId: "proj_123",
        environmentName: "Production",
        host: "my-project.production.veryfront.com",
        isLocalProject: false,
        isProxyMode: true,
        pathname,
        defaultEnvironment: undefined,
      });

      assertEquals(result.errorResponse?.status, 404, pathname);
      assertEquals(result.resolvedEnvironment, "production", pathname);
      assertEquals(result.releaseId, undefined, pathname);
    }
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

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { resolveEnvironment } from "./environment-resolution.ts";

describe("environment-resolution", () => {
  afterEach(() => {
    __resetLogRecordEmitterForTests();
  });

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
    assertEquals(result.errorResponse?.headers.get("Cache-Control"), "no-store");
    assertEquals(result.errorResponse?.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(result.resolvedEnvironment, "production");
  });

  it("does not log tenant identifiers when a proxy release is missing", () => {
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));

    resolveEnvironment({
      proxyEnv: "production",
      reqCtxMode: "production",
      releaseId: undefined,
      projectSlug: "private-project",
      projectId: "private-project-id",
      environmentName: "private-environment",
      host: "private-project.production.example",
      isLocalProject: false,
      isProxyMode: true,
      pathname: "/",
      defaultEnvironment: undefined,
    });

    assertEquals(JSON.stringify(entries).includes("private-"), false);
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

  it("preserves host-derived production mode for a standalone server", () => {
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
    assertEquals(result.resolvedEnvironment, "production");
    assertEquals(result.releaseId, undefined);
  });

  it("does not invent a release ID for standalone production", () => {
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
    assertEquals(result.releaseId, undefined);
  });

  it("honors an explicit standalone preview override", () => {
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
      defaultEnvironment: "preview",
    });

    assertEquals(result.errorResponse, undefined);
    assertEquals(result.resolvedEnvironment, "preview");
    assertEquals(result.releaseId, undefined);
  });
});

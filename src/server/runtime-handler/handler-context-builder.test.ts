import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildHandlerContext,
  buildMinimalContext,
  type HandlerContextOptions,
} from "./handler-context-builder.ts";

function makeOpts(overrides: Partial<HandlerContextOptions> = {}): HandlerContextOptions {
  return {
    projectDir: "/tmp/project",
    adapter: {} as any,
    securityConfig: { allowedOrigins: ["*"] } as any,
    cspUserHeader: "default-src 'self'",
    debug: true,
    config: { name: "test" } as any,
    parsedDomain: { slug: "my-project", branch: null, environment: "production" } as any,
    projectSlug: "my-project",
    projectId: "proj-123",
    releaseId: "rel-456",
    proxyToken: "secret-token",
    environmentName: "production",
    resolvedEnvironment: "production",
    requestContext: {
      token: "req-token",
      slug: "my-project",
      branch: null,
      mode: "preview",
    },
    routeRegistry: {} as any,
    isLocalProject: false,
    moduleServerUrl: "https://modules.example.com",
    environmentId: "env-789",
    ...overrides,
  };
}

describe("buildHandlerContext", () => {
  it("builds full context with all fields populated", () => {
    const opts = makeOpts();
    const ctx = buildHandlerContext(opts);

    assertEquals(ctx.projectDir, "/tmp/project");
    assertEquals(ctx.adapter, opts.adapter);
    assertEquals(ctx.moduleServerUrl, "https://modules.example.com");
    assertEquals(ctx.securityConfig, opts.securityConfig);
    assertEquals(ctx.cspUserHeader, "default-src 'self'");
    assertEquals(ctx.debug, true);
    assertEquals(ctx.config, opts.config);
    assertEquals(ctx.parsedDomain, opts.parsedDomain);
    assertEquals(ctx.projectSlug, "my-project");
    assertEquals(ctx.projectId, "proj-123");
    assertEquals(ctx.releaseId, "rel-456");
    assertEquals(ctx.proxyToken, "secret-token");
    assertEquals(ctx.environmentName, "production");
    assertEquals(ctx.resolvedEnvironment, "production");
    assertEquals(ctx.routeRegistry, opts.routeRegistry);
    assertEquals(ctx.isLocalProject, false);
    assertEquals(ctx.environmentId, "env-789");
    assertEquals(ctx.enriched !== undefined, true);
  });

  it("strips proxyToken for local projects (sets to undefined)", () => {
    const opts = makeOpts({ isLocalProject: true, resolvedEnvironment: "preview" });
    const ctx = buildHandlerContext(opts);

    assertEquals(ctx.proxyToken, undefined);
  });

  it("builds enriched context when both config and projectSlug present", () => {
    const opts = makeOpts({
      config: { name: "test" } as any,
      projectSlug: "my-project",
    });
    const ctx = buildHandlerContext(opts);

    assertEquals(ctx.enriched !== undefined, true);
    assertEquals(ctx.enriched!.projectSlug, "my-project");
    assertEquals(ctx.enriched!.projectId, "proj-123");
  });

  it("does NOT build enriched context when config is undefined", () => {
    const opts = makeOpts({ config: undefined });
    const ctx = buildHandlerContext(opts);

    assertEquals(ctx.enriched, undefined);
  });

  it("does NOT build enriched context when projectSlug is undefined", () => {
    const opts = makeOpts({ projectSlug: undefined });
    const ctx = buildHandlerContext(opts);

    assertEquals(ctx.enriched, undefined);
  });

  it("falls back to projectSlug as projectId in enriched when projectId is undefined", () => {
    const opts = makeOpts({ projectId: undefined });
    const ctx = buildHandlerContext(opts);

    assertEquals(ctx.enriched!.projectId, "my-project");
  });

  it("overrides requestContext.mode with resolvedEnvironment", () => {
    const opts = makeOpts({
      resolvedEnvironment: "production",
      requestContext: {
        token: "t",
        slug: "s",
        branch: null,
        mode: "preview",
      },
    });
    const ctx = buildHandlerContext(opts);

    assertEquals(ctx.requestContext!.mode, "production");
  });

  it("uses empty token for local projects in enriched context", () => {
    const opts = makeOpts({
      isLocalProject: true,
      proxyToken: "secret-token",
      resolvedEnvironment: "preview",
    });
    const ctx = buildHandlerContext(opts);

    assertEquals(ctx.enriched!.token, "");
  });
});

describe("buildMinimalContext", () => {
  it("returns only projectDir, adapter, securityConfig, cspUserHeader, debug, config", () => {
    const adapter = {} as any;
    const securityConfig = { foo: "bar" } as any;
    const config = { name: "minimal" } as any;

    const ctx = buildMinimalContext(
      "/tmp/minimal",
      adapter,
      securityConfig,
      "csp-header",
      false,
      config,
    );

    assertEquals(ctx.projectDir, "/tmp/minimal");
    assertEquals(ctx.adapter, adapter);
    assertEquals(ctx.securityConfig, securityConfig);
    assertEquals(ctx.cspUserHeader, "csp-header");
    assertEquals(ctx.debug, false);
    assertEquals(ctx.config, config);

    // Should not have other handler context fields
    assertEquals(ctx.enriched, undefined);
    assertEquals(ctx.projectSlug, undefined);
    assertEquals(ctx.routeRegistry, undefined);
    assertEquals(ctx.isLocalProject, undefined);
  });
});

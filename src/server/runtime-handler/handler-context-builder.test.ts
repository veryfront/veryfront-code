import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildHandlerContext,
  buildMinimalContext,
  type HandlerContextOptions,
} from "./handler-context-builder.ts";

const prepareHostedConfigContext: NonNullable<HandlerContextOptions["prepareHostedConfigContext"]> =
  () => Promise.resolve({} as any);

function makeOpts(overrides: Partial<HandlerContextOptions> = {}): HandlerContextOptions {
  return {
    projectDir: "/tmp/project",
    adapter: {} as any,
    securityConfig: { allowedOrigins: ["*"] } as any,
    requestOrigin: "https://my-project.example.com",
    debug: true,
    config: { name: "test" } as any,
    parsedDomain: { slug: "my-project", branch: null, environment: "production" } as any,
    projectSlug: "my-project",
    projectId: "proj-123",
    releaseId: "rel-456",
    branchId: "branch-1",
    branchName: "feature-x",
    defaultBranchName: "main",
    prepareHostedConfigContext,
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
    isProxyMode: true,
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
    assertEquals(ctx.requestOrigin, "https://my-project.example.com");
    assertEquals(ctx.debug, true);
    assertEquals(ctx.config, opts.config);
    assertEquals(ctx.parsedDomain, opts.parsedDomain);
    assertEquals(ctx.projectSlug, "my-project");
    assertEquals(ctx.projectId, "proj-123");
    assertEquals(ctx.releaseId, "rel-456");
    assertEquals(
      ctx.branchId,
      "branch-1",
      "the hosted agent-source check needs the canonical branch id",
    );
    assertEquals(
      ctx.branchName,
      "feature-x",
      "the hosted agent-source check needs the canonical branch name",
    );
    assertEquals(
      ctx.defaultBranchName,
      "main",
      "the hosted agent-source check needs the project default branch name",
    );
    assertStrictEquals(
      ctx.prepareHostedConfigContext,
      opts.prepareHostedConfigContext,
      "the hosted config preparer must pass through by identity",
    );
    assertEquals(ctx.proxyToken, "secret-token");
    assertEquals(ctx.environmentName, "production");
    assertEquals(ctx.resolvedEnvironment, "production");
    assertEquals(ctx.routeRegistry, opts.routeRegistry);
    assertEquals(ctx.isLocalProject, false);
    assertEquals(ctx.isProxyMode, true);
    assertEquals(ctx.environmentId, "env-789");
    assertEquals(ctx.enriched !== undefined, true);
  });

  it("strips proxyToken for local projects (sets to undefined)", () => {
    const opts = makeOpts({ isLocalProject: true, resolvedEnvironment: "preview" });
    const ctx = buildHandlerContext(opts);

    assertEquals(ctx.proxyToken, undefined);
  });

  it("preserves the narrow host project-code execution capability", () => {
    const ctx = buildHandlerContext(
      makeOpts({ allowHostProjectCodeExecution: true }),
    );

    assertEquals(ctx.allowHostProjectCodeExecution, true);
    assertEquals(ctx.isLocalProject, false);
    assertEquals(ctx.enriched?.allowHostProjectCodeExecution, true);
  });

  it("snapshots configured trusted-proxy identity header names", () => {
    const ctx = buildHandlerContext(
      makeOpts({
        securityConfig: {
          auth: {
            trustedProxy: {
              trustedPeers: ["127.0.0.1"],
              headers: {
                subject: "X-Auth-Subject",
                email: "X-Auth-Email",
              },
            },
          },
        } as never,
      }),
    );

    assertEquals(ctx.applicationIdentityHeaderNames, ["x-auth-subject", "x-auth-email"]);
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

  it("skips enriched render context for internal control-plane requests without a release id", () => {
    const opts = makeOpts({
      releaseId: undefined,
      resolvedEnvironment: "production",
      skipEnrichedContext: true,
    });

    const ctx = buildHandlerContext(opts);

    assertEquals(ctx.releaseId, undefined);
    assertEquals(ctx.projectSlug, "my-project");
    assertEquals(ctx.enriched, undefined);
  });
});

describe("buildMinimalContext", () => {
  it("returns only projectDir, adapter, securityConfig, debug, config", () => {
    const adapter = {} as any;
    const securityConfig = { foo: "bar" } as any;
    const config = { name: "minimal" } as any;

    const ctx = buildMinimalContext(
      "/tmp/minimal",
      adapter,
      securityConfig,
      false,
      config,
    );

    assertEquals(ctx.projectDir, "/tmp/minimal");
    assertEquals(ctx.adapter, adapter);
    assertEquals(ctx.securityConfig, securityConfig);
    assertEquals(ctx.debug, false);
    assertEquals(ctx.config, config);

    // Should not have other handler context fields
    assertEquals(ctx.enriched, undefined);
    assertEquals(ctx.projectSlug, undefined);
    assertEquals(ctx.routeRegistry, undefined);
    assertEquals(ctx.isLocalProject, undefined);
  });

  it("snapshots trusted-proxy identity headers for pre-authentication handlers", () => {
    const ctx = buildMinimalContext(
      "/tmp/minimal",
      {} as any,
      {
        auth: {
          trustedProxy: {
            trustedPeers: ["127.0.0.1"],
            headers: { subject: "X-Auth-Subject" },
          },
        },
      } as never,
      false,
      undefined,
    );

    assertEquals(ctx.applicationIdentityHeaderNames, ["x-auth-subject"]);
  });
});

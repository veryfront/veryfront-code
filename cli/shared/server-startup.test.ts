import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { deleteHostSecret, setHostSecret } from "#cli/process-env";
import {
  buildDiscoveryConfig,
  buildProxyRuntimeProjectIdentity,
  prepareCliProxyModeEnvironment,
} from "./server-startup.ts";

describe("buildDiscoveryConfig", () => {
  it("does not scope an unlinked local project to its directory slug", () => {
    const host = createInMemoryHostRuntime({ env: { VERYFRONT_API_TOKEN: "stored-token" } });

    const config = buildDiscoveryConfig({
      port: 3000,
      projectDir: "/tmp/my-agent",
      signal: new AbortController().signal,
      requestInterceptor: (request: Request) => request,
      defaultProjectId: "local-my-agent",
      linkedProjectSlug: undefined,
    }, host);

    assertEquals(config.projectSlug, undefined, "no slug is inferred from the directory");
    assertEquals(config.apiToken, "stored-token", "the stored token is forwarded");
  });

  it("uses a persisted project link for cloud discovery", () => {
    const host = createInMemoryHostRuntime({ env: { VERYFRONT_API_TOKEN: "stored-token" } });

    const config = buildDiscoveryConfig({
      port: 3000,
      projectDir: "/tmp/my-agent",
      signal: new AbortController().signal,
      requestInterceptor: (request: Request) => request,
      defaultProjectId: "local-my-agent",
      linkedProjectSlug: "linked-project",
    }, host);

    assertEquals(config.projectSlug, "linked-project", "the persisted link names the project");
  });

  it("lets VERYFRONT_PROJECT_SLUG override a persisted project link", () => {
    const host = createInMemoryHostRuntime({
      env: { VERYFRONT_API_TOKEN: "stored-token", VERYFRONT_PROJECT_SLUG: "env-project" },
    });

    const config = buildDiscoveryConfig({
      port: 3000,
      projectDir: "/tmp/my-agent",
      signal: new AbortController().signal,
      requestInterceptor: (request: Request) => request,
      defaultProjectId: "local-my-agent",
      linkedProjectSlug: "linked-project",
    }, host);

    assertEquals(config.projectSlug, "env-project", "the environment wins over the link");
  });

  it("prefers the stored login token over a blank exported one", () => {
    const host = createInMemoryHostRuntime({ env: { VERYFRONT_API_TOKEN: "   " } });
    setHostSecret("VERYFRONT_API_TOKEN", "stored-token");

    try {
      const config = buildDiscoveryConfig({
        port: 3000,
        projectDir: "/tmp/my-agent",
        signal: new AbortController().signal,
        requestInterceptor: (request: Request) => request,
        defaultProjectId: "local-my-agent",
      }, host);

      // `applyRuntimeAuthContext` normalizes a blank export to "unset" before it
      // registers the stored token, so discovery must not treat it as a token.
      assertEquals(config.apiToken, "stored-token");
    } finally {
      deleteHostSecret("VERYFRONT_API_TOKEN");
    }
  });

  it("omits an absent token rather than forwarding an empty string", () => {
    const config = buildDiscoveryConfig({
      port: 3000,
      projectDir: "/tmp/my-agent",
      signal: new AbortController().signal,
      requestInterceptor: (request: Request) => request,
      defaultProjectId: "local-my-agent",
    }, createInMemoryHostRuntime());

    assertEquals(config.apiToken, undefined, "no token is reported as absent");
    assertEquals(config.baseDir, "/tmp/my-agent", "the project directory is the base");
  });
});

describe("buildProxyRuntimeProjectIdentity", () => {
  it("keeps the standalone slug paired with its local project id", () => {
    assertEquals(
      buildProxyRuntimeProjectIdentity({
        defaultProjectId: "local-my-agent",
        linkedProjectSlug: "linked-project",
      }),
      {
        defaultProjectSlug: "local-my-agent",
        defaultProjectId: "local-my-agent",
      },
      "the local id doubles as the slug",
    );
  });
});

describe("prepareCliProxyModeEnvironment", () => {
  it("marks local CLI proxy mode before bootstrap and defaults NODE_ENV to development", () => {
    const host = createInMemoryHostRuntime();

    prepareCliProxyModeEnvironment(host);

    assertEquals(host.env.get("PROXY_MODE"), "1", "proxy mode is on");
    assertEquals(host.env.get("VERYFRONT_CLI_LOCAL_PROXY_MODE"), "1", "local proxy mode is on");
    assertEquals(host.env.get("NODE_ENV"), "development", "NODE_ENV defaults to development");
  });

  it("preserves an existing runtime environment while marking local CLI proxy mode", () => {
    const host = createInMemoryHostRuntime({ env: { DENO_ENV: "test" } });

    prepareCliProxyModeEnvironment(host);

    assertEquals(host.env.get("PROXY_MODE"), "1", "proxy mode is on");
    assertEquals(host.env.get("VERYFRONT_CLI_LOCAL_PROXY_MODE"), "1", "local proxy mode is on");
    assertEquals(host.env.get("NODE_ENV"), undefined, "NODE_ENV stays unset beside DENO_ENV");
    assertEquals(host.env.get("DENO_ENV"), "test", "DENO_ENV is untouched");
  });

  it("never touches the process it was not given", () => {
    const host = createInMemoryHostRuntime();
    const bystander = createInMemoryHostRuntime();

    prepareCliProxyModeEnvironment(host);

    assertEquals(bystander.env.toObject(), {}, "another host sees no writes");
  });
});

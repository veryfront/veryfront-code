import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildDiscoveryConfig,
  buildProxyRuntimeProjectIdentity,
  prepareCliProxyModeEnvironment,
} from "./server-startup.ts";

const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");
const originalProxyMode = Deno.env.get("PROXY_MODE");
const originalLocalProxyMode = Deno.env.get("VERYFRONT_CLI_LOCAL_PROXY_MODE");
const originalNodeEnv = Deno.env.get("NODE_ENV");
const originalDenoEnv = Deno.env.get("DENO_ENV");

function restoreEnv(): void {
  if (originalApiToken === undefined) {
    Deno.env.delete("VERYFRONT_API_TOKEN");
  } else {
    Deno.env.set("VERYFRONT_API_TOKEN", originalApiToken);
  }

  if (originalProjectSlug === undefined) {
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");
  } else {
    Deno.env.set("VERYFRONT_PROJECT_SLUG", originalProjectSlug);
  }

  for (
    const [key, value] of [
      ["PROXY_MODE", originalProxyMode],
      ["VERYFRONT_CLI_LOCAL_PROXY_MODE", originalLocalProxyMode],
      ["NODE_ENV", originalNodeEnv],
      ["DENO_ENV", originalDenoEnv],
    ] as const
  ) {
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
}

describe("buildDiscoveryConfig", () => {
  afterEach(restoreEnv);

  it("does not scope an unlinked local project to its directory slug", () => {
    Deno.env.set("VERYFRONT_API_TOKEN", "stored-token");
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");

    const config = buildDiscoveryConfig({
      port: 3000,
      projectDir: "/tmp/my-agent",
      signal: new AbortController().signal,
      requestInterceptor: (request: Request) => request,
      defaultProjectId: "local-my-agent",
      linkedProjectSlug: undefined,
    });

    assertEquals(config.projectSlug, undefined);
    assertEquals(config.apiToken, "stored-token");
  });

  it("uses a persisted project link for cloud discovery", () => {
    Deno.env.set("VERYFRONT_API_TOKEN", "stored-token");
    Deno.env.delete("VERYFRONT_PROJECT_SLUG");

    const config = buildDiscoveryConfig({
      port: 3000,
      projectDir: "/tmp/my-agent",
      signal: new AbortController().signal,
      requestInterceptor: (request: Request) => request,
      defaultProjectId: "local-my-agent",
      linkedProjectSlug: "linked-project",
    });

    assertEquals(config.projectSlug, "linked-project");
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
    );
  });
});

describe("prepareCliProxyModeEnvironment", () => {
  afterEach(restoreEnv);

  it("marks local CLI proxy mode before bootstrap and defaults NODE_ENV to development", () => {
    Deno.env.delete("PROXY_MODE");
    Deno.env.delete("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    Deno.env.delete("NODE_ENV");
    Deno.env.delete("DENO_ENV");

    prepareCliProxyModeEnvironment();

    assertEquals(Deno.env.get("PROXY_MODE"), "1");
    assertEquals(Deno.env.get("VERYFRONT_CLI_LOCAL_PROXY_MODE"), "1");
    assertEquals(Deno.env.get("NODE_ENV"), "development");
  });

  it("preserves an existing runtime environment while marking local CLI proxy mode", () => {
    Deno.env.delete("PROXY_MODE");
    Deno.env.delete("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    Deno.env.delete("NODE_ENV");
    Deno.env.set("DENO_ENV", "test");

    prepareCliProxyModeEnvironment();

    assertEquals(Deno.env.get("PROXY_MODE"), "1");
    assertEquals(Deno.env.get("VERYFRONT_CLI_LOCAL_PROXY_MODE"), "1");
    assertEquals(Deno.env.get("NODE_ENV"), undefined);
    assertEquals(Deno.env.get("DENO_ENV"), "test");
  });
});

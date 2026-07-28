import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { buildDiscoveryConfig, buildProxyRuntimeProjectIdentity } from "./server-startup.ts";

const originalApiToken = Deno.env.get("VERYFRONT_API_TOKEN");
const originalProjectSlug = Deno.env.get("VERYFRONT_PROJECT_SLUG");

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

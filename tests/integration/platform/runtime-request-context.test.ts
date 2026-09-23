import { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import { enablePrivateVeryfrontApiClientSourceContext } from "#veryfront/platform/adapters/veryfront-api-client/client.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { resolveHostOwnedApiBaseUrl } from "#veryfront/config/host-api-base.ts";
import { resolveCacheRequestAuthority } from "#veryfront/cache/request-authority.ts";
import {
  getCurrentRequestContext,
  runWithRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  getRuntimeRequestContext,
  runWithRuntimeRequestContext,
} from "#veryfront/platform/runtime-request-context.ts";

describe("platform/runtime-request-context", () => {
  it("reads source metadata with the private source token at the host API origin", async () => {
    const projectId = "20000000-1000-4000-8000-100000000005";
    const apiBaseUrl = resolveHostOwnedApiBaseUrl();
    const observed: Array<{ url: string; authorization: string | null }> = [];
    installMockFetch(
      ((input: RequestInfo | URL, init?: RequestInit) => {
        observed.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return Promise.resolve(Response.json({ id: projectId, slug: "source", name: "Source" }));
      }) as typeof fetch,
    );
    try {
      const client = new VeryfrontApiClient({
        apiBaseUrl,
        projectSlug: projectId,
        retry: { maxRetries: 0 },
      });
      enablePrivateVeryfrontApiClientSourceContext(client);
      client.enableContextualToken();
      await runWithRequestContext(
        { projectSlug: "source", token: "source-release-token", productionMode: true },
        () =>
          runWithRuntimeRequestContext(
            { projectSlug: "consumer", token: "consumer-run-token", productionMode: false },
            async () => {
              assertEquals((await client.getProject()).id, projectId);
              assertThrows(
                () => client.getToken(),
                Error,
                "Host-private credentials cannot be read",
              );
            },
          ),
      );
      assertEquals(observed, [{
        url: `${apiBaseUrl.replace(/\/$/, "")}/projects/${projectId}`,
        authorization: "Bearer source-release-token",
      }]);
    } finally {
      restoreMockFetch();
    }
  });

  it("keeps source credentials out of public contextual API clients", async () => {
    const config = {
      apiBaseUrl: "https://caller.example",
      apiToken: "fallback",
      projectSlug: "source",
    };
    const publicClient = new VeryfrontApiClient(config);
    publicClient.enableContextualToken();
    const fileClient = new VeryfrontApiClient({
      ...config,
      apiBaseUrl: "https://api.veryfront.org",
    });
    enablePrivateVeryfrontApiClientSourceContext(fileClient);
    fileClient.enableContextualToken();
    await runWithRequestContext(
      { projectSlug: "source", token: "source-release-token", productionMode: true },
      () =>
        runWithRuntimeRequestContext(
          { projectSlug: "consumer", token: "consumer-run-token", productionMode: false },
          () => {
            assertEquals(publicClient.getToken(), "consumer-run-token");
            assertThrows(
              () => fileClient.getToken(),
              Error,
              "Host-private credentials cannot be read",
            );
            return Promise.resolve();
          },
        ),
    );
  });

  it("refuses forwarding a source credential to a caller-selected API origin", async () => {
    const client = new VeryfrontApiClient({
      apiBaseUrl: "https://caller.example",
      apiToken: "fallback",
      projectSlug: "source",
      retry: { maxRetries: 0 },
    });
    enablePrivateVeryfrontApiClientSourceContext(client);
    client.enableContextualToken();
    await runWithRequestContext(
      { projectSlug: "source", token: "source-release-token", productionMode: true },
      () =>
        runWithRuntimeRequestContext(
          { projectSlug: "consumer", token: "consumer-run-token", productionMode: false },
          async () => {
            await assertRejects(
              () => client.getProject(),
              Error,
              "Host-private credentials require the host API origin",
            );
          },
        ),
    );
  });

  it("does not expose execution credentials to a replaced Object.freeze", () => {
    const original = Object.freeze;
    let intercepted = false;
    Object.freeze = ((value: unknown) => {
      intercepted = true;
      return value;
    }) as typeof Object.freeze;
    try {
      runWithRuntimeRequestContext({
        projectSlug: "consumer",
        token: "consumer-token",
        productionMode: false,
      }, () => {
        assertEquals(getRuntimeRequestContext()?.projectSlug, "consumer");
      });
    } finally {
      Object.freeze = original;
    }
    assertEquals(intercepted, false);
  });

  it("separates concurrent consuming identities from the shared file source", async () => {
    await runWithRequestContext({
      projectSlug: "source-project",
      token: "release-read-token",
      productionMode: true,
      releaseId: "release-1",
    }, async () => {
      await Promise.all(
        ["consumer-a", "consumer-c"].map((projectSlug) =>
          runWithRuntimeRequestContext({
            projectSlug,
            token: `${projectSlug}-token`,
            productionMode: false,
          }, async () => {
            await Promise.resolve();
            assertEquals(getRuntimeRequestContext()?.projectSlug, projectSlug);
            assertEquals(getRuntimeRequestContext()?.token, `${projectSlug}-token`);
            assertEquals(resolveCacheRequestAuthority().projectRef, projectSlug);
            assertEquals(resolveCacheRequestAuthority().token, `${projectSlug}-token`);
            assertEquals(getRuntimeRequestContext()?.releaseId, undefined);
            assertEquals(getCurrentRequestContext()?.projectSlug, "source-project");
            assertEquals(getCurrentRequestContext()?.releaseId, "release-1");
          })
        ),
      );
      assertEquals(getRuntimeRequestContext(), getCurrentRequestContext());
    });
    assertEquals(getRuntimeRequestContext(), null);
  });
});

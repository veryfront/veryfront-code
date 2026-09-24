import { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/index.ts";
import { enablePrivateVeryfrontApiClientSourceContext } from "#veryfront/platform/adapters/veryfront-api-client/client.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  resolveHostOwnedApiBaseUrl,
  resolveHostOwnedSourceApiBaseUrl,
} from "#veryfront/config/host-api-base.ts";
import {
  clearEnvFileValueSource,
  deleteHostSecret,
  getHostSecret,
  markEnvFileValue,
  setHostSecret,
} from "#veryfront/platform/compat/process/env.ts";
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
  it("reads pinned source files through the runtime API when the internal API URL differs", async () => {
    const keys = ["VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL"] as const;
    const previous = keys.map((key) => Deno.env.get(key));
    Deno.env.set(keys[0], "http://veryfront-api:80");
    Deno.env.set(keys[1], "https://api.veryfront.org");
    const observed: Array<{ url: string; authorization: string | null }> = [];
    installMockFetch(
      ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        observed.push({ url, authorization: new Headers(init?.headers).get("authorization") });
        return Promise.resolve(Response.json(
          url.includes("/releases/")
            ? {
              data: [],
              page_info: { self: null, first: null, next: null, prev: null },
              release_id: "pinned-release",
              release_version: "v1",
            }
            : { id: "20000000-1000-4000-8000-100000000005", slug: "source", name: "Source" },
        ));
      }) as typeof fetch,
    );
    try {
      await runWithRequestContext(
        { projectSlug: "source", token: "source-release-token", productionMode: true },
        () =>
          runWithRuntimeRequestContext(
            { projectSlug: "consumer", token: "consumer-run-token", productionMode: false },
            async () => {
              const client = new VeryfrontApiClient({
                apiBaseUrl: "https://api.veryfront.org",
                projectSlug: "source",
                retry: { maxRetries: 0 },
              });
              enablePrivateVeryfrontApiClientSourceContext(client);
              client.enableContextualToken();
              assertEquals((await client.getProject()).slug, "source");
              assertEquals(
                (await client.listReleaseFiles("pinned-release")).release_id,
                "pinned-release",
              );
              for (
                const apiBaseUrl of [
                  "https://caller.example",
                  "http://api.veryfront.org",
                  "http://veryfront-api:80",
                ]
              ) {
                const rejected = new VeryfrontApiClient({
                  apiBaseUrl,
                  projectSlug: "source",
                  retry: { maxRetries: 0 },
                });
                enablePrivateVeryfrontApiClientSourceContext(rejected);
                rejected.enableContextualToken();
                await assertRejects(
                  () => rejected.getProject(),
                  Error,
                  apiBaseUrl.startsWith("https:")
                    ? "Host-private credentials require the host API origin"
                    : "Host-private credentials require an HTTPS API endpoint",
                );
              }
            },
          ),
      );
      assertEquals(observed.length, 2);
      assertEquals(
        observed.every((entry) =>
          entry.url.startsWith("https://api.veryfront.org/projects/source") &&
          entry.authorization === "Bearer source-release-token"
        ),
        true,
      );
      assertEquals(observed[1]?.url.includes("/releases/pinned-release/files?"), true);
      assertEquals(resolveHostOwnedApiBaseUrl(), "http://veryfront-api:80");
    } finally {
      restoreMockFetch();
      keys.forEach((key, index) =>
        previous[index] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previous[index]!)
      );
    }
  });

  it("does not let project env files select the private source API", () => {
    const keys = ["VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL"] as const;
    const previous = keys.map((key) => Deno.env.get(key));
    try {
      Deno.env.set(keys[0], "https://operator.example/graphql/");
      Deno.env.set(keys[1], "https://project.example");
      markEnvFileValue(keys[1]);
      assertEquals(resolveHostOwnedSourceApiBaseUrl(), "https://operator.example/api");
      markEnvFileValue(keys[0]);
      assertEquals(resolveHostOwnedSourceApiBaseUrl(), "https://api.veryfront.com");
    } finally {
      keys.forEach((key, index) => {
        clearEnvFileValueSource(key);
        if (previous[index] === undefined) Deno.env.delete(key);
        else Deno.env.set(key, previous[index]!);
      });
    }
  });

  it("retains stored-login URL precedence even when the token also matches source context", async () => {
    const keys = ["VERYFRONT_API_URL", "VERYFRONT_API_BASE_URL"] as const;
    const previous = keys.map((key) => Deno.env.get(key));
    const previousToken = getHostSecret("VERYFRONT_API_TOKEN");
    let calls = 0;
    try {
      Deno.env.set(keys[0], "https://login.example");
      Deno.env.set(keys[1], "https://runtime.example");
      setHostSecret("VERYFRONT_API_TOKEN", "stored-source-token");
      installMockFetch(
        (() => {
          calls++;
          return Promise.resolve(
            Response.json({
              id: "20000000-1000-4000-8000-100000000005",
              slug: "source",
              name: "Source",
            }),
          );
        }) as typeof fetch,
      );
      await runWithRequestContext(
        { projectSlug: "source", token: "stored-source-token", productionMode: true },
        () =>
          runWithRuntimeRequestContext({
            projectSlug: "consumer",
            token: "consumer-token",
            productionMode: false,
          }, async () => {
            for (const apiBaseUrl of ["https://login.example", "https://runtime.example"]) {
              const client = new VeryfrontApiClient({
                apiBaseUrl,
                projectSlug: "source",
                retry: { maxRetries: 0 },
              });
              enablePrivateVeryfrontApiClientSourceContext(client);
              client.enableContextualToken();
              if (apiBaseUrl === "https://login.example") {
                assertEquals((await client.getProject()).slug, "source");
              } else {
                await assertRejects(
                  () => client.getProject(),
                  Error,
                  "Host-private credentials require the host API origin",
                );
              }
            }
          }),
      );
      assertEquals(calls, 1);
    } finally {
      restoreMockFetch();
      deleteHostSecret("VERYFRONT_API_TOKEN");
      keys.forEach((key, index) =>
        previous[index] === undefined ? Deno.env.delete(key) : Deno.env.set(key, previous[index]!)
      );
      if (previousToken !== undefined) setHostSecret("VERYFRONT_API_TOKEN", previousToken);
    }
  });

  it("reads source metadata with the private source token at the host API origin", async () => {
    const projectId = "20000000-1000-4000-8000-100000000005";
    const apiBaseUrl = resolveHostOwnedSourceApiBaseUrl();
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

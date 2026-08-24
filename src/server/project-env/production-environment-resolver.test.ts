import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit } from "#veryfront/testing/mock-fetch.ts";
import {
  MAX_ENVIRONMENT_LIST_RESPONSE_BYTES,
  ProductionEnvironmentResolver,
  ProjectEnvironmentIdentityResolver,
} from "./production-environment-resolver.ts";

const originalFetch = globalThis.fetch;

function requestUrlOf(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function scope() {
  return {
    apiBaseUrl: "https://api.veryfront.test",
    projectSlug: "project-one",
    projectId: "project-id-one",
    token: "project-token",
  };
}

describe("ProductionEnvironmentResolver", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses bounded, redirect-safe authenticated transport and selects title-case production", async () => {
    let requestUrl: string | undefined;
    let requestInit: RequestInit | undefined;
    globalThis.fetch = ((input, init) => {
      requestUrl = requestUrlOf(input);
      requestInit = init;
      return Promise.resolve(Response.json({
        data: [
          { id: "env-preview", name: "Preview" },
          { id: "env-production", name: "Production" },
        ],
      }));
    }) as typeof fetch;

    const resolver = new ProductionEnvironmentResolver();
    assertEquals(await resolver.resolve(scope()), "env-production");
    assertEquals(
      requestUrl,
      "https://api.veryfront.test/projects/project-one/environments",
      "the lookup must address the scoped project environments endpoint",
    );
    assertEquals(requestInit?.redirect, "error");
    assertEquals(new Headers(requestInit?.headers).get("authorization"), "Bearer project-token");
  });

  it("keeps a tenant-supplied slug inside its own path segment", async () => {
    let requestUrl: string | undefined;
    globalThis.fetch = ((input) => {
      requestUrl = requestUrlOf(input);
      return Promise.resolve(Response.json({
        data: [{ id: "env-production", name: "production" }],
      }));
    }) as typeof fetch;

    await new ProductionEnvironmentResolver().resolve({
      ...scope(),
      projectSlug: "x/../../internal/admin",
    });
    assertEquals(
      requestUrl,
      "https://api.veryfront.test/projects/x%2F..%2F..%2Finternal%2Fadmin/environments",
      "a slug must be percent-encoded so it cannot re-address the control plane",
    );
  });

  it("preserves authorization semantics for failed lookups", async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 403 }))) as typeof fetch;

    const error = await assertRejects(() => new ProductionEnvironmentResolver().resolve(scope()));
    assertEquals((error as { slug?: string }).slug, "permission-denied");
    assertEquals((error as { status?: number }).status, 403);
  });

  it("reports a rejected project credential as authentication required", async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 401 }))) as typeof fetch;

    const error = await assertRejects(() => new ProductionEnvironmentResolver().resolve(scope()));
    assertEquals(
      (error as { slug?: string }).slug,
      "authentication-required",
      "a rejected project credential must be reported as authentication required",
    );
    assertEquals(
      (error as { status?: number }).status,
      401,
      "a rejected project credential must carry the 401 status so callers re-authenticate",
    );
  });

  it("classifies a missing project the same as an unauthorized one", async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 404 }))) as typeof fetch;

    const error = await assertRejects(() => new ProductionEnvironmentResolver().resolve(scope()));
    assertEquals(
      (error as { slug?: string }).slug,
      "permission-denied",
      "a missing project must not be distinguishable from an unauthorized one",
    );
    assertEquals((error as { status?: number }).status, 403);
  });

  it("resolves an exact named environment and verifies its signed ID", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(Response.json({
        data: [
          { id: "env-production", name: "production" },
          { id: "env-staging", name: "staging" },
        ],
      }))) as typeof fetch;

    const resolver = new ProjectEnvironmentIdentityResolver();
    assertEquals(
      await resolver.resolveNamed({
        ...scope(),
        environmentName: "staging",
        expectedEnvironmentId: "env-staging",
      }),
      "env-staging",
    );
  });

  it("matches canonical named environments without depending on API letter case", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(Response.json({
        data: [{ id: "env-staging", name: "Staging" }],
      }))) as typeof fetch;

    const resolver = new ProjectEnvironmentIdentityResolver();
    assertEquals(
      await resolver.resolveNamed({
        ...scope(),
        environmentName: "STAGING",
        expectedEnvironmentId: "env-staging",
      }),
      "env-staging",
    );
  });

  it("fails closed when a signed environment ID does not match project metadata", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(Response.json({
        data: [{ id: "env-staging", name: "staging" }],
      }))) as typeof fetch;

    const error = await assertRejects(() =>
      new ProjectEnvironmentIdentityResolver().resolveNamed({
        ...scope(),
        environmentName: "staging",
        expectedEnvironmentId: "env-production",
      })
    );
    assertEquals((error as { slug?: string }).slug, "permission-denied");
    assertEquals((error as { status?: number }).status, 403);
  });

  it("binds a named environment to its current active release", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(Response.json({
        data: [{
          id: "env-staging",
          name: "staging",
          active_release_id: "release-staging-42",
        }],
      }))) as typeof fetch;

    const resolver = new ProjectEnvironmentIdentityResolver();
    assertEquals(
      await resolver.resolveNamedForActiveRelease({
        ...scope(),
        environmentName: "staging",
        expectedEnvironmentId: "env-staging",
        expectedReleaseId: "release-staging-42",
      }),
      "env-staging",
    );
  });

  // The API returns the active release nested under `deployment.release.id`, not
  // as a top-level `active_release_id`. Reading only the flat key resolved every
  // lookup to null, so every release-bound run was denied with "Signed release
  // identity does not match the environment active release" while the signed
  // release and the deployed release were in fact identical.
  it("binds a named environment to the release nested under its deployment", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(Response.json({
        data: [{
          id: "env-staging",
          name: "staging",
          deployment: {
            id: "deployment-1",
            release: { id: "release-staging-42", deploy_status: "deployed" },
          },
        }],
      }))) as typeof fetch;

    const resolver = new ProjectEnvironmentIdentityResolver();
    assertEquals(
      await resolver.resolveNamedForActiveRelease({
        ...scope(),
        environmentName: "staging",
        expectedEnvironmentId: "env-staging",
        expectedReleaseId: "release-staging-42",
      }),
      "env-staging",
    );
  });

  it("still denies a nested release that does not match the signed identity", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(Response.json({
        data: [{
          id: "env-staging",
          name: "staging",
          deployment: { release: { id: "release-other" } },
        }],
      }))) as typeof fetch;

    const error = await assertRejects(() =>
      new ProjectEnvironmentIdentityResolver().resolveNamedForActiveRelease({
        ...scope(),
        environmentName: "staging",
        expectedEnvironmentId: "env-staging",
        expectedReleaseId: "release-staging-42",
      })
    );
    assertEquals((error as { slug?: string }).slug, "permission-denied");
  });

  it("fails closed when active release metadata is missing or does not match", async () => {
    const activeReleaseIds: unknown[] = [undefined, null, "release-other"];
    globalThis.fetch = (() =>
      Promise.resolve(Response.json({
        data: [{
          id: "env-staging",
          name: "staging",
          active_release_id: activeReleaseIds.shift(),
        }],
      }))) as typeof fetch;

    const resolver = new ProjectEnvironmentIdentityResolver();
    for (let index = 0; index < 3; index += 1) {
      const error = await assertRejects(() =>
        resolver.resolveNamedForActiveRelease({
          ...scope(),
          environmentName: "staging",
          expectedEnvironmentId: "env-staging",
          expectedReleaseId: "release-staging-42",
        })
      );
      assertEquals((error as { slug?: string }).slug, "permission-denied");
      assertEquals((error as { status?: number }).status, 403);
    }
  });

  it("does not cache mutable active-release metadata", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(Response.json({
        data: [{
          id: "env-staging",
          name: "staging",
          active_release_id: fetchCalls === 1 ? "release-one" : "release-two",
        }],
      }));
    }) as typeof fetch;

    const resolver = new ProjectEnvironmentIdentityResolver();
    await resolver.resolveNamedForActiveRelease({
      ...scope(),
      environmentName: "staging",
      expectedEnvironmentId: "env-staging",
      expectedReleaseId: "release-one",
    });
    await resolver.resolveNamedForActiveRelease({
      ...scope(),
      environmentName: "staging",
      expectedEnvironmentId: "env-staging",
      expectedReleaseId: "release-two",
    });

    assertEquals(fetchCalls, 2);
  });

  describe("named environment identity cache", () => {
    function stubFetch(counter: { calls: number }, environmentId = "env-staging") {
      globalThis.fetch = (() => {
        counter.calls += 1;
        return Promise.resolve(Response.json({
          data: [{ id: environmentId, name: "staging" }],
        }));
      }) as typeof fetch;
    }

    async function warm(resolver: ProjectEnvironmentIdentityResolver, counter: { calls: number }) {
      stubFetch(counter);
      assertEquals(
        await resolver.resolveNamed({ ...scope(), environmentName: "staging" }),
        "env-staging",
      );
      assertEquals(counter.calls, 1);
    }

    it("serves a repeated named lookup from the identity cache", async () => {
      const counter = { calls: 0 };
      const resolver = new ProjectEnvironmentIdentityResolver();
      await warm(resolver, counter);

      assertEquals(
        await resolver.resolveNamed({ ...scope(), environmentName: "staging" }),
        "env-staging",
      );
      assertEquals(
        counter.calls,
        1,
        "a repeated named lookup must be served from the identity cache",
      );
    });

    const isolationCases: Array<[string, Partial<ReturnType<typeof scope>>]> = [
      ["token", { token: "other-token" }],
      ["projectSlug", { projectSlug: "project-two" }],
      ["projectId", { projectId: "project-id-two" }],
      ["apiBaseUrl", { apiBaseUrl: "https://api.other.test" }],
    ];

    for (const [field, change] of isolationCases) {
      it(`keeps ${field} in the identity cache key`, async () => {
        const counter = { calls: 0 };
        const resolver = new ProjectEnvironmentIdentityResolver();
        await warm(resolver, counter);

        stubFetch(counter, "env-other");
        assertEquals(
          await resolver.resolveNamed({ ...scope(), ...change, environmentName: "staging" }),
          "env-other",
          `${field} must be part of the identity cache key`,
        );
        assertEquals(counter.calls, 2, `changing ${field} must force a fresh lookup`);
      });
    }

    it("still verifies the signed environment ID on a cache hit", async () => {
      const counter = { calls: 0 };
      const resolver = new ProjectEnvironmentIdentityResolver();
      await warm(resolver, counter);

      const error = await assertRejects(() =>
        resolver.resolveNamed({
          ...scope(),
          environmentName: "staging",
          expectedEnvironmentId: "env-production",
        })
      );
      assertEquals(
        (error as { slug?: string }).slug,
        "permission-denied",
        "a cache hit must still run the signed environment ID check",
      );
      assertEquals(counter.calls, 1, "the mismatch must be detected without a refetch");
    });

    it("refetches after clear()", async () => {
      const counter = { calls: 0 };
      const resolver = new ProjectEnvironmentIdentityResolver();
      await warm(resolver, counter);

      resolver.clear();
      assertEquals(
        await resolver.resolveNamed({ ...scope(), environmentName: "staging" }),
        "env-staging",
      );
      assertEquals(counter.calls, 2, "clear() must force a refetch");
    });
  });

  it("rejects oversized lookup responses before parsing", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(" ".repeat(MAX_ENVIRONMENT_LIST_RESPONSE_BYTES + 1)),
      )) as typeof fetch;

    const error = await assertRejects(() => new ProductionEnvironmentResolver().resolve(scope()));
    assertEquals((error as { slug?: string }).slug, "network-error");
    assertEquals((error as { status?: number }).status, 502);
  });

  it("aborts stalled lookup work at the transport deadline", async () => {
    let observedAbort = false;
    globalThis.fetch = ((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = observeFetchRequestInit(init).signal;
        signal?.addEventListener("abort", () => {
          observedAbort = true;
          reject(signal.reason);
        }, { once: true });
      })) as typeof fetch;

    const error = await assertRejects(() =>
      new ProductionEnvironmentResolver({ timeoutMs: 5 }).resolve(scope())
    );
    assertEquals(observedAbort, true);
    assertEquals((error as { slug?: string }).slug, "network-error");
  });

  it("fails closed when production identity is absent or ambiguous", async () => {
    const bodies = [
      { data: [{ id: "env-preview", name: "preview" }] },
      {
        data: [
          { id: "env-prod-one", name: "production" },
          { id: "env-prod-two", name: "Production" },
        ],
      },
    ];
    globalThis.fetch = (() => Promise.resolve(Response.json(bodies.shift()))) as typeof fetch;

    for (let index = 0; index < 2; index += 1) {
      const error = await assertRejects(() => new ProductionEnvironmentResolver().resolve(scope()));
      assertEquals((error as { slug?: string }).slug, "network-error");
    }
  });
});

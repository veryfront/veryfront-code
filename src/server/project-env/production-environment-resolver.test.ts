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
    let requestInit: RequestInit | undefined;
    globalThis.fetch = ((_input, init) => {
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
    assertEquals(requestInit?.redirect, "error");
    assertEquals(new Headers(requestInit?.headers).get("authorization"), "Bearer project-token");
  });

  it("preserves authorization semantics for failed lookups", async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 403 }))) as typeof fetch;

    const error = await assertRejects(() => new ProductionEnvironmentResolver().resolve(scope()));
    assertEquals((error as { slug?: string }).slug, "permission-denied");
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

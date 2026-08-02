import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
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

  it("uses bounded, redirect-safe authenticated transport and selects production exactly", async () => {
    let requestInit: RequestInit | undefined;
    globalThis.fetch = ((_input, init) => {
      requestInit = init;
      return Promise.resolve(Response.json({
        data: [
          { id: "env-preview", name: "preview" },
          { id: "env-production", name: "production" },
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
        init?.signal?.addEventListener("abort", () => {
          observedAbort = true;
          reject(init.signal?.reason);
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
          { id: "env-prod-two", name: "production" },
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

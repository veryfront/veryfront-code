/**
 * Adapter routing for createFSAdapter.
 *
 * Constructing a veryfront-api adapter initializes it over the outbound fetch
 * boundary, so these cases replace the process-global fetch and cannot live
 * beside the colocated unit tests in src/platform/adapters/fs/factory.test.ts.
 */

import "../../_helpers/contract-init.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createFSAdapter } from "#veryfront/platform/adapters/fs/factory.ts";

function disposeAdapter(adapter: unknown): void {
  (adapter as { dispose?: () => void }).dispose?.();
}

describe("createFSAdapter adapter routing", () => {
  it("should route a proxy-mode config to the multi-project adapter", async () => {
    let requests = 0;
    const adapter = await withMockFetch(
      () => {
        requests++;
        return Promise.reject(new Error("proxy mode must not initialize over the network"));
      },
      () =>
        createFSAdapter({
          type: "veryfront-api",
          veryfront: {
            apiBaseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            proxyMode: true,
          },
        }),
    );

    try {
      assertEquals(
        adapter.constructor.name,
        "MultiProjectFSAdapter",
        "proxyMode must route to the multi-project adapter",
      );
      assertEquals(requests, 0, "the multi-project adapter initializes lazily per project");
    } finally {
      disposeAdapter(adapter);
    }
  });

  it("should route a single-project config to the veryfront adapter", async () => {
    const adapter = await withMockFetch(
      (input) => {
        const url = input instanceof Request ? input.url : String(input);
        const body = url.includes("/files")
          ? {
            data: [],
            page_info: { self: null, first: null, next: null, prev: null },
            release_id: "release-1",
            release_version: null,
          }
          : {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Test Project",
            slug: "test-project",
            provider: "veryfront",
            layout: "default",
          };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
      () =>
        createFSAdapter({
          type: "veryfront-api",
          veryfront: {
            apiBaseUrl: "https://api.example.com",
            apiToken: "test-token",
            projectSlug: "test-project",
            contentSource: { type: "release", releaseId: "release-1" },
          },
        }),
    );

    try {
      assertEquals(
        adapter.constructor.name,
        "VeryfrontFSAdapter",
        "single-project config must not get the multi-project adapter",
      );
    } finally {
      disposeAdapter(adapter);
    }
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { shouldRetryUpstreamRequest } from "#veryfront/proxy/retry.ts";
import type { ProxyContext } from "#veryfront/proxy/handler.ts";
import { createSplitForwardRequestInit } from "#veryfront/proxy/split-forward-request.ts";

function previewContext(): ProxyContext {
  return {
    token: "trusted-token",
    projectSlug: "project",
    projectId: "project-id",
    environmentId: "environment-id",
    environmentName: "preview",
    environment: "preview",
    contentSourceId: "preview-main",
    host: "project.preview.veryfront.test",
    parsedDomain: {
      slug: "project",
      isVeryfrontDomain: true,
      environment: "preview",
      branch: null,
      isDraft: true,
      allowIframeEmbed: true,
    },
    isLocalProject: false,
  };
}

describe("split proxy client abort", () => {
  it("aborts the upstream fetch when the incoming request aborts", async () => {
    const client = new AbortController();
    const timeout = new AbortController();
    const request = new Request("https://proxy.test/slow", { signal: client.signal });
    const init = createSplitForwardRequestInit(request, previewContext(), null, timeout.signal);
    let attempts = 0;
    await withMockFetch((_url, upstreamInit) => {
      attempts++;
      return new Promise((_resolve, reject) => {
        upstreamInit?.signal?.addEventListener("abort", () => reject(upstreamInit.signal?.reason), {
          once: true,
        });
      });
    }, async () => {
      const upstream = fetch("https://runtime.test/slow", init);
      client.abort(new Error("connection refused"));
      assertEquals(init.signal?.aborted, true);
      await assertRejects(() => upstream, Error, "connection refused");
      assertEquals(shouldRetryUpstreamRequest(request, "/slow", client.signal.reason), false);
      assertEquals(attempts, 1);
      assertStrictEquals(init.signal?.reason, client.signal.reason);
      assertEquals(timeout.signal.aborted, false);
    });
  });
});

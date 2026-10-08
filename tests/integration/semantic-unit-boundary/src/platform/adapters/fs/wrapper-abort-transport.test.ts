import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { FSAdapterWrapper } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { VeryfrontFSAdapter } from "#veryfront/platform/adapters/fs/veryfront/adapter.ts";

afterEach(() => {
  restoreMockFetch();
});

describe("FSAdapterWrapper transport integration", () => {
  it("propagates abort through a wrapped Veryfront adapter to the API transport", async () => {
    const adapter = new VeryfrontFSAdapter({
      veryfront: {
        apiBaseUrl: "https://api.example.com",
        apiToken: "test-token",
        projectSlug: "test-project",
        cache: { enabled: false },
      },
    });
    const wrapper = new FSAdapterWrapper(adapter);
    const requestStarted = Promise.withResolvers<void>();
    let observedSignal: AbortSignal | undefined;
    installMockFetch(
      ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/projects/test-project/files") {
          observedSignal = init?.signal ?? undefined;
          requestStarted.resolve();
          return new Promise<Response>((_resolve, reject) => {
            const rejectAbort = () => reject(observedSignal?.reason ?? new Error("aborted"));
            if (observedSignal?.aborted) rejectAbort();
            else observedSignal?.addEventListener("abort", rejectAbort, { once: true });
          });
        }
        if (url.pathname === "/projects/test-project") {
          return Promise.resolve(Response.json({
            id: "550e8400-e29b-41d4-a716-446655440000",
            name: "Test Project",
            slug: "test-project",
            provider: "veryfront",
            layout: "default",
          }));
        }
        return Promise.reject(new Error(`Unexpected API request: ${url.pathname}`));
      }) as typeof fetch,
    );
    const controller = new AbortController();
    const read = wrapper.readFile("/veryfront.config.ts", { signal: controller.signal });

    await requestStarted.promise;
    assertEquals(observedSignal?.aborted, false);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const failure = assertRejects(
      () =>
        Promise.race([
          read,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("abort not observed")), 500);
          }),
        ]),
      Error,
    );
    controller.abort();
    try {
      await failure;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      adapter.dispose();
    }
    assertEquals(observedSignal?.aborted, true);
  });
});

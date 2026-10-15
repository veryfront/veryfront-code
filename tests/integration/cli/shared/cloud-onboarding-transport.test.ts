import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createCloudOnboardingTransport } from "../../../../cli/shared/cloud-onboarding-transport.ts";

Deno.test("onboarding cancels a stalled request at its deadline", async () => {
  let cancelled = false;
  await withMockFetch((_input, init) =>
    new Promise((_resolve, reject) => {
      const { signal } = observeFetchRequestInit(init);
      signal?.addEventListener("abort", () => {
        cancelled = true;
        reject(signal.reason);
      }, { once: true });
    }), async () => {
    const transport = createCloudOnboardingTransport("https://api.veryfront.com", 10);
    await assertRejects(() => transport("https://api.veryfront.com/projects"), DOMException);
  });
  assertEquals(cancelled, true);
});

Deno.test("onboarding preserves caller cancellation", async () => {
  const controller = new AbortController();
  let cancelled = false;
  await withMockFetch((_input, init) =>
    new Promise((_resolve, reject) => {
      const { signal } = observeFetchRequestInit(init);
      signal?.addEventListener("abort", () => {
        cancelled = true;
        reject(signal.reason);
      }, { once: true });
      controller.abort();
    }), async () => {
    const transport = createCloudOnboardingTransport("https://api.veryfront.com");
    await assertRejects(
      () => transport("https://api.veryfront.com/projects", { signal: controller.signal }),
      DOMException,
    );
  });
  assertEquals(cancelled, true);
});

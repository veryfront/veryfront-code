import "#veryfront/schemas/_test-setup.ts";
import { createProjectMetadataClient } from "./project-metadata-client.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { FakeTime } from "#std/testing/time";
import { routingRefreshDelayRange, RoutingRefreshScheduler } from "./routing-refresh-scheduler.ts";

describe("routing refresh admission", () => {
  it("bounds a synchronized burst and cancels queued and running refreshes", async () => {
    using time = new FakeTime();
    const scheduler = new RoutingRefreshScheduler(4);
    const releases: Array<() => void> = [];
    let started = 0;
    let aborted = 0;
    for (let i = 0; i < 250; i++) {
      scheduler.schedule(String(i), 45_000, (signal) => {
        started++;
        signal.addEventListener("abort", () => aborted++, { once: true });
        return new Promise<void>((resolve) => releases.push(resolve));
      });
    }
    await time.tickAsync(45_000);
    await time.runMicrotasks();
    assertEquals(started, 4, "background work must leave foreground metadata capacity");
    for (let i = 4; i < 250; i++) scheduler.cancel(String(i));
    scheduler.close();
    assertEquals(aborted, 4);
    for (const release of releases) release();
    await time.runMicrotasks();
    assertEquals(started, 4, "cancelled queued work must never run");
  });

  it("admits the next queued refresh when a slot becomes free", async () => {
    using time = new FakeTime();
    const scheduler = new RoutingRefreshScheduler(1);
    const release = Promise.withResolvers<void>();
    const started: string[] = [];
    scheduler.schedule("first", 10, () => {
      started.push("first");
      return release.promise;
    });
    scheduler.schedule("second", 10, () => {
      started.push("second");
      return Promise.resolve();
    });
    await time.tickAsync(10);
    assertEquals(started, ["first"]);
    release.resolve();
    await time.runMicrotasks();
    assertEquals(started, ["first", "second"]);
    scheduler.close();
  });

  it("leaves a full timeout for each refresh request before the entry expires", () => {
    for (const timeoutMs of [1_000, 5_000, 10_000]) {
      const { minMs, maxMs } = routingRefreshDelayRange(60_000, timeoutMs);
      assertEquals(minMs <= maxMs, true);
      assertEquals(60_000 - maxMs >= 3 * timeoutMs, true, `timeout ${timeoutMs}`);
    }
    // A TTL that cannot fit the budget refreshes at half the TTL, never in a loop.
    assertEquals(routingRefreshDelayRange(60_000, 30_000).maxMs, 30_000);
    assertEquals(routingRefreshDelayRange(60_000, 1_000), { minMs: 39_000, maxMs: 45_000 });
    assertEquals(routingRefreshDelayRange(1, 10_000), { minMs: 1, maxMs: 1 });
  });
});

it("keeps foreground metadata admission available during more than 200 due refreshes", async () => {
  using time = new FakeTime();
  const scheduler = new RoutingRefreshScheduler(4);
  const pending = Promise.withResolvers<Response>();
  let backgroundRequests = 0;
  const fakeFetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith("/foreground")) {
      return Response.json({ id: "proj-123", slug: "foreground", environments: [] });
    }
    backgroundRequests++;
    return await pending.promise;
  }) as typeof fetch;
  const metadata = createProjectMetadataClient({
    apiBaseUrl: "https://api.example.test",
    fetchImpl: fakeFetch,
    maxInflight: 5,
  });
  for (let i = 0; i < 250; i++) {
    scheduler.schedule(String(i), 45_000, async (signal) => {
      await metadata.lookupAccess(`project-${i}`, "service-token", false, { signal });
    });
  }
  try {
    await time.tickAsync(45_000);
    await time.runMicrotasks();
    assertEquals(backgroundRequests, 4);
    const foreground = await metadata.lookupAccess("foreground", "service-token", false);
    assertEquals(foreground?.slug, "foreground");
  } finally {
    scheduler.close();
    pending.resolve(new Response(null, { status: 404 }));
    await time.runMicrotasks();
  }
});

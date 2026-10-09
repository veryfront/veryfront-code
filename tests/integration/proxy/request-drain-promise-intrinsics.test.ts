// Mutates the host Promise prototype, so this regression runs in the Deno
// integration suite rather than a hermetic unit module.
import { recordRequestTransportLifetime } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { ProxyRequestDrainTracker } from "#veryfront/proxy/request-drain.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("proxy request drain Promise intrinsics", () => {
  for (const outcome of ["completed", "error"]) {
    it(`observes native transport ${outcome} despite a replaced Promise.then`, async () => {
      const tracker = new ProxyRequestDrainTracker();
      const request = new Request("https://preview.test/native-completion");
      const transportFinished = Promise.withResolvers<void>();
      recordRequestTransportLifetime(request, transportFinished.promise);
      const response = new Response("preview body");
      const thenDescriptor = Object.getOwnPropertyDescriptor(Promise.prototype, "then")!;
      let mutatedThenCalls = 0;
      tracker.start("native-completion", "GET", "/native-completion");
      try {
        Object.defineProperty(Promise.prototype, "then", {
          ...thenDescriptor,
          value: () => {
            mutatedThenCalls++;
            throw new Error("extension replaced Promise.prototype.then");
          },
        });
        assertStrictEquals(
          tracker.completeOnResponseEnd("native-completion", request, response),
          response,
        );
        assertEquals(tracker.getInFlightCount(), 1);
        if (outcome === "completed") transportFinished.resolve();
        else transportFinished.reject(new Error("native transport failed"));
      } finally {
        Object.defineProperty(Promise.prototype, "then", thenDescriptor);
        await response.body!.cancel("test cleanup");
      }
      assertEquals(mutatedThenCalls, 0);
      assertEquals(await tracker.waitForDrain(50, 2), true);
      assertEquals(tracker.getInFlightCount(), 0);
    });
  }
});

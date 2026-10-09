// Mutates the host Promise prototype, so this regression runs in the Deno
// integration suite rather than a hermetic unit module.
import { recordRequestTransportLifetime } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { ProxyRequestDrainTracker } from "#veryfront/proxy/request-drain.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("proxy request drain Promise intrinsics", () => {
  for (const mode of ["cancel", "abort"]) {
    for (const outcome of ["completed", "error"]) {
      it(`drains fallback ${mode} with source cancellation ${outcome} while Promise.then stays replaced`, async () => {
        // Let the test harness attach its observer before replacing the host method.
        await Promise.resolve();
        const tracker = new ProxyRequestDrainTracker();
        const inboundAbort = new AbortController();
        const request = new Request("https://preview.test/fallback-cancellation", {
          signal: inboundAbort.signal,
        });
        const sourceCanceled = Promise.withResolvers<void>();
        const cancellationError = new Error("source cancellation failed");
        const reason = new Error("response canceled");
        let cancelCalls = 0;
        let cancelReason: unknown;
        const source = new ReadableStream<Uint8Array>({
          cancel(receivedReason) {
            cancelCalls++;
            cancelReason = receivedReason;
            return sourceCanceled.promise;
          },
        });
        tracker.start("fallback-cancellation", "GET", "/fallback-cancellation");
        const response = tracker.completeOnResponseEnd(
          "fallback-cancellation",
          request,
          new Response(source),
        );
        const thenDescriptor = Object.getOwnPropertyDescriptor(Promise.prototype, "then")!;
        let mutatedThenCalls = 0;
        try {
          Object.defineProperty(Promise.prototype, "then", {
            ...thenDescriptor,
            value: () => {
              mutatedThenCalls++;
              throw new Error("extension replaced Promise.prototype.then");
            },
          });
          let cancellation: Promise<void> | undefined;
          if (mode === "cancel") cancellation = response.body!.cancel(reason);
          else inboundAbort.abort(reason);
          assertEquals(cancelCalls, 1);
          assertStrictEquals(cancelReason, reason);
          assertEquals(tracker.getInFlightCount(), 1);
          if (outcome === "completed") sourceCanceled.resolve();
          else sourceCanceled.reject(cancellationError);
          if (cancellation) {
            let receivedError: unknown;
            try {
              await cancellation;
            } catch (error) {
              receivedError = error;
            }
            assertStrictEquals(receivedError, outcome === "error" ? cancellationError : undefined);
          }
          assertEquals(await tracker.waitForDrain(50, 2), true);
          assertEquals(tracker.getInFlightCount(), 0);
          assertEquals(mutatedThenCalls, 0);
        } finally {
          Object.defineProperty(Promise.prototype, "then", thenDescriptor);
          sourceCanceled.resolve();
        }
        if (mode === "abort") {
          await assertRejects(() => response.text(), Error, "response canceled");
        }
      });
    }
  }
  for (const outcome of ["completed", "error"]) {
    it(`consumes fallback source ${outcome} despite a replaced Promise.then`, async () => {
      const tracker = new ProxyRequestDrainTracker();
      const request = new Request("https://preview.test/fallback-completion");
      let sourceController!: ReadableStreamDefaultController<Uint8Array>;
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            sourceController = controller;
            controller.enqueue(new TextEncoder().encode("preview body"));
          },
        }),
      );
      const thenDescriptor = Object.getOwnPropertyDescriptor(Promise.prototype, "then")!;
      let mutatedThenCalls = 0;
      let trackedResponse: Response | undefined;
      let sourceSettled = false;
      tracker.start("fallback-completion", "GET", "/fallback-completion");
      try {
        try {
          Object.defineProperty(Promise.prototype, "then", {
            ...thenDescriptor,
            value: () => {
              mutatedThenCalls++;
              throw new Error("extension replaced Promise.prototype.then");
            },
          });
          trackedResponse = tracker.completeOnResponseEnd("fallback-completion", request, response);
          if (outcome === "completed") sourceController.close();
          else sourceController.error(new Error("fallback source failed"));
          sourceSettled = true;
        } finally {
          Object.defineProperty(Promise.prototype, "then", thenDescriptor);
        }
        // Source settlement alone must retain ownership until the wrapper is consumed.
        await Promise.resolve();
        assertEquals(tracker.getInFlightCount(), 1);
        if (outcome === "completed") {
          assertEquals(await trackedResponse.text(), "preview body");
        } else {
          await assertRejects(() => trackedResponse!.text(), Error, "fallback source failed");
        }
        assertEquals(mutatedThenCalls, 0);
        assertEquals(await tracker.waitForDrain(50, 2), true);
        assertEquals(tracker.getInFlightCount(), 0);
      } finally {
        Object.defineProperty(Promise.prototype, "then", thenDescriptor);
        if (!sourceSettled) sourceController.close();
        if (trackedResponse?.body && !trackedResponse.body.locked) {
          await trackedResponse.body.cancel("test cleanup");
        }
      }
    });
  }
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

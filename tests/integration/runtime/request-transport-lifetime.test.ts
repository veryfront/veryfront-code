import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getRequestPeerProvenance,
  getRequestTransportLifetime,
  recordDenoServeRequestPeer,
  recordRequestTransportLifetime,
} from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

describe("native request lifetime across project prototype mutations", () => {
  it("records and retires Deno completion without consulting Promise.hasInstance", async () => {
    for (
      const poison of [
        () => false,
        () => {
          throw new Error("Promise.hasInstance must not run");
        },
      ]
    ) {
      const request = new Request("http://localhost/_projects");
      let resolveCompleted!: () => void;
      const completed = new Promise<void>((resolve) => {
        resolveCompleted = resolve;
      });
      const descriptor = Object.getOwnPropertyDescriptor(Promise, Symbol.hasInstance);
      let hasInstanceCalls = 0;
      Object.defineProperty(Promise, Symbol.hasInstance, {
        configurable: true,
        value: () => {
          hasInstanceCalls++;
          return poison();
        },
      });

      let recorded = false;
      try {
        recorded = recordDenoServeRequestPeer(request, {
          remoteAddr: {
            transport: "tcp",
            hostname: "::1",
            port: 52_000,
          },
          completed,
        });
      } finally {
        if (descriptor) Object.defineProperty(Promise, Symbol.hasInstance, descriptor);
        else Reflect.deleteProperty(Promise, Symbol.hasInstance);
      }

      assertEquals(recorded, true);
      assertEquals(hasInstanceCalls, 0);
      assertEquals(getRequestPeerProvenance(request), {
        runtime: "deno",
        transport: "tcp",
        hostname: "::1",
      });
      assertStrictEquals(getRequestTransportLifetime(request)?.completed, completed);

      resolveCompleted();
      await completed;
      assertEquals(getRequestTransportLifetime(request), undefined);
    }
  });

  it("captures the native request signal when project code replaces its getter", () => {
    const request = new Request("http://localhost/_projects");
    const nativeSignal = request.signal;
    const replacementSignal = new AbortController().signal;
    const signalDescriptor = Object.getOwnPropertyDescriptor(Request.prototype, "signal");
    if (!signalDescriptor?.get) throw new Error("Request.signal getter is unavailable");

    Object.defineProperty(Request.prototype, "signal", {
      ...signalDescriptor,
      get: () => replacementSignal,
    });
    try {
      recordRequestTransportLifetime(request);
    } finally {
      Object.defineProperty(Request.prototype, "signal", signalDescriptor);
    }

    assertStrictEquals(getRequestTransportLifetime(request)?.signal, nativeSignal);
  });
});

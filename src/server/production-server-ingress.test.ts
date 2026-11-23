import { createManagedBrokerHandler } from "#veryfront/agent/service/managed-broker-handler.ts";
import { BrokerIngressError } from "#veryfront/agent/service/broker-ingress.ts";
import {
  options as brokerOptions,
  signedRequest,
} from "#veryfront/agent/service/broker-ingress.test-helpers.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { installCredentialProbes } from "#veryfront/security/http/credential-probes.test-helpers.ts";
import type { BootstrapResult } from "./bootstrap.ts";
import { startProductionServerWithDependencies } from "./production-server.ts";

const API_TOKEN = "vf-combined-proxy-token-5d02";
const INFERENCE_TOKEN = "vf-combined-inference-token-e81c";

function createBootstrap(adapter: RuntimeAdapter): BootstrapResult {
  return {
    adapter,
    config: { fs: { veryfront: { proxyMode: true } } },
    usingFSAdapter: false,
    fsAdapterType: "MockRuntimeAdapter",
    extensionLoader: {} as BootstrapResult["extensionLoader"],
  };
}

describe("production server ingress", () => {
  it("passes deployment-owned managed routes through the production listener", async () => {
    const signed = await signedRequest();
    const adapter = createMockAdapter();
    let served: Parameters<RuntimeAdapter["serve"]>[0] | undefined;
    adapter.serve = (handler, options) => {
      served = handler;
      options.onListen?.({ hostname: "127.0.0.1", port: options.port ?? 0 });
      return Promise.resolve({
        stop: () => Promise.resolve(),
        addr: { hostname: "127.0.0.1", port: options.port ?? 0 },
      });
    };
    let prepared = false;
    const broker = createManagedBrokerHandler({
      responseMode: "sse",
      broker: { start: () => Promise.reject(new Error("Must not allocate")) },
      resolveIngressOptions: () => brokerOptions(signed.publicKeyPem),
      prepare: () => {
        prepared = true;
        return Promise.reject(new BrokerIngressError(503, "BROKER_UNAVAILABLE"));
      },
    });
    const server = await startProductionServerWithDependencies({
      projectDir: "/production-agent-broker",
      port: 0,
      adapter,
      bootstrapResult: createBootstrap(adapter),
      unhandledRejectionGuard: false,
      managedAgents: {
        handlers: {
          signedStream: broker,
          durableStart: broker,
          agUi: broker,
          cancel: broker,
          resume: broker,
        },
        readiness: () => false,
      },
    }, { bootstrap: () => Promise.reject(new Error("Unexpected bootstrap")) });
    try {
      await server.ready;
      if (!served) throw new Error("Production listener was not installed");
      const response = await served(signed.request);
      if (!(response instanceof Response)) throw new Error("Expected a response");
      assertEquals(response.status, 503);
      assertEquals(await response.json(), { errorCode: "BROKER_UNAVAILABLE" });
      assertEquals(prepared, true);
    } finally {
      await broker.close();
      await server.stop();
    }
  });

  // The probes pin what Deno 2.7.7 calls through the live prototypes.
  it("takes run credentials off the request before the combined-mode interceptor", {
    ignore: !isDeno,
  }, async () => {
    const adapter = createMockAdapter();
    let servedHandler: Parameters<RuntimeAdapter["serve"]>[0] | undefined;
    adapter.serve = (handler, options) => {
      servedHandler = handler;
      options.onListen?.({ hostname: "127.0.0.1", port: options.port ?? 0 });
      return Promise.resolve({
        stop: () => Promise.resolve(),
        addr: { hostname: "127.0.0.1", port: options.port ?? 0 },
      });
    };
    // The interceptor stands in for the in-process proxy, so it reads with
    // the originals rather than through the probes.
    const headersGet = Headers.prototype.get;
    const requestHeaders = Object.getOwnPropertyDescriptor(Request.prototype, "headers")!.get!;
    const seenByInterceptor: (string | null)[] = [];
    const server = await startProductionServerWithDependencies({
      projectDir: "/combined-mode",
      port: 0,
      adapter,
      bootstrapResult: createBootstrap(adapter),
      unhandledRejectionGuard: false,
      requestInterceptor: (request) => {
        const headers = Reflect.apply(requestHeaders, request, []) as Headers;
        seenByInterceptor.push(Reflect.apply(headersGet, headers, ["x-token"]) as string | null);
        return new Request(request.url, {
          headers: { "x-project-slug": "demo", "x-token": "proxy-resolved-token" },
        });
      },
    }, {
      bootstrap: () => Promise.reject(new Error("unexpected bootstrap")),
      // The CLI's local combined mode, the one setup the interceptor is for.
      isLocalCliProxyMode: () => true,
    });

    const request = new Request("http://localhost/page", {
      headers: { "x-token": API_TOKEN, "X-Veryfront-Inference-Token": INFERENCE_TOKEN },
    });
    const probes = installCredentialProbes();
    let response: Response;
    try {
      if (!servedHandler) throw new Error("production listener did not receive a handler");
      const result = await servedHandler(request);
      if (!(result instanceof Response)) throw new Error("Expected an ordinary HTTP response");
      response = result;
    } finally {
      probes.restore();
      await server.stop();
    }
    await response.body?.cancel();

    assertEquals(seenByInterceptor, [null]);
    assertEquals(probes.saw(API_TOKEN), false);
    assertEquals(probes.saw(INFERENCE_TOKEN), false);
  });

  it("refuses the interceptor for a bootstrapped proxy runtime outside the local CLI", async () => {
    const adapter = createMockAdapter();
    await assertRejects(
      () =>
        startProductionServerWithDependencies({
          projectDir: "/combined-mode",
          port: 0,
          adapter,
          bootstrapResult: createBootstrap(adapter),
          unhandledRejectionGuard: false,
          requestInterceptor: (request) => request,
        }, {
          bootstrap: () => Promise.reject(new Error("unexpected bootstrap")),
          isLocalCliProxyMode: () => false,
        }),
      TypeError,
      "local development only",
    );
  });

  it("reads the local CLI marker before bootstrap, so project code cannot forge it", async () => {
    let forged = false;
    const adapter = createMockAdapter();
    await assertRejects(
      () =>
        startProductionServerWithDependencies({
          projectDir: "/combined-mode",
          port: 0,
          adapter,
          unhandledRejectionGuard: false,
          requestInterceptor: (request) => request,
        }, {
          // Stands in for project code, loaded by bootstrap, setting the marker.
          bootstrap: () => {
            forged = true;
            return Promise.resolve(createBootstrap(adapter));
          },
          isLocalCliProxyMode: () => forged,
        }),
      TypeError,
      "local development only",
    );
  });
});

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { deleteEnv, getEnv, setEnv, withEnv } from "#veryfront/testing/deno-compat.ts";
import type { BootstrapResult } from "../../../src/server/bootstrap.ts";
import { startProductionServerWithDependencies } from "../../../src/server/production-server.ts";
import { isAuthenticInternalControlPlaneCandidate } from "../../../src/proxy/control-plane-signature.ts";

const API_TOKEN = "vf-combined-proxy-token-5d02";

function createBootstrap(adapter: RuntimeAdapter): BootstrapResult {
  return {
    adapter,
    config: { fs: { veryfront: { proxyMode: true } } },
    usingFSAdapter: false,
    fsAdapterType: "MockRuntimeAdapter",
    extensionLoader: {} as BootstrapResult["extensionLoader"],
  };
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A control-plane JWS for `path` and an empty body, and its verification key. */
async function mintControlPlaneJws(
  path: string,
): Promise<{ jws: string; publicKeyPem: string }> {
  const keys = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
  const pemBody = btoa(String.fromCharCode(...der)).match(/.{1,64}/g)!.join("\n");
  const now = Math.floor(Date.now() / 1000);
  const emptyBodyHash = base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(""))),
  );
  const header = base64url(encoder.encode(JSON.stringify({ alg: "EdDSA", typ: "JWT" })));
  const payload = base64url(encoder.encode(JSON.stringify({
    iss: "veryfront-api",
    aud: "demo",
    sub: "control-plane",
    project_id: "proj-1",
    iat: now,
    exp: now + 60,
    surface: "channels",
    request_hash: emptyBodyHash,
    request_method: "POST",
    request_path: path,
  })));
  const signature = new Uint8Array(
    await crypto.subtle.sign("Ed25519", keys.privateKey, encoder.encode(`${header}.${payload}`)),
  );
  return {
    jws: `${header}.${payload}.${base64url(signature)}`,
    publicKeyPem: `-----BEGIN PUBLIC KEY-----\n${pemBody}\n-----END PUBLIC KEY-----`,
  };
}

function captureServedHandler(
  adapter: RuntimeAdapter,
): () => (request: Request) => Response | Promise<Response> {
  let servedHandler: ((request: Request) => Response | Promise<Response>) | undefined;
  adapter.serve = (handler, options) => {
    servedHandler = handler;
    options.onListen?.({ hostname: "127.0.0.1", port: options.port ?? 0 });
    return Promise.resolve({
      stop: () => Promise.resolve(),
      addr: { hostname: "127.0.0.1", port: options.port ?? 0 },
    });
  };
  return () => {
    if (!servedHandler) throw new Error("production listener did not receive a handler");
    return servedHandler;
  };
}

describe("production server combined mode with a signed control-plane request", () => {
  it("keeps a signed control-plane request's x-token through a proxy interceptor that writes none", async () => {
    const path = "/api/control-plane/runs/r_1/stream";
    const { jws, publicKeyPem } = await mintControlPlaneJws(path);
    const adapter = createMockAdapter();
    const served = captureServedHandler(adapter);
    let proxyAdmitted: boolean | undefined;
    let body: { error?: string; detail?: string } | undefined;
    await withEnv({ CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: publicKeyPem }, async () => {
      const server = await startProductionServerWithDependencies({
        projectDir: "/combined-mode",
        port: 0,
        adapter,
        bootstrapResult: createBootstrap(adapter),
        unhandledRejectionGuard: false,
        // Stands in for the in-process proxy: it runs the real signed-internal
        // check on the sealed request it receives, then forwards a request of
        // its own that carries the project but no x-token of its own.
        requestInterceptor: async (request) => {
          proxyAdmitted = await isAuthenticInternalControlPlaneCandidate(
            request,
            new URL(request.url),
          );
          return new Request(request.url, {
            method: "POST",
            headers: { "x-project-slug": "demo", "x-veryfront-control-plane-jws": jws },
          });
        },
      }, {
      bootstrap: () => Promise.reject(new Error("unexpected bootstrap")),
      // The CLI's local combined mode, the one setup the interceptor is for.
      isLocalCliProxyMode: () => true,
    });
      try {
        const response = await served()(
          new Request(`http://localhost${path}`, {
            method: "POST",
            headers: { "x-token": API_TOKEN, "x-veryfront-control-plane-jws": jws },
          }),
        );
        body = await response.json();
      } finally {
        await server.stop();
      }
    });

    // The proxy check read the token the request arrived with.
    assertEquals(proxyAdmitted, true);
    // The runtime still found it: proxy mode refuses a request without one.
    assertEquals(
      body?.detail === "x-token header is required in proxy mode",
      false,
      JSON.stringify(body),
    );
  });
});

describe("production server combined-mode interceptor in hosted proxy mode", () => {
  // The interceptor is the CLI's in-process proxy; a deployed runtime must not use it.
  it("refuses it when PROXY_MODE is set without the local CLI marker", async () => {
    await withEnv({ PROXY_MODE: "1" }, async () => {
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
          }, { bootstrap: () => Promise.reject(new Error("unexpected bootstrap")) }),
        TypeError,
        "local development only",
      );
    });
  });

  it("refuses it when bootstrap loads hosted proxy mode", async () => {
    const previous = getEnv("PROXY_MODE");
    if (previous !== undefined) deleteEnv("PROXY_MODE");
    try {
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
            // Stands in for bootstrap loading PROXY_MODE from the project env.
            bootstrap: () => {
              setEnv("PROXY_MODE", "1");
              return Promise.resolve(createBootstrap(adapter));
            },
          }),
        TypeError,
        "local development only",
      );
    } finally {
      if (previous === undefined) deleteEnv("PROXY_MODE");
      else setEnv("PROXY_MODE", previous);
    }
  });

  it("refuses it for a supplied hosted bootstrap even when the marker is set", async () => {
    // A supplied bootstrap already ran project code, which could have set this.
    await withEnv({ VERYFRONT_CLI_LOCAL_PROXY_MODE: "1" }, async () => {
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
          }, { bootstrap: () => Promise.reject(new Error("unexpected bootstrap")) }),
        TypeError,
        "local development only",
      );
    });
  });
});

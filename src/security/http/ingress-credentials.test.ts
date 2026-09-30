import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import {
  getRequestPeerProvenance,
  recordDenoServeRequestPeer,
  recordRequestPeerFromTransport,
} from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import {
  INGRESS_API_TOKEN_HEADER,
  INGRESS_INFERENCE_TOKEN_HEADER,
  INGRESS_RUN_EVENT_TOKEN_HEADER,
  inheritIngressCredentials,
  readIngressCredential,
  requestForWebSocketUpgrade,
  sealIngressCredentials,
} from "./ingress-credentials.ts";
import { installCredentialProbes } from "./credential-probes.test-helpers.ts";

const API_TOKEN = "vf-proxy-token-a1b2c3";
const INFERENCE_TOKEN = "vf-inference-token-d4e5f6";
const RUN_EVENT_TOKEN = "vf-run-event-token-g7h8i9";
const SECRETS = [API_TOKEN, INFERENCE_TOKEN, RUN_EVENT_TOKEN];

function credentialRequest(init: RequestInit = {}): Request {
  return new Request("https://project.example/api/control-plane/runs/run_1/execute", {
    method: "POST",
    body: '{"runId":"run_1"}',
    ...init,
    headers: {
      "content-type": "application/json",
      origin: "https://studio.example",
      "x-veryfront-control-plane-jws": "jws-value",
      "x-token": API_TOKEN,
      "X-Veryfront-Inference-Token": INFERENCE_TOKEN,
      "X-Veryfront-Run-Event-Token": RUN_EVENT_TOKEN,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/** What framework code does with a request after ingress, header reads included. */
function readLikeFramework(request: Request): void {
  request.headers.get("origin");
  request.headers.has("x-veryfront-control-plane-jws");
  request.headers.forEach(() => {});
  for (const _entry of request.headers) { /* consumed */ }
  for (const _entry of request.headers.entries()) { /* consumed */ }
  for (const _key of request.headers.keys()) { /* consumed */ }
  for (const _value of request.headers.values()) { /* consumed */ }
  const responseHeaders = new Headers();
  responseHeaders.set("vary", "Origin");
  responseHeaders.append("access-control-allow-origin", request.headers.get("origin") ?? "");
  // Copies such as the runtime handler's timeout request.
  new Request(request, { signal: new AbortController().signal });
}

// These pin what Deno 2.7.7's own Request and Headers call through the live
// prototypes. Node fails closed instead (assertNativeHeaderProcessing), and
// Bun's Request neither reads inherited init fields nor has symbol internals.
const DENO_INTERNALS = { ignore: !isDeno };

describe("security/http/ingress-credentials", () => {
  it(
    "takes every run credential off the request before a patched intrinsic can see it",
    DENO_INTERNALS,
    () => {
      const request = credentialRequest();
      const probes = installCredentialProbes();
      let sealed: Request;
      try {
        // The server adapter records the transport peer before the handler runs.
        recordDenoServeRequestPeer(request, {
          remoteAddr: { transport: "tcp", hostname: "10.0.0.7" },
        });
        sealed = sealIngressCredentials(request);
        readLikeFramework(sealed);
      } finally {
        probes.restore();
      }

      for (const secret of SECRETS) assertEquals(probes.saw(secret), false, secret);
      // Every probe the framework-style reads reach did run.
      for (
        const name of [
          "get",
          "has",
          "set",
          "append",
          "forEach",
          "entries",
          "keys",
          "values",
          "Symbol.iterator",
          "next",
          "Object.prototype.body",
          "Object.prototype.client",
          "Object.prototype.method",
          "Object.prototype.redirect",
        ]
      ) {
        assert((probes.calls[name] ?? 0) > 0, `${name} probe never ran`);
      }
      assertEquals(readIngressCredential(sealed, INGRESS_API_TOKEN_HEADER), API_TOKEN);
      assertEquals(readIngressCredential(sealed, INGRESS_INFERENCE_TOKEN_HEADER), INFERENCE_TOKEN);
      assertEquals(readIngressCredential(sealed, INGRESS_RUN_EVENT_TOKEN_HEADER), RUN_EVENT_TOKEN);
      assertEquals(getRequestPeerProvenance(sealed)?.hostname, "10.0.0.7");
    },
  );

  it("locks the symbol-keyed internals that captured accessors still reach", DENO_INTERNALS, () => {
    for (const target of [Request.prototype, Headers.prototype]) {
      const internals = Object.getOwnPropertySymbols(target).filter((key) =>
        key !== Symbol.iterator && key !== Symbol.toStringTag
      );
      assert(internals.length > 0);
      for (const key of internals) {
        assertEquals(
          Object.getOwnPropertyDescriptor(target, key)?.configurable,
          false,
          String(key),
        );
        assertThrows(() => Object.defineProperty(target, key, { get: () => undefined }), TypeError);
      }
    }
  });

  it("reads the credential without a patched intrinsic seeing it", () => {
    const sealed = sealIngressCredentials(credentialRequest());
    const unsealed = credentialRequest();
    const probes = installCredentialProbes();
    let values: (string | null)[];
    try {
      values = [
        readIngressCredential(sealed, INGRESS_API_TOKEN_HEADER),
        readIngressCredential(sealed, INGRESS_INFERENCE_TOKEN_HEADER),
        // A request that never passed ingress is read through captured accessors.
        readIngressCredential(unsealed, INGRESS_API_TOKEN_HEADER),
        readIngressCredential(unsealed, INGRESS_INFERENCE_TOKEN_HEADER),
      ];
    } finally {
      probes.restore();
    }

    assertEquals(values, [API_TOKEN, INFERENCE_TOKEN, API_TOKEN, INFERENCE_TOKEN]);
    assertEquals(probes.observed, []);
  });

  it(
    "is what stops the probes: the same reads on the original request expose it",
    DENO_INTERNALS,
    () => {
      const request = credentialRequest();
      const probes = installCredentialProbes();
      try {
        readLikeFramework(request);
      } finally {
        probes.restore();
      }

      for (const secret of SECRETS) assertEquals(probes.saw(secret), true, secret);
    },
  );

  it("keeps the method, other headers, body, redirect, signal and peer", async () => {
    const controller = new AbortController();
    const request = credentialRequest({ redirect: "manual", signal: controller.signal });
    recordRequestPeerFromTransport(request, {
      runtime: "deno",
      transport: "tcp",
      hostname: "10.0.0.7",
    });

    const sealed = sealIngressCredentials(request);

    assertEquals(sealed.url, request.url);
    assertEquals(sealed.method, "POST");
    assertEquals(sealed.redirect, "manual");
    assertEquals([...sealed.headers], [
      ["content-type", "application/json"],
      ["origin", "https://studio.example"],
      ["x-veryfront-control-plane-jws", "jws-value"],
    ]);
    assertEquals(getRequestPeerProvenance(sealed), getRequestPeerProvenance(request));
    assertEquals(sealed.signal.aborted, false);
    controller.abort(new Error("run cancelled"));
    assertEquals(sealed.signal.aborted, true);
    assertEquals(await sealed.text(), '{"runId":"run_1"}');
  });

  it("returns a request without credentials unchanged", () => {
    const request = new Request("https://project.example/page", {
      headers: { origin: "https://studio.example" },
    });

    const sealed = sealIngressCredentials(request);

    assertStrictEquals(sealed, request);
    assertEquals(readIngressCredential(sealed, INGRESS_API_TOKEN_HEADER), null);
    assertEquals(readIngressCredential(sealed, INGRESS_INFERENCE_TOKEN_HEADER), null);
  });

  it("seals a WebSocket upgrade and keeps the server request for the upgrade call only", () => {
    const request = new Request("https://project.example/_ws", {
      headers: { upgrade: "websocket", "x-token": API_TOKEN },
    });

    const sealed = sealIngressCredentials(request);

    assert(sealed !== request);
    assertEquals(sealed.headers.get("x-token"), null);
    assertEquals(sealed.headers.get("upgrade"), "websocket");
    assertEquals(readIngressCredential(sealed, INGRESS_API_TOKEN_HEADER), API_TOKEN);
    assertStrictEquals(requestForWebSocketUpgrade(sealed), request);
    // A framework copy on the way to the upgrade still resolves to it.
    assertStrictEquals(
      requestForWebSocketUpgrade(inheritIngressCredentials(sealed, new Request(sealed))),
      request,
    );
    const plain = new Request("https://project.example/page");
    assertStrictEquals(requestForWebSocketUpgrade(plain), plain);
  });

  it("refuses to hand out the credential-bearing upgrade request once Headers.get was replaced", () => {
    const sealed = sealIngressCredentials(
      new Request("https://project.example/_ws", {
        headers: { upgrade: "websocket", "x-token": API_TOKEN },
      }),
    );
    const probes = installCredentialProbes();
    try {
      assertThrows(() => requestForWebSocketUpgrade(sealed), TypeError);
    } finally {
      probes.restore();
    }
    assertEquals(probes.saw(API_TOKEN), false);
  });

  it("carries the credentials to a framework copy, and none to a copy of an unsealed request", () => {
    const sealed = sealIngressCredentials(credentialRequest());
    const copy = inheritIngressCredentials(sealed, new Request(sealed));
    assertEquals(copy.headers.get("x-token"), null);
    assertEquals(readIngressCredential(copy, INGRESS_API_TOKEN_HEADER), API_TOKEN);

    // A copy that is later re-derived from an unsealed request reads its own headers.
    const unsealed = new Request("https://project.example/page");
    inheritIngressCredentials(unsealed, copy);
    assertEquals(readIngressCredential(copy, INGRESS_API_TOKEN_HEADER), null);
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import {
  handleProxyRoutingInvalidationRequest,
  PROXY_ROUTING_INVALIDATION_PATH,
  type ProxyRoutingInvalidationEvent,
} from "./routing-invalidation.ts";

const encoder = new TextEncoder();

async function sha256Base64url(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  return base64urlEncodeBytes(new Uint8Array(digest));
}

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

async function createDispatchSignature(
  body: string,
  overrides: Partial<{
    audience: string;
    projectId: string;
    subject: string;
    platform: string;
  }> = {},
): Promise<{ jws: string; publicKeyPem: string }> {
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyDer = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyPem = encodePem("PUBLIC KEY", publicKeyDer);
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "veryfront-api",
    aud: overrides.audience ?? "demo-project",
    sub: overrides.subject ?? "deployment-routing-invalidation",
    project_id: overrides.projectId ?? "proj-1",
    platform: overrides.platform ?? "proxy-routing",
    body_sha256: await sha256Base64url(body),
    iat: now,
    exp: now + 60,
  };
  const encodedHeader = base64urlEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const encodedPayload = base64urlEncode(JSON.stringify(claims));
  const signingInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, signingInput);

  return {
    publicKeyPem,
    jws: `${encodedHeader}.${encodedPayload}.${base64urlEncodeBytes(new Uint8Array(signature))}`,
  };
}

function createBody(): string {
  return JSON.stringify({
    version: 1,
    projectId: "proj-1",
    projectSlug: "demo-project",
    deploymentId: "deployment-1",
    environmentId: "environment-1",
    environmentName: "production",
    releaseId: "release-1",
  });
}

describe("proxy routing invalidation ingress", () => {
  it("accepts a body-bound deployment invalidation and waits for replica acknowledgements", async () => {
    const body = createBody();
    const { jws, publicKeyPem } = await createDispatchSignature(body);
    const events: ProxyRoutingInvalidationEvent[] = [];
    const response = await handleProxyRoutingInvalidationRequest(
      new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-dispatch-jws": jws,
        },
        body,
      }),
      {
        publicKeyPem,
        createEventId: () => "event-1",
        publisher: {
          publish: (event) => {
            events.push(event);
            return Promise.resolve({ acknowledged: 2, converged: true, recipients: 2 });
          },
        },
      },
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      acknowledged: 2,
      converged: true,
      recipients: 2,
    });
    assertEquals(events, [{
      eventId: "event-1",
      version: 1,
      projectId: "proj-1",
      projectSlug: "demo-project",
      deploymentId: "deployment-1",
      environmentId: "environment-1",
      environmentName: "production",
      releaseId: "release-1",
    }]);
  });

  it("rejects a valid signature when the signed project does not match the body", async () => {
    const body = createBody();
    const { jws, publicKeyPem } = await createDispatchSignature(body, {
      projectId: "different-project",
    });
    let published = false;
    const response = await handleProxyRoutingInvalidationRequest(
      new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
        method: "POST",
        headers: { "x-veryfront-dispatch-jws": jws },
        body,
      }),
      {
        publicKeyPem,
        publisher: {
          publish: () => {
            published = true;
            return Promise.resolve({ acknowledged: 1, converged: true, recipients: 1 });
          },
        },
      },
    );

    assertEquals(response.status, 401);
    assertEquals(published, false);
  });

  it("rejects a signature when the request body is changed after signing", async () => {
    const signedBody = createBody();
    const { jws, publicKeyPem } = await createDispatchSignature(signedBody);
    const changedBody = signedBody.replace("release-1", "release-2");
    const response = await handleProxyRoutingInvalidationRequest(
      new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
        method: "POST",
        headers: { "x-veryfront-dispatch-jws": jws },
        body: changedBody,
      }),
      {
        publicKeyPem,
        publisher: {
          publish: () => Promise.resolve({ acknowledged: 1, converged: true, recipients: 1 }),
        },
      },
    );

    assertEquals(response.status, 401);
  });

  it("reports unavailable when replica convergence is not acknowledged", async () => {
    const body = createBody();
    const { jws, publicKeyPem } = await createDispatchSignature(body);
    const response = await handleProxyRoutingInvalidationRequest(
      new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
        method: "POST",
        headers: { "x-veryfront-dispatch-jws": jws },
        body,
      }),
      {
        publicKeyPem,
        publisher: {
          publish: () => Promise.resolve({ acknowledged: 1, converged: false, recipients: 2 }),
        },
      },
    );

    assertEquals(response.status, 503);
    assertEquals(await response.json(), {
      acknowledged: 1,
      converged: false,
      recipients: 2,
    });
  });

  it("fails closed when signing verification is not configured", async () => {
    const response = await handleProxyRoutingInvalidationRequest(
      new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
        method: "POST",
        body: createBody(),
      }),
      {
        publicKeyPem: "",
        publisher: {
          publish: () => Promise.resolve({ acknowledged: 1, converged: true, recipients: 1 }),
        },
      },
    );

    assertEquals(response.status, 503);
  });

  it("cancels an oversized streaming body without a content-length header", async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(encoder.encode("x".repeat(8 * 1024 + 1)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await handleProxyRoutingInvalidationRequest(
      new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
        method: "POST",
        body,
      }),
      {
        publicKeyPem: "configured",
        publisher: {
          publish: () => Promise.resolve({ acknowledged: 1, converged: true, recipients: 1 }),
        },
      },
    );

    assertEquals(response.status, 413);
    assertEquals(cancelled, true);
    assertEquals(pulls < 10, true);
  });
});

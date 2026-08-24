import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import {
  createProxyRoutingInvalidationRejectionThrottle,
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

  it("rejects publisher results whose convergence contradicts its counts", async () => {
    // A bus that claims convergence while no replica acknowledged would tell the
    // deploying control plane the old release is no longer being served.
    const body = createBody();
    const { jws, publicKeyPem } = await createDispatchSignature(body);
    const contradictoryResults = [
      { acknowledged: 0, converged: true, recipients: 0 },
      { acknowledged: 1, converged: true, recipients: 2 },
      { acknowledged: 3, converged: false, recipients: 2 },
    ];

    for (const result of contradictoryResults) {
      const label = JSON.stringify(result);
      const response = await handleProxyRoutingInvalidationRequest(
        new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
          method: "POST",
          headers: { "x-veryfront-dispatch-jws": jws },
          body,
        }),
        {
          publicKeyPem,
          publisher: {
            publish: () => Promise.resolve(result),
          },
        },
      );

      assertEquals(
        response.status,
        503,
        `an inconsistent publisher result must not be reported as success: ${label}`,
      );
      assertEquals(
        await response.json(),
        { error: "Routing invalidation did not converge" },
        `an invalid publisher result must return the generic failure body, not the raw counts: ${label}`,
      );
    }
  });

  it("rejects malformed invalidation input before it reaches the publisher", async () => {
    // The 400 gate runs before the signature gate, so it is what stands between
    // an unauthenticated caller and caller-shaped audience/project claims.
    const { publicKeyPem } = await createDispatchSignature(createBody());
    const valid = JSON.parse(createBody()) as Record<string, unknown>;
    const malformedBodies: Array<[string, string]> = [
      ["a body that is not JSON at all", "{ not json"],
      ["an unsupported version", JSON.stringify({ ...valid, version: 2 })],
      ["an uppercase project slug", JSON.stringify({ ...valid, projectSlug: "Demo-Project" })],
      ["a project slug with a leading hyphen", JSON.stringify({ ...valid, projectSlug: "-demo" })],
      ["an empty release id", JSON.stringify({ ...valid, releaseId: "" })],
    ];
    const published: ProxyRoutingInvalidationEvent[] = [];

    for (const [label, malformed] of malformedBodies) {
      const response = await handleProxyRoutingInvalidationRequest(
        new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
          method: "POST",
          body: malformed,
        }),
        {
          publicKeyPem,
          publisher: {
            publish: (event) => {
              published.push(event);
              return Promise.resolve({ acknowledged: 1, converged: true, recipients: 1 });
            },
          },
        },
      );

      assertEquals(response.status, 400, `${label} must be rejected as malformed input`);
      assertEquals(published.length, 0, `${label} must never reach the publisher`);
    }
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
      new Request(
        `http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`,
        {
          method: "POST",
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" },
      ),
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
  it("logs why a routing invalidation signature was rejected", async () => {
    // A silent 401 is why this path stayed inert in production for a month:
    // the proxy answered every invalidation with 401 and logged nothing, so
    // neither the sender nor the pod logs named a cause.
    const body = createBody();
    const { jws, publicKeyPem } = await createDispatchSignature(body);
    const tampered = jws.slice(0, -4) + (jws.endsWith("AAAA") ? "BBBB" : "AAAA");
    const warnings: Array<{ message: string; extra?: Record<string, unknown> }> = [];
    const response = await handleProxyRoutingInvalidationRequest(
      new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
        method: "POST",
        headers: { "x-veryfront-dispatch-jws": tampered },
        body,
      }),
      {
        publicKeyPem,
        logger: {
          warn: (message, extra) => warnings.push({ message, extra }),
        },
        publisher: {
          publish: () => Promise.resolve({ acknowledged: 1, converged: true, recipients: 1 }),
        },
      },
    );

    assertEquals(response.status, 401);
    assertEquals(warnings.length, 1);
    const [warning] = warnings;
    assertEquals(typeof warning?.extra?.reason, "string");
    assertStringIncludes(String(warning?.extra?.reason), "signature verification failed");
    // The rejected credential must never reach the log.
    const serialized = JSON.stringify(warnings);
    assertEquals(serialized.includes(tampered), false);
    assertEquals(serialized.includes(tampered.split(".")[2] ?? ""), false);
  });

  it("keeps caller-supplied identifiers out of a rejected invalidation warning", async () => {
    // Nothing in the body is trustworthy on this path: verification has already
    // failed, so every identifier is attacker-chosen. Logging them lets an
    // unauthenticated caller pin a forged rejection on someone else's project
    // and turns each request into ~4.5KB of caller-controlled log volume, which
    // AGENTS.md ("Secret and internal-detail safety") forbids. The reason is
    // minted by our own verification code, so it stays.
    const body = createBody();
    const { jws, publicKeyPem } = await createDispatchSignature(body);
    const tampered = jws.slice(0, -4) + (jws.endsWith("AAAA") ? "BBBB" : "AAAA");
    const warnings: Array<{ message: string; extra?: Record<string, unknown> }> = [];
    const response = await handleProxyRoutingInvalidationRequest(
      new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
        method: "POST",
        headers: { "x-veryfront-dispatch-jws": tampered },
        body,
      }),
      {
        publicKeyPem,
        logger: {
          warn: (message, extra) => warnings.push({ message, extra }),
        },
        publisher: {
          publish: () => Promise.resolve({ acknowledged: 1, converged: true, recipients: 1 }),
        },
      },
    );

    assertEquals(response.status, 401);
    assertEquals(warnings.length, 1);
    assertStringIncludes(String(warnings[0]?.extra?.reason), "signature verification failed");
    const serialized = JSON.stringify(warnings);
    for (
      const identifier of [
        "proj-1",
        "demo-project",
        "deployment-1",
        "environment-1",
        "production",
        "release-1",
      ]
    ) {
      assertEquals(
        serialized.includes(identifier),
        false,
        `rejection warning leaked the caller-supplied identifier ${identifier}`,
      );
    }
  });

  it("logs the missing-signature rejection without inventing a verification reason", async () => {
    const body = createBody();
    const warnings: Array<{ message: string; extra?: Record<string, unknown> }> = [];
    const response = await handleProxyRoutingInvalidationRequest(
      new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
        method: "POST",
        body,
      }),
      {
        publicKeyPem: "configured",
        logger: {
          warn: (message, extra) => warnings.push({ message, extra }),
        },
        publisher: {
          publish: () => Promise.resolve({ acknowledged: 1, converged: true, recipients: 1 }),
        },
      },
    );

    assertEquals(response.status, 401);
    assertEquals(warnings.length, 1);
    assertStringIncludes(String(warnings[0]?.extra?.reason), "missing");
  });

  it("keeps a failing log sink from upgrading a rejection into a 500", async () => {
    // Diagnosability must not cost availability: a transport or serialization
    // failure in the warning sink cannot be allowed to rewrite the answer.
    const body = createBody();
    const { jws, publicKeyPem } = await createDispatchSignature(body);
    const tampered = jws.slice(0, -4) + (jws.endsWith("AAAA") ? "BBBB" : "AAAA");
    const logger = {
      warn: (): void => {
        throw new Error("sink down");
      },
    };
    const publisher = {
      publish: () => Promise.resolve({ acknowledged: 1, converged: true, recipients: 1 }),
    };

    const rejected = await handleProxyRoutingInvalidationRequest(
      new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
        method: "POST",
        headers: { "x-veryfront-dispatch-jws": tampered },
        body,
      }),
      { publicKeyPem, logger, publisher },
    );

    assertEquals(rejected.status, 401, "a throwing log sink must not change the rejection status");
    assertEquals(
      await rejected.json(),
      { error: "Invalid routing invalidation signature" },
      "the generic rejection body must be preserved",
    );

    const accepted = await handleProxyRoutingInvalidationRequest(
      new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
        method: "POST",
        headers: { "x-veryfront-dispatch-jws": jws },
        body,
      }),
      { publicKeyPem, logger, publisher },
    );

    assertEquals(
      accepted.status,
      200,
      "a throwing log sink must not poison a later valid invalidation",
    );
  });

  it("coalesces repeated rejections of one class into a counted warning", async () => {
    // Unauthenticated callers reach this path, so one log write per request is
    // an amplification lever. The first rejection must still warn immediately —
    // suppressing it would rebuild the silence that hid this bug for a month.
    const body = createBody();
    const warnings: Array<{ message: string; extra?: Record<string, unknown> }> = [];
    let clockMs = 0;
    const rejectionThrottle = createProxyRoutingInvalidationRejectionThrottle({
      nowMs: () => clockMs,
      windowMs: 60_000,
    });
    const reject = (): Promise<Response> =>
      handleProxyRoutingInvalidationRequest(
        new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
          method: "POST",
          body,
        }),
        {
          publicKeyPem: "configured",
          logger: {
            warn: (message, extra) => warnings.push({ message, extra }),
          },
          publisher: {
            publish: () => Promise.resolve({ acknowledged: 1, converged: true, recipients: 1 }),
          },
          rejectionThrottle,
        },
      );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      assertEquals((await reject()).status, 401);
      clockMs += 1_000;
    }
    assertEquals(warnings.length, 1);
    assertEquals(warnings[0]?.extra?.coalescedSincePreviousWarning, undefined);

    clockMs += 60_000;
    assertEquals((await reject()).status, 401);
    assertEquals(warnings.length, 2);
    assertEquals(warnings[1]?.extra?.coalescedSincePreviousWarning, 4);
    assertStringIncludes(String(warnings[1]?.extra?.reason), "missing");

    // An NTP step backwards must not silence the class until the clock catches up.
    clockMs -= 300_000;
    assertEquals((await reject()).status, 401);
    assertEquals(
      warnings.length,
      3,
      "a backwards clock step must expire the window instead of silencing the class",
    );
  });

  it("buckets unforeseen rejection classes into a shared overflow class", () => {
    // Mirrors MAX_TRACKED_REJECTION_CLASSES in routing-invalidation.ts: the map
    // is capped so an error type carrying a dynamic name cannot grow it forever.
    const maxTrackedRejectionClasses = 32;
    const throttle = createProxyRoutingInvalidationRejectionThrottle({
      nowMs: () => 0,
      windowMs: 60_000,
    });

    for (let index = 0; index < maxTrackedRejectionClasses; index += 1) {
      assertEquals(
        throttle.admit(`class-${index}`),
        0,
        `the first rejection of class-${index} must warn immediately`,
      );
    }

    assertEquals(
      throttle.admit("class-overflow-a"),
      0,
      "the first overflow-class rejection still warns",
    );
    assertEquals(
      throttle.admit("class-overflow-b"),
      null,
      "a second distinct unforeseen class must coalesce into the shared overflow bucket rather than grow the map",
    );
  });

  // Deliberately no in-process "missing SchemaValidator" test. One was written
  // and removed: `lazySchema` memoises a materialized schema permanently, so an
  // in-process `unregister("SchemaValidator")` is a no-op once any earlier test
  // in this file has parsed a JWS — and an invalid `publicKeyPem` makes WebCrypto
  // throw "Invalid key data" first regardless. It asserted only that some reason
  // string existed, which every rejection path satisfies, so it would have passed
  // with the fix deleted. The production failure mode needs a clean process and is
  // covered by cli/commands/serve/proxy-runtime-schema-contracts.test.ts.
});

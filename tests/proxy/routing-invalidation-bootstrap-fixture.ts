/**
 * Clean-process fixture for the dedicated proxy binary's routing-invalidation
 * ingress.
 *
 * The unit suites register a SchemaValidator through
 * `deno test --preload=src/testing/preload.ts`, which no proxy process ever
 * does. This fixture therefore runs as its own `deno run` process, with no
 * preload and no `#veryfront/schemas/_test-setup.ts` import, so it observes the
 * contract registry exactly as a proxy pod does: whatever the proxy bootstrap
 * registers, and nothing else.
 *
 * It reproduces the production sequence — bootstrap the standalone proxy
 * runtime, then serve a signed deployment invalidation — and prints
 * `__RESULT__<json>` on stdout so the owning test can assert the status.
 *
 * @module commands/serve/_routing-invalidation-bootstrap-fixture
 */

import {
  handleProxyRoutingInvalidationRequest,
  PROXY_ROUTING_INVALIDATION_PATH,
  PROXY_ROUTING_INVALIDATION_PLATFORM,
  PROXY_ROUTING_INVALIDATION_SUBJECT,
} from "#veryfront/proxy/routing-invalidation.ts";
import { base64urlEncode, base64urlEncodeBytes } from "veryfront/utils";
import { tryResolve } from "veryfront/extensions/contracts";
import { runStandaloneProxyRuntime } from "../../cli/commands/serve/proxy-runtime.ts";

/** Marker prefix for the single machine-readable stdout line. */
const ROUTING_INVALIDATION_FIXTURE_RESULT_PREFIX = "__RESULT__";

const encoder = new TextEncoder();

const BODY = JSON.stringify({
  version: 1,
  projectId: "proj-1",
  projectSlug: "demo-project",
  deploymentId: "deployment-1",
  environmentId: "environment-1",
  environmentName: "production",
  releaseId: "release-1",
});

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

async function signBody(
  body: string,
): Promise<{ jws: string; publicKeyPem: string }> {
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyPem = encodePem(
    "PUBLIC KEY",
    await crypto.subtle.exportKey("spki", keyPair.publicKey),
  );
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64urlEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const encodedPayload = base64urlEncode(JSON.stringify({
    iss: "veryfront-api",
    aud: "demo-project",
    sub: PROXY_ROUTING_INVALIDATION_SUBJECT,
    project_id: "proj-1",
    platform: PROXY_ROUTING_INVALIDATION_PLATFORM,
    body_sha256: base64urlEncodeBytes(new Uint8Array(digest)),
    iat: now,
    exp: now + 60,
  }));
  const signature = await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    encoder.encode(`${encodedHeader}.${encodedPayload}`),
  );
  return {
    publicKeyPem,
    jws: `${encodedHeader}.${encodedPayload}.${base64urlEncodeBytes(new Uint8Array(signature))}`,
  };
}

await runStandaloneProxyRuntime({}, {
  activateExtensions: () => Promise.resolve(null),
  registerTeardown: () => Promise.resolve(() => Promise.resolve()),
  // The real entrypoint imports `veryfront/proxy/main`, which binds a socket.
  // Only the bootstrap that precedes it is under test here.
  loadProxy: () => Promise.resolve(),
  keepAlive: () => Promise.resolve(),
});

const schemaValidatorRegistered = tryResolve("SchemaValidator") !== undefined;
const { jws, publicKeyPem } = await signBody(BODY);
const response = await handleProxyRoutingInvalidationRequest(
  new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-veryfront-dispatch-jws": jws },
    body: BODY,
  }),
  {
    publicKeyPem,
    createEventId: () => "event-1",
    publisher: {
      publish: () => Promise.resolve({ acknowledged: 2, converged: true, recipients: 2 }),
    },
  },
);

console.log(
  `${ROUTING_INVALIDATION_FIXTURE_RESULT_PREFIX}${
    JSON.stringify({
      schemaValidatorRegistered,
      status: response.status,
      body: await response.json(),
    })
  }`,
);

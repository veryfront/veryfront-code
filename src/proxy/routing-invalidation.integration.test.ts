import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createMockServer } from "../../tests/_helpers/utils.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { createProxyHandler } from "./handler.ts";
import {
  type RoutingInvalidationRedisClient,
  startProxyRoutingInvalidationBus,
} from "./routing-invalidation-redis.ts";
import {
  handleProxyRoutingInvalidationRequest,
  PROXY_ROUTING_INVALIDATION_PATH,
} from "./routing-invalidation.ts";

const encoder = new TextEncoder();

function createFakeRedisServer() {
  type Listener = (message: string, channel: string) => void;
  const subscriptions = new Map<RoutingInvalidationRedisClient, Map<string, Listener>>();

  const createClient = (): RoutingInvalidationRedisClient => {
    const client: RoutingInvalidationRedisClient = {
      connect: () => Promise.resolve(),
      publish: async (channel, message) => {
        const listeners = [...subscriptions.values()]
          .map((channels) => channels.get(channel))
          .filter((listener): listener is Listener => Boolean(listener));
        for (const listener of listeners) queueMicrotask(() => listener(message, channel));
        return listeners.length;
      },
      subscribe: (channel, listener) => {
        const channels = subscriptions.get(client) ?? new Map<string, Listener>();
        channels.set(channel, listener);
        subscriptions.set(client, channels);
        return Promise.resolve(1);
      },
      unsubscribe: (channel) => {
        subscriptions.get(client)?.delete(channel);
        return Promise.resolve(0);
      },
      close: () => {
        subscriptions.delete(client);
        return Promise.resolve();
      },
      destroy: () => subscriptions.delete(client),
    };
    return client;
  };

  return { createClient };
}

async function createSigner() {
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyDer = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyDer)));
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${base64}\n-----END PUBLIC KEY-----`;

  return {
    publicKeyPem,
    async sign(body: string): Promise<string> {
      const digest = await crypto.subtle.digest("SHA-256", encoder.encode(body));
      const now = Math.floor(Date.now() / 1000);
      const header = base64urlEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
      const payload = base64urlEncode(JSON.stringify({
        iss: "veryfront-api",
        aud: "demo-project",
        sub: "deployment-routing-invalidation",
        project_id: "project-1",
        platform: "proxy-routing",
        body_sha256: base64urlEncodeBytes(new Uint8Array(digest)),
        iat: now,
        exp: now + 60,
      }));
      const signature = await crypto.subtle.sign(
        "Ed25519",
        keyPair.privateKey,
        encoder.encode(`${header}.${payload}`),
      );
      return `${header}.${payload}.${base64urlEncodeBytes(new Uint8Array(signature))}`;
    },
  };
}

it("converges deploy and rollback routing across two proxy replicas", async () => {
  let activeReleaseId = "release-old";
  const { server, port } = createMockServer((req: Request) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/auth/token") {
      return Response.json({
        access_token: "test-token",
        token_type: "Bearer",
        expires_in: 3_600,
      });
    }
    if (pathname.startsWith("/projects/-/proxy-routing/")) {
      return Response.json({
        id: "project-1",
        slug: "demo-project",
        name: "Demo Project",
        environments: [{
          id: "environment-1",
          name: "production",
          domains: [],
          active_release_id: activeReleaseId,
        }],
      });
    }
    return new Response("Not found", { status: 404 });
  });
  const createHandler = () =>
    createProxyHandler({
      config: {
        apiBaseUrl: `http://127.0.0.1:${port}`,
        apiClientId: "test-client",
        apiClientSecret: "test-secret",
        previewApiClientId: "test-client",
        previewApiClientSecret: "test-secret",
      },
    });
  const handlerA = createHandler();
  const handlerB = createHandler();
  const confirmations = { a: 0, b: 0 };
  const redis = createFakeRedisServer();
  const integritySecret = crypto.randomUUID();
  const busA = await startProxyRoutingInvalidationBus({
    redisUrl: "redis://example.test:6379",
    expectedReplicas: 2,
    replicaId: "replica-a",
    acknowledgementTimeoutMs: 100,
    createClient: redis.createClient,
    integritySecret,
    onInvalidate: async (event) => {
      await handlerA.invalidateAndConfirmRoutingLookup(event);
      confirmations.a++;
    },
  });
  const busB = await startProxyRoutingInvalidationBus({
    redisUrl: "redis://example.test:6379",
    expectedReplicas: 2,
    replicaId: "replica-b",
    acknowledgementTimeoutMs: 100,
    createClient: redis.createClient,
    integritySecret,
    onInvalidate: async (event) => {
      await handlerB.invalidateAndConfirmRoutingLookup(event);
      confirmations.b++;
    },
  });
  const signer = await createSigner();

  const activate = async (deploymentId: string, releaseId: string) => {
    activeReleaseId = releaseId;
    const body = JSON.stringify({
      version: 1,
      projectId: "project-1",
      projectSlug: "demo-project",
      deploymentId,
      environmentId: "environment-1",
      environmentName: "production",
      releaseId,
    });
    const response = await handleProxyRoutingInvalidationRequest(
      new Request(`http://proxy.test${PROXY_ROUTING_INVALIDATION_PATH}`, {
        method: "POST",
        headers: { "x-veryfront-dispatch-jws": await signer.sign(body) },
        body,
      }),
      { publicKeyPem: signer.publicKeyPem, publisher: busA },
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      acknowledged: 2,
      converged: true,
      recipients: 2,
    });
  };

  try {
    await activate("deployment-new", "release-new");
    assertEquals(confirmations, { a: 1, b: 1 });

    await activate("deployment-rollback", "release-old");
    assertEquals(confirmations, { a: 2, b: 2 });
  } finally {
    await busA?.close();
    await busB?.close();
    await handlerA.close();
    await handlerB.close();
    await server.shutdown();
  }
});

import type { Agent } from "#veryfront/agent";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { ChannelAssistantsHandler } from "./channel-assistants.handler.ts";

const encoder = new TextEncoder();

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

async function sha256Base64url(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(body));
  return base64urlEncodeBytes(new Uint8Array(digest));
}

async function createDispatchSignature(
  body: string,
  overrides: Partial<{
    audience: string;
    projectId: string;
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

  const header = base64urlEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const payload = base64urlEncode(JSON.stringify({
    iss: "veryfront-api",
    aud: overrides.audience ?? "demo-project",
    sub: "assistants-1",
    project_id: overrides.projectId ?? "proj-1",
    platform: "slack",
    body_sha256: await sha256Base64url(body),
    iat: now,
    exp: now + 60,
  }));

  const signingInput = encoder.encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, signingInput);

  return {
    publicKeyPem,
    jws: `${header}.${payload}.${base64urlEncodeBytes(new Uint8Array(signature))}`,
  };
}

function createCtx(publicKeyPem?: string): HandlerContext {
  return {
    projectDir: "/project",
    adapter: {
      env: {
        get: (key: string) =>
          key === "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY" ? publicKeyPem : undefined,
      },
      fs: {},
    },
    securityConfig: null,
    cspUserHeader: null,
    projectSlug: "demo-project",
    projectId: "proj-1",
    isLocalProject: false,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/channel-assistants.handler", () => {
  it("returns discovered assistants for a valid signed request", async () => {
    let discoveryCalls = 0;
    const handler = new ChannelAssistantsHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
      },
      getAgent: (id) => {
        if (id === "assistant-1") {
          return {
            id,
            config: {
              system: "You are Support.",
              model: "anthropic/claude-sonnet-4-6",
              name: "Support",
            } as unknown as Agent["config"],
            generate: async () => ({}) as never,
            stream: async () => ({ toDataStreamResponse: () => new Response() } as never),
            respond: async () => new Response(),
            getMemory: () => ({} as never),
            getMemoryStats: async () => ({ totalMessages: 0, estimatedTokens: 0, type: "conversation" }),
            clearMemory: async () => {},
          };
        }

        return undefined;
      },
      getAllAgentIds: () => ["assistant-1"],
    });

    const body = JSON.stringify({
      requestId: "assistants-1",
      projectId: "proj-1",
      platform: "slack",
    });
    const { jws, publicKeyPem } = await createDispatchSignature(body);

    const result = await handler.handle(
      new Request("https://example.com/channels/assistants", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-dispatch-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(discoveryCalls, 1);
    assertEquals(await result.response.json(), {
      assistants: [
        {
          id: "assistant-1",
          name: "Support",
          description: null,
          model: "anthropic/claude-sonnet-4-6",
        },
      ],
    });
  });

  it("returns 401 when the dispatch signature is missing", async () => {
    const handler = new ChannelAssistantsHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const result = await handler.handle(
      new Request("https://example.com/channels/assistants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "assistants-1",
          projectId: "proj-1",
          platform: "slack",
        }),
      }),
      createCtx("-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----"),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(await result.response.json(), { error: "Missing dispatch signature" });
  });
});

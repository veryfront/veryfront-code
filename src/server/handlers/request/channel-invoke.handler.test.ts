import type { Agent, AgentMessage as Message, AgentResponse } from "#veryfront/agent";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import type { ChannelInvokeRequest } from "../../../channels/invoke.ts";
import { ChannelInvokeHandler } from "./channel-invoke.handler.ts";

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
    sub: "dispatch-1",
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

function createPayload(): ChannelInvokeRequest {
  return {
    dispatchId: "dispatch-1",
    conversationId: "conversation-1",
    projectId: "proj-1",
    assistantId: "agent-1",
    platform: "slack",
    inboundMessage: {
      text: "Hello from Slack",
      userId: "U123",
      userName: "Alice",
      isDirectMessage: false,
    },
    conversationHistory: [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello from Slack" }],
      },
    ],
  };
}

function createAgentResponse(text = "Hello from handler"): AgentResponse {
  const assistantMessage: Message = {
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text }],
  };

  return {
    text,
    messages: [assistantMessage],
    toolCalls: [],
    status: "completed",
    usage: {
      promptTokens: 5,
      completionTokens: 7,
      totalTokens: 12,
    },
  };
}

function createAgent(generate: Agent["generate"]): Agent {
  return {
    id: "agent-1",
    config: {} as Agent["config"],
    generate,
    stream: async () => ({ toDataStreamResponse: () => new Response() } as never),
    respond: async () => new Response(),
    getMemory: () => ({} as never),
    getMemoryStats: async () => ({ totalMessages: 0, estimatedTokens: 0, type: "conversation" }),
    clearMemory: async () => {},
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

describe("server/handlers/request/channel-invoke.handler", () => {
  it("returns 200 for a valid signed invoke request", async () => {
    let discoveryCalls = 0;
    const handler = new ChannelInvokeHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
      },
      getAgent: () => createAgent(async () => createAgentResponse()),
      getAllAgentIds: () => ["agent-1"],
    });

    const payload = createPayload();
    const body = JSON.stringify(payload);
    const { jws, publicKeyPem } = await createDispatchSignature(body);

    const result = await handler.handle(
      new Request("https://example.com/channels/invoke", {
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

    const responseBody = await result.response.json();
    assertEquals(responseBody, {
      ignored: false,
      responseParts: [{ type: "text", text: "Hello from handler" }],
      tokenUsage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
    });
  });

  it("returns 401 when the dispatch signature header is missing", async () => {
    const handler = new ChannelInvokeHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const result = await handler.handle(
      new Request("https://example.com/channels/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createPayload()),
      }),
      createCtx("-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----"),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 401);
    assertEquals(await result.response.json(), { error: "Missing dispatch signature" });
  });

  it("returns 400 when the signed body does not match the invoke schema", async () => {
    const handler = new ChannelInvokeHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const invalidBody = JSON.stringify({
      dispatchId: "dispatch-1",
      projectId: "proj-1",
      assistantId: "agent-1",
      platform: "slack",
      inboundMessage: {
        text: "Hello from Slack",
        userId: "U123",
        userName: "Alice",
        isDirectMessage: false,
      },
      conversationHistory: [],
    });
    const { jws, publicKeyPem } = await createDispatchSignature(invalidBody);

    const result = await handler.handle(
      new Request("https://example.com/channels/invoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-dispatch-jws": jws,
        },
        body: invalidBody,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(await result.response.json(), { error: "Invalid channel invoke request" });
  });
});

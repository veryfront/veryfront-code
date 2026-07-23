import "#veryfront/schemas/_test-setup.ts";
import type { Agent, AgentMessage as Message, AgentResponse } from "#veryfront/agent";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import type { ChannelInvokeRequest } from "../../../channels/invoke.ts";
import { ChannelInvokeHandler } from "./channel-invoke.handler.ts";
import { __resetServerShuttingDownForTests, markServerShuttingDown } from "../../shutdown-state.ts";

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

interface DispatchTestSigningKey {
  privateKey: CryptoKey;
  publicKeyPem: string;
}

async function createDispatchTestSigningKey(): Promise<DispatchTestSigningKey> {
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519",
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const publicKeyDer = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  return {
    privateKey: keyPair.privateKey,
    publicKeyPem: encodePem("PUBLIC KEY", publicKeyDer),
  };
}

async function createDispatchSignature(
  body: string,
  overrides: Partial<{
    audience: string;
    projectId: string;
    subject: string;
  }> = {},
  signingKey?: DispatchTestSigningKey,
): Promise<{ jws: string; publicKeyPem: string }> {
  const key = signingKey ?? await createDispatchTestSigningKey();
  const now = Math.floor(Date.now() / 1000);

  const header = base64urlEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
  const payload = base64urlEncode(JSON.stringify({
    iss: "veryfront-api",
    aud: overrides.audience ?? "demo-project",
    sub: overrides.subject ?? "dispatch-1",
    project_id: overrides.projectId ?? "proj-1",
    platform: "slack",
    body_sha256: await sha256Base64url(body),
    iat: now,
    exp: now + 60,
  }));

  const signingInput = encoder.encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign("Ed25519", key.privateKey, signingInput);

  return {
    publicKeyPem: key.publicKeyPem,
    jws: `${header}.${payload}.${base64urlEncodeBytes(new Uint8Array(signature))}`,
  };
}

function createPayload(overrides: Partial<ChannelInvokeRequest> = {}): ChannelInvokeRequest {
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
    ...overrides,
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

  it("rejects signed claims that are not bound to the dispatch payload", async () => {
    let discoveryCalls = 0;
    let agentLookups = 0;
    let agentIdLookups = 0;
    const handler = new ChannelInvokeHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
      },
      getAgent: () => {
        agentLookups += 1;
        return createAgent(async () => createAgentResponse());
      },
      getAllAgentIds: () => {
        agentIdLookups += 1;
        return ["agent-1"];
      },
    });
    const payload = createPayload({ dispatchId: "dispatch-from-body" });
    const body = JSON.stringify(payload);
    const { jws, publicKeyPem } = await createDispatchSignature(body, {
      subject: "different-dispatch",
    });

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
    assertEquals(result.response.status, 401);
    assertEquals(await result.response.json(), { error: "Invalid dispatch signature" });
    assertEquals(discoveryCalls, 0);
    assertEquals(agentLookups, 0);
    assertEquals(agentIdLookups, 0);
  });

  it("coalesces concurrent dispatch replays and reuses the completed response", async () => {
    let generateCalls = 0;
    let markStarted!: () => void;
    let releaseGeneration!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const handler = new ChannelInvokeHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () =>
        createAgent(async () => {
          generateCalls += 1;
          markStarted();
          await generationGate;
          return createAgentResponse("Replay-safe response");
        }),
      getAllAgentIds: () => ["agent-1"],
    });
    const payload = createPayload({ dispatchId: "dispatch-replay-concurrent" });
    const body = JSON.stringify(payload);
    const { jws, publicKeyPem } = await createDispatchSignature(body, {
      subject: payload.dispatchId,
    });
    const createRequest = () =>
      new Request("https://example.com/channels/invoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-dispatch-jws": jws,
        },
        body,
      });
    const ctx = createCtx(publicKeyPem);

    const first = handler.handle(createRequest(), ctx);
    await started;
    const second = handler.handle(createRequest(), ctx);
    releaseGeneration();

    const firstResult = await first;
    const secondResult = await second;
    const retryResult = await handler.handle(createRequest(), ctx);
    assertExists(firstResult.response);
    assertExists(secondResult.response);
    assertExists(retryResult.response);
    assertEquals(generateCalls, 1);
    assertEquals(await secondResult.response.json(), await firstResult.response.json());
    assertEquals(await retryResult.response.json(), {
      ignored: false,
      responseParts: [{ type: "text", text: "Replay-safe response" }],
      tokenUsage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
    });
  });

  it("allows an identical dispatch retry after a retryable execution failure", async () => {
    let generateCalls = 0;
    const handler = new ChannelInvokeHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () =>
        createAgent(async () => {
          generateCalls += 1;
          throw new Error("temporary provider failure");
        }),
      getAllAgentIds: () => ["agent-1"],
    });
    const payload = createPayload({ dispatchId: "dispatch-retryable-failure" });
    const body = JSON.stringify(payload);
    const { jws, publicKeyPem } = await createDispatchSignature(body, {
      subject: payload.dispatchId,
    });
    const createRequest = () =>
      new Request("https://example.com/channels/invoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-dispatch-jws": jws,
        },
        body,
      });
    const ctx = createCtx(publicKeyPem);

    const firstResult = await handler.handle(createRequest(), ctx);
    const retryResult = await handler.handle(createRequest(), ctx);

    assertExists(firstResult.response);
    assertExists(retryResult.response);
    assertEquals(await firstResult.response.json(), {
      ignored: false,
      error: { code: "internal_error", retryable: true },
    });
    assertEquals(await retryResult.response.json(), {
      ignored: false,
      error: { code: "internal_error", retryable: true },
    });
    assertEquals(generateCalls, 2);
  });

  it("rejects a dispatch id reused with a different signed body", async () => {
    let generateCalls = 0;
    const handler = new ChannelInvokeHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () =>
        createAgent(async () => {
          generateCalls += 1;
          return createAgentResponse();
        }),
      getAllAgentIds: () => ["agent-1"],
    });
    const signingKey = await createDispatchTestSigningKey();
    const firstPayload = createPayload({ dispatchId: "dispatch-replay-conflict" });
    const conflictingPayload = createPayload({
      dispatchId: firstPayload.dispatchId,
      conversationId: "different-conversation",
    });
    const createRequest = async (payload: ChannelInvokeRequest) => {
      const body = JSON.stringify(payload);
      const { jws } = await createDispatchSignature(
        body,
        { subject: payload.dispatchId },
        signingKey,
      );
      return new Request("https://example.com/channels/invoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-dispatch-jws": jws,
        },
        body,
      });
    };
    const ctx = createCtx(signingKey.publicKeyPem);

    const firstResult = await handler.handle(await createRequest(firstPayload), ctx);
    const conflictingResult = await handler.handle(await createRequest(conflictingPayload), ctx);

    assertExists(firstResult.response);
    assertExists(conflictingResult.response);
    assertEquals(firstResult.response.status, 200);
    assertEquals(conflictingResult.response.status, 409);
    assertEquals(await conflictingResult.response.json(), {
      error: "Channel dispatch identity conflicts with a different request",
    });
    assertEquals(generateCalls, 1);
  });

  it("rejects new invoke requests with 503 while the runtime is shutting down", async () => {
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

    markServerShuttingDown();
    try {
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
      assertEquals(result.response.status, 503);
      assertEquals(result.response.headers.get("connection"), "close");
      assertEquals(
        result.response.headers.get("x-veryfront-runtime-owner-invoke-url"),
        null,
      );
      const responseBody = await result.response.json();
      assertEquals(responseBody.code, "RUNTIME_SHUTTING_DOWN");
      assertEquals(typeof responseBody.message, "string");
      // Rejection must happen before any dispatch verification / agent work.
      assertEquals(discoveryCalls, 0);
    } finally {
      __resetServerShuttingDownForTests();
    }
  });
});

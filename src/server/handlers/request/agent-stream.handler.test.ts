import type { Agent } from "#veryfront/agent";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { AgentStreamHandler } from "./agent-stream.handler.ts";

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

async function createControlPlaneSignature(
  body: string,
  overrides: Partial<{
    audience: string;
    projectId: string;
    requestId: string;
    surface: "studio" | "channels" | "a2a" | "mcp";
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
    sub: overrides.requestId ?? "run_1",
    surface: overrides.surface ?? "studio",
    project_id: overrides.projectId ?? "proj-1",
    request_hash: await sha256Base64url(body),
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

function createAgent(): Agent {
  return {
    id: "assistant-1",
    config: {
      system: "You are Support.",
      model: "anthropic/claude-sonnet-4-6",
      name: "Support",
      description: "Helps with support issues",
      version: "1.0.0",
    } as unknown as Agent["config"],
    generate: async () => ({}) as never,
    stream: async () => ({ toDataStreamResponse: () => new Response() } as never),
    respond: async () => new Response(),
    getMemory: () => ({} as never),
    getMemoryStats: async () => ({
      totalMessages: 0,
      estimatedTokens: 0,
      type: "conversation",
    }),
    clearMemory: async () => {},
  };
}

function encodeRuntimeEvent(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

describe("server/handlers/request/agent-stream.handler", () => {
  it("streams AG-UI events for a valid signed request", async () => {
    let discoveryCalls = 0;
    const handler = new AgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
      },
      getAgent: (id) => id === "assistant-1" ? createAgent() : undefined,
      getAllAgentIds: () => ["assistant-1"],
      sessionManager: {
        startRun: () => new AbortController().signal,
        waitForToolResult: async () => ({ result: { ok: true }, isError: false }),
        submitToolResult: () => ({ accepted: true }),
        cancelRun: () => true,
        completeRun: () => {},
        failRun: () => {},
        getRunStatus: () => "running",
        reset: () => {},
      },
      createRuntime: () => ({
        stream: async (_messages, _context, callbacks) => {
          callbacks?.onFinish?.({
            text: "hello from runtime",
            messages: [],
            toolCalls: [],
            status: "completed",
            usage: {
              promptTokens: 21,
              completionTokens: 13,
              totalTokens: 34,
            },
            metadata: {
              finishReason: "stop",
            },
          });

          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encodeRuntimeEvent({ type: "message-start", messageId: "assistant-msg-1" }),
              );
              controller.enqueue(encodeRuntimeEvent({ type: "step-start" }));
              controller.enqueue(encodeRuntimeEvent({ type: "text-start", id: "text-1" }));
              controller.enqueue(
                encodeRuntimeEvent({
                  type: "text-delta",
                  id: "text-1",
                  delta: "hello from runtime",
                }),
              );
              controller.enqueue(encodeRuntimeEvent({ type: "text-end", id: "text-1" }));
              controller.enqueue(encodeRuntimeEvent({ type: "step-end" }));
              controller.close();
            },
          });
        },
      }),
    });

    const body = JSON.stringify({
      agentId: "assistant-1",
      threadId: "10000000-1000-4000-8000-100000000001",
      runId: "run_1",
      messages: [
        {
          id: "msg_1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
      ],
      tools: [{ name: "studio_focus_component" }],
      context: [{ type: "text", text: "Current file: app.tsx" }],
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, { requestId: "run_1" });

    const result = await handler.handle(
      new Request("https://example.com/internal/agents/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
        },
        body,
      }),
      createCtx(publicKeyPem),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(discoveryCalls, 1);
    assertEquals(result.response.headers.get("content-type"), "text/event-stream");

    const text = await result.response.text();
    assertStringIncludes(text, "event: RunStarted");
    assertStringIncludes(text, "event: TextMessageContent");
    assertStringIncludes(text, "event: RunFinished");
    assertStringIncludes(text, '"inputTokens":21');
  });
});

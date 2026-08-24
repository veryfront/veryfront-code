import "#veryfront/schemas/_test-setup.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import type { Agent, AgentMessage as Message, AgentResponse } from "#veryfront/agent";
import { VeryfrontError } from "#veryfront/errors";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import {
  buildChannelResponseParts,
  ChannelAssistantsRequestSchema,
  ChannelAssistantsResponseSchema,
  type ChannelInvokeDeps,
  type ChannelInvokeRequest,
  executeChannelInvoke,
  listChannelAssistants,
  normalizeConversationHistoryForRuntime,
  resolveChannelInvokeAgent,
  verifyDispatchJws,
} from "./invoke.ts";

const encoder = new TextEncoder();

type AgentGenerateFixture = (input: Parameters<Agent["generate"]>[0]) => Promise<AgentResponse>;

function createGenerateStub(generate: AgentGenerateFixture): Agent["generate"] {
  return (async (input: Parameters<Agent["generate"]>[0]) => {
    return await generate(input);
  }) as Agent["generate"];
}

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
    iat: number;
    exp: number;
    bodySha256: string;
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
  const header = { alg: "EdDSA", typ: "JWT" };
  const claims = {
    iss: "veryfront-api",
    aud: overrides.audience ?? "demo-project",
    sub: "dispatch-1",
    project_id: overrides.projectId ?? "proj-1",
    platform: "slack",
    body_sha256: overrides.bodySha256 ?? await sha256Base64url(body),
    iat: overrides.iat ?? now,
    exp: overrides.exp ?? now + 60,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(claims));
  const signingInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, signingInput);

  return {
    publicKeyPem,
    jws: `${encodedHeader}.${encodedPayload}.${base64urlEncodeBytes(new Uint8Array(signature))}`,
  };
}

function createPayload(
  overrides: Partial<ChannelInvokeRequest> = {},
): ChannelInvokeRequest {
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
        id: "msg-user-1",
        role: "user",
        parts: [{ type: "text", text: "Hello from Slack" }],
        createdAt: "2026-03-13T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function createHandlerContext(): HandlerContext {
  return {
    projectDir: "/project",
    adapter: {
      env: { get: () => undefined },
      fs: {},
    },
    securityConfig: null,
    projectSlug: "demo-project",
    projectId: "proj-1",
    isLocalProject: false,
  } as unknown as HandlerContext;
}

function createAgentResponse(
  text = "Hello from runtime",
  overrides: Partial<AgentResponse> = {},
): AgentResponse {
  const assistantMessage: Message = {
    id: "assistant-1",
    role: "assistant",
    parts: [{ type: "text", text }],
    timestamp: Date.now(),
  };

  return {
    text,
    messages: [assistantMessage],
    toolCalls: [],
    status: "completed",
    usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    ...overrides,
  };
}

function createAgent(overrides: {
  id?: string;
  generate?: AgentGenerateFixture;
  clearMemory?: Agent["clearMemory"];
} = {}): Agent {
  return {
    id: overrides.id ?? "agent-1",
    config: {} as Agent["config"],
    generate: createGenerateStub(overrides.generate ?? (async () => createAgentResponse())),
    stream: async () => ({ toDataStreamResponse: () => new Response() } as never),
    respond: async () => new Response(),
    getMemory: () => ({} as never),
    getMemoryStats: async () => ({ totalMessages: 0, estimatedTokens: 0, type: "conversation" }),
    clearMemory: overrides.clearMemory ?? (() => Promise.resolve()),
  };
}

describe("channels/invoke", () => {
  describe("verifyDispatchJws", () => {
    it("accepts a valid Ed25519 dispatch signature", async () => {
      const payload = createPayload();
      const body = JSON.stringify(payload);
      const { jws, publicKeyPem } = await createDispatchSignature(body);

      const claims = await verifyDispatchJws(jws, body, {
        audience: "demo-project",
        publicKeyPem,
        maxAgeSeconds: 60,
        expectedProjectId: "proj-1",
      });

      assertEquals(claims.aud, "demo-project");
      assertEquals(claims.project_id, "proj-1");
      assertEquals(claims.body_sha256, await sha256Base64url(body));
    });

    it("rejects a dispatch with the wrong audience", async () => {
      const payload = createPayload();
      const body = JSON.stringify(payload);
      const { jws, publicKeyPem } = await createDispatchSignature(body);

      await assertRejects(() =>
        verifyDispatchJws(jws, body, {
          audience: "other-project",
          publicKeyPem,
          maxAgeSeconds: 60,
          expectedProjectId: "proj-1",
        })
      );
    });

    it("rejects an expired dispatch signature", async () => {
      const payload = createPayload();
      const body = JSON.stringify(payload);
      const now = Math.floor(Date.now() / 1000);
      // Issued now so only the exp check can reject: a stale iat would also
      // trip the replay window and hide a missing expiry check.
      const { jws, publicKeyPem } = await createDispatchSignature(body, {
        iat: now,
        exp: now - 1,
      });

      await assertRejects(
        () =>
          verifyDispatchJws(jws, body, {
            audience: "demo-project",
            publicKeyPem,
            maxAgeSeconds: 60,
            expectedProjectId: "proj-1",
          }),
        VeryfrontError,
        "expired",
        "a freshly issued signature whose exp has passed must be rejected as expired",
      );
    });

    it("rejects a stale but unexpired dispatch signature", async () => {
      const payload = createPayload();
      const body = JSON.stringify(payload);
      const now = Math.floor(Date.now() / 1000);
      const { jws, publicKeyPem } = await createDispatchSignature(body, {
        iat: now - 600,
        exp: now + 600,
      });

      await assertRejects(
        () =>
          verifyDispatchJws(jws, body, {
            audience: "demo-project",
            publicKeyPem,
            maxAgeSeconds: 60,
            expectedProjectId: "proj-1",
          }),
        VeryfrontError,
        "too old",
        "a signature minted outside the replay window must be rejected even while unexpired",
      );
    });

    it("rejects a dispatch signature issued in the future", async () => {
      const payload = createPayload();
      const body = JSON.stringify(payload);
      const now = Math.floor(Date.now() / 1000);
      const { jws, publicKeyPem } = await createDispatchSignature(body, {
        iat: now + 30,
        exp: now + 90,
      });

      await assertRejects(() =>
        verifyDispatchJws(jws, body, {
          audience: "demo-project",
          publicKeyPem,
          maxAgeSeconds: 60,
          expectedProjectId: "proj-1",
        })
      );
    });

    it("rejects a dispatch when the body hash does not match", async () => {
      const payload = createPayload();
      const body = JSON.stringify(payload);
      const { jws, publicKeyPem } = await createDispatchSignature(body);

      await assertRejects(() =>
        verifyDispatchJws(jws, `${body} `, {
          audience: "demo-project",
          publicKeyPem,
          maxAgeSeconds: 60,
          expectedProjectId: "proj-1",
        })
      );
    });
  });

  describe("normalizeConversationHistoryForRuntime", () => {
    it("maps supported message parts and drops unsupported ones", () => {
      const normalized = normalizeConversationHistoryForRuntime([
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            { type: "text", text: "Done" },
            { type: "reasoning", text: "internal reasoning" },
            { type: "tool_call", id: "tool-1", name: "search", input: { query: "docs" } },
            {
              type: "tool_result",
              tool_call_id: "tool-1",
              tool_name: "search",
              output: { answer: 42 },
            },
            { type: "file", url: "https://example.com/file.png" },
          ],
          metadata: { source: "channel" },
          createdAt: "2026-03-13T10:00:00.000Z",
        },
      ]);

      assertEquals(normalized, [{
        id: "msg-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Done" },
          {
            type: "tool-search",
            toolCallId: "tool-1",
            toolName: "search",
            args: { query: "docs" },
          },
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "search",
            result: { answer: 42 },
          },
        ],
        metadata: { source: "channel" },
        timestamp: Date.parse("2026-03-13T10:00:00.000Z"),
      }]);
    });

    it("infers tool result names from preceding persisted tool calls", () => {
      const normalized = normalizeConversationHistoryForRuntime([
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            { type: "tool_call", id: "tool-1", name: "search", input: { query: "docs" } },
            { type: "tool_result", tool_call_id: "tool-1", output: { answer: 42 } },
          ],
        },
      ]);

      assertEquals(normalized[0]?.parts, [
        {
          type: "tool-search",
          toolCallId: "tool-1",
          toolName: "search",
          args: { query: "docs" },
        },
        {
          type: "tool-result",
          toolCallId: "tool-1",
          toolName: "search",
          result: { answer: 42 },
        },
      ]);
    });
  });

  describe("listChannelAssistants", () => {
    it("returns discovered runtime assistants sorted by name", async () => {
      let discoveryCalls = 0;
      const response = await listChannelAssistants(createHandlerContext(), {
        ensureProjectDiscovery: async () => {
          discoveryCalls += 1;
          return createEmptyDiscoveryResult();
        },
        getAgent: (id) => {
          if (id === "assistant-b") {
            return {
              ...createAgent({ id }),
              config: {
                system: "You are Beta.",
                model: "anthropic/claude-sonnet-4-6",
                name: "Beta",
              } as unknown as Agent["config"],
            };
          }
          if (id === "assistant-a") {
            return {
              ...createAgent({ id }),
              config: {
                system: "You are Alpha.",
                model: "openai/gpt-5",
                name: "Alpha",
                description: "Primary assistant",
              } as unknown as Agent["config"],
            };
          }
          return undefined;
        },
        getAllAgentIds: () => ["assistant-b", "assistant-a"],
      });

      assertEquals(discoveryCalls, 1);
      assertEquals(
        response,
        ChannelAssistantsResponseSchema.parse({
          assistants: [
            {
              id: "assistant-a",
              name: "Alpha",
              description: "Primary assistant",
              model: "openai/gpt-5",
            },
            {
              id: "assistant-b",
              name: "Beta",
              description: null,
              model: "anthropic/claude-sonnet-4-6",
            },
          ],
        }),
      );
    });

    it("validates assistants request payload shape", () => {
      const parsed = ChannelAssistantsRequestSchema.parse({
        requestId: "request-1",
        projectId: "proj-1",
        platform: "slack",
      });

      assertEquals(parsed.platform, "slack");
      assertEquals(parsed.requestId, "request-1");
    });
  });

  describe("resolveChannelInvokeAgent", () => {
    it("returns an exact registry match when available", () => {
      const agent = createAgent({ id: "agent-1" });
      const resolved = resolveChannelInvokeAgent("agent-1", {
        getAgent: (id) => id === "agent-1" ? agent : undefined,
      });

      assertEquals(resolved, agent);
    });

    it("fails closed when the requested assistant is not registered", () => {
      const resolved = resolveChannelInvokeAgent("api-agent-config", {
        getAgent: () => undefined,
      });

      assertEquals(resolved, undefined);
    });
  });

  describe("buildChannelResponseParts", () => {
    it("includes reasoning, tool calls, tool results, and final text", () => {
      const response = createAgentResponse("Final answer", {
        thinking: "Need to check a tool first",
        toolCalls: [{
          id: "tool-1",
          name: "search",
          args: { query: "docs" },
          status: "completed",
          result: { hits: 2 },
        }],
      });

      const parts = buildChannelResponseParts(response);

      assertEquals(parts, [
        { type: "reasoning", text: "Need to check a tool first" },
        {
          type: "tool_call",
          id: "tool-1",
          name: "search",
          input: { query: "docs" },
          state: "completed",
        },
        {
          type: "tool_result",
          tool_call_id: "tool-1",
          output: { hits: 2 },
        },
        { type: "text", text: "Final answer" },
      ]);
    });

    it("reports a failed tool call as an errored tool result", () => {
      const response = createAgentResponse("Done", {
        toolCalls: [{
          id: "tool-1",
          name: "search",
          args: { query: "docs" },
          status: "error",
          error: "boom",
        }],
      });

      assertEquals(
        buildChannelResponseParts(response),
        [
          {
            type: "tool_call",
            id: "tool-1",
            name: "search",
            input: { query: "docs" },
            state: "error",
          },
          {
            type: "tool_result",
            tool_call_id: "tool-1",
            output: { error: "boom" },
            is_error: true,
          },
          { type: "text", text: "Done" },
        ],
        "a failed tool call must be flagged as an errored tool result",
      );

      const withoutMessage = createAgentResponse("Done", {
        toolCalls: [{
          id: "tool-2",
          name: "search",
          args: { query: "docs" },
          status: "error",
        }],
      });

      assertEquals(
        buildChannelResponseParts(withoutMessage)[1],
        {
          type: "tool_result",
          tool_call_id: "tool-2",
          output: { error: "Tool execution failed" },
          is_error: true,
        },
        "a failed tool call without an error message must carry the default failure text",
      );
    });

    it("falls back to response text when no assistant message is present", () => {
      const response = createAgentResponse("Fallback answer", {
        messages: [{
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Question" }],
          timestamp: Date.now(),
        }],
      });

      assertEquals(buildChannelResponseParts(response), [
        { type: "text", text: "Fallback answer" },
      ]);
    });

    it("does not duplicate tool calls already present in runtime toolCalls", () => {
      const response = createAgentResponse("Tool answer", {
        toolCalls: [{
          id: "tool-1",
          name: "search",
          args: { query: "docs" },
          status: "pending",
        }],
        messages: [{
          id: "assistant-1",
          role: "assistant",
          parts: [
            {
              type: "tool-search",
              toolCallId: "tool-1",
              toolName: "search",
              args: { query: "docs" },
            },
            { type: "text", text: "Tool answer" },
          ],
          timestamp: Date.now(),
        }],
      });

      assertEquals(buildChannelResponseParts(response), [
        {
          type: "tool_call",
          id: "tool-1",
          name: "search",
          input: { query: "docs" },
          state: "pending",
        },
        { type: "text", text: "Tool answer" },
      ]);
    });
  });

  describe("executeChannelInvoke", () => {
    it("forwards maxResponseTokens to the runtime agent and returns normalized parts", async () => {
      let discoveryCalls = 0;
      let clearMemoryCalls = 0;
      let capturedGenerateInput: Parameters<Agent["generate"]>[0] | undefined;
      const agent = createAgent({
        clearMemory: async () => {
          clearMemoryCalls += 1;
        },
        generate: async (input) => {
          capturedGenerateInput = input;
          return createAgentResponse("Runtime answer");
        },
      });

      const deps: ChannelInvokeDeps = {
        ensureProjectDiscovery: async () => {
          discoveryCalls += 1;
          return createEmptyDiscoveryResult();
        },
        getAgent: (id) => id === "agent-1" ? agent : undefined,
        getAllAgentIds: () => ["agent-1"],
      };

      const payload = createPayload({ generation: { maxResponseTokens: 321 } });
      const response = await executeChannelInvoke(
        payload,
        createHandlerContext(),
        deps,
      );

      assertEquals(discoveryCalls, 1);
      assertEquals(clearMemoryCalls, 1);
      assertExists(capturedGenerateInput);
      assertEquals(capturedGenerateInput.maxOutputTokens, 321);
      assertEquals(
        capturedGenerateInput.input,
        [{
          id: "msg-user-1",
          role: "user",
          parts: [{ type: "text", text: "Hello from Slack" }],
          timestamp: Date.parse("2026-03-13T10:00:00.000Z"),
        }],
        "runtime agent must receive the normalized conversation history",
      );
      assertEquals(
        capturedGenerateInput.context,
        {
          requestId: "dispatch-1",
          dispatchId: "dispatch-1",
          conversationId: "conversation-1",
          projectId: "proj-1",
          assistantId: "agent-1",
          channel: {
            text: "Hello from Slack",
            userId: "U123",
            userName: "Alice",
            isDirectMessage: false,
          },
        },
        "runtime agent must receive the dispatch context and inbound channel message",
      );
      assertEquals(response, {
        ignored: false,
        responseParts: [{ type: "text", text: "Runtime answer" }],
        tokenUsage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      });
    });

    it("returns a structured provider error when no AI runtime is available", async () => {
      const agent = createAgent({
        generate: async () => {
          throw toError(
            createError({ type: "no_ai_available", message: "Local model unavailable" }),
          );
        },
      });

      const response = await executeChannelInvoke(
        createPayload(),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
          getAgent: () => agent,
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(response, {
        ignored: false,
        error: { code: "provider_error", retryable: false },
      });
    });

    it("classifies upstream provider failures as provider_error", async () => {
      async function invokeWith(thrown: Error) {
        return await executeChannelInvoke(
          createPayload(),
          createHandlerContext(),
          {
            ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
            getAgent: () =>
              createAgent({
                generate: () => {
                  throw thrown;
                },
              }),
            getAllAgentIds: () => ["agent-1"],
          },
        );
      }

      assertEquals(
        await invokeWith(toError(createError({ type: "api", message: "provider 503" }))),
        { ignored: false, error: { code: "provider_error", retryable: true } },
        "api provider failures must keep the provider_error taxonomy",
      );
      assertEquals(
        await invokeWith(toError(createError({ type: "network", message: "connect timeout" }))),
        { ignored: false, error: { code: "provider_error", retryable: true } },
        "network provider failures must keep the provider_error taxonomy",
      );
      assertEquals(
        await invokeWith(new Error("boom")),
        { ignored: false, error: { code: "internal_error", retryable: true } },
        "unclassified runtime failures must stay internal_error",
      );
    });

    it("fails closed when the requested assistant is not registered on the runtime", async () => {
      const response = await executeChannelInvoke(
        createPayload({ assistantId: "assistant-missing" }),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
          getAgent: () => undefined,
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
    });
  });
});

import "#veryfront/schemas/_test-setup.ts";
import type { Agent, AgentMessage as Message, AgentResponse } from "#veryfront/agent";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import {
  buildChannelResponseParts,
  ChannelAssistantsRequestSchema,
  ChannelAssistantsResponseSchema,
  type ChannelDiscoveryContext,
  type ChannelInvokeDeps,
  type ChannelInvokeRequest,
  ChannelInvokeRequestSchema,
  ChannelInvokeResponseSchema,
  type ChannelRequestContext,
  defaultChannelInvokeDeps,
  executeChannelInvoke,
  listChannelAssistants,
  normalizeConversationHistoryForRuntime,
  resolveChannelInvokeAgent,
  verifyDispatchJws,
  verifyDispatchJwsSignature,
} from "./invoke.ts";

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

function createHandlerContext(): ChannelRequestContext {
  return { projectId: "proj-1" };
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
  generate?: Agent["generate"];
  clearMemory?: Agent["clearMemory"];
} = {}): Agent {
  return {
    id: overrides.id ?? "agent-1",
    config: {} as Agent["config"],
    generate: overrides.generate ?? (() => Promise.resolve(createAgentResponse())),
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
      const { jws, publicKeyPem } = await createDispatchSignature(body, {
        iat: now - 120,
        exp: now - 60,
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

    it("rejects empty optional verifier bindings instead of silently omitting them", async () => {
      const body = JSON.stringify(createPayload());
      const { jws, publicKeyPem } = await createDispatchSignature(body);

      await assertRejects(() =>
        verifyDispatchJws(jws, body, {
          audience: "demo-project",
          publicKeyPem,
          maxAgeSeconds: 60,
          expectedSubject: "",
        })
      );
      await assertRejects(() =>
        verifyDispatchJws(jws, body, {
          audience: "demo-project",
          publicKeyPem,
          maxAgeSeconds: 60,
          expectedPlatform: "",
        })
      );
    });

    it("fails closed for invalid signature-only limits and oversized inputs", async () => {
      const body = JSON.stringify({ action: "invoke" });
      const { jws, publicKeyPem } = await createDispatchSignature(body);

      assertEquals(
        await verifyDispatchJwsSignature(jws, { publicKeyPem, maxAgeSeconds: 0 }),
        false,
      );

      const [, payload, signature] = jws.split(".");
      assertEquals(
        await verifyDispatchJwsSignature(
          `${"a".repeat(20_000)}.${payload}.${signature}`,
          { publicKeyPem, maxAgeSeconds: 60 },
        ),
        false,
      );
      assertEquals(
        await verifyDispatchJwsSignature(jws, {
          publicKeyPem: `${publicKeyPem}${"x".repeat(20_000)}`,
          maxAgeSeconds: 60,
        }),
        false,
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

    it("preserves epoch timestamps and drops unbound tool results", () => {
      const normalized = normalizeConversationHistoryForRuntime([
        {
          id: "msg-epoch",
          role: "assistant",
          parts: [{ type: "tool_result", tool_call_id: "missing", output: "ignored" }],
          createdAt: "1970-01-01T00:00:00.000Z",
        },
      ]);

      assertEquals(normalized, [{
        id: "msg-epoch",
        role: "assistant",
        parts: [],
        timestamp: 0,
      }]);
    });

    it("drops tool calls whose identifiers or arguments are not wire-safe JSON", () => {
      const normalized = normalizeConversationHistoryForRuntime([{
        id: "message-1",
        role: "assistant",
        parts: [{
          type: "tool_call",
          id: "tool-1",
          name: "search",
          input: { issuedAt: new Date() },
        }],
      }]);

      assertEquals(normalized[0]?.parts, []);
    });

    it("drops duplicate tool calls and results that do not bind to the original call", () => {
      const normalized = normalizeConversationHistoryForRuntime([{
        id: "message-1",
        role: "assistant",
        parts: [{
          type: "tool_call",
          id: "tool-1",
          name: "search",
          input: { query: "docs" },
        }, {
          type: "tool_call",
          id: "tool-1",
          name: "write",
          input: { content: "unsafe" },
        }, {
          type: "tool_result",
          tool_call_id: "tool-1",
          tool_name: "write",
          output: { ok: true },
        }],
      }]);

      assertEquals(normalized[0]?.parts, [{
        type: "tool-search",
        toolCallId: "tool-1",
        toolName: "search",
        args: { query: "docs" },
      }]);
    });

    it("rejects accessor-backed history without executing it", () => {
      let accessorReads = 0;
      const message = {
        id: "message-1",
        role: "user" as const,
      } as ChannelInvokeRequest["conversationHistory"][number];
      Object.defineProperty(message, "parts", {
        enumerable: true,
        get() {
          accessorReads += 1;
          return [{ type: "text", text: "unsafe" }];
        },
      });

      assertThrows(() => normalizeConversationHistoryForRuntime([message]));
      assertEquals(accessorReads, 0);
    });

    it("does not retain oversized direct-call history parts or metadata", () => {
      const history = [{
        id: "message-1",
        role: "user" as const,
        parts: [
          { type: "text", text: "x".repeat(10_001) },
          {
            type: "tool_call",
            id: "call-1",
            name: "search",
            input: { query: "x".repeat(65_536) },
          },
        ],
      }];

      assertEquals(normalizeConversationHistoryForRuntime(history)[0]?.parts, []);
      assertThrows(
        () =>
          normalizeConversationHistoryForRuntime([{
            ...history[0],
            metadata: { note: "x".repeat(16_384) },
          }]),
        TypeError,
        "metadata",
      );
    });
  });

  describe("wire limits", () => {
    it("rejects oversized identifiers and conversation histories", () => {
      const oversizedId = ChannelInvokeRequestSchema.safeParse(
        createPayload({ dispatchId: "x".repeat(129) }),
      );
      assertEquals(oversizedId.success, false);

      const oversizedHistory = ChannelInvokeRequestSchema.safeParse(
        createPayload({
          conversationHistory: Array.from({ length: 101 }, (_, index) => ({
            id: `message-${index}`,
            role: "user" as const,
            parts: [{ type: "text", text: "hello" }],
          })),
        }),
      );
      assertEquals(oversizedHistory.success, false);

      const oversizedBody = ChannelInvokeRequestSchema.safeParse(
        createPayload({
          conversationHistory: Array.from({ length: 20 }, (_, index) => ({
            id: `message-${index}`,
            role: "user" as const,
            parts: [{ type: "text", text: "x".repeat(10_000) }],
          })),
        }),
      );
      assertEquals(oversizedBody.success, false);

      const unsafeAttachmentUrl = ChannelInvokeRequestSchema.safeParse(
        createPayload({
          inboundMessage: {
            ...createPayload().inboundMessage,
            attachments: [{
              id: "attachment-1",
              kind: "file",
              privateUrl: "file:///private/secret",
            }],
          },
        }),
      );
      assertEquals(unsafeAttachmentUrl.success, false);
    });

    it("requires canonical timestamps and mutually exclusive success and error payloads", () => {
      const nonCanonicalTimestamp = ChannelInvokeRequestSchema.safeParse(createPayload({
        conversationHistory: [{
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          createdAt: "March 13, 2026",
        }],
      }));
      assertEquals(nonCanonicalTimestamp.success, false);

      const mixedResponse = ChannelInvokeResponseSchema.safeParse({
        ignored: false,
        responseParts: [{ type: "text", text: "Done" }],
        error: { code: "internal_error", retryable: false },
      });
      assertEquals(mixedResponse.success, false);
    });
  });

  describe("listChannelAssistants", () => {
    it("uses a request-scoped discovery capability in the default adapter", async () => {
      let discoveryCalls = 0;
      const context: ChannelDiscoveryContext = {
        projectId: "proj-1",
        ensureProjectDiscovery: async () => {
          discoveryCalls += 1;
        },
      };

      await defaultChannelInvokeDeps.ensureProjectDiscovery(context);

      assertEquals(discoveryCalls, 1);
    });

    it("fails closed when the default adapter receives no discovery capability", async () => {
      await assertRejects(
        () => defaultChannelInvokeDeps.ensureProjectDiscovery({ projectId: "proj-1" }),
        TypeError,
        "does not support project discovery",
      );
    });

    it("does not execute accessor-backed discovery capabilities", async () => {
      let accessorReads = 0;
      const context: ChannelRequestContext = { projectId: "proj-1" };
      Object.defineProperty(context, "ensureProjectDiscovery", {
        configurable: true,
        get() {
          accessorReads += 1;
          return async () => {};
        },
      });

      await assertRejects(
        () => defaultChannelInvokeDeps.ensureProjectDiscovery(context),
        TypeError,
        "does not support project discovery",
      );
      assertEquals(accessorReads, 0);
    });

    it("returns discovered runtime assistants sorted by name", async () => {
      let discoveryCalls = 0;
      const response = await listChannelAssistants(createHandlerContext(), {
        ensureProjectDiscovery: async () => {
          discoveryCalls += 1;
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

    it("deduplicates tool calls repeated inside the assistant message", () => {
      const toolPart = {
        type: "tool-search" as const,
        toolCallId: "tool-1",
        toolName: "search",
        args: { query: "docs" },
      };
      const response = createAgentResponse("Tool answer", {
        messages: [{
          id: "assistant-1",
          role: "assistant",
          parts: [toolPart, { ...toolPart }, { type: "text", text: "Tool answer" }],
          timestamp: Date.now(),
        }],
      });

      assertEquals(buildChannelResponseParts(response), [{
        type: "tool_call",
        id: "tool-1",
        name: "search",
        input: { query: "docs" },
        state: "pending",
      }, { type: "text", text: "Tool answer" }]);
    });

    it("maps executing calls to streaming state and redacts tool failure details", () => {
      const response = createAgentResponse("Done", {
        toolCalls: [{
          id: "tool-1",
          name: "search",
          args: {},
          status: "executing",
        }, {
          id: "tool-2",
          name: "write",
          args: {},
          status: "error",
          error: "secret provider payload",
        }],
      });

      assertEquals(buildChannelResponseParts(response), [
        { type: "tool_call", id: "tool-1", name: "search", input: {}, state: "streaming" },
        { type: "tool_call", id: "tool-2", name: "write", input: {}, state: "error" },
        {
          type: "tool_result",
          tool_call_id: "tool-2",
          output: { error: "Tool execution failed" },
          is_error: true,
        },
        { type: "text", text: "Done" },
      ]);
    });

    it("uses response text when the last assistant message has no text part", () => {
      const response = createAgentResponse("Final answer", {
        messages: [{
          id: "assistant-1",
          role: "assistant",
          parts: [{
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "search",
            result: { hits: 1 },
          }],
        }],
      });

      assertEquals(buildChannelResponseParts(response), [
        { type: "text", text: "Final answer" },
      ]);
    });

    it("rejects unknown tool states instead of silently reporting them as pending", () => {
      const response = createAgentResponse("Done", {
        toolCalls: [{
          id: "tool-1",
          name: "search",
          args: {},
          status: "unknown",
        } as never],
      });

      assertThrows(() => buildChannelResponseParts(response));
    });

    it("rejects accessor-backed agent responses without executing them", () => {
      const response = createAgentResponse();
      let accessorReads = 0;
      Object.defineProperty(response, "toolCalls", {
        configurable: true,
        enumerable: true,
        get() {
          accessorReads += 1;
          return [];
        },
      });

      assertThrows(() => buildChannelResponseParts(response));
      assertEquals(accessorReads, 0);
    });

    it("rejects response collections before traversing beyond the wire part limit", () => {
      const response = createAgentResponse("Done", {
        toolCalls: Array.from({ length: 257 }, (_, index) => ({
          id: `tool-${index}`,
          name: "search",
          args: {},
          status: "pending" as const,
        })),
      });

      assertThrows(() => buildChannelResponseParts(response));
    });
  });

  describe("executeChannelInvoke", () => {
    it("fails closed on invalid direct-call payloads before discovery", async () => {
      let discoveryCalls = 0;
      const response = await executeChannelInvoke(
        createPayload({ dispatchId: "" }),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {
            discoveryCalls += 1;
          },
          getAgent: () => createAgent(),
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(discoveryCalls, 0);
      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
    });

    it("rejects accessor-backed request payloads without executing them", async () => {
      const payload = createPayload();
      let accessorReads = 0;
      let discoveryCalls = 0;
      Object.defineProperty(payload.inboundMessage, "text", {
        configurable: true,
        enumerable: true,
        get() {
          accessorReads += 1;
          return "unsafe";
        },
      });

      const response = await executeChannelInvoke(payload, createHandlerContext(), {
        ensureProjectDiscovery: async () => {
          discoveryCalls += 1;
        },
        getAgent: () => createAgent(),
        getAllAgentIds: () => ["agent-1"],
      });

      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
      assertEquals(discoveryCalls, 0);
      assertEquals(accessorReads, 0);
    });

    it("passes persisted history without duplicating the inbound message", async () => {
      let capturedInput: Parameters<Agent["generate"]>[0] | undefined;
      const agent = createAgent({
        generate: async (input) => {
          capturedInput = input;
          return createAgentResponse();
        },
      });

      const payload = createPayload();
      await executeChannelInvoke(
        payload,
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () => agent,
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertExists(capturedInput);
      assertEquals(
        capturedInput.input,
        normalizeConversationHistoryForRuntime(payload.conversationHistory),
      );
    });

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
        },
        getAgent: (id) => id === "agent-1" ? agent : undefined,
        getAllAgentIds: () => ["agent-1"],
      };

      const response = await executeChannelInvoke(
        createPayload({ generation: { maxResponseTokens: 321 } }),
        createHandlerContext(),
        deps,
      );

      assertEquals(discoveryCalls, 1);
      assertEquals(clearMemoryCalls, 0);
      assertExists(capturedGenerateInput);
      assertEquals(capturedGenerateInput.maxOutputTokens, 321);
      assertEquals(capturedGenerateInput.memoryMode, "isolated");
      assertEquals(response, {
        ignored: false,
        responseParts: [{ type: "text", text: "Runtime answer" }],
        tokenUsage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      });
    });

    it("supports prototype-defined agent generation while preserving its receiver", async () => {
      class PrototypeAgent {
        readonly id = "agent-1";
        readonly config = {};
        calls = 0;

        generate(): Promise<AgentResponse> {
          this.calls += 1;
          return Promise.resolve(createAgentResponse("Prototype response"));
        }
      }

      const agent = new PrototypeAgent();
      const response = await executeChannelInvoke(
        createPayload(),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () => agent,
          getAllAgentIds: () => [agent.id],
        },
      );

      assertEquals(agent.calls, 1);
      assertEquals(response.responseParts, [{ type: "text", text: "Prototype response" }]);
    });

    it("passes caller cancellation to agent generation", async () => {
      const controller = new AbortController();
      let receivedSignal: AbortSignal | undefined;
      const agent = createAgent({
        generate: async (input) => {
          receivedSignal = input.abortSignal;
          return createAgentResponse();
        },
      });

      await executeChannelInvoke(
        createPayload(),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () => agent,
          getAllAgentIds: () => ["agent-1"],
        },
        { signal: controller.signal },
      );

      assertEquals(receivedSignal, controller.signal);
    });

    it("discards a result when cancellation arrives during generation", async () => {
      const controller = new AbortController();
      const agent = createAgent({
        generate: async () => {
          controller.abort(new Error("request disconnected"));
          return createAgentResponse();
        },
      });

      const response = await executeChannelInvoke(
        createPayload(),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () => agent,
          getAllAgentIds: () => ["agent-1"],
        },
        { signal: controller.signal },
      );

      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
    });

    it("treats caller cancellation as non-retryable before discovery", async () => {
      const controller = new AbortController();
      controller.abort(new Error("request disconnected"));
      let discoveryCalls = 0;

      const response = await executeChannelInvoke(
        createPayload(),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {
            discoveryCalls += 1;
          },
          getAgent: () => createAgent(),
          getAllAgentIds: () => ["agent-1"],
        },
        { signal: controller.signal },
      );

      assertEquals(discoveryCalls, 0);
      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
    });

    it("does not clear configured agent memory for an isolated invocation", async () => {
      let clearMemoryCalls = 0;
      const agent = createAgent({
        clearMemory: async () => {
          clearMemoryCalls += 1;
          throw new Error("shared memory must not be cleared");
        },
      });

      const response = await executeChannelInvoke(
        createPayload(),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () => agent,
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(clearMemoryCalls, 0);
      assertEquals(response.error, undefined);
    });

    it("fails closed when the payload project does not match the runtime context", async () => {
      let generateCalls = 0;
      const agent = createAgent({
        generate: async () => {
          generateCalls += 1;
          return createAgentResponse();
        },
      });

      const response = await executeChannelInvoke(
        createPayload({ projectId: "another-project" }),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () => agent,
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(generateCalls, 0);
      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
    });

    it("fails closed when the runtime context has no project identifier", async () => {
      let generateCalls = 0;
      const context = createHandlerContext();
      context.projectId = undefined;

      const response = await executeChannelInvoke(
        createPayload(),
        context,
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () =>
            createAgent({
              generate: async () => {
                generateCalls += 1;
                return createAgentResponse();
              },
            }),
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(generateCalls, 0);
      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
    });

    it("rejects channel responses that exceed the wire budget", async () => {
      const agent = createAgent({
        generate: async () => createAgentResponse("x".repeat(200_000)),
      });

      const response = await executeChannelInvoke(
        createPayload(),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () => agent,
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
    });

    it("rejects accessor-backed usage without executing it", async () => {
      let accessorReads = 0;
      const agent = createAgent({
        generate: async () => {
          const result = createAgentResponse();
          Object.defineProperty(result, "usage", {
            configurable: true,
            enumerable: true,
            get() {
              accessorReads += 1;
              return { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
            },
          });
          return result;
        },
      });

      const response = await executeChannelInvoke(
        createPayload(),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () => agent,
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
      assertEquals(accessorReads, 0);
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
          ensureProjectDiscovery: async () => {},
          getAgent: () => agent,
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(response, {
        ignored: false,
        error: { code: "provider_error", retryable: false },
      });
    });

    it("does not retry deterministic runtime contract failures", async () => {
      const response = await executeChannelInvoke(
        createPayload(),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () =>
            createAgent({
              generate: async () => {
                throw new TypeError("invalid runtime response");
              },
            }),
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
    });

    it("does not log an untrusted runtime error name", async () => {
      const secretMarker = "provider-secret-in-error-name";
      const failure = new Error("provider failure");
      failure.name = secretMarker;
      const output: string[] = [];
      const originalConsoleError = console.error;
      console.error = (...args: unknown[]) => output.push(args.map(String).join(" "));

      try {
        await executeChannelInvoke(
          createPayload(),
          createHandlerContext(),
          {
            ensureProjectDiscovery: async () => {},
            getAgent: () =>
              createAgent({
                generate: async () => {
                  throw failure;
                },
              }),
            getAllAgentIds: () => ["agent-1"],
          },
        );
      } finally {
        console.error = originalConsoleError;
      }

      assertEquals(output.join("\n").includes(secretMarker), false);
    });

    it("fails closed when the requested assistant is not registered on the runtime", async () => {
      const response = await executeChannelInvoke(
        createPayload({ assistantId: "assistant-missing" }),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () => undefined,
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
    });

    it("contains runtime agent resolution failures", async () => {
      const response = await executeChannelInvoke(
        createPayload(),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () => {
            throw new TypeError("registry contract failure");
          },
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
    });

    it("rejects accessor-backed agent generation without executing it", async () => {
      const agent = createAgent();
      let accessorReads = 0;
      Object.defineProperty(agent, "generate", {
        configurable: true,
        enumerable: true,
        get() {
          accessorReads += 1;
          return async () => createAgentResponse();
        },
      });

      const response = await executeChannelInvoke(
        createPayload(),
        createHandlerContext(),
        {
          ensureProjectDiscovery: async () => {},
          getAgent: () => agent,
          getAllAgentIds: () => ["agent-1"],
        },
      );

      assertEquals(response, {
        ignored: false,
        error: { code: "internal_error", retryable: false },
      });
      assertEquals(accessorReads, 0);
    });
  });
});

import type { Agent, AgentResponse } from "#veryfront/agent";
import { type Tool } from "#veryfront/tool";
import type { HandlerContext } from "#veryfront/types";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";

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

export async function createControlPlaneSignature(
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
    sub: overrides.requestId ?? "run-1",
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

export function createCtx(publicKeyPem?: string): HandlerContext {
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

export function createAgent(id = "agent-1"): Agent {
  return {
    id,
    config: {
      id,
      system: "You are helpful.",
      model: "anthropic/claude-sonnet-4-6",
    } as Agent["config"],
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

export function encodeDataStreamEvent(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export function createInjectedToolRuntime(toolName: string, toolCallId: string, result: unknown) {
  return (_agent: Agent, mergedTools: Agent["config"]["tools"]) => ({
    async stream(
      _messages: Array<Record<string, unknown>>,
      _context?: Record<string, unknown>,
      callbacks?: { onFinish?: (response: AgentResponse) => void },
    ) {
      const tool = mergedTools && mergedTools !== true
        ? mergedTools[toolName] as Tool | boolean | undefined
        : undefined;
      if (!tool || tool === true) {
        throw new Error(`Injected tool "${toolName}" was not available`);
      }

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(
            encodeDataStreamEvent({ type: "message-start", messageId: "assistant-1" }),
          );
          controller.enqueue(encodeDataStreamEvent({
            type: "data",
            data: {
              model: "anthropic/claude-sonnet-4-6",
              inferenceMode: "cloud",
            },
          }));
          controller.enqueue(encodeDataStreamEvent({ type: "text-start", id: "assistant-1" }));
          controller.enqueue(encodeDataStreamEvent({ type: "step-start" }));
          controller.enqueue(encodeDataStreamEvent({
            type: "tool-input-start",
            toolCallId,
            toolName,
          }));
          controller.enqueue(encodeDataStreamEvent({
            type: "tool-input-delta",
            toolCallId,
            inputTextDelta: '{"target":"hero"}',
          }));
          controller.enqueue(encodeDataStreamEvent({
            type: "tool-input-available",
            toolCallId,
            toolName,
            input: { target: "hero" },
          }));

          const output = await tool.execute(
            { target: "hero" },
            { toolCallId },
          );
          controller.enqueue(encodeDataStreamEvent({
            type: "tool-output-available",
            toolCallId,
            output,
          }));
          controller.enqueue(
            encodeDataStreamEvent({ type: "text-delta", id: "assistant-1", delta: "Done." }),
          );
          controller.enqueue(encodeDataStreamEvent({ type: "step-end" }));
          controller.close();
          callbacks?.onFinish?.({
            text: "Done.",
            messages: [
              {
                id: "assistant-1",
                role: "assistant",
                parts: [{ type: "text", text: "Done." }],
              },
            ],
            toolCalls: [{
              id: toolCallId,
              name: toolName,
              args: { target: "hero" },
              status: "completed",
              result,
            }],
            status: "completed",
            usage: {
              promptTokens: 10,
              completionTokens: 5,
              totalTokens: 15,
            },
            metadata: {
              finishReason: "stop",
            },
          });
        },
      });

      return stream;
    },
  });
}

export async function readResponseText(response: Response): Promise<string> {
  return await response.text();
}

export async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  matcher: (text: string) => boolean,
): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return output;
    }

    output += decoder.decode(value, { stream: true });
    if (matcher(output)) {
      return output;
    }
  }
}

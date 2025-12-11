import { describe, it } from "std/testing/bdd.ts";
import {
  type AgentConfig,
  getTextFromParts,
  type Message,
  type MessagePart,
} from "../../src/ai/types/agent.ts";

type Provider = {
  name: string;
  complete: (input: unknown) => Promise<{
    text: string;
    toolCalls: any[];
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  }>;
  stream: (input: unknown) => Promise<ReadableStream<Uint8Array>>;
};

function assert(condition: unknown, message?: string): void {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const pass = typeof actual === "object" && typeof expected === "object"
    ? JSON.stringify(actual) === JSON.stringify(expected)
    : actual === expected;
  if (!pass) {
    throw new Error(
      message || `Assertion failed: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
    );
  }
}

function createStreamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

function createMockProvider(events: Array<Record<string, unknown>>): Provider {
  return {
    name: "mock",
    complete: async () => ({
      text: "",
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
    stream: async () => {
      const payload = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
      const mid = Math.floor(payload.length / 2);
      // Intentionally split JSON in the middle to simulate chunk boundaries
      return createStreamFromChunks([payload.slice(0, mid), payload.slice(mid)]);
    },
  } as unknown as Provider;
}

describe("AgentRuntime streaming JSON buffering", () => {
  it("should parse content and tool events even when JSON is split across chunks", async () => {
    // Stub Deno.env to avoid permission errors from logger initialization inside AgentRuntime
    const originalEnv = (Deno as any).env;
    let restoreEnv: (() => void) | null = null;
    try {
      (Deno as any).env = { get: () => undefined, set: () => {} };
      restoreEnv = () => {
        (Deno as any).env = originalEnv;
      };
    } catch {
      if (originalEnv) {
        try {
          originalEnv.get = () => undefined;
          originalEnv.set = () => {};
          restoreEnv = () => {
            originalEnv.get = Deno.env.get;
            originalEnv.set = Deno.env.set;
          };
        } catch {
          /* ignore if not writable */
        }
      }
    }
    const { AgentRuntime } = await import("../../src/ai/agent/runtime.ts");

    const baseConfig: AgentConfig = {
      id: "test-agent",
      model: "mock/model",
      system: "You are a tester",
      memory: { type: "conversation", maxTokens: 4000 },
    };
    const provider = createMockProvider([
      { type: "content", content: "Hello" },
      { type: "tool_call_start", toolCall: { id: "1", name: "testTool" } },
      { type: "tool_call_delta", id: "1", arguments: '{"x":1}' },
      { type: "tool_call_complete", toolCall: { id: "1", name: "testTool", arguments: '{"x":1}' } },
      { type: "finish", finishReason: "stop" },
    ]);

    const runtime = new AgentRuntime("test", baseConfig);
    const messages: Message[] = [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }];
    const controller = {
      enqueue: (_chunk: Uint8Array) => {},
      close: () => {},
    } as unknown as ReadableStreamDefaultController;

    // @ts-ignore access private for test
    const response = await runtime["executeAgentLoopStreaming"](
      provider as any,
      "mock/model",
      "sys",
      messages,
      controller,
      new TextEncoder(),
    );

    assert(response.text.includes("Hello"), "should include streamed content");
    // No tool execution because finishReason=stop, but assistant message should carry parsed tool-call parts
    const assistant = response.messages.find((m) => m.role === "assistant");
    const toolCallParts = assistant?.parts.filter((p): p is MessagePart & { type: "tool-call" } =>
      p.type === "tool-call"
    );
    assert(toolCallParts && toolCallParts.length === 1, "assistant tool-call parts captured");
    const tc = toolCallParts![0]!;
    assertEquals(tc.toolName, "testTool");
    assertEquals(tc.args, { x: 1 });
    // Restore env if we modified it
    if (restoreEnv) {
      restoreEnv();
    }
  });
});

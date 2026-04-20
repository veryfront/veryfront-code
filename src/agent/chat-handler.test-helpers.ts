import { registerAgent } from "./composition/index.ts";

export type ChatMessage = {
  id?: string;
  role: string;
  parts: unknown[];
};

export function createChatRequest(
  messages: ChatMessage[] = [
    {
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "hello" }],
    },
  ],
): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
}

export function registerStreamAgent<T extends object>(agentId: string, overrides: T) {
  const agent = {
    id: agentId,
    config: { model: "openai/gpt-4o", system: "test" },
    clearMemory: async () => {},
    stream: async () => ({
      toDataStreamResponse: () => new Response("ok", { status: 200 }),
    }),
    ...overrides,
  };

  // deno-lint-ignore no-explicit-any
  registerAgent(agentId, agent as any);
  return agent;
}

import { assertEquals } from "#veryfront/testing/assert.ts";
import type { ModelRuntime, ModelRuntimePromptMessage, RuntimePromptMessage } from "./types.ts";

type LegacyAssistantContentPart = Extract<
  RuntimePromptMessage,
  { role: "assistant" }
>["content"][number];

type Equal<Left, Right> = (
  <Value>() => Value extends Left ? 1 : 2
) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Assert<Condition extends true> = Condition;
const legacyToolCallKeysAreStable: Assert<
  Equal<
    keyof Extract<LegacyAssistantContentPart, { type: "tool-call" }>,
    "type" | "toolCallId" | "toolName" | "input" | "providerExecuted"
  >
> = true;

function describeLegacyAssistantContent(part: LegacyAssistantContentPart): string {
  switch (part.type) {
    case "text":
      return part.text;
    case "tool-call":
      return part.toolName;
    case "reasoning":
      return part.text ?? "";
    default: {
      const exhaustive: never = part;
      return exhaustive;
    }
  }
}

Deno.test("default ModelRuntime remains compatible with untyped custom runtimes", async () => {
  let received: unknown;
  const runtime: ModelRuntime = {
    doGenerate(options: unknown) {
      received = options;
      return Promise.resolve({ content: [] });
    },
    doStream(_options: unknown) {
      return Promise.resolve({ stream: new ReadableStream() });
    },
  };

  await runtime.doGenerate({ customProviderOption: true });

  assertEquals(received, { customProviderOption: true });
});

Deno.test("ModelRuntime generics opt into provider-specific call options", async () => {
  interface CustomOptions {
    prompt: RuntimePromptMessage[];
    customProviderOption: string;
  }

  const runtime: ModelRuntime<CustomOptions> = {
    doGenerate(options: CustomOptions) {
      return Promise.resolve({
        content: [{ type: "text", text: options.customProviderOption }],
      });
    },
    doStream(_options: CustomOptions) {
      return Promise.resolve({ stream: new ReadableStream() });
    },
  };

  const result = await runtime.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    customProviderOption: "preserved",
  });

  assertEquals(result.content, [{ type: "text", text: "preserved" }]);
});

Deno.test("RuntimePromptMessage collections retain their mutable public contract", () => {
  const userMessage: Extract<RuntimePromptMessage, { role: "user" }> = {
    role: "user",
    content: [{ type: "text", text: "first" }],
  };
  userMessage.content.push({ type: "text", text: "second" });

  const assistantMessage: Extract<RuntimePromptMessage, { role: "assistant" }> = {
    role: "assistant",
    content: [],
    providerToolCalls: [],
  };
  assistantMessage.content.push({ type: "text", text: "answer" });
  assistantMessage.providerToolCalls?.push({
    toolCallId: "call_1",
    toolName: "lookup",
    input: {},
  });

  assertEquals(userMessage.content.length, 2);
  assertEquals(assistantMessage.content.length, 1);
  assertEquals(assistantMessage.providerToolCalls?.length, 1);
});

Deno.test("RuntimePromptMessage retains its legacy exhaustive assistant union", () => {
  assertEquals(legacyToolCallKeysAreStable, true);
  assertEquals(
    describeLegacyAssistantContent({ type: "text", text: "answer" }),
    "answer",
  );
});

Deno.test("ModelRuntimePromptMessage represents provider-executed assistant results", () => {
  const prompt = [{
    role: "assistant",
    content: [{
      type: "tool-result",
      toolCallId: "provider_call_1",
      toolName: "web_search",
      result: { status: "completed" },
      providerExecuted: true,
    }],
  }] as const satisfies readonly ModelRuntimePromptMessage[];

  assertEquals(prompt[0].content[0].providerExecuted, true);
});

Deno.test("ModelRuntime content generics compose validated output with replay input", async () => {
  type TextPart = { type: "text"; text: string };
  const runtime: ModelRuntime<{ prompt: readonly ModelRuntimePromptMessage[] }, TextPart> = {
    doGenerate() {
      return Promise.resolve({
        content: [{ type: "text", text: "validated" }],
      });
    },
    doStream() {
      return Promise.resolve({ stream: new ReadableStream() });
    },
  };

  const result = await runtime.doGenerate({ prompt: [] });
  const replay: ModelRuntimePromptMessage = {
    role: "assistant",
    content: result.content ?? [],
  };

  assertEquals(replay.content, [{ type: "text", text: "validated" }]);
});

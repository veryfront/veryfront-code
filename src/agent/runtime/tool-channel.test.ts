import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createRecoveredToolCallId,
  getToolChannelProfile,
  recoverTextEmittedToolCalls,
  resolveStepToolChoice,
  type ToolChannelStepInput,
} from "./tool-channel.ts";

const TOOL_NAMES = new Set(["get_file", "create_file", "search_knowledge"]);

function stepInput(overrides: Partial<ToolChannelStepInput> = {}): ToolChannelStepInput {
  return { step: 0, hasTools: true, madeToolCall: false, hasOutputSchema: false, ...overrides };
}

let counter = 0;
function nextToolCallId(): string {
  counter += 1;
  return `call_${counter}`;
}

describe("getToolChannelProfile", () => {
  it("forces the tool channel for Mistral models", () => {
    const profile = getToolChannelProfile("mistral/mistral-small-2503");
    assertEquals(profile.forceByDefault, true);
    assertEquals(profile.toolChoiceValue, "any");
    assertEquals(profile.recoverTextToolCalls, true);
  });

  it("reads the upstream provider through a Veryfront Cloud prefix", () => {
    assertEquals(
      getToolChannelProfile("veryfront-cloud/mistral/mistral-large-2512").forceByDefault,
      true,
    );
  });

  it("leaves models that hold the channel on the provider default", () => {
    for (
      const model of [
        "anthropic/claude-haiku-4-5-20251001",
        "openai/gpt-5-nano",
        "google-ai-studio/gemini-3.5-flash",
      ]
    ) {
      const profile = getToolChannelProfile(model);
      assertEquals(profile.forceByDefault, false, model);
      assertEquals(profile.recoverTextToolCalls, false, model);
    }
  });

  it("does not recover text tool calls for an unlisted provider", () => {
    const profile = getToolChannelProfile("deepseek/deepseek-v3");
    assertEquals(profile.forceByDefault, false);
    assertEquals(profile.recoverTextToolCalls, false);
  });

  it("uses the captured Set intrinsic for provider policy lookups", () => {
    const originalHas = Set.prototype.has;
    Object.defineProperty(Set.prototype, "has", {
      configurable: true,
      value: () => true,
    });
    try {
      const profile = getToolChannelProfile("deepseek/deepseek-v3");
      assertEquals(profile.forceByDefault, false);
      assertEquals(profile.recoverTextToolCalls, false);
    } finally {
      Object.defineProperty(Set.prototype, "has", {
        configurable: true,
        value: originalHas,
      });
    }
  });
});

describe("resolveStepToolChoice", () => {
  const mistral = getToolChannelProfile("mistral/mistral-small-2503");
  const anthropic = getToolChannelProfile("anthropic/claude-haiku-4-5-20251001");

  it("forces the channel on the opening step of a run with tools", () => {
    assertEquals(resolveStepToolChoice(mistral, stepInput()), "any");
  });

  it("keeps forcing until the model makes its first tool call", () => {
    assertEquals(resolveStepToolChoice(mistral, stepInput({ step: 2 })), "any");
  });

  it("releases the channel once the model has made a tool call", () => {
    assertEquals(
      resolveStepToolChoice(mistral, stepInput({ step: 2, madeToolCall: true })),
      undefined,
    );
  });

  it("leaves a step that sends no tools alone", () => {
    assertEquals(resolveStepToolChoice(mistral, stepInput({ hasTools: false })), undefined);
  });

  it("yields to a requested response schema", () => {
    assertEquals(resolveStepToolChoice(mistral, stepInput({ hasOutputSchema: true })), undefined);
  });

  it("never forces a model that holds the channel", () => {
    assertEquals(resolveStepToolChoice(anthropic, stepInput()), undefined);
  });

  it("restores the previous behavior in off mode", () => {
    assertEquals(resolveStepToolChoice(mistral, stepInput(), "off"), undefined);
  });

  it("limits forcing to the opening step in force-first-step mode", () => {
    assertEquals(resolveStepToolChoice(mistral, stepInput(), "force-first-step"), "any");
    assertEquals(
      resolveStepToolChoice(mistral, stepInput({ step: 1 }), "force-first-step"),
      undefined,
    );
  });

  it("forces a model that holds the channel only when an operator asks", () => {
    assertEquals(resolveStepToolChoice(anthropic, stepInput(), "force-first-step"), "any");
  });

  it("sends the tool_choice value each provider accepts", () => {
    const openai = getToolChannelProfile("openai/gpt-5-nano");
    assertEquals(resolveStepToolChoice(openai, stepInput(), "force-first-step"), "required");
  });
});

describe("createRecoveredToolCallId", () => {
  it("mints the nine alphanumeric characters Mistral requires", () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const id = createRecoveredToolCallId();
      assertEquals(id.length, 9, id);
      assertEquals(/^[A-Za-z0-9]{9}$/.test(id), true, id);
    }
  });

  it("mints a distinct id per call", () => {
    const ids = new Set<string>();
    for (let attempt = 0; attempt < 200; attempt++) ids.add(createRecoveredToolCallId());
    assertEquals(ids.size, 200);
  });

  it("is the default id source for a recovered call", () => {
    const recovered = recoverTextEmittedToolCalls(
      '{"name": "get_file", "arguments": {"path": "a"}}',
      TOOL_NAMES,
    );
    assertEquals(/^[A-Za-z0-9]{9}$/.test(recovered?.[0]?.toolCallId ?? ""), true);
  });
});

describe("recoverTextEmittedToolCalls", () => {
  it("reads an array payload naming a known tool", () => {
    const recovered = recoverTextEmittedToolCalls(
      '[{"name": "get_file", "arguments": {"path": "a.txt"}}]',
      TOOL_NAMES,
      nextToolCallId,
    );
    assertEquals(recovered?.length, 1);
    assertEquals(recovered?.[0]?.toolName, "get_file");
    assertEquals(recovered?.[0]?.input, { path: "a.txt" });
  });

  it("reads a bare object payload", () => {
    const recovered = recoverTextEmittedToolCalls(
      '{"name": "search_knowledge", "arguments": {"query": "invoices"}}',
      TOOL_NAMES,
      nextToolCallId,
    );
    assertEquals(recovered?.length, 1);
    assertEquals(recovered?.[0]?.toolName, "search_knowledge");
  });

  it("reads a fenced payload and a stringified argument bag", () => {
    const recovered = recoverTextEmittedToolCalls(
      '```json\n[{"name": "get_file", "arguments": "{\\"path\\": \\"b.txt\\"}"}]\n```',
      TOOL_NAMES,
      nextToolCallId,
    );
    assertEquals(recovered?.[0]?.input, { path: "b.txt" });
  });

  it("reads the OpenAI function wrapper", () => {
    const recovered = recoverTextEmittedToolCalls(
      '{"id": "1", "type": "function", "function": {"name": "get_file", "arguments": {"path": "c"}}}',
      TOOL_NAMES,
      nextToolCallId,
    );
    assertEquals(recovered?.[0]?.toolName, "get_file");
  });

  it("recovers every call in a batch or none of them", () => {
    assertEquals(
      recoverTextEmittedToolCalls(
        '[{"name": "get_file", "arguments": {"path": "a"}}, {"name": "unknown_tool", "arguments": {}}]',
        TOOL_NAMES,
        nextToolCallId,
      ),
      undefined,
    );
  });

  it("leaves prose that merely contains JSON alone", () => {
    for (
      const text of [
        'Here is what I would call: [{"name": "get_file", "arguments": {"path": "a"}}]',
        '[{"name": "get_file", "arguments": {"path": "a"}}] — let me know if that is right.',
        "I'm sorry, but I currently don't have the tools needed to access that directory.",
      ]
    ) {
      assertEquals(recoverTextEmittedToolCalls(text, TOOL_NAMES, nextToolCallId), undefined, text);
    }
  });

  it("leaves an ordinary JSON answer alone", () => {
    for (
      const text of [
        '{"category": "invoices", "reasoning": "It is a bill."}',
        '{"name": "get_file", "arguments": {"path": "a"}, "reasoning": "why"}',
        '{"name": "Ada Lovelace", "arguments": {}}',
        '[{"name": "get_file"}]',
        '{"name": "get_file", "arguments": "not json"}',
        '{"name": "get_file", "arguments": ["a"]}',
        "[]",
        '"get_file"',
      ]
    ) {
      assertEquals(recoverTextEmittedToolCalls(text, TOOL_NAMES, nextToolCallId), undefined, text);
    }
  });

  it("recovers nothing when the step sent no tools", () => {
    assertEquals(
      recoverTextEmittedToolCalls(
        '{"name": "get_file", "arguments": {"path": "a"}}',
        new Set<string>(),
        nextToolCallId,
      ),
      undefined,
    );
  });

  it("refuses a payload larger than the recovery budget", () => {
    const long = `{"name": "get_file", "arguments": {"path": "${"a".repeat(20_000)}"}}`;
    assertEquals(recoverTextEmittedToolCalls(long, TOOL_NAMES, nextToolCallId), undefined);
  });

  it("refuses a payload whose prototype was poisoned", () => {
    assertEquals(
      recoverTextEmittedToolCalls(
        '{"name": "get_file", "arguments": {"__proto__": {"polluted": true}}}',
        TOOL_NAMES,
        nextToolCallId,
      )?.[0]?.input,
      // JSON.parse leaves __proto__ as an own data property, so the tool sees it
      // as ordinary input rather than a mutated prototype.
      JSON.parse('{"__proto__": {"polluted": true}}'),
    );
  });
});

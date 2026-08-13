import { renderToString } from "react-dom/server";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatDynamicToolPart } from "#veryfront/agent/react";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { ToolCall, useToolCall } from "./tool-ui.tsx";
import { Message } from "../composition/message.tsx";
import { ChatContextProvider, type ChatContextValue } from "../contexts/chat-context.tsx";

/** A fully-populated card tool (input + output) — the composable `card` path. */
const cardTool: ChatDynamicToolPart = {
  type: "dynamic-tool",
  toolCallId: "tool-search-docs",
  toolName: "search_docs",
  state: "output-available",
  input: { query: "agent run persistence" },
  output: [{ title: "Runs" }],
};

const skillTool: ChatDynamicToolPart = {
  type: "dynamic-tool",
  toolCallId: "tool-load-skill",
  toolName: "load_skill",
  state: "output-available",
  input: { skillId: "review" },
  output: { loaded: true },
};

const invokeAgentTool: ChatDynamicToolPart = {
  type: "dynamic-tool",
  toolCallId: "tool-invoke-agent",
  toolName: "invoke_agent",
  state: "input-available",
  input: { agent_id: "case-ingest", description: "Fetch and redact cases" },
};

/** An assistant turn holding one `invoke_agent` child that never resolved. */
const runningInvokeAgentMessage = {
  id: "assistant-message",
  role: "assistant" as const,
  metadata: {},
  parts: [invokeAgentTool],
};

/** Minimal `ChatContext` — only the streaming lifecycle matters to these cards. */
function chatContext(overrides: Partial<ChatContextValue>): ChatContextValue {
  const noop = () => {};
  return {
    messages: [],
    isLoading: false,
    error: null,
    input: "",
    setInput: noop,
    onSubmit: noop,
    models: [],
    attachments: [],
    ...overrides,
  } as ChatContextValue;
}

function installDom(): { host: HTMLElement; restore: () => void } {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const window = dom.window;
  const keys = ["window", "document", "navigator", "Node", "Element", "HTMLElement"] as const;
  const previous: Record<string, unknown> = {};
  for (const key of keys) previous[key] = (globalThis as Record<string, unknown>)[key];
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
  });
  return {
    host: window.document.getElementById("root") as unknown as HTMLElement,
    restore: () => {
      Object.assign(globalThis, previous);
      dom.window.close();
    },
  };
}

describe("ToolCall", () => {
  it("renders invoke_agent as a child-agent card by default", () => {
    const html = renderToString(<ToolCall tool={invokeAgentTool} className="custom-card" />);

    assertStringIncludes(html, "Case Ingest");
    assertStringIncludes(html, "Running");
    assertStringIncludes(html, "custom-card");
    assertStringIncludes(html, 'aria-expanded="true"');
    assertStringIncludes(html, "Fetch and redact cases");
    assertEquals(html.includes("Parameters"), false);
  });

  it("auto-expands a running child and collapses when it completes", async () => {
    const { host, restore } = installDom();
    const root = createRoot(host);
    try {
      flushSync(() => root.render(<ToolCall tool={invokeAgentTool} />));
      assertEquals(host.querySelector("button")?.getAttribute("aria-expanded"), "true");

      flushSync(() =>
        root.render(
          <ToolCall
            tool={{
              ...invokeAgentTool,
              state: "output-available",
              output: { status: "completed", text: "Done" },
            }}
          />,
        )
      );
      assertEquals(host.querySelector("button")?.getAttribute("aria-expanded"), "false");
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("advances the open child section from instructions to live reasoning", async () => {
    const { host, restore } = installDom();
    const root = createRoot(host);
    const tool: ChatDynamicToolPart = {
      ...invokeAgentTool,
      input: { agent_id: "case-ingest", prompt: "Fetch the newest cases." },
    };
    const streamPart = (event: Record<string, unknown>) => ({
      type: "data-veryfront.invoke_agent.stream" as const,
      data: { toolCallId: tool.toolCallId, agentId: "case-ingest", event },
    });
    const renderWithEvents = (events: Record<string, unknown>[]) => {
      flushSync(() =>
        root.render(
          <Message.Root
            isStreaming
            message={{
              id: "assistant-message",
              role: "assistant",
              metadata: {},
              parts: [tool, ...events.map(streamPart)],
            }}
          >
            <ToolCall tool={tool} />
          </Message.Root>,
        )
      );
    };
    // The child sections reuse the main-chat `Reasoning` disclosure (a button +
    // conditionally-rendered content), so "open" is detected by whether the
    // section's body text is in the DOM rather than a `<details open>` flag.
    const shows = (text: string) => host.textContent?.includes(text) ?? false;

    try {
      renderWithEvents([]);
      // Instructions phase: its body is visible.
      assertEquals(shows("Fetch the newest cases."), true);

      renderWithEvents([
        { type: "reasoning-start", id: "child-reasoning" },
        { type: "reasoning-delta", id: "child-reasoning", delta: "I should query first." },
      ]);
      // Reasoning began: instructions collapse, the thought process is visible.
      assertEquals(shows("Fetch the newest cases."), false);
      assertEquals(shows("I should query first."), true);

      renderWithEvents([
        { type: "reasoning-start", id: "child-reasoning" },
        { type: "reasoning-delta", id: "child-reasoning", delta: "I should query first." },
        { type: "reasoning-end", id: "child-reasoning" },
        {
          type: "tool-input-available",
          toolCallId: "child-tool-call",
          toolName: "salesforce__list_cases",
          input: { status: "open" },
        },
      ]);
      // Work phase: instructions stay collapsed and the child tool renders.
      assertEquals(shows("Fetch the newest cases."), false);
      assertEquals(shows("salesforce__list_cases"), true);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("recovers streamed child tool input (start → delta → output) into Parameters", async () => {
    const { host, restore } = installDom();
    const root = createRoot(host);
    const tool: ChatDynamicToolPart = { ...invokeAgentTool, input: { agent_id: "case-ingest" } };
    const streamPart = (event: Record<string, unknown>) => ({
      type: "data-veryfront.invoke_agent.stream" as const,
      data: { toolCallId: tool.toolCallId, agentId: "case-ingest", event },
    });
    try {
      // No `tool-input-available` — the input only ever arrives as buffered
      // delta text, so the reducer must parse `inputText` into `input`.
      flushSync(() =>
        root.render(
          <Message.Root
            isStreaming
            message={{
              id: "assistant-message",
              role: "assistant",
              metadata: {},
              parts: [
                tool,
                streamPart({
                  type: "tool-input-start",
                  toolCallId: "child",
                  toolName: "salesforce__list_cases",
                }),
                streamPart({
                  type: "tool-input-delta",
                  toolCallId: "child",
                  inputTextDelta: '{"status":"open"}',
                }),
                streamPart({
                  type: "tool-output-available",
                  toolCallId: "child",
                  output: { ok: true },
                }),
              ],
            }}
          >
            <ToolCall tool={tool} defaultExpanded />
          </Message.Root>,
        )
      );
      const childButton = Array.from(host.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("salesforce__list_cases")
      );
      assert(childButton, "expected the child tool row to render");
      flushSync(() => (childButton as HTMLButtonElement).click());
      assert(host.textContent?.includes("status"), "expected the parsed child input key");
      assert(host.textContent?.includes("open"), "expected the parsed child input value");
    } finally {
      await unmountReactRoot(root);
      restore();
    }
  });

  it("freezes a running child as Stopped once the turn stops streaming", () => {
    const skillStreamPart = {
      type: "data-veryfront.invoke_agent.stream" as const,
      data: {
        toolCallId: invokeAgentTool.toolCallId,
        agentId: "case-ingest",
        event: {
          type: "tool-input-available",
          toolCallId: "child-load-skill",
          toolName: "load_skill",
          input: { skillId: "case-normalise-redact" },
        },
      },
    };
    const message = {
      id: "assistant-message",
      role: "assistant" as const,
      metadata: {},
      parts: [invokeAgentTool, skillStreamPart],
    };

    // While the turn streams, the running child reads as Running.
    const streamingHtml = renderToString(
      <Message.Root message={message} isStreaming>
        <ToolCall tool={invokeAgentTool} defaultExpanded />
      </Message.Root>,
    );
    assertStringIncludes(streamingHtml, "Running");

    // Once the turn stops streaming with no terminal output, the card and its
    // still-running child freeze to Stopped instead of a forever-Running card.
    const stoppedHtml = renderToString(
      <Message.Root message={message} isStreaming={false}>
        <ToolCall tool={invokeAgentTool} defaultExpanded />
      </Message.Root>,
    );
    assertStringIncludes(stoppedHtml, "Stopped");
    assertEquals(stoppedHtml.includes("Running"), false);
    // The frozen child row reads terminal, never a static "Loading".
    assertStringIncludes(stoppedHtml, "Stopped loading skill: case-normalise-redact");
  });

  it("keeps a running child card Running while the chat is still streaming", () => {
    // The message itself stopped streaming because the turn moved on to another
    // message. The chat is still live, so nothing was stopped.
    const html = renderToString(
      <ChatContextProvider value={chatContext({ status: "streaming" })}>
        <Message.Root message={runningInvokeAgentMessage} isStreaming={false}>
          <ToolCall tool={invokeAgentTool} defaultExpanded />
        </Message.Root>
      </ChatContextProvider>,
    );

    assertStringIncludes(html, "Running");
    assertEquals(html.includes("Stopped"), false);
  });

  it("reads a turn that ended in an error as Failed, not Stopped", () => {
    const html = renderToString(
      <ChatContextProvider value={chatContext({ status: "error" })}>
        <Message.Root message={runningInvokeAgentMessage} isStreaming={false}>
          <ToolCall tool={invokeAgentTool} defaultExpanded />
        </Message.Root>
      </ChatContextProvider>,
    );

    assertStringIncludes(html, "Failed");
    assertEquals(html.includes("Stopped"), false);
  });

  it("leaves an approval-gated child card alone when the turn pauses on the user", () => {
    // The stream ends while the tool waits for a person. That is paused, not
    // stopped, so the card keeps its own state.
    const awaitingApproval: ChatDynamicToolPart = {
      ...invokeAgentTool,
      state: "approval-requested" as ChatDynamicToolPart["state"],
    };
    const html = renderToString(
      <ChatContextProvider value={chatContext({ status: "ready" })}>
        <Message.Root
          message={{ ...runningInvokeAgentMessage, parts: [awaitingApproval] }}
          isStreaming={false}
        >
          <ToolCall tool={awaitingApproval} defaultExpanded />
        </Message.Root>
      </ChatContextProvider>,
    );

    assertEquals(html.includes("Stopped"), false);
    assertEquals(html.includes("Failed"), false);
  });

  it("renders the streamed child name and avatar in the card header", () => {
    const message = {
      id: "assistant-message",
      role: "assistant" as const,
      metadata: {},
      parts: [
        invokeAgentTool,
        {
          type: "data-veryfront.invoke_agent.stream" as const,
          data: {
            toolCallId: invokeAgentTool.toolCallId,
            agentId: "case-ingest",
            agentName: "Intake Bot",
            avatarUrl: "https://cdn.example.com/agents/case-ingest.png",
            event: { type: "reasoning-delta", delta: "Starting." },
          },
        },
      ],
    };

    const html = renderToString(
      <Message.Root message={message} isStreaming>
        <ToolCall tool={invokeAgentTool} defaultExpanded />
      </Message.Root>,
    );

    // The streamed name wins over the humanized agent id, and the avatar image
    // renders while the child is still running (not only on completion).
    assertStringIncludes(html, "Intake Bot");
    assertStringIncludes(html, "https://cdn.example.com/agents/case-ingest.png");
    assertEquals(html.includes("Case Ingest"), false);
  });

  it("renders the child prompt in an Instructions disclosure", () => {
    const tool: ChatDynamicToolPart = {
      ...invokeAgentTool,
      input: {
        agent_id: "case-ingest",
        description: "Fetch and redact cases",
        prompt: "Fetch the five newest open cases and redact PII.",
      },
    };

    const html = renderToString(<ToolCall tool={tool} defaultExpanded />);

    assertStringIncludes(html, "Instructions");
    assertStringIncludes(html, "Fetch the five newest open cases and redact PII.");
    // Themed via tokens, like the main-chat disclosure it now reuses (which
    // carries the foreground token, not the softer one the old markup used).
    assertStringIncludes(html, "text-[var(--foreground)]");
    assertEquals(html.includes("text-black"), false);
    assertEquals(html.includes("text-white"), false);
  });

  it("renders streamed child response content before invoke_agent completes", () => {
    const message = {
      id: "assistant-message",
      role: "assistant" as const,
      metadata: {},
      parts: [
        invokeAgentTool,
        {
          type: "data-veryfront.invoke_agent.stream" as const,
          data: {
            toolCallId: "tool-invoke-agent",
            agentId: "case-ingest",
            event: { type: "reasoning-delta", delta: "I should query Salesforce first." },
          },
        },
        {
          type: "data-veryfront.invoke_agent.stream" as const,
          data: {
            toolCallId: "tool-invoke-agent",
            agentId: "case-ingest",
            event: { type: "text-delta", delta: "I will query Salesforce now." },
          },
        },
        {
          type: "data-veryfront.invoke_agent.stream" as const,
          data: {
            toolCallId: "tool-invoke-agent",
            agentId: "case-ingest",
            event: {
              type: "tool-input-available",
              toolCallId: "child-tool-call",
              toolName: "salesforce__list_cases",
              input: { status: "open" },
            },
          },
        },
        {
          type: "data-veryfront.invoke_agent.stream" as const,
          data: {
            toolCallId: "tool-invoke-agent",
            agentId: "case-ingest",
            event: { type: "text-delta", delta: "Fetching the newest cases now." },
          },
        },
      ],
    };

    const html = renderToString(
      <Message.Root message={message}>
        <ToolCall tool={invokeAgentTool} defaultExpanded />
      </Message.Root>,
    );

    // Reasoning is still streaming (no reasoning-end), so the shared Reasoning
    // disclosure shows its "Thinking..." label and stays open.
    assertStringIncludes(html, "Thinking...");
    assertStringIncludes(html, "I should query Salesforce first.");
    assertStringIncludes(html, "Fetching the newest cases now.");
    assertStringIncludes(html, "salesforce__list_cases");
    assert(
      html.indexOf("I will query Salesforce now.") < html.indexOf("salesforce__list_cases"),
      "expected child text emitted before a tool to render before that tool",
    );
    assert(
      html.indexOf("salesforce__list_cases") < html.indexOf("Fetching the newest cases now."),
      "expected child text emitted after a tool to render after that tool",
    );
  });

  it("surfaces a failed child run without exposing raw tool JSON", () => {
    const tool: ChatDynamicToolPart = {
      type: "dynamic-tool",
      toolCallId: "tool-invoke-agent-failed",
      toolName: "invoke_agent",
      state: "output-available",
      input: { agent_id: "case-ingest" },
      output: {
        structuredContent: {
          ok: false,
          status: "error",
          terminalErrorMessage: "The child agent run failed before returning a usable result.",
        },
      },
    };

    const html = renderToString(<ToolCall tool={tool} />);

    assertStringIncludes(html, "Case Ingest");
    assertStringIncludes(html, "Failed");
    assertStringIncludes(html, 'aria-expanded="false"');
    assertEquals(
      html.includes("The child agent run failed before returning a usable result."),
      false,
    );
    assertEquals(html.includes("structuredContent"), false);

    const expandedHtml = renderToString(<ToolCall tool={tool} defaultExpanded />);
    assertStringIncludes(
      expandedHtml,
      "The child agent run failed before returning a usable result.",
    );
  });

  it("keeps the child error visible after partial streamed prose", () => {
    const tool: ChatDynamicToolPart = {
      ...invokeAgentTool,
      state: "output-error",
      errorText: "Salesforce credentials expired.",
    };
    const message = {
      id: "assistant-message",
      role: "assistant" as const,
      metadata: {},
      parts: [
        tool,
        {
          type: "data-veryfront.invoke_agent.stream" as const,
          data: {
            toolCallId: tool.toolCallId,
            agentId: "case-ingest",
            event: { type: "text-delta", delta: "I found the first case." },
          },
        },
      ],
    };

    const html = renderToString(
      <Message.Root message={message}>
        <ToolCall tool={tool} defaultExpanded />
      </Message.Root>,
    );

    assertStringIncludes(html, "I found the first case.");
    assertStringIncludes(html, "Salesforce credentials expired.");
  });

  it("renders a completed tool with null output as a compact status row", () => {
    const tool: ChatDynamicToolPart = {
      type: "dynamic-tool",
      toolCallId: "tool-web-search",
      toolName: "web_search",
      state: "output-available",
      input: { query: "Swedish tax residency" },
      output: null,
    };

    const html = renderToString(<ToolCall tool={tool} />);

    assertStringIncludes(html, "web_search");
    assertStringIncludes(html, "Completed");
    assertStringIncludes(html, "rounded-[var(--radius-md)]");
    assertStringIncludes(html, "border-[var(--outline-border)]");
    assertEquals(html.includes("Parameters"), false);
    assertEquals(html.includes("Result"), false);
  });

  it("renders hostile tool values without invoking accessors or custom serializers", () => {
    let accessorCalls = 0;
    let serializerCalls = 0;
    const output: Record<string, unknown> = {
      count: 12n,
      toJSON() {
        serializerCalls += 1;
        return "unsafe";
      },
    };
    Object.defineProperty(output, "secret", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return "unsafe";
      },
    });
    output.self = output;

    const tool: ChatDynamicToolPart = {
      type: "dynamic-tool",
      toolCallId: "tool-hostile-output",
      toolName: "hostile_output",
      state: "output-available",
      input: undefined,
      output,
    };

    const html = renderToString(<ToolCall tool={tool} defaultExpanded />);

    assertStringIncludes(html, "[Circular]");
    assertStringIncludes(html, "[Accessor omitted]");
    assertStringIncludes(html, "12");
    assertEquals(accessorCalls, 0);
    assertEquals(serializerCalls, 0);
  });

  it("bounds oversized tool output before rendering", () => {
    const tool: ChatDynamicToolPart = {
      type: "dynamic-tool",
      toolCallId: "tool-large-output",
      toolName: "large_output",
      state: "output-available",
      input: undefined,
      output: Array.from({ length: 600 }, (_, index) => index),
    };

    const html = renderToString(<ToolCall tool={tool} defaultExpanded />);

    assertStringIncludes(html, "[Truncated] 100 array items");
  });
});

// The composability contract: a consuming developer must be able to recompose
// the card, inject a slot, and restyle a part. If these fail, `ToolCall` is not
// composable — these tests ARE the definition.
describe("ToolCall — composability contract", () => {
  it("replaces invoke_agent anatomy with custom children", () => {
    const html = renderToString(
      <ToolCall tool={invokeAgentTool}>
        <span>CUSTOM_AGENT_CARD</span>
      </ToolCall>,
    );

    assertStringIncludes(html, "CUSTOM_AGENT_CARD");
    assertEquals(html.includes("Case Ingest"), false);
  });

  it("replaces compact anatomy with context-aware children", () => {
    function CustomSkill() {
      const { tool } = useToolCall();
      return <span>{`CUSTOM_SKILL ${tool.toolName}`}</span>;
    }

    const html = renderToString(
      <ToolCall tool={skillTool}>
        <CustomSkill />
      </ToolCall>,
    );

    assertStringIncludes(html, "CUSTOM_SKILL load_skill");
    assertEquals(html.includes("Loaded skill: review"), false);
  });

  it("recomposes: a caller can reorder the body parts", () => {
    const html = renderToString(
      <ToolCall tool={cardTool} defaultExpanded>
        <ToolCall.Body>
          <ToolCall.Output />
          <ToolCall.Input />
        </ToolCall.Body>
      </ToolCall>,
    );
    // Custom order: Result must render before Parameters.
    assert(
      html.indexOf("Result") < html.indexOf("Parameters"),
      "expected Result to render before Parameters in the recomposed body",
    );
  });

  it("injects a slot: Output children replace the default rendering", () => {
    const html = renderToString(
      <ToolCall tool={cardTool} defaultExpanded>
        <ToolCall.Body>
          <ToolCall.Output>
            <span>CUSTOM_OUTPUT_NODE</span>
          </ToolCall.Output>
        </ToolCall.Body>
      </ToolCall>,
    );
    assertStringIncludes(html, "CUSTOM_OUTPUT_NODE");
    // The default JSON highlighter is bypassed when children are provided.
    assertEquals(html.includes("text-green-600"), false);
  });

  it("injects a slot: Trigger accepts a custom icon", () => {
    const html = renderToString(
      <ToolCall tool={cardTool}>
        <ToolCall.Trigger icon={<span>MY_ICON</span>} />
      </ToolCall>,
    );
    assertStringIncludes(html, "MY_ICON");
  });

  it("restyles: className on a sub-part is merged onto its wrapper", () => {
    const html = renderToString(
      <ToolCall tool={cardTool} defaultExpanded>
        <ToolCall.Body>
          <ToolCall.Output className="vf-custom-output-class" />
        </ToolCall.Body>
      </ToolCall>,
    );
    assertStringIncludes(html, "vf-custom-output-class");
  });

  it("useToolCall throws outside a ToolCall", () => {
    function Orphan() {
      useToolCall();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });
});

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
    const detailsFor = (label: string) =>
      Array.from(host.querySelectorAll("details")).find((details) =>
        details.querySelector("summary")?.textContent === label
      );

    try {
      renderWithEvents([]);
      assertEquals(detailsFor("Instructions")?.open, true);

      renderWithEvents([
        { type: "reasoning-start", id: "child-reasoning" },
        { type: "reasoning-delta", id: "child-reasoning", delta: "I should query first." },
      ]);
      assertEquals(detailsFor("Instructions")?.open, false);
      assertEquals(detailsFor("Thought process")?.open, true);

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
      assertEquals(detailsFor("Instructions")?.open, false);
      assertEquals(detailsFor("Thought process")?.open, false);
    } finally {
      await unmountReactRoot(root);
      restore();
    }
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
    assertStringIncludes(html, "text-[var(--soft)]");
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

    assertStringIncludes(html, "Thought process");
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

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatDynamicToolPart, ChatMessage } from "#veryfront/agent/react";
import { Message } from "./message.tsx";
import { useMessageBranches, useMessageParts } from "../contexts/message-context.tsx";
import type { PartGroup } from "../utils/message-parts.ts";

const completedTool: ChatDynamicToolPart = {
  type: "dynamic-tool",
  toolCallId: "tool-search-docs",
  toolName: "search_docs",
  state: "output-available",
  input: { query: "agent run persistence" },
  output: [{ title: "Runs" }],
};

const assistantMessage: ChatMessage = {
  id: "m-assistant",
  role: "assistant",
  parts: [
    { type: "text", text: "Answer body." },
    completedTool,
  ],
  metadata: {},
};

// The composability contract for the message body: a developer must be able to
// own the parts loop, render defaults via `Message.Part`, and drop in
// `Message.Sources` — without reimplementing part grouping.
describe("Message.Content — composability contract", () => {
  it("hands each grouped part to a function child (caller owns the body)", () => {
    const seen: string[] = [];
    const html = renderToString(
      <Message.Root message={assistantMessage}>
        <Message.Content>
          {(part: PartGroup, i: number) => {
            seen.push(part.type);
            return part.type === "tool"
              ? <div key={i} className="vf-custom-tool">custom tool</div>
              : <Message.Part key={i} part={part} />;
          }}
        </Message.Content>
      </Message.Root>,
    );
    // The caller's nodes render; the default markdown/tool card does not.
    assertStringIncludes(html, "Answer body.");
    assertStringIncludes(html, "vf-custom-tool");
    assert(!html.includes("search_docs"), "the custom tool replaces the default tool card");
    // The loop yielded the grouped parts in order.
    assertEquals(seen, ["text", "tool"]);
  });

  it("Message.Part renders the default anatomy for a part", () => {
    const html = renderToString(
      <Message.Root message={assistantMessage}>
        <Message.Content>
          {(part: PartGroup, i: number) => <Message.Part key={i} part={part} />}
        </Message.Content>
      </Message.Root>,
    );
    // Default tool card renders (tool name is present).
    assertStringIncludes(html, "search_docs");
  });

  it("restyles: className merges onto the Content wrapper", () => {
    const html = renderToString(
      <Message.Root message={assistantMessage}>
        <Message.Content className="vf-body-gap" />
      </Message.Root>,
    );
    assertStringIncludes(html, "vf-body-gap");
  });

  it("Message.Sources renders the citation sources when present", () => {
    const withSources: ChatMessage = {
      ...assistantMessage,
      parts: [
        { type: "text", text: "See sources." },
        {
          type: "tool-result",
          toolCallId: "tool-search-docs",
          // deno-lint-ignore no-explicit-any
          result: { documents: [{ title: "Runs guide", url: "/runs" }] } as any,
          // deno-lint-ignore no-explicit-any
        } as any,
      ],
    };
    const html = renderToString(
      <Message.Root message={withSources}>
        <Message.Content>
          {(part: PartGroup, i: number) => <Message.Part key={i} part={part} />}
        </Message.Content>
        <Message.Sources />
      </Message.Root>,
    );
    assertStringIncludes(html, "Runs guide");
  });

  it("Message.Sources maps each citation through a function child", () => {
    const withSources: ChatMessage = {
      ...assistantMessage,
      parts: [
        { type: "text", text: "See sources." },
        {
          type: "tool-result",
          toolCallId: "tool-search-docs",
          // deno-lint-ignore no-explicit-any
          result: { documents: [{ title: "Runs guide", url: "/runs" }] } as any,
          // deno-lint-ignore no-explicit-any
        } as any,
      ],
    };
    const html = renderToString(
      <Message.Root message={withSources}>
        <Message.Sources>
          {(source, index) => <span key={index} data-testid="custom-citation">{source.title}</span>}
        </Message.Sources>
      </Message.Root>,
    );
    assertStringIncludes(html, "custom-citation");
    assertStringIncludes(html, "Runs guide");
  });

  it("Message.Text / .Reasoning render narrowed parts via the typed sugar leaves", () => {
    const reasoning: ChatMessage = {
      ...assistantMessage,
      parts: [
        { type: "reasoning", text: "Thinking about persistence.", state: "done" },
        { type: "text", text: "Answer body." },
      ],
    };
    const html = renderToString(
      <Message.Root message={reasoning}>
        <Message.Content>
          {(part: PartGroup, i: number) => {
            if (part.type === "text") return <Message.Text key={i} part={part} />;
            if (part.type === "reasoning") return <Message.Reasoning key={i} part={part} />;
            return <Message.Part key={i} part={part} />;
          }}
        </Message.Content>
      </Message.Root>,
    );
    assertStringIncludes(html, "Answer body.");
    // The reasoning leaf renders the collapsible `Reasoning` anatomy (its text is
    // behind the "Thought process" toggle, collapsed by default in SSR).
    assertStringIncludes(html, "Thought process");
  });

  it("Message.Source renders a citation and inherits the row click handler", () => {
    const withSources: ChatMessage = {
      ...assistantMessage,
      parts: [
        { type: "text", text: "See sources." },
        {
          type: "tool-result",
          toolCallId: "tool-search-docs",
          // deno-lint-ignore no-explicit-any
          result: { documents: [{ title: "Runs guide", url: "/runs" }] } as any,
          // deno-lint-ignore no-explicit-any
        } as any,
      ],
    };
    const html = renderToString(
      <Message.Root message={withSources}>
        <Message.Sources onSourceClick={() => {}}>
          {(source, index) => <Message.Source key={index} source={source} index={index} />}
        </Message.Sources>
      </Message.Root>,
    );
    assertStringIncludes(html, "Runs guide");
    assertStringIncludes(
      html,
      "cursor-pointer",
      "Message.Source inherits the row onSourceClick and renders clickable",
    );

    const inert = renderToString(
      <Message.Root message={withSources}>
        <Message.Sources>
          {(source, index) => <Message.Source key={index} source={source} index={index} />}
        </Message.Sources>
      </Message.Root>,
    );
    assertStringIncludes(inert, "cursor-default", "without a row handler the pill is inert");
    assert(!inert.includes("cursor-pointer"), "an inert pill must not render as clickable");
  });

  it("does not auto-append sources when the body is composed", () => {
    // In compose mode the caller owns sources — nothing is appended implicitly.
    const withSources: ChatMessage = {
      ...assistantMessage,
      parts: [
        { type: "text", text: "See sources." },
        {
          type: "tool-result",
          toolCallId: "tool-search-docs",
          // deno-lint-ignore no-explicit-any
          result: { documents: [{ title: "Hidden source", url: "/x" }] } as any,
          // deno-lint-ignore no-explicit-any
        } as any,
      ],
    };
    const html = renderToString(
      <Message.Root message={withSources}>
        <Message.Content>
          {(part: PartGroup, i: number) => <Message.Part key={i} part={part} />}
        </Message.Content>
      </Message.Root>,
    );
    assert(
      !html.includes("Hidden source"),
      "composed body must not auto-append sources",
    );
  });
});

// The header's name + timestamp are addressable leaves a consumer can restyle,
// reorder, or replace by composing — without re-implementing the header.
describe("Message.Header — sub-parts", () => {
  it("exposes Name and Timestamp as functions", () => {
    assert(typeof Message.Header.Name === "function");
    assert(typeof Message.Header.Timestamp === "function");
  });

  it("renders a composed header that surfaces the agent name", () => {
    const named: ChatMessage = {
      ...assistantMessage,
      metadata: { agentName: "Ada" },
    };
    const html = renderToString(
      <Message.Root message={named}>
        <Message.Header>
          <Message.Header.Name />
        </Message.Header>
      </Message.Root>,
    );
    assertStringIncludes(html, "Ada");
  });
});

// The headless access point to a message's parts lets consumers render the data
// without reimplementing part grouping.
describe("useMessageParts — headless parts data", () => {
  it("exposes grouped parts + text content as data inside a Message", () => {
    function PartsProbe() {
      const { parts, textContent } = useMessageParts();
      return <div data-count={parts.length}>{textContent}</div>;
    }
    const html = renderToString(
      <Message.Root message={assistantMessage}>
        <PartsProbe />
      </Message.Root>,
    );
    assertStringIncludes(html, "Answer body.");
    assertStringIncludes(
      html,
      'data-count="2"',
      "text and tool parts group into two entries via Message.Root",
    );
  });

  it("fails fast when used outside a Message", () => {
    function Orphan() {
      useMessageParts();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assert(threw, "a misplaced useMessageParts is a loud error, not silent");
  });
});

describe("useMessageBranches — headless branch navigation", () => {
  it("maps the 1-based branch contract to indexes and navigation callbacks", () => {
    let result: ReturnType<typeof useMessageBranches> | undefined;
    const switches: Array<{ messageId: string; index: number }> = [];
    function BranchProbe(): null {
      result = useMessageBranches();
      return null;
    }

    renderToString(
      <Message.Root
        message={assistantMessage}
        getBranches={() => ({ current: 2, total: 3 })}
        switchBranch={(messageId, index) => switches.push({ messageId, index })}
      >
        <BranchProbe />
      </Message.Root>,
    );

    assert(result, "hook result was captured");
    assertEquals(result.index, 1);
    assertEquals(result.count, 3);
    assertEquals(result.hasPrevious, true);
    assertEquals(result.hasNext, true);
    result.previous();
    result.next();
    assertEquals(switches, [
      { messageId: assistantMessage.id, index: 0 },
      { messageId: assistantMessage.id, index: 2 },
    ]);
  });

  it("returns safe disabled navigation for a message without variants", () => {
    let result: ReturnType<typeof useMessageBranches> | undefined;
    function BranchProbe(): null {
      result = useMessageBranches();
      return null;
    }

    renderToString(
      <Message.Root message={assistantMessage}>
        <BranchProbe />
      </Message.Root>,
    );

    assert(result, "hook result was captured");
    assertEquals(result.index, 0);
    assertEquals(result.count, 1);
    assertEquals(result.hasPrevious, false);
    assertEquals(result.hasNext, false);
    result.previous();
    result.next();
  });

  it("reports navigation unavailable when no branch switch callback exists", () => {
    let result: ReturnType<typeof useMessageBranches> | undefined;
    function BranchProbe(): null {
      result = useMessageBranches();
      return null;
    }

    renderToString(
      <Message.Root
        message={assistantMessage}
        getBranches={() => ({ current: 2, total: 3 })}
      >
        <BranchProbe />
      </Message.Root>,
    );

    assert(result, "hook result was captured");
    assertEquals(result.hasPrevious, false);
    assertEquals(result.hasNext, false);
    result.previous();
    result.next();
  });

  it("does not navigate beyond the first or last branch", () => {
    let result: ReturnType<typeof useMessageBranches> | undefined;
    const switches: number[] = [];
    function BranchProbe(): null {
      result = useMessageBranches();
      return null;
    }
    const renderBranch = (current: number) =>
      renderToString(
        <Message.Root
          message={assistantMessage}
          getBranches={() => ({ current, total: 2 })}
          switchBranch={(_messageId, index) => switches.push(index)}
        >
          <BranchProbe />
        </Message.Root>,
      );

    renderBranch(1);
    assert(result, "first branch hook result was captured");
    result.previous();
    result.next();

    renderBranch(2);
    assert(result, "last branch hook result was captured");
    result.previous();
    result.next();

    assertEquals(switches, [1, 0]);
  });
});

describe("Message.Tokens", () => {
  it("uses the canonical renderItem collection callback", () => {
    const rows: Array<{ label: string; index: number }> = [];
    const html = renderToString(
      <Message.Root
        message={{
          ...assistantMessage,
          metadata: {
            model: "provider/model",
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        }}
      >
        <Message.Tokens
          renderItem={({ item, index }) => {
            rows.push({ label: item.label, index });
            return <span>{item.label}: {item.value}</span>;
          }}
        />
      </Message.Root>,
    );

    assertStringIncludes(html, "Token usage");
    assertEquals(rows, [
      { label: "Model", index: 0 },
      { label: "Input", index: 1 },
      { label: "Output", index: 2 },
      { label: "Total", index: 3 },
    ]);
  });
});

describe("Message.CopyAction", () => {
  it("retains document provenance when an interceptor calls next asynchronously", async () => {
    const dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    const window = dom.window;
    const previous = {
      window: globalThis.window,
      document: globalThis.document,
      navigator: globalThis.navigator,
      self: globalThis.self,
      Node: globalThis.Node,
      Element: globalThis.Element,
      HTMLElement: globalThis.HTMLElement,
      Event: globalThis.Event,
      MouseEvent: globalThis.MouseEvent,
    };
    const writes: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) => {
          writes.push(text);
          return Promise.resolve();
        },
      },
    });
    Object.assign(globalThis, {
      window,
      document: window.document,
      navigator: window.navigator,
      self: window,
      Node: window.Node,
      Element: window.Element,
      HTMLElement: window.HTMLElement,
      Event: window.Event,
      MouseEvent: window.MouseEvent,
    });

    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root fixture exists");
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <Message.Root message={assistantMessage}>
            <Message.CopyAction onClick={(_event, next) => queueMicrotask(next)} />
          </Message.Root>,
        );
      });
      const button = rootElement.querySelector("button");
      assert(button, "copy action renders");
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      flushSync(() => {});

      assertEquals(writes, ["Answer body."]);
      await unmountReactRoot(root);
    } finally {
      Object.assign(globalThis, previous);
      dom.window.close();
    }
  });
});

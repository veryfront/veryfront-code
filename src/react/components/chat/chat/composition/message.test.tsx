import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatDynamicToolPart, ChatMessage } from "#veryfront/agent/react";
import { Message } from "./message.tsx";
import { useMessageParts } from "../contexts/message-context.tsx";
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

// The 4th, headless access point to a message's parts (§K tier-1): read them as
// data and render however you like, without reimplementing part grouping.
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
    assertStringIncludes(html, "data-count=");
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

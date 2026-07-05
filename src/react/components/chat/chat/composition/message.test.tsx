import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatDynamicToolPart, ChatMessage } from "#veryfront/agent/react";
import { Message } from "./message.tsx";
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
              : <div key={i} className="vf-custom-text">custom text</div>;
          }}
        </Message.Content>
      </Message.Root>,
    );
    // The caller's nodes render; the default markdown/tool card does not.
    assertStringIncludes(html, "vf-custom-text");
    assertStringIncludes(html, "vf-custom-tool");
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
        <Message.Content showSources>
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

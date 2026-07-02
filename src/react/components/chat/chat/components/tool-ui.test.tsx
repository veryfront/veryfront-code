import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatDynamicToolPart } from "#veryfront/agent/react";
import { ToolCall, ToolCallCard, useToolCall } from "./tool-ui.tsx";

/** A fully-populated card tool (input + output) — the composable `card` path. */
const cardTool: ChatDynamicToolPart = {
  type: "dynamic-tool",
  toolCallId: "tool-search-docs",
  toolName: "search_docs",
  state: "output-available",
  input: { query: "agent run persistence" },
  output: [{ title: "Runs" }],
};

describe("ToolCallCard", () => {
  it("renders a completed tool with null output as a compact status row", () => {
    const tool: ChatDynamicToolPart = {
      type: "dynamic-tool",
      toolCallId: "tool-web-search",
      toolName: "web_search",
      state: "output-available",
      input: { query: "Swedish tax residency" },
      output: null,
    };

    const html = renderToString(<ToolCallCard tool={tool} />);

    assertStringIncludes(html, "web_search");
    assertStringIncludes(html, "Completed");
    assertStringIncludes(html, "rounded-[var(--radius-md)]");
    assertStringIncludes(html, "border-[var(--outline-border)]");
    assertEquals(html.includes("Parameters"), false);
    assertEquals(html.includes("Result"), false);
  });
});

// The composability contract: a consuming developer must be able to recompose
// the card, inject a slot, and restyle a part. If these fail, `ToolCall` is not
// composable — these tests ARE the definition.
describe("ToolCall — composability contract", () => {
  it("recomposes: a caller can reorder the body parts", () => {
    const html = renderToString(
      <ToolCall tool={cardTool}>
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
      <ToolCall tool={cardTool}>
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
      <ToolCall tool={cardTool}>
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

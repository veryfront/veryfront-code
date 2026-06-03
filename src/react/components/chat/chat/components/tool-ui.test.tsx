import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatDynamicToolPart } from "#veryfront/agent/react";
import { ToolCallCard } from "./tool-ui.tsx";

describe("ToolCallCard", () => {
  it("does not render an empty result panel when a completed tool has null output", () => {
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
    assertStringIncludes(html, "Parameters");
    assertEquals(html.includes("Result"), false);
  });
});

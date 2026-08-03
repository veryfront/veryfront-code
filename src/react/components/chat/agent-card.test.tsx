import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { AgentMessage, ToolCall } from "#veryfront/agent";
import { AgentCard, useAgentCard } from "./agent-card.tsx";

const messages: AgentMessage[] = [
  {
    id: "m-1",
    role: "assistant",
    parts: [{ type: "text", text: "All release checks passed." }],
  } as AgentMessage,
];

const toolCalls: ToolCall[] = [
  {
    id: "tool-1",
    name: "check_release",
    args: { branch: "main" },
    status: "completed",
    result: { ok: true },
  } as ToolCall,
];

// The composability contract: a consuming developer must be able to recompose
// the card, reorder its sections, restyle a part, and the `useAgentCard` hook
// must throw outside an `AgentCard`. If these fail, `AgentCard` is not
// composable — these tests ARE the definition.
describe("AgentCard — composability contract", () => {
  it("recomposes + reorders: Body renders before Header when composed", () => {
    const html = renderToString(
      <AgentCard.Root
        name="Release Agent"
        status="completed"
        messages={messages}
      >
        <AgentCard.Body />
        <AgentCard.Header />
      </AgentCard.Root>,
    );
    // Both sections render, and the message body appears before the name.
    assertStringIncludes(html, "All release checks passed.");
    assertStringIncludes(html, "Release Agent");
    assert(
      html.indexOf("All release checks passed.") <
        html.indexOf("Release Agent"),
      "expected the composed Body to render before the Header",
    );
  });

  it("restyles: className on a sub-part is merged onto its wrapper", () => {
    const html = renderToString(
      <AgentCard.Root name="Release Agent" status="completed">
        <AgentCard.Header className="vf-custom-header-class" />
      </AgentCard.Root>,
    );
    assertStringIncludes(html, "vf-custom-header-class");
  });

  it("renders the default anatomy when given no children", () => {
    const html = renderToString(
      <AgentCard
        name="Release Agent"
        status="completed"
        messages={messages}
        toolCalls={toolCalls}
      />,
    );
    assertStringIncludes(html, "Release Agent");
    assertStringIncludes(html, "All release checks passed.");
    assertStringIncludes(html, "check_release");
  });

  it("lets a compound child replace the tool list", () => {
    function CustomTools() {
      const { toolCalls: calls } = useAgentCard();
      return (
        <div className="vf-custom-tools">
          {calls.map((tool) => <span key={tool.id}>{`Custom ${tool.name}`}</span>)}
        </div>
      );
    }

    const html = renderToString(
      <AgentCard.Root
        name="Release Agent"
        status="completed"
        toolCalls={toolCalls}
      >
        <AgentCard.Header />
        <CustomTools />
      </AgentCard.Root>,
    );

    assertStringIncludes(html, "vf-custom-tools");
    assertStringIncludes(html, "Custom check_release");
  });

  it("useAgentCard throws outside an AgentCard", () => {
    function Orphan() {
      useAgentCard();
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

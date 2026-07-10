import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { AgentOption } from "./agent-picker.tsx";
import { AgentPicker, useAgentPicker } from "./agent-picker.tsx";

const agents: AgentOption[] = [
  { id: "inbox", name: "Inbox Helper" },
  { id: "lawyer", name: "Lawyer Agent" },
];

// NOTE: the popover surface (Content / List / Item) portals through `Floating`
// into the DOM, so it does NOT appear in `renderToString` output. These tests
// exercise the parts that DO render server-side — the trigger, the provider,
// and the hook-throws contract. See the reported limitation.

describe("AgentPicker — preset (back-compat)", () => {
  it("renders the pill trigger with the selected agent name", () => {
    const html = renderToString(
      <AgentPicker agents={agents} value="inbox" onValueChange={() => {}} />,
    );
    assertStringIncludes(html, "Inbox Helper");
  });

  it("renders the input-style trigger when inputStyle is set", () => {
    const html = renderToString(
      <AgentPicker
        agents={agents}
        value="lawyer"
        onValueChange={() => {}}
        inputStyle
      />,
    );
    assertStringIncludes(html, "Lawyer Agent");
    assertStringIncludes(html, "border-[var(--input-border)]");
  });
});

describe("AgentPicker — composability contract", () => {
  it("recomposes: a caller can supply their own Trigger", () => {
    const html = renderToString(
      <AgentPicker agents={agents} value="inbox" onValueChange={() => {}}>
        <AgentPicker.Trigger />
        <AgentPicker.Content>
          <AgentPicker.List>
            <AgentPicker.Item agent={agents[0]!} />
          </AgentPicker.List>
        </AgentPicker.Content>
      </AgentPicker>,
    );
    // Only the (non-portalled) trigger renders server-side.
    assertStringIncludes(html, "Inbox Helper");
  });

  it("restyles: className on the Trigger is merged onto the pill", () => {
    const html = renderToString(
      <AgentPicker agents={agents} value="inbox" onValueChange={() => {}}>
        <AgentPicker.Trigger className="vf-custom-trigger-class" />
      </AgentPicker>,
    );
    assertStringIncludes(html, "vf-custom-trigger-class");
  });

  it("exposes every documented sub-part off the compound", () => {
    for (const part of ["Root", "Trigger", "Content", "Search", "List", "Item"]) {
      assertEquals(
        typeof (AgentPicker as unknown as Record<string, unknown>)[part] !==
          "undefined",
        true,
      );
    }
  });

  it("useAgentPicker throws outside an AgentPicker", () => {
    function Orphan() {
      useAgentPicker();
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

describe("AgentPicker.Search", () => {
  it("is a function component addressable off the compound", () => {
    assertEquals(typeof AgentPicker.Search, "function");
  });

  it("composes inside Content without throwing", () => {
    // The Content surface portals through `Floating`, so nothing renders
    // server-side — we only assert the composed tree does not throw.
    const html = renderToString(
      <AgentPicker agents={agents} value="inbox" onValueChange={() => {}}>
        <AgentPicker.Trigger />
        <AgentPicker.Content>
          <AgentPicker.Search />
          <AgentPicker.List>
            <AgentPicker.Item agent={agents[0]!} />
          </AgentPicker.List>
        </AgentPicker.Content>
      </AgentPicker>,
    );
    // Only the (non-portalled) trigger renders server-side.
    assertStringIncludes(html, "Inbox Helper");
  });
});

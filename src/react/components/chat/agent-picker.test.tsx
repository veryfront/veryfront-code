import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToString } from "react-dom/server";
import { JSDOM } from "npm:jsdom@28.0.0";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { AgentOption } from "./agent-picker.tsx";
import { AgentPicker, useAgentPicker } from "./agent-picker.tsx";

const agents: AgentOption[] = [
  { id: "inbox", name: "Inbox Helper" },
  { id: "lawyer", name: "Lawyer Agent" },
];

function installDom(): { restore: () => void; window: JSDOM["window"] } {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "Event",
    "MouseEvent",
  ] as const;
  const previous: Record<string, unknown> = {};
  for (const key of keys) previous[key] = (globalThis as Record<string, unknown>)[key];
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
  return {
    window,
    restore: () => {
      Object.assign(globalThis, previous);
      dom.window.close();
    },
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 2; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
}

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

  it("keeps the legacy avatarSrc option rendering during migration", () => {
    const legacyAgents: AgentOption[] = [{
      id: "legacy",
      name: "Legacy Agent",
      avatarSrc: "https://example.com/legacy-agent.png",
    }];
    const html = renderToString(<AgentPicker agents={legacyAgents} value="legacy" />);
    assertStringIncludes(html, "https://example.com/legacy-agent.png");
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

  it("Trigger accepts a per-leaf `icon` override for the chevron", () => {
    const html = renderToString(
      <AgentPicker agents={agents} value="inbox" onValueChange={() => {}}>
        <AgentPicker.Trigger icon={<svg data-testid="custom-chevron" />} />
      </AgentPicker>,
    );
    assertStringIncludes(html, "custom-chevron");
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
    for (
      const part of [
        "Root",
        "Trigger",
        "Content",
        "Search",
        "List",
        "Item",
        "Create",
        "Manage",
      ]
    ) {
      assertEquals(
        typeof (AgentPicker as unknown as Record<string, unknown>)[part] !==
          "undefined",
        true,
      );
    }
  });

  it("composes create and manage actions with per-leaf icons", async () => {
    const dom = installDom();
    let created = 0;
    let managed = 0;
    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root element exists");
      const root = createRoot(rootElement);
      flushSync(() => {
        root.render(
          <AgentPicker
            agents={agents}
            value="inbox"
            onValueChange={() => {}}
            onCreate={() => created++}
            onManage={() => managed++}
          >
            <AgentPicker.Trigger />
            <AgentPicker.Content>
              <AgentPicker.List>
                <AgentPicker.Create
                  icon={<span data-testid="custom-create">create</span>}
                  className="vf-create"
                />
                <AgentPicker.Manage
                  icon={<span data-testid="custom-manage">manage</span>}
                  className="vf-manage"
                />
              </AgentPicker.List>
            </AgentPicker.Content>
          </AgentPicker>,
        );
      });

      const trigger = rootElement.querySelector("button");
      assert(trigger, "trigger renders");
      flushSync(() => trigger.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
      await settle();

      const create = document.querySelector<HTMLElement>('[data-testid="custom-create"]')?.closest(
        "[data-command-item]",
      );
      const manage = document.querySelector<HTMLElement>('[data-testid="custom-manage"]')?.closest(
        "[data-command-item]",
      );
      assert(create, "custom create action renders");
      assert(manage, "custom manage action renders");
      assertStringIncludes(create.className, "vf-create");
      assertStringIncludes(manage.className, "vf-manage");

      flushSync(() => create.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
      assertEquals(created, 1);
      assertEquals(managed, 0);

      flushSync(() => root.unmount());
      await settle();
    } finally {
      dom.restore();
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

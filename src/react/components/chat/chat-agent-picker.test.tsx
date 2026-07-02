import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agentsToPickerOptions, ChatAgentPicker } from "./chat-agent-picker.tsx";
import type { AgentMetadata } from "#veryfront/agent/react";

function agent(id: string, over: Partial<AgentMetadata> = {}): AgentMetadata {
  return { id, name: id, description: null, avatarUrl: null, ...over };
}

describe("react/components/chat/chat-agent-picker: agentsToPickerOptions", () => {
  it("maps metadata to picker rows and carries the avatar url through", () => {
    assertEquals(
      agentsToPickerOptions([
        agent("support", { name: "Support", avatarUrl: "https://cdn/x.svg" }),
        agent("sales", { name: "Sales" }),
      ]),
      [
        { id: "support", name: "Support", avatarSrc: "https://cdn/x.svg" },
        { id: "sales", name: "Sales" },
      ],
    );
  });

  it("omits avatarSrc when the agent has no avatar", () => {
    const rows = agentsToPickerOptions([agent("solo", { name: "Solo" })]);
    assertEquals(rows.length, 1);
    assertEquals("avatarSrc" in rows[0]!, false);
  });
});

// --- Connected render, with a stubbed /api/agents fetch --------------------

function installDom(): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://example.com/",
  });
  const window = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
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
  });
  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

function stubAgentsFetch(agents: AgentMetadata[]): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
            ...(a.avatarUrl ? { avatar_url: a.avatarUrl } : {}),
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )) as typeof fetch;
  return () => {
    globalThis.fetch = previous;
  };
}

/** Let the fetch effect resolve and React commit. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("react/components/chat/chat-agent-picker: connected", () => {
  it("shows the picker once more than one agent has loaded", async () => {
    const restoreDom = installDom();
    const restoreFetch = stubAgentsFetch([
      agent("support", { name: "Support Agent" }),
      agent("sales", { name: "Sales Agent" }),
    ]);
    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root element exists");
      const root = createRoot(rootElement);
      root.render(<ChatAgentPicker />);
      await settle();

      const trigger = rootElement.querySelector("button");
      assert(trigger, "picker trigger renders after the agents resolve");
      assertStringIncludes(trigger.textContent ?? "", "Select agent");

      root.unmount();
    } finally {
      restoreFetch();
      restoreDom();
    }
  });

  it("reflects the controlled selection in the trigger label", async () => {
    const restoreDom = installDom();
    const restoreFetch = stubAgentsFetch([
      agent("support", { name: "Support Agent" }),
      agent("sales", { name: "Sales Agent" }),
    ]);
    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root element exists");
      const root = createRoot(rootElement);
      root.render(<ChatAgentPicker value="sales" />);
      await settle();

      const trigger = rootElement.querySelector("button");
      assert(trigger, "picker trigger renders");
      assertStringIncludes(trigger.textContent ?? "", "Sales Agent");

      root.unmount();
    } finally {
      restoreFetch();
      restoreDom();
    }
  });

  it("renders nothing when only one agent is available", async () => {
    const restoreDom = installDom();
    const restoreFetch = stubAgentsFetch([agent("solo", { name: "Solo Agent" })]);
    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root element exists");
      const root = createRoot(rootElement);
      root.render(<ChatAgentPicker />);
      await settle();

      assertEquals(rootElement.querySelector("button"), null);
      assertEquals(rootElement.textContent, "");

      root.unmount();
    } finally {
      restoreFetch();
      restoreDom();
    }
  });

  it("does not fetch or render when disabled", async () => {
    const restoreDom = installDom();
    let fetches = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetches += 1;
      return Promise.reject(new Error("should not fetch"));
    }) as typeof fetch;
    try {
      const rootElement = document.getElementById("root");
      assert(rootElement, "root element exists");
      const root = createRoot(rootElement);
      root.render(<ChatAgentPicker enabled={false} />);
      await settle();

      assertEquals(fetches, 0);
      assertEquals(rootElement.querySelector("button"), null);

      root.unmount();
    } finally {
      globalThis.fetch = previousFetch;
      restoreDom();
    }
  });
});

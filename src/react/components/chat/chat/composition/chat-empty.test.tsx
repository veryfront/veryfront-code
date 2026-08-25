import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentMetadata, PromptSuggestion } from "#veryfront/agent/react";
import { getAgentPromptSuggestionItems } from "#veryfront/agent/react";
import { ChatEmpty } from "./chat-empty.tsx";

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

describe("getAgentPromptSuggestionItems", () => {
  it("normalizes prompt suggestions to { label, prompt }, dropping non-prompts", () => {
    const agent: AgentMetadata = {
      id: "support",
      name: "Support",
      description: null,
      avatarUrl: null,
      suggestions: {
        suggestions: [
          { type: "prompt", title: "Triage login", prompt: "Triage a user who cannot sign in." },
          { type: "prompt", prompt: "Summarize the last incident." },
          { type: "task", id: "daily-triage" },
        ],
      },
    };

    assertEquals(getAgentPromptSuggestionItems(agent), [
      { label: "Triage login", prompt: "Triage a user who cannot sign in." },
      { label: "Summarize the last incident.", prompt: "Summarize the last incident." },
    ]);
  });

  it("returns [] for a null agent or missing suggestions", () => {
    assertEquals(getAgentPromptSuggestionItems(null), [], "null agent yields []");
    const bare: AgentMetadata = { id: "a", name: "A", description: null, avatarUrl: null };
    assertEquals(getAgentPromptSuggestionItems(bare), [], "agent without suggestions yields []");
    assertEquals(
      getAgentPromptSuggestionItems({
        ...bare,
        suggestions: { suggestions: undefined } as unknown as AgentMetadata["suggestions"],
      }),
      [],
      "agent with an empty suggestions container yields []",
    );
  });
});

describe("ChatEmpty suggestions", () => {
  it("renders labels and hands the { label, prompt } object to onSuggestionSelect", async () => {
    const restoreDom = installDom();
    const clicked: PromptSuggestion[] = [];
    try {
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => {
        root.render(
          <ChatEmpty
            suggestions={[{ label: "Triage login", prompt: "Triage a user who cannot sign in." }]}
            onSuggestionSelect={(suggestion) => clicked.push(suggestion)}
          />,
        );
      });

      const button = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Triage login")
      );
      assert(button, "renders the short label on the chip");

      flushSync(() => button!.click());
      assertEquals(clicked, [
        { label: "Triage login", prompt: "Triage a user who cannot sign in." },
      ], "click sends the full { label, prompt } — no .find needed");

      await unmountReactRoot(root);
    } finally {
      restoreDom();
    }
  });

  it("normalizes a plain string suggestion to { label, prompt }", async () => {
    const restoreDom = installDom();
    const clicked: PromptSuggestion[] = [];
    try {
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => {
        root.render(
          <ChatEmpty
            suggestions={["Ask anything"]}
            onSuggestionSelect={(value) => clicked.push(value)}
          />,
        );
      });

      const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
        candidate.textContent?.includes("Ask anything")
      );
      assert(button, "renders the string suggestion chip");
      flushSync(() => button.click());
      assertEquals(clicked, [
        { label: "Ask anything", prompt: "Ask anything" },
      ], "a string suggestion becomes both label and prompt");
      await unmountReactRoot(root);
    } finally {
      restoreDom();
    }
  });
});

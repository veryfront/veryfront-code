/**
 * ChatSidebar — conversation-native rail. Proves the two entry points that
 * Step 5 introduced: it lists straight from a `ConversationsProvider` with no
 * props, and it also works controlled from explicit `conversations`/`activeId`.
 */
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { renderToString } from "react-dom/server";
import * as React from "react";
import { JSDOM } from "npm:jsdom@28.0.0";
import { unmountReactRoot } from "#veryfront/react/react-root.test-helpers.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ChatSidebar, useChatSidebarItem } from "./sidebar.tsx";
import { ChatSidebarRenameEditor } from "./sidebar-rename-editor.tsx";
import { ConversationsProvider } from "../contexts/conversations-context.tsx";
import { memoryConversationStore } from "../persistence/memory-conversation-store.ts";
import type { Conversation, ConversationSummary } from "../persistence/conversation-store.ts";

function installDom(): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "https://example.com/",
  });
  const window = dom.window;
  // React DOM is initialized before this per-test browser exists, so its text-input
  // event adapter uses the legacy listener API. JSDOM omits that API; supplying the
  // listener-shaped methods keeps keyboard tests on the same React event path.
  Object.defineProperties(window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => {} },
    detachEvent: { configurable: true, value: () => {} },
  });
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "Event",
    "FocusEvent",
    "KeyboardEvent",
    "localStorage",
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
    HTMLInputElement: window.HTMLInputElement,
    Event: window.Event,
    FocusEvent: window.FocusEvent,
    KeyboardEvent: window.KeyboardEvent,
    localStorage: window.localStorage,
  });
  window.localStorage.clear();
  return () => {
    Object.assign(globalThis, previous);
    dom.window.close();
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  flushSync(() => {});
}

function conversation(id: string, title: string, updatedAt: number): Conversation {
  return { id, title, messages: [], createdAt: updatedAt, updatedAt };
}

function summary(id: string, title: string, updatedAt: number): ConversationSummary {
  return { id, title, messageCount: 2, createdAt: updatedAt, updatedAt };
}

describe("ChatSidebar — conversation-native", () => {
  it("lists conversations straight from context with no props", async () => {
    const restoreDom = installDom();
    const store = memoryConversationStore([
      conversation("a", "First chat", 2000),
      conversation("b", "Second chat", 1000),
    ]);
    try {
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => {
        root.render(
          <ConversationsProvider store={store} id="a">
            <ChatSidebar />
          </ConversationsProvider>,
        );
      });
      await settle();

      const html = document.getElementById("root")!.innerHTML;
      assert(html.includes("First chat"), "lists the first conversation from context");
      assert(html.includes("Second chat"), "lists the second conversation from context");

      await unmountReactRoot(root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("works controlled from explicit conversations/activeId (no provider)", async () => {
    const restoreDom = installDom();
    try {
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => {
        root.render(
          <ChatSidebar
            conversations={[summary("x", "Controlled chat", 5000)]}
            activeId="x"
            onSelect={() => {}}
            onDelete={() => {}}
          />,
        );
      });
      await settle();

      assert(
        document.getElementById("root")!.innerHTML.includes("Controlled chat"),
        "lists the controlled conversation",
      );
      const currentConversation = document.querySelector<HTMLButtonElement>(
        'button[aria-current="page"]',
      );
      assert(currentConversation, "the current conversation is a native primary action");
      assert(
        currentConversation.textContent?.includes("Controlled chat"),
        "the primary action carries the conversation label",
      );

      await unmountReactRoot(root);
      await settle();
    } finally {
      restoreDom();
    }
  });

  it("keeps the legacy fill prop in embedded layouts", () => {
    const html = renderToString(
      <ChatSidebar
        fill
        conversations={[summary("x", "Embedded chat", 5000)]}
        activeId="x"
        onSelect={() => {}}
        onDelete={() => {}}
      />,
    );
    const railClass = html.match(/data-vf-chat="" class="([^"]*)"/)?.[1] ?? "";
    assert(railClass.includes("w-full"), "fill keeps the embedded rail full-width");
    assert(!railClass.includes("w-60"), "fill omits standalone fixed-width chrome");
  });
});

describe("ChatSidebar.Item — menu compound (E4 acid test)", () => {
  it("exposes the row-menu leaves off the compound", () => {
    assert(typeof ChatSidebar.Item.Menu === "function", "Item.Menu is addressable");
    assert(typeof ChatSidebar.Item.Rename === "function", "Item.Rename is addressable");
    assert(typeof ChatSidebar.Item.Delete === "function", "Item.Delete is addressable");
  });

  it("useChatSidebarItem fails fast outside an <ChatSidebar.Item>", () => {
    function Orphan() {
      useChatSidebarItem();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assert(threw, "a misplaced Item leaf is a loud error, not a silent null");
  });

  it("a custom entry composes alongside the built-ins without re-implementing the row", () => {
    // The whole point: add a menu entry by composing, not by re-writing the row.
    const html = renderToString(
      <ChatSidebar.Root
        conversations={[summary("x", "Row title", 5000)]}
        activeId="x"
        onSelect={() => {}}
        onDelete={() => {}}
        onRename={() => {}}
      >
        <ChatSidebar.List>
          <ChatSidebar.Item conversation={summary("x", "Row title", 5000)}>
            <ChatSidebar.Item.Menu>
              <ChatSidebar.Item.Rename />
              <ChatSidebar.Item.Delete />
              <div data-archive="">Archive</div>
            </ChatSidebar.Item.Menu>
          </ChatSidebar.Item>
        </ChatSidebar.List>
      </ChatSidebar.Root>,
    );
    // The composed row still renders (the built-in row is reused, not replaced).
    assert(html.includes("Row title"), "the row renders from the composed Item");
  });

  it("keeps the row ref attached while inline rename is active", async () => {
    const restoreDom = installDom();
    const itemRef = React.createRef<HTMLDivElement>();
    function StartRename(): React.ReactElement {
      const { startRename } = useChatSidebarItem();
      return <button type="button" data-start-rename="" onClick={startRename}>Rename</button>;
    }

    try {
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => {
        root.render(
          <ChatSidebar.Root
            conversations={[summary("x", "Row title", 5000)]}
            activeId="x"
            onSelect={() => {}}
            onDelete={() => {}}
            onRename={() => {}}
          >
            <ChatSidebar.List>
              <ChatSidebar.Item
                ref={itemRef}
                className="custom-row"
                conversation={summary("x", "Row title", 5000)}
              >
                <StartRename />
              </ChatSidebar.Item>
            </ChatSidebar.List>
          </ChatSidebar.Root>,
        );
      });
      assert(itemRef.current, "the display row owns the consumer ref");

      flushSync(() => {
        document.querySelector<HTMLButtonElement>("[data-start-rename]")?.click();
      });

      assert(itemRef.current, "the inline rename row keeps the consumer ref attached");
      assert(
        itemRef.current.classList.contains("custom-row"),
        "the rename row keeps custom styling",
      );
      assert(itemRef.current.querySelector("input"), "the ref targets the active rename row");

      await unmountReactRoot(root);
      await settle();
    } finally {
      restoreDom();
    }
  });
});

describe("ChatSidebar.Item.Title: composable row label", () => {
  it("exposes the Title leaf off the compound", () => {
    assert(typeof ChatSidebar.Item.Title === "function", "Item.Title is addressable");
  });

  it("composes the row label alongside a sibling", () => {
    const html = renderToString(
      <ChatSidebar.Root
        conversations={[summary("x", "Row title", 5000)]}
        activeId="x"
        onSelect={() => {}}
        onDelete={() => {}}
      >
        <ChatSidebar.List>
          <ChatSidebar.Item conversation={summary("x", "Row title", 5000)}>
            <ChatSidebar.Item.Title />
            <span data-badge="">badge</span>
          </ChatSidebar.Item>
        </ChatSidebar.List>
      </ChatSidebar.Root>,
    );
    assert(html.includes(">Row title<"), "the Title leaf renders the conversation title");
    assert(html.includes("data-badge"), "the sibling badge renders next to the title");
    const primaryActionClass = html.match(/<button[^>]*class="([^"]*)"[^>]*>/)?.[1] ?? "";
    const titleClass = html.match(/<span[^>]*class="([^"]*)"[^>]*>Row title/)?.[1] ?? "";
    assert(
      primaryActionClass.includes("flex items-center gap-1"),
      "the primary action keeps the composed label and badge on one row",
    );
    assert(
      titleClass.includes("min-w-0 flex-1"),
      "the title shrinks before its sibling badge",
    );
    assertEquals(
      html.split(">Row title<").length - 1,
      1,
      "the composed Title replaces the default title (no duplicate label)",
    );
  });

  it("forwards native span props from the Title leaf", () => {
    const html = renderToString(
      <ChatSidebar.Root
        conversations={[summary("x", "Row title", 5000)]}
        activeId="x"
        onSelect={() => {}}
        onDelete={() => {}}
      >
        <ChatSidebar.List>
          <ChatSidebar.Item conversation={summary("x", "Row title", 5000)}>
            <ChatSidebar.Item.Title id="custom-title" data-title="" />
          </ChatSidebar.Item>
        </ChatSidebar.List>
      </ChatSidebar.Root>,
    );
    assert(html.includes('id="custom-title"'), "Title forwards native span props");
    assert(html.includes('data-title=""'), "Title forwards data attributes");
  });

  it("keeps a composed Menu sibling in the action slot (no default duplicate)", () => {
    const html = renderToString(
      <ChatSidebar.Root
        conversations={[summary("x", "Row title", 5000)]}
        activeId="x"
        onSelect={() => {}}
        onDelete={() => {}}
      >
        <ChatSidebar.List>
          <ChatSidebar.Item conversation={summary("x", "Row title", 5000)}>
            <ChatSidebar.Item.Title />
            <ChatSidebar.Item.Menu />
          </ChatSidebar.Item>
        </ChatSidebar.List>
      </ChatSidebar.Root>,
    );
    assertEquals(
      html.split("More actions for Row title").length - 1,
      1,
      "exactly one menu trigger renders, the composed Menu instead of a second default",
    );
    assert(html.includes(">Row title<"), "the composed Title still renders the label");
  });

  it("partitions Title and Menu leaves grouped in a fragment", () => {
    const html = renderToString(
      <ChatSidebar.Root
        conversations={[summary("x", "Row title", 5000)]}
        activeId="x"
        onSelect={() => {}}
        onDelete={() => {}}
      >
        <ChatSidebar.List>
          <ChatSidebar.Item conversation={summary("x", "Row title", 5000)}>
            {React.createElement(
              React.Fragment,
              null,
              <ChatSidebar.Item.Title />,
              <span data-badge="">badge</span>,
              <ChatSidebar.Item.Menu />,
            )}
          </ChatSidebar.Item>
        </ChatSidebar.List>
      </ChatSidebar.Root>,
    );
    assertEquals(
      html.split("More actions for Row title").length - 1,
      1,
      "the fragment's Menu fills the action slot without a default duplicate",
    );
    assert(html.includes(">Row title<"), "the fragment's Title fills the row body");
    assert(html.includes("data-badge"), "sibling fragments preserve other body content");
  });

  it("regression: a childless Item still renders the default title", () => {
    const html = renderToString(
      <ChatSidebar.Root
        conversations={[summary("x", "Row title", 5000)]}
        activeId="x"
        onSelect={() => {}}
        onDelete={() => {}}
      >
        <ChatSidebar.List>
          <ChatSidebar.Item conversation={summary("x", "Row title", 5000)} />
        </ChatSidebar.List>
      </ChatSidebar.Root>,
    );
    assert(html.includes(">Row title<"), "the childless row renders the default title");
    assertEquals(
      html.split(">Row title<").length - 1,
      1,
      "the default title renders exactly once",
    );
  });
});

describe("ChatSidebarRenameEditor", () => {
  async function runKeyboardCompletion(key: "Enter" | "Escape"): Promise<[number, number]> {
    const restoreDom = installDom();
    let commits = 0;
    let cancels = 0;

    try {
      const root = createRoot(document.getElementById("root")!);
      flushSync(() => {
        root.render(
          <ChatSidebarRenameEditor
            value="Row title"
            onChange={() => {}}
            onCommit={() => commits++}
            onCancel={() => cancels++}
          />,
        );
      });
      const input = document.querySelector<HTMLInputElement>("input")!;
      input.focus();
      flushSync(() => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
        input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });

      await unmountReactRoot(root);
      await settle();
      return [commits, cancels];
    } finally {
      restoreDom();
    }
  }

  it("does not commit twice when Enter is followed by blur", async () => {
    assertEquals(await runKeyboardCompletion("Enter"), [1, 0]);
  });

  it("does not commit after Escape is followed by blur", async () => {
    assertEquals(await runKeyboardCompletion("Escape"), [0, 1]);
  });

  it("gives the editor a stable contextual accessible name", async () => {
    const restoreDom = installDom();
    try {
      const root = createRoot(document.getElementById("root")!);
      const renderEditor = (value: string) => (
        <ChatSidebarRenameEditor
          value={value}
          onChange={() => {}}
          onCommit={() => {}}
          onCancel={() => {}}
        />
      );
      flushSync(() => root.render(renderEditor("Original title")));
      const input = document.querySelector<HTMLInputElement>("input")!;
      assertEquals(input.getAttribute("aria-label"), "Rename Original title");

      flushSync(() => root.render(renderEditor("Edited title")));
      assertEquals(input.getAttribute("aria-label"), "Rename Original title");
      await unmountReactRoot(root);
      await settle();
    } finally {
      restoreDom();
    }
  });
});

import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  ConversationsContextProvider,
  ConversationsProvider,
  useConversationsContext,
  useConversationsContextOptional,
} from "./conversations-context.tsx";
import type { UseConversationsResult } from "../hooks/use-conversations.ts";

function noop(): void {}

const fakeResult: UseConversationsResult = {
  conversations: [],
  activeConversation: null,
  active: null,
  activeConversationId: null,
  activeId: null,
  isLoading: false,
  select: noop,
  create: () => ({
    id: "c-1",
    title: "New Chat",
    messages: [],
    createdAt: 0,
    updatedAt: 0,
  }),
  rename: noop,
  remove: noop,
  update: noop,
  save: noop,
  bind: noop,
};

describe("ConversationsContextProvider / useConversationsContext", () => {
  it("supplies the raw provider's value to a descendant", () => {
    function Consumer() {
      const ctx = useConversationsContext();
      return <div data-count={ctx.conversations.length} data-loading={String(ctx.isLoading)} />;
    }
    const html = renderToString(
      <ConversationsContextProvider value={fakeResult}>
        <Consumer />
      </ConversationsContextProvider>,
    );
    assertStringIncludes(html, 'data-count="0"');
    assertStringIncludes(html, 'data-loading="false"');
  });

  it("fails fast when used outside a ConversationsProvider", () => {
    function Orphan() {
      useConversationsContext();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assert(threw, "a misplaced useConversationsContext is a loud error, not silent");
  });

  it("useConversationsContextOptional returns null outside a provider, without throwing", () => {
    function OptionalConsumer() {
      const ctx = useConversationsContextOptional();
      return <div data-has-context={String(ctx !== null)} />;
    }
    const html = renderToString(<OptionalConsumer />);
    assertStringIncludes(html, 'data-has-context="false"');
  });
});

// Smoke test: the real component (not the raw provider) calls useConversations()
// itself and shares the live result. Under SSR no effect runs, so this only
// characterizes the synchronous first render — a fresh, still-loading result.
describe("ConversationsProvider — smoke test", () => {
  it("wires useConversations() and shares its result via context", () => {
    function Consumer() {
      const ctx = useConversationsContext();
      return (
        <div
          data-conversations={ctx.conversations.length}
          data-loading={String(ctx.isLoading)}
          data-active={String(ctx.activeConversation)}
        />
      );
    }
    const html = renderToString(
      <ConversationsProvider>
        <Consumer />
      </ConversationsProvider>,
    );
    assertStringIncludes(html, 'data-conversations="0"');
    assertStringIncludes(html, 'data-loading="true"');
    assertStringIncludes(html, 'data-active="null"');
  });
});

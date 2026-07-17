import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  AgentAvatar,
  ChatEmpty,
  ChatIf,
  ChatInput,
  ChatMessageList,
  ChatRoot,
  ErrorBanner,
  Message,
  ModelAvatar,
  PendingMessage,
} from "./api.tsx";

// `api.tsx` is a pure re-export barrel for the composition building blocks —
// characterize that every name is still wired to a live value, not that any
// individual component's behavior is correct (that's covered by its own
// co-located test).
describe("composition/api — barrel re-exports", () => {
  it("re-exports the root/layout building blocks as functions", () => {
    assert(typeof ChatRoot === "function");
    assert(typeof ChatMessageList === "function");
    assert(typeof ChatInput === "function");
    assert(typeof ChatEmpty === "function");
    assert(typeof ChatIf === "function");
  });

  it("re-exports the leaf building blocks as functions", () => {
    assert(typeof AgentAvatar === "function");
    assert(typeof ModelAvatar === "function");
    assert(typeof ErrorBanner === "function");
    assert(typeof PendingMessage === "function");
  });

  it("re-exports the Message compound with its sub-parts intact", () => {
    assert(typeof Message === "function");
    assert(typeof Message.Root === "function");
    assert(typeof Message.Content === "function");
  });

  it("smoke-renders a re-exported leaf component through the barrel", () => {
    const html = renderToString(<PendingMessage />);
    assertStringIncludes(html, "Waiting for a response");
  });

  it("smoke-renders ErrorBanner through the barrel", () => {
    const html = renderToString(<ErrorBanner error={new Error("boom")} />);
    assertStringIncludes(html, "boom");
  });
});

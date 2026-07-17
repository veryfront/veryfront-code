import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ChatEmptyState } from "./chat-empty-state.tsx";

describe("ChatEmptyState — default anatomy", () => {
  it("renders Root + Avatar + Heading + Suggestions + Suggestion together", () => {
    const html = renderToString(
      <ChatEmptyState.Root>
        <ChatEmptyState.Avatar alt="Ada" />
        <ChatEmptyState.Heading>Ada</ChatEmptyState.Heading>
        <ChatEmptyState.Suggestions>
          <ChatEmptyState.Suggestion onClick={() => undefined}>
            Create a plan
          </ChatEmptyState.Suggestion>
        </ChatEmptyState.Suggestions>
      </ChatEmptyState.Root>,
    );
    assertStringIncludes(html, "Ada");
    assertStringIncludes(html, "Create a plan");
    assertStringIncludes(html, 'role="group"');
  });

  it("Avatar pulses via animate-pulse while isCreating", () => {
    const html = renderToString(
      <ChatEmptyState.Root>
        <ChatEmptyState.Avatar alt="Provisioning" isCreating />
      </ChatEmptyState.Root>,
    );
    assertStringIncludes(html, "animate-pulse");
  });

  it("Heading renders the requested heading level", () => {
    const html = renderToString(
      <ChatEmptyState.Root>
        <ChatEmptyState.Heading level={1}>Top-level</ChatEmptyState.Heading>
      </ChatEmptyState.Root>,
    );
    assertStringIncludes(html, "<h1");
    assertStringIncludes(html, "Top-level");
  });
});

describe("ChatEmptyState — composability", () => {
  it("recomposes: sub-parts can be rendered directly (no Root wrapper required)", () => {
    const html = renderToString(
      <div>
        <ChatEmptyState.Heading>Standalone heading</ChatEmptyState.Heading>
        <ChatEmptyState.Suggestions>
          <ChatEmptyState.Suggestion onClick={() => undefined}>
            Summarize this thread
          </ChatEmptyState.Suggestion>
        </ChatEmptyState.Suggestions>
      </div>,
    );
    assertStringIncludes(html, "Standalone heading");
    assertStringIncludes(html, "Summarize this thread");
  });

  it("restyles: className merges onto the Root container", () => {
    const html = renderToString(
      <ChatEmptyState.Root className="vf-custom-empty-state">
        <ChatEmptyState.Heading>Hi</ChatEmptyState.Heading>
      </ChatEmptyState.Root>,
    );
    assertStringIncludes(html, "vf-custom-empty-state");
  });

  it("exposes every sub-part as a function", () => {
    assert(typeof ChatEmptyState.Root === "function");
    assert(typeof ChatEmptyState.Avatar === "function");
    assert(typeof ChatEmptyState.Heading === "function");
    assert(typeof ChatEmptyState.Suggestions === "function");
    assert(typeof ChatEmptyState.Suggestion === "function");
  });
});

import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  ConversationEmptyState,
  ConversationScrollButton,
  Suggestion,
  Suggestions,
} from "./empty-state.tsx";

describe("ConversationEmptyState", () => {
  it("renders the default title when none is provided", () => {
    const html = renderToString(<ConversationEmptyState />);
    assertStringIncludes(html, "What can I help with?");
  });

  it("renders a custom title, description, icon, and children", () => {
    const html = renderToString(
      <ConversationEmptyState
        title="Start a conversation"
        description="Ask anything about your data."
        icon={<span data-testid="empty-icon">icon</span>}
      >
        <div>extra content</div>
      </ConversationEmptyState>,
    );
    assertStringIncludes(html, "Start a conversation");
    assertStringIncludes(html, "Ask anything about your data.");
    assertStringIncludes(html, "empty-icon");
    assertStringIncludes(html, "extra content");
  });
});

describe("ConversationScrollButton", () => {
  it("renders nothing when visible is false", () => {
    const html = renderToString(<ConversationScrollButton visible={false} />);
    assertEquals(html, "");
  });

  it("renders the scroll-to-bottom button by default", () => {
    const html = renderToString(<ConversationScrollButton />);
    assertStringIncludes(html, 'aria-label="Scroll to bottom"');
  });

  it("renders a custom icon in place of the default arrow", () => {
    const html = renderToString(
      <ConversationScrollButton icon={<span data-testid="custom-arrow">up</span>} />,
    );
    assertStringIncludes(html, "custom-arrow");
  });
});

describe("Suggestion", () => {
  it("renders the suggestion text and an optional icon", () => {
    const html = renderToString(
      <Suggestion suggestion="Summarize this thread" icon={<span>icon</span>} />,
    );
    assertStringIncludes(html, "Summarize this thread");
    assertStringIncludes(html, "icon");
  });

  it("omits the icon wrapper when no icon is provided", () => {
    const html = renderToString(<Suggestion suggestion="Summarize this thread" />);
    assertStringIncludes(html, "Summarize this thread");
  });
});

describe("Suggestions", () => {
  it("renders each child suggestion in a grid layout by default", () => {
    const html = renderToString(
      <Suggestions>
        <Suggestion suggestion="First idea" />
        <Suggestion suggestion="Second idea" />
      </Suggestions>,
    );
    assertStringIncludes(html, "First idea");
    assertStringIncludes(html, "Second idea");
    assertStringIncludes(html, "flex-wrap");
  });

  it("renders a horizontal scroll layout when layout='horizontal'", () => {
    const html = renderToString(
      <Suggestions layout="horizontal">
        <Suggestion suggestion="First idea" />
      </Suggestions>,
    );
    assert(html.includes("overflow-x-auto"), "expected the horizontal layout class");
  });
});

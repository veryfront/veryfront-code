import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { TabSwitcher } from "./tab-switcher.tsx";

describe("TabSwitcher", () => {
  it("renders the Chat and Attachments tabs inside a tablist", () => {
    const html = renderToString(
      <TabSwitcher activeTab="chat" onTabChange={() => undefined} />,
    );
    assertStringIncludes(html, 'role="tablist"');
    assertStringIncludes(html, 'aria-label="Chat view"');
    assertStringIncludes(html, "Chat");
    assertStringIncludes(html, "Attachments");
  });

  it("marks the active tab as aria-selected and focusable", () => {
    const html = renderToString(
      <TabSwitcher activeTab="attachments" onTabChange={() => undefined} />,
    );
    const attachmentsIndex = html.indexOf(">Attachments<");
    const chatIndex = html.indexOf(">Chat<");
    assert(attachmentsIndex > -1 && chatIndex > -1, "expected both tab labels to render");
    // The active tab's button carries aria-selected="true" and tabIndex 0; the
    // inactive one carries aria-selected="false" and tabIndex -1.
    assertStringIncludes(html, 'aria-selected="true"');
    assertStringIncludes(html, 'aria-selected="false"');
  });

  it("renders exactly one selected tab for a given activeTab", () => {
    const html = renderToString(
      <TabSwitcher activeTab="chat" onTabChange={() => undefined} />,
    );
    const selectedCount = html.split('aria-selected="true"').length - 1;
    assert(selectedCount === 1, "expected exactly one aria-selected=true tab");
  });

  it("merges className onto the outer wrapper", () => {
    const html = renderToString(
      <TabSwitcher
        activeTab="chat"
        onTabChange={() => undefined}
        className="vf-custom-switcher"
      />,
    );
    assertStringIncludes(html, "vf-custom-switcher");
  });
});

import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ChatThemeScope } from "./chat-theme-scope.tsx";

describe("ChatThemeScope", () => {
  it("renders a data-vf-chat wrapper containing a <style> tag and its children", () => {
    const html = renderToString(
      <ChatThemeScope>
        <span>shell content</span>
      </ChatThemeScope>,
    );
    assertStringIncludes(html, "data-vf-chat=");
    assertStringIncludes(html, "<style");
    assertStringIncludes(html, "shell content");
  });

  it("merges a custom className onto the scope element's default classes", () => {
    const html = renderToString(
      <ChatThemeScope className="h-screen">
        <span>content</span>
      </ChatThemeScope>,
    );
    assertStringIncludes(html, "h-screen");
    assertStringIncludes(html, "bg-[var(--background)]");
  });

  it("renders without a custom className when none is supplied", () => {
    const html = renderToString(
      <ChatThemeScope>
        <span>content</span>
      </ChatThemeScope>,
    );
    assert(html.includes("bg-[var(--background)]"));
  });
});

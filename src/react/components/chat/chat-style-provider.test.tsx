import { renderToString } from "react-dom/server";
import { assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ChatStyleProvider } from "./chat-style-provider.tsx";

describe("ChatStyleProvider", () => {
  it("renders a <style> tag with the chat token CSS followed by its children", () => {
    const html = renderToString(
      <ChatStyleProvider>
        <div data-testid="child">chat body</div>
      </ChatStyleProvider>,
    );
    assertStringIncludes(html, "<style");
    assertStringIncludes(html, "--chat-background");
    assertStringIncludes(html, "chat body");
  });

  it("exposes a displayName for devtools", () => {
    assertStringIncludes(ChatStyleProvider.displayName ?? "", "ChatStyleProvider");
  });
});

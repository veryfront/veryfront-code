import { renderToString } from "react-dom/server";
import { assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ChatTokens } from "./chat-tokens-style.tsx";

describe("ChatTokens (re-export of ui/tokens.tsx DesignTokenStyle)", () => {
  it("renders a scoped design-token <style> tag", () => {
    const html = renderToString(<ChatTokens />);
    assertStringIncludes(html, "<style");
  });
});

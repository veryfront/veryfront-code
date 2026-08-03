import { renderToString } from "react-dom/server";
import { assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ModelAvatar } from "./model-avatar.tsx";

// Characterizes ModelAvatar's model-string -> provider-logo resolution, and
// its fallback to a generic icon for unresolved providers.
describe("ModelAvatar", () => {
  it("resolves an Anthropic/Claude model to the Anthropic logomark + dark surface", () => {
    const html = renderToString(<ModelAvatar model="claude-3-opus" />);
    assertStringIncludes(html, "<svg");
    assertStringIncludes(html, "bg-[#181818]");
  });

  it("resolves an OpenAI/GPT model to the OpenAI logomark", () => {
    const html = renderToString(<ModelAvatar model="gpt-4o" />);
    assertStringIncludes(html, "<svg");
    assertStringIncludes(html, "bg-[var(--foreground)]");
  });

  it("resolves a Gemini/Google model to the Gemini logomark", () => {
    const html = renderToString(<ModelAvatar model="gemini-1.5-pro" />);
    assertStringIncludes(html, "<svg");
    assertStringIncludes(html, "bg-[var(--foreground)]");
  });

  it("falls back to the faint surface + SparklesIcon for an unresolved provider", () => {
    const html = renderToString(<ModelAvatar model="some-unknown-model" />);
    assertStringIncludes(html, "bg-[var(--faint)]");
    assertStringIncludes(html, "<svg");
  });

  it("falls back to a custom icon override when the provider is unresolved", () => {
    const html = renderToString(
      <ModelAvatar model="unknown" icon={<span data-testid="custom-icon">?</span>} />,
    );
    assertStringIncludes(html, "custom-icon");
  });

  it("treats an absent model as an unresolved provider", () => {
    const html = renderToString(<ModelAvatar />);
    assertStringIncludes(html, "bg-[var(--faint)]");
  });

  it("merges a custom className onto the wrapper", () => {
    const html = renderToString(<ModelAvatar model="claude" className="vf-custom-model-avatar" />);
    assertStringIncludes(html, "vf-custom-model-avatar");
  });
});

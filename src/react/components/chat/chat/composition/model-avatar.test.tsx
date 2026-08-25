import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ModelAvatar } from "./model-avatar.tsx";

// Leading path segments of the inlined Simple Icons logomarks; the only
// per-logo discriminator in the rendered markup.
const ANTHROPIC_PATH = "M17.3041 3.541";
const OPENAI_PATH = "M22.2819 9.8211";
const GEMINI_PATH = "M11.04 19.32";

// Characterizes ModelAvatar's model-string -> provider-logo resolution, and
// its fallback to a generic icon for unresolved providers.
describe("ModelAvatar", () => {
  it("resolves an Anthropic/Claude model to the Anthropic logomark + dark surface", () => {
    const html = renderToString(<ModelAvatar model="claude-3-opus" />);
    assertStringIncludes(html, "<svg");
    assertStringIncludes(html, "bg-[#181818]");
    assertStringIncludes(html, ANTHROPIC_PATH, "Anthropic logomark path renders");
    assertStringIncludes(html, "text-[#D4A27F]", "Anthropic glyph uses the brand tint");
  });

  it("resolves an OpenAI/GPT model to the OpenAI logomark", () => {
    const html = renderToString(<ModelAvatar model="gpt-4o" />);
    assertStringIncludes(html, "<svg");
    assertStringIncludes(html, "bg-[var(--foreground)]");
    assertStringIncludes(html, OPENAI_PATH, "OpenAI logomark path renders");
    assert(!html.includes(GEMINI_PATH), "Gemini path must not render for an OpenAI model");
  });

  it("resolves a Gemini/Google model to the Gemini logomark", () => {
    const html = renderToString(<ModelAvatar model="gemini-1.5-pro" />);
    assertStringIncludes(html, "<svg");
    assertStringIncludes(html, "bg-[var(--foreground)]");
    assertStringIncludes(html, GEMINI_PATH, "Gemini logomark path renders");
    assert(!html.includes(OPENAI_PATH), "OpenAI path must not render for a Gemini model");
  });

  it("falls back to the faint surface + SparklesIcon for an unresolved provider", () => {
    const html = renderToString(<ModelAvatar model="some-unknown-model" />);
    assertStringIncludes(html, "bg-[var(--faint)]");
    assertStringIncludes(html, "<svg");
    for (const path of [ANTHROPIC_PATH, OPENAI_PATH, GEMINI_PATH]) {
      assert(!html.includes(path), "no brand logomark renders for an unresolved provider");
    }
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

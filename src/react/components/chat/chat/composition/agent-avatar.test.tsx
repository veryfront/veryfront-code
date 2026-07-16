import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { AgentAvatar } from "./agent-avatar.tsx";

// Characterization: locks in AgentAvatar's fallback chain — avatarUrl image,
// then a name-derived initial, then delegating to ModelAvatar.
describe("AgentAvatar", () => {
  it("renders an <img> when avatarUrl is provided", () => {
    const html = renderToString(
      <AgentAvatar avatarUrl="https://example.com/agent.png" name="Ada" />,
    );
    assertStringIncludes(html, 'src="https://example.com/agent.png"');
    assertStringIncludes(html, 'aria-hidden="true"');
    // avatarUrl takes priority over the name-initial fallback.
    assert(!html.includes(">A<"), "the image must win over the initial fallback");
  });

  it("falls back to an uppercased initial when there is no avatarUrl", () => {
    const html = renderToString(<AgentAvatar name="ada" />);
    assertStringIncludes(html, ">A<");
    assert(!html.includes("<img"), "no avatarUrl means no <img> is rendered");
  });

  it("trims whitespace before taking the initial", () => {
    const html = renderToString(<AgentAvatar name="  bob" />);
    assertStringIncludes(html, ">B<");
  });

  it("delegates to ModelAvatar when neither avatarUrl nor name is given", () => {
    const html = renderToString(<AgentAvatar model="claude-3-opus" />);
    // ModelAvatar renders an svg logomark for a resolved provider — not an
    // initial letter or <img>.
    assertStringIncludes(html, "<svg");
    assert(!html.includes("<img"));
  });

  it("merges a custom className onto the rendered element", () => {
    const html = renderToString(<AgentAvatar name="Ada" className="vf-custom-avatar" />);
    assertStringIncludes(html, "vf-custom-avatar");
  });
});

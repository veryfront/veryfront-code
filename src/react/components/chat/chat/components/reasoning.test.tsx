import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { Reasoning, useReasoning } from "./reasoning.tsx";

describe("Reasoning — default anatomy", () => {
  it("renders the collapsed 'Thought process' trigger when not streaming", () => {
    const html = renderToString(<Reasoning text="Let me think about this." />);
    assertStringIncludes(html, "Thought process");
    // Not streaming and no defaultOpen: the disclosure starts collapsed, so the
    // reasoning body markdown does not render.
    assert(
      !html.includes("Let me think about this."),
      "expected the collapsed body to be absent",
    );
  });

  it("opens automatically and shows the 'Thinking...' shimmer while streaming", () => {
    const html = renderToString(<Reasoning text="Working it out..." isStreaming />);
    assertStringIncludes(html, "Thinking...");
    assertStringIncludes(html, "Working it out...");
  });

  it("honors a controlled open prop even when not streaming", () => {
    const html = renderToString(<Reasoning text="Visible body text." open />);
    assertStringIncludes(html, "Visible body text.");
  });

  it("overrides the trigger labels via the labels prop", () => {
    const html = renderToString(
      <Reasoning
        text="Body"
        isStreaming
        labels={{ thinking: "Pondering...", thought: "Pondered" }}
      />,
    );
    assertStringIncludes(html, "Pondering...");
  });
});

describe("Reasoning — composability contract", () => {
  it("recomposes: custom children replace the default trigger + content", () => {
    const html = renderToString(
      <Reasoning text="Composed body" open>
        <Reasoning.Content>
          <span data-testid="custom-reasoning-body">custom body</span>
        </Reasoning.Content>
      </Reasoning>,
    );
    assertStringIncludes(html, "custom-reasoning-body");
    assert(
      !html.includes("Composed body"),
      "the custom Content children should replace the default markdown",
    );
  });

  it("restyles: className merges onto the Root wrapper", () => {
    const html = renderToString(
      <Reasoning text="Body" className="vf-custom-reasoning" />,
    );
    assertStringIncludes(html, "vf-custom-reasoning");
  });

  it("useReasoning throws outside a Reasoning", () => {
    function Orphan() {
      useReasoning();
      return null;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });
});

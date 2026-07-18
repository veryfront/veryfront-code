import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MessageFeedback } from "./message-feedback.tsx";

describe("MessageFeedback", () => {
  it("renders both default feedback controls", () => {
    const html = renderToString(
      <MessageFeedback messageId="message-1" onFeedback={() => {}} />,
    );

    assertStringIncludes(html, "Helpful");
    assertStringIncludes(html, "Not helpful");
  });

  it("composes per-action icons and classes", () => {
    const html = renderToString(
      <MessageFeedback
        messageId="message-1"
        feedback="positive"
        onFeedback={() => {}}
      >
        <MessageFeedback.Negative
          icon={<span data-testid="custom-negative">no</span>}
          className="vf-negative"
        />
        <MessageFeedback.Positive
          icon={<span data-testid="custom-positive">yes</span>}
          className="vf-positive"
        />
      </MessageFeedback>,
    );

    assertStringIncludes(html, "custom-negative");
    assertStringIncludes(html, "vf-negative");
    assertStringIncludes(html, "custom-positive");
    assertStringIncludes(html, "vf-positive");
    assertStringIncludes(html, "text-emerald-500");
  });

  it("exposes both feedback leaves", () => {
    for (const part of ["Root", "Positive", "Negative"]) {
      assertEquals(
        typeof (MessageFeedback as unknown as Record<string, unknown>)[part],
        "function",
      );
    }
  });
});

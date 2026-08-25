/**
 * ChatInput action leaves: `children` override the default glyph.
 */
import * as React from "react";
import { renderToString } from "react-dom/server";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ChatInput } from "./chat-composer.tsx";

function composer(node: React.ReactNode): string {
  return renderToString(
    <ChatInput.Root input="hi" onChange={() => {}} onSubmit={() => {}}>
      {node}
    </ChatInput.Root>,
  );
}

describe("ChatInput action leaves — children override", () => {
  it("children replace the default Send glyph", () => {
    const html = composer(
      <ChatInput.Send>
        <svg data-testid="kids-send" />
      </ChatInput.Send>,
    );
    assert(html.includes("kids-send"), "children render inside Send");
    assert(
      !html.includes('points="5 12 12 5 19 12"'),
      "the default ArrowUp glyph must not render alongside children",
    );
    assertEquals(html.split("<svg").length - 1, 1, "exactly one svg renders inside Send");
  });

  it("children replace the default Stop glyph", () => {
    const html = composer(
      <ChatInput.Root input="hi" onChange={() => {}} onSubmit={() => {}} isLoading stop={() => {}}>
        <ChatInput.Stop>
          <svg data-testid="kids-stop" />
        </ChatInput.Stop>
      </ChatInput.Root>,
    );
    assert(html.includes("kids-stop"), "children take precedence");
    assert(
      !html.includes('<rect x="3" y="3"'),
      "the default Stop glyph must not render alongside children",
    );
    assertEquals(html.split("<svg").length - 1, 1, "exactly one svg renders inside Stop");
  });
});

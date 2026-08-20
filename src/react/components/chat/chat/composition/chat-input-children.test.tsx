/**
 * ChatInput action leaves: `children` override the default glyph.
 */
import * as React from "react";
import { renderToString } from "react-dom/server";
import { assert } from "#veryfront/testing/assert.ts";
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
  });
});

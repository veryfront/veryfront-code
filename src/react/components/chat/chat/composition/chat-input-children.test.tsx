/**
 * ChatInput action leaves: `children` override the default glyph (RFC 2980 —
 * "a leaf renders its default icon when childless; pass children to replace
 * it"), while the deprecated `icon` prop still works (backward compat).
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

  it("the deprecated icon prop still works when no children given", () => {
    const html = composer(<ChatInput.Send icon={<svg data-testid="icon-send" />} />);
    assert(html.includes("icon-send"), "icon prop still honoured (backward compat)");
  });

  it("children win over icon when both are provided", () => {
    const html = composer(
      <ChatInput.Send icon={<svg data-testid="icon-send" />}>
        <svg data-testid="kids-send" />
      </ChatInput.Send>,
    );
    assert(html.includes("kids-send"), "children take precedence");
    assert(!html.includes("icon-send"), "icon is not rendered when children present");
  });
});

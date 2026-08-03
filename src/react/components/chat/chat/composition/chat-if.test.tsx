import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ChatIf } from "./chat-if.tsx";
import { ChatRoot } from "./chat-root.tsx";
import type { ChatContextValue } from "../contexts/chat-context.tsx";

// ChatIf's conditional can be a plain boolean or a function reading the
// nearest ChatContext. Characterize both paths, plus the "no ChatRoot
// ancestor" case, since the hook is read via the *optional* variant.
describe("ChatIf", () => {
  it("renders children when condition is true", () => {
    const html = renderToString(
      <ChatIf condition>
        <span>visible</span>
      </ChatIf>,
    );
    assertStringIncludes(html, "visible");
  });

  it("renders the fallback when condition is false", () => {
    const html = renderToString(
      <ChatIf condition={false} fallback={<span>fallback</span>}>
        <span>visible</span>
      </ChatIf>,
    );
    assertStringIncludes(html, "fallback");
    assert(!html.includes("visible"));
  });

  it("renders nothing when condition is false and no fallback is given", () => {
    const html = renderToString(
      <ChatIf condition={false}>
        <span>visible</span>
      </ChatIf>,
    );
    assertEquals(html, "");
  });

  it("evaluates a function condition against the enclosing ChatContext", () => {
    const html = renderToString(
      <ChatRoot messages={[]} input="">
        <ChatIf condition={(ctx: ChatContextValue) => ctx.isEmpty}>
          <span>chat is empty</span>
        </ChatIf>
      </ChatRoot>,
    );
    assertStringIncludes(html, "chat is empty");
  });

  it("treats a function condition as false when there is no ChatContext ancestor", () => {
    const html = renderToString(
      <ChatIf condition={() => true} fallback={<span>no-context-fallback</span>}>
        <span>visible</span>
      </ChatIf>,
    );
    assertStringIncludes(html, "no-context-fallback");
  });
});

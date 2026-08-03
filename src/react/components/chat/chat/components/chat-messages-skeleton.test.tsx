import { renderToString } from "react-dom/server";
import { assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { ChatMessagesSkeleton } from "./chat-messages-skeleton.tsx";

describe("ChatMessagesSkeleton", () => {
  it("renders an aria-busy output with a screen-reader loading announcement", () => {
    const html = renderToString(<ChatMessagesSkeleton />);
    assertStringIncludes(html, 'aria-busy="true"');
    assertStringIncludes(html, "Loading messages...");
  });

  it("lays out the same max-w-[850px] column as the real message list", () => {
    const html = renderToString(<ChatMessagesSkeleton />);
    assertStringIncludes(html, "max-w-[850px]");
  });

  it("restyles: className merges onto the output wrapper", () => {
    const html = renderToString(<ChatMessagesSkeleton className="vf-custom-skeleton" />);
    assertStringIncludes(html, "vf-custom-skeleton");
  });

  it("exposes a stable displayName for devtools", () => {
    assertStringIncludes(ChatMessagesSkeleton.displayName ?? "", "ChatMessagesSkeleton");
  });
});

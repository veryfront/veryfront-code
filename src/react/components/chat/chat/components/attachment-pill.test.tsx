import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { AttachmentInfo } from "./attachment-pill.tsx";
import { AttachmentPill, useAttachmentPill } from "./attachment-pill.tsx";

const readyFile: AttachmentInfo = {
  id: "notes",
  name: "handoff-notes.md",
  type: "md",
  size: 2418,
};

describe("AttachmentPill", () => {
  it("renders the default anatomy (icon box + label)", () => {
    const html = renderToString(<AttachmentPill attachment={readyFile} />);
    assertStringIncludes(html, "handoff-notes.md");
  });

  it("defines no width itself — width is the container's decision", () => {
    const html = renderToString(<AttachmentPill attachment={readyFile} />);
    assert(!html.includes("w-[200px]"));
    // A caller-supplied width lands on the wrapper.
    const sized = renderToString(
      <AttachmentPill attachment={readyFile} className="w-full" />,
    );
    assertStringIncludes(sized, "w-full");
  });

  it("surfaces a remove control when onRemove is provided", () => {
    const html = renderToString(
      <AttachmentPill attachment={readyFile} onRemove={() => undefined} />,
    );
    assertStringIncludes(html, "Remove handoff-notes.md");
  });

  it("keeps the remove control visible when reached by keyboard", () => {
    const html = renderToString(
      <AttachmentPill attachment={readyFile} onRemove={() => undefined} />,
    );
    assertStringIncludes(html, "md:focus-visible:opacity-100");
  });

  it("surfaces a retry control only in the error state with an onRetry handler", () => {
    const errored = renderToString(
      <AttachmentPill attachment={{ ...readyFile, state: "error" }} onRetry={() => undefined} />,
    );
    assertStringIncludes(
      errored,
      'aria-label="Retry handoff-notes.md"',
      "error state with onRetry exposes the retry control",
    );

    const uploaded = renderToString(
      <AttachmentPill
        attachment={{ ...readyFile, state: "uploaded" }}
        onRetry={() => undefined}
      />,
    );
    assert(
      !uploaded.includes("Retry handoff-notes.md"),
      "retry is hidden outside the error state",
    );

    const noHandler = renderToString(
      <AttachmentPill attachment={{ ...readyFile, state: "error" }} />,
    );
    assert(
      !noHandler.includes("Retry handoff-notes.md"),
      "retry is hidden when no onRetry handler is supplied",
    );
  });
});

// The composability contract: a consuming developer must be able to recompose
// the pill, and restyle a part. If these fail, `AttachmentPill` is not
// composable — these tests ARE the definition.
describe("AttachmentPill — composability contract", () => {
  it("recomposes: a caller can reorder the parts", () => {
    const html = renderToString(
      <AttachmentPill attachment={readyFile} onRemove={() => undefined}>
        <AttachmentPill.Remove />
        <AttachmentPill.Label />
      </AttachmentPill>,
    );
    // Custom order: the remove control renders before the label column.
    assert(
      html.indexOf("Remove handoff-notes.md") <
        html.indexOf("flex min-w-0 flex-1 flex-col"),
      "expected Remove to render before the Label in the recomposed pill",
    );
  });

  it("accepts a per-sub-component icon override as .Remove children", () => {
    const html = renderToString(
      <AttachmentPill attachment={readyFile} onRemove={() => undefined}>
        <AttachmentPill.Remove>
          <span data-testid="custom-remove">x</span>
        </AttachmentPill.Remove>
      </AttachmentPill>,
    );
    assertStringIncludes(html, "custom-remove");
  });

  it("restyles: className on a sub-part is merged onto its wrapper", () => {
    const html = renderToString(
      <AttachmentPill attachment={readyFile}>
        <AttachmentPill.Label className="vf-custom-label-class" />
      </AttachmentPill>,
    );
    assertStringIncludes(html, "vf-custom-label-class");
  });

  it("useAttachmentPill throws outside an AttachmentPill", () => {
    function Orphan() {
      useAttachmentPill();
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

import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { UploadedFile } from "./attachments-panel.tsx";
import { AttachmentsPanel, useAttachmentsPanel } from "./attachments-panel.tsx";
import { AttachmentPill } from "./attachment-pill.tsx";

const uploads: UploadedFile[] = [
  { id: "upload-1", name: "run-analysis.csv", size: 24424, type: "text/csv" },
  { id: "upload-2", name: "prompt-notes.md", size: 9812, type: "text/markdown" },
];

describe("AttachmentsPanel", () => {
  it("renders a row per upload", () => {
    const html = renderToString(<AttachmentsPanel uploads={uploads} />);
    assertStringIncludes(html, "run-analysis.csv");
    assertStringIncludes(html, "prompt-notes.md");
  });

  it("renders the empty state when there are no uploads", () => {
    const html = renderToString(<AttachmentsPanel uploads={[]} />);
    assertStringIncludes(html, "No files uploaded");
  });

  it("renders the loading placeholder — not the empty state — while the list loads", () => {
    const html = renderToString(<AttachmentsPanel uploads={[]} loading />);
    assertStringIncludes(html, 'aria-label="Loading files"');
    assert(!html.includes("No files uploaded"), "empty state must not flash while loading");
  });

  it("prefers a cached list over the loading placeholder", () => {
    // A non-empty list paints immediately even mid-refresh — no skeleton flash
    // over real content.
    const html = renderToString(<AttachmentsPanel uploads={uploads} loading />);
    assertStringIncludes(html, "run-analysis.csv");
    assert(!html.includes('aria-label="Loading files"'), "list wins over the loading state");
  });

  it("renders a ⋯ overflow menu per row instead of the pill's ✕", () => {
    const html = renderToString(
      <AttachmentsPanel uploads={uploads} onRemoveUpload={() => undefined} />,
    );
    assertStringIncludes(html, 'aria-label="Actions for run-analysis.csv"');
    // The composed row swaps AttachmentPill's default remove control, so its
    // "Remove <name>" ✕ must not be present.
    assert(!html.includes('aria-label="Remove run-analysis.csv"'));
  });

  it("renders the Attachments header + close button when onClose is set", () => {
    const html = renderToString(
      <AttachmentsPanel uploads={uploads} onClose={() => undefined} />,
    );
    assertStringIncludes(html, "Attachments");
    assertStringIncludes(html, 'aria-label="Close attachments"');
  });

  it("omits the close button when onClose is absent", () => {
    const html = renderToString(<AttachmentsPanel uploads={uploads} />);
    assert(!html.includes('aria-label="Close attachments"'));
  });
});

// The composability contract: a consuming developer must be able to recompose
// the panel, and restyle a part. If these fail, `AttachmentsPanel` is not
// composable — these tests ARE the definition.
describe("AttachmentsPanel — composability contract", () => {
  it("recomposes: a caller can render sub-part children directly", () => {
    const html = renderToString(
      <AttachmentsPanel uploads={uploads}>
        <AttachmentsPanel.List>
          <AttachmentsPanel.Item file={uploads[1]!} />
          <AttachmentsPanel.Item file={uploads[0]!} />
        </AttachmentsPanel.List>
      </AttachmentsPanel>,
    );
    // Custom order: the second upload's row renders before the first.
    assert(
      html.indexOf("prompt-notes.md") < html.indexOf("run-analysis.csv"),
      "expected prompt-notes.md to render before run-analysis.csv in the recomposed list",
    );
  });

  it("restyles: className on a sub-part is merged onto its wrapper", () => {
    const html = renderToString(
      <AttachmentsPanel uploads={uploads}>
        <AttachmentsPanel.List className="vf-custom-list-class" />
      </AttachmentsPanel>,
    );
    assertStringIncludes(html, "vf-custom-list-class");
  });

  it("recomposes the row from Item leaves (Icon + Remove) + AttachmentPill.Label", () => {
    const html = renderToString(
      <AttachmentsPanel uploads={uploads} onRemoveUpload={() => undefined}>
        <AttachmentsPanel.List>
          {uploads.map((file) => (
            <AttachmentsPanel.Item key={file.id} file={file}>
              <AttachmentsPanel.Item.Icon />
              {/* Name + size are plain text — reuse the pill's Label leaf. */}
              <AttachmentPill.Label />
              <AttachmentsPanel.Item.Remove />
            </AttachmentsPanel.Item>
          ))}
        </AttachmentsPanel.List>
      </AttachmentsPanel>,
    );
    // Name + formatted size come through the Label leaf...
    assertStringIncludes(html, "run-analysis.csv");
    assertStringIncludes(html, "24 KB");
    // ...and the composed row uses the pill's ✕ Remove (wired to onRemoveUpload),
    // not the default overflow menu.
    assertStringIncludes(html, 'aria-label="Remove run-analysis.csv"');
    assert(!html.includes('aria-label="Actions for run-analysis.csv"'));
  });

  it("Item.Remove renders nothing when no onRemoveUpload is set", () => {
    const html = renderToString(
      <AttachmentsPanel uploads={uploads}>
        <AttachmentsPanel.List>
          <AttachmentsPanel.Item file={uploads[0]!}>
            <AttachmentsPanel.Item.Icon />
            <AttachmentsPanel.Item.Remove />
          </AttachmentsPanel.Item>
        </AttachmentsPanel.List>
      </AttachmentsPanel>,
    );
    assert(!html.includes('aria-label="Remove run-analysis.csv"'));
  });

  it("Item leaves read the file from context; used outside an Item they throw", () => {
    function Orphan() {
      return <AttachmentsPanel.Item.Icon />;
    }
    let threw = false;
    try {
      renderToString(<Orphan />);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });

  it("useAttachmentsPanel throws outside an AttachmentsPanel", () => {
    function Orphan() {
      useAttachmentsPanel();
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

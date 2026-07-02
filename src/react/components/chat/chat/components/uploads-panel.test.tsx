import { renderToString } from "react-dom/server";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { UploadedFile } from "./uploads-panel.tsx";
import { UploadsPanel, useUploadsPanel } from "./uploads-panel.tsx";

const uploads: UploadedFile[] = [
  { id: "upload-1", name: "run-analysis.csv", size: 24424, type: "text/csv" },
  { id: "upload-2", name: "prompt-notes.md", size: 9812, type: "text/markdown" },
];

describe("UploadsPanel", () => {
  it("renders a row per upload", () => {
    const html = renderToString(<UploadsPanel uploads={uploads} />);
    assertStringIncludes(html, "run-analysis.csv");
    assertStringIncludes(html, "prompt-notes.md");
  });

  it("renders the empty state when there are no uploads", () => {
    const html = renderToString(<UploadsPanel uploads={[]} />);
    assertStringIncludes(html, "No files uploaded");
  });

  it("renders the Attachments header + close button when onClose is set", () => {
    const html = renderToString(
      <UploadsPanel uploads={uploads} onClose={() => undefined} />,
    );
    assertStringIncludes(html, "Attachments");
    assertStringIncludes(html, 'aria-label="Close attachments"');
  });

  it("omits the close button when onClose is absent", () => {
    const html = renderToString(<UploadsPanel uploads={uploads} />);
    assert(!html.includes('aria-label="Close attachments"'));
  });
});

// The composability contract: a consuming developer must be able to recompose
// the panel, and restyle a part. If these fail, `UploadsPanel` is not
// composable — these tests ARE the definition.
describe("UploadsPanel — composability contract", () => {
  it("recomposes: a caller can render sub-part children directly", () => {
    const html = renderToString(
      <UploadsPanel uploads={uploads}>
        <UploadsPanel.List>
          <UploadsPanel.Item file={uploads[1]!} />
          <UploadsPanel.Item file={uploads[0]!} />
        </UploadsPanel.List>
      </UploadsPanel>,
    );
    // Custom order: the second upload's row renders before the first.
    assert(
      html.indexOf("prompt-notes.md") < html.indexOf("run-analysis.csv"),
      "expected prompt-notes.md to render before run-analysis.csv in the recomposed list",
    );
  });

  it("restyles: className on a sub-part is merged onto its wrapper", () => {
    const html = renderToString(
      <UploadsPanel uploads={uploads}>
        <UploadsPanel.List className="vf-custom-list-class" />
      </UploadsPanel>,
    );
    assertStringIncludes(html, "vf-custom-list-class");
  });

  it("useUploadsPanel throws outside an UploadsPanel", () => {
    function Orphan() {
      useUploadsPanel();
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

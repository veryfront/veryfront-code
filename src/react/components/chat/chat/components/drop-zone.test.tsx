import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { DropZoneOverlay } from "./drop-zone.tsx";

describe("DropZoneOverlay", () => {
  it("renders nothing when not visible", () => {
    const html = renderToString(<DropZoneOverlay visible={false} />);
    assertEquals(html, "");
  });

  it('renders the default "Drop files" label with the glyph when visible', () => {
    const html = renderToString(<DropZoneOverlay visible />);
    assertStringIncludes(html, "Drop files");
    assertStringIncludes(html, "<svg");
  });

  it("overrides the label via the label prop", () => {
    const html = renderToString(<DropZoneOverlay visible label="Drop it here" />);
    assertStringIncludes(html, "Drop it here");
  });

  it("overrides the glyph via the icon prop (no default svg)", () => {
    const html = renderToString(
      <DropZoneOverlay visible icon={<span data-testid="custom-icon">*</span>} />,
    );
    assertStringIncludes(html, "custom-icon");
    // The default upload polyline glyph must not also render.
    const svgCount = (html.match(/<svg/g) ?? []).length;
    assertEquals(svgCount, 0);
  });

  it("restyles: className merges onto the overlay wrapper", () => {
    const html = renderToString(<DropZoneOverlay visible className="vf-custom-overlay" />);
    assertStringIncludes(html, "vf-custom-overlay");
  });
});

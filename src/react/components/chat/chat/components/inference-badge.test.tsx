import { renderToString } from "react-dom/server";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { InferenceBadge } from "./inference-badge.tsx";

describe("InferenceBadge", () => {
  it('renders nothing when inferenceMode is "cloud"', () => {
    const html = renderToString(<InferenceBadge inferenceMode="cloud" />);
    assertEquals(html, "");
  });

  it('renders the default "Running locally" label + status dot for "server-local"', () => {
    const html = renderToString(<InferenceBadge inferenceMode="server-local" />);
    assertStringIncludes(html, "Running locally");
    assertStringIncludes(html, "bg-green-500");
  });

  it("overrides the label via the label prop", () => {
    const html = renderToString(
      <InferenceBadge inferenceMode="server-local" label="On this device" />,
    );
    assertStringIncludes(html, "On this device");
  });

  it("overrides the status icon via the icon prop (no default green dot)", () => {
    const html = renderToString(
      <InferenceBadge
        inferenceMode="server-local"
        icon={<span data-testid="custom-dot">*</span>}
      />,
    );
    assertStringIncludes(html, "custom-dot");
    assertEquals(html.includes("bg-green-500"), false);
  });

  it("restyles: className merges onto the badge wrapper", () => {
    const html = renderToString(
      <InferenceBadge inferenceMode="server-local" className="vf-custom-badge" />,
    );
    assertStringIncludes(html, "vf-custom-badge");
  });
});

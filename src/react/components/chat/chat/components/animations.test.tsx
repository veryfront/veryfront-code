import { renderToString } from "react-dom/server";
import { assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { FadeIn, Loader, Shimmer } from "./animations.tsx";

describe("Shimmer", () => {
  it("wraps children in an animate-pulse span", () => {
    const html = renderToString(<Shimmer>Thinking...</Shimmer>);
    assertStringIncludes(html, "Thinking...");
    assertStringIncludes(html, "animate-pulse");
  });
});

describe("Loader", () => {
  it("renders three animated dots sized from the default size prop", () => {
    const html = renderToString(<Loader />);
    // size=16 -> dotSize=4, so each dot is 4px wide/tall.
    const dotCount = (html.match(/animate-bounce/g) ?? []).length;
    assertStringIncludes(html, "flex items-center gap-1");
    assertStringIncludes(html, "width:4px");
    assertStringIncludes(html, "height:4px");
    if (dotCount !== 3) {
      throw new Error(`expected 3 dots, got ${dotCount}`);
    }
  });

  it("restyles: className merges onto the wrapper", () => {
    const html = renderToString(<Loader className="vf-custom-loader" />);
    assertStringIncludes(html, "vf-custom-loader");
  });
});

describe("FadeIn", () => {
  it("renders in the pre-mount state during SSR (no effects run)", () => {
    // useEffect never fires during renderToString, so `mounted` stays false —
    // this characterizes the SSR-emitted markup, not the post-hydration state.
    const html = renderToString(<FadeIn>Body text</FadeIn>);
    assertStringIncludes(html, "Body text");
    assertStringIncludes(html, "opacity:0");
    assertStringIncludes(html, "translateY(8px)");
    assertStringIncludes(html, "300ms ease-out");
  });

  it("restyles: className merges onto the wrapper", () => {
    const html = renderToString(<FadeIn className="vf-fade-in">x</FadeIn>);
    assertStringIncludes(html, "vf-fade-in");
  });
});

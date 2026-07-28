import "#veryfront/schemas/_test-setup.ts";
import { renderToString } from "react-dom/server";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runWithHeadCollector } from "#veryfront/react/head-collector.ts";
import { type Font, GoogleFonts } from "./index.ts";

function collectGoogleFonts(fonts: readonly Font[]) {
  return runWithHeadCollector(() => {
    renderToString(<GoogleFonts fonts={fonts} />);
  });
}

describe("GoogleFonts", () => {
  it("supports frozen readonly weights without mutating caller-owned arrays", async () => {
    const mutableWeights: Array<string | number> = [700, "400", 500];
    const frozenWeights = Object.freeze(["200..900"] as const);
    const fonts: readonly Font[] = Object.freeze([
      Object.freeze({
        name: "Fira Code",
        variable: "--font-mono",
        weights: mutableWeights,
      }),
      Object.freeze({
        name: "Source Serif 4",
        variable: "--font-serif",
        weights: frozenWeights,
        italics: true,
      }),
    ]);

    const { head } = await collectGoogleFonts(fonts);

    assertEquals(mutableWeights, [700, "400", 500]);
    assertEquals(frozenWeights, ["200..900"]);
    assertEquals(
      head.links.find(({ rel }) => rel === "stylesheet")?.href,
      "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;700&family=Source+Serif+4:ital,wght@0,200..900;1,200..900&display=swap",
    );
    assertEquals(head.styles, [
      `@layer base {
  :root {
    --font-mono: "Fira Code", ui-sans-serif, system-ui, sans-serif;
    --font-serif: "Source Serif 4", ui-sans-serif, system-ui, sans-serif;
  }
}`,
    ]);
  });

  it("encodes query delimiters and escapes CSS string delimiters", async () => {
    const { head } = await collectGoogleFonts([{
      name: 'Inter&family=Roboto "Quoted" \\ Display',
      variable: "--font-display",
      weights: ["450.5"],
    }]);

    assertEquals(
      head.links.find(({ rel }) => rel === "stylesheet")?.href,
      "https://fonts.googleapis.com/css2?family=Inter%26family%3DRoboto+%22Quoted%22+%5C+Display:wght@450.5&display=swap",
    );
    assertEquals(head.styles, [
      `@layer base {
  :root {
    --font-display: "Inter&family=Roboto \\"Quoted\\" \\\\ Display", ui-sans-serif, system-ui, sans-serif;
  }
}`,
    ]);
  });

  it("rejects malformed weight interpolation", async () => {
    await assertRejects(
      () =>
        collectGoogleFonts([{
          name: "Inter",
          weights: ["400&family=Roboto"],
        }]),
      TypeError,
      "Invalid Google font weight",
    );
  });

  it("rejects control characters in font-family names", async () => {
    await assertRejects(
      () =>
        collectGoogleFonts([{
          name: "Inter\nbody { color: red; }",
          weights: [400],
        }]),
      TypeError,
      "Google font family",
    );
  });

  it("rejects malformed Unicode and CSS custom-property injection", async () => {
    await assertRejects(
      () =>
        collectGoogleFonts([{
          name: "Inter\uD800",
          weights: [400],
        }]),
      TypeError,
      "well-formed name",
    );

    await assertRejects(
      () =>
        collectGoogleFonts([{
          name: "Inter",
          variable: "--font; color: red",
          weights: [400],
        }]),
      TypeError,
      "CSS custom property",
    );
  });
});

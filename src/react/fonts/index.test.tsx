import "#veryfront/schemas/_test-setup.ts";
import { renderToString } from "react-dom/server";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  deserializeManagedHeadPayload,
  HEAD_SSR_PAYLOAD_ATTRIBUTE,
} from "#veryfront/html/managed-head-protocol.ts";
import { type Font, GoogleFonts } from "./index.ts";

function collectGoogleFonts(fonts: readonly Font[]) {
  const html = renderToString(<GoogleFonts fonts={fonts} />);
  const payload = html.match(
    new RegExp(`${HEAD_SSR_PAYLOAD_ATTRIBUTE}="([A-Za-z0-9_-]*)"`),
  )?.[1];
  const descriptors = deserializeManagedHeadPayload(payload ?? "");
  return {
    links: descriptors
      .filter(({ tagName }) => tagName === "link")
      .map(({ attributes }) => Object.fromEntries(attributes)),
    styles: descriptors
      .filter(({ tagName }) => tagName === "style")
      .map(({ content }) => content ?? ""),
  };
}

describe("GoogleFonts", () => {
  it("supports frozen readonly weights without mutating caller-owned arrays", () => {
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

    const head = collectGoogleFonts(fonts);

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

  it("encodes query delimiters and escapes CSS string delimiters", () => {
    const head = collectGoogleFonts([{
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

  it("rejects malformed weight interpolation", () => {
    assertThrows(
      () =>
        collectGoogleFonts([{
          name: "Inter",
          weights: ["400&family=Roboto"],
        }]),
      TypeError,
      "Invalid Google font weight",
    );
  });

  it("rejects control characters in font-family names", () => {
    assertThrows(
      () =>
        collectGoogleFonts([{
          name: "Inter\nbody { color: red; }",
          weights: [400],
        }]),
      TypeError,
      "Google font family",
    );
  });

  it("rejects malformed Unicode and CSS custom-property injection", () => {
    assertThrows(
      () =>
        collectGoogleFonts([{
          name: "Inter\uD800",
          weights: [400],
        }]),
      TypeError,
      "well-formed name",
    );

    assertThrows(
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

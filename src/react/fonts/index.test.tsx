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

const PRECONNECT_LINKS: { [k: string]: string }[] = [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" },
];

describe("GoogleFonts", () => {
  it("emits only preconnect links and no style block for an empty font list", () => {
    const head = collectGoogleFonts([]);

    assertEquals(
      head.links,
      PRECONNECT_LINKS,
      "empty fonts must emit only the two preconnect links, never a stylesheet",
    );
    assertEquals(head.styles, [], "empty fonts must not emit a style block");
  });

  it("omits the style block when no font declares a variable", () => {
    const head = collectGoogleFonts([{ name: "Inter", weights: [400] }]);

    assertEquals(
      head.links.find(({ rel }) => rel === "stylesheet")?.href,
      "https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap",
      "stylesheet link is still emitted without a variable",
    );
    assertEquals(head.styles, [], "no variable means no @layer base style block");
  });

  it("rejects empty, out-of-range, descending, and overlapping weights", () => {
    assertThrows(
      () => collectGoogleFonts([{ name: "Inter", weights: [] }]),
      RangeError,
      "must not be empty",
      "an empty weights array must be rejected",
    );
    assertThrows(
      () => collectGoogleFonts([{ name: "Inter", weights: [5000] }]),
      RangeError,
      "between 1 and 1000",
      "numeric weights above 1000 must be rejected",
    );
    assertThrows(
      () => collectGoogleFonts([{ name: "Inter", weights: ["0..400"] }]),
      RangeError,
      "between 1 and 1000",
      "range bounds below 1 must be rejected",
    );
    assertThrows(
      () => collectGoogleFonts([{ name: "Inter", weights: ["700..400"] }]),
      RangeError,
      "ordered from low to high",
      "descending ranges must be rejected",
    );
    assertThrows(
      () => collectGoogleFonts([{ name: "Inter", weights: [400, 400] }]),
      RangeError,
      "must not overlap or repeat",
      "repeated weights must be rejected",
    );
    assertThrows(
      () => collectGoogleFonts([{ name: "Inter", weights: ["300..500", 400] }]),
      RangeError,
      "must not overlap or repeat",
      "a weight inside an existing range must be rejected",
    );
  });

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
      head.links,
      [
        ...PRECONNECT_LINKS,
        {
          rel: "stylesheet",
          href:
            "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;700&family=Source+Serif+4:ital,wght@0,200..900;1,200..900&display=swap",
        },
      ],
      "both Google Fonts preconnect links must precede the stylesheet",
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

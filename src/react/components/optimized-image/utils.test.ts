import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateBlurDataURL, getAspectRatioPadding } from "./utils.tsx";

function decodeBlurSvg(dataUrl: string): string {
  const prefix = "data:image/svg+xml;base64,";
  assertStringIncludes(dataUrl, prefix);
  const binary = atob(dataUrl.slice(prefix.length));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

describe("optimized image utilities", () => {
  it("generates a UTF-8-safe blur placeholder and escapes SVG attributes", () => {
    const svg = decodeBlurSvg(
      generateBlurDataURL(12, 8, 'café & <unsafe> "value"'),
    );

    assertStringIncludes(svg, 'viewBox="0 0 12 8"');
    assertStringIncludes(
      svg,
      'fill="café &amp; &lt;unsafe&gt; &quot;value&quot;"',
    );
    assertEquals(svg.includes("<unsafe>"), false);
  });

  it("rejects invalid dimensions instead of emitting invalid CSS or SVG", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assertThrows(
        () => generateBlurDataURL(value, 10),
        TypeError,
        "Blur image width must be a positive finite number",
      );
      assertThrows(
        () => getAspectRatioPadding(10, value),
        TypeError,
        "Image height must be a positive finite number",
      );
      assertThrows(
        () => generateBlurDataURL(10, value),
        TypeError,
        "Blur image height must be a positive finite number",
      );
      assertThrows(
        () => getAspectRatioPadding(value, 10),
        TypeError,
        "Image width must be a positive finite number",
      );
    }
  });

  it("calculates aspect-ratio padding for valid dimensions", () => {
    assertEquals(getAspectRatioPadding(16, 9), "56.25%");
  });

  it("bounds placeholder color input", () => {
    assertThrows(
      () => generateBlurDataURL(10, 10, "x".repeat(1_025)),
      TypeError,
      "Blur image color must not exceed 1024 characters",
    );
    assertThrows(
      () => generateBlurDataURL(10, 10, "url(https://tracker.invalid/pixel)"),
      TypeError,
      "must not contain XML control characters or resource URLs",
    );
    for (const forbidden of ["\u0000", "\u000b", "\ufffe", "\uffff"]) {
      assertThrows(
        () => generateBlurDataURL(10, 10, forbidden),
        TypeError,
        "must not contain XML control characters or resource URLs",
      );
    }
  });
});

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertSafeIntegrationIconSvg } from "./icon-validation.ts";

describe("assertSafeIntegrationIconSvg", () => {
  it("accepts inert SVGs and internal paint references", () => {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">',
      '<defs><linearGradient id="paint"><stop stop-color="#fff"/></linearGradient></defs>',
      '<path fill="url(#paint)" d="M0 0h10v10H0z"/>',
      "</svg>",
    ].join("");

    assertEquals(assertSafeIntegrationIconSvg(svg), svg);
  });

  it("rejects active content and external resource references", () => {
    for (
      const svg of [
        "<svg><script>alert(1)</script></svg>",
        '<svg onload="alert(1)"><path/></svg>',
        '<svg><image href="https://private.test/icon.png"/></svg>',
        '<svg><path fill="url(https://private.test/paint)"/></svg>',
        "<svg><style>@import url(https://private.test/style.css)</style></svg>",
        '<svg><path style="fill:u&#114;l(jav&#97;script:alert(1))"/></svg>',
        '<!DOCTYPE svg [<!ENTITY payload SYSTEM "file:///private">]><svg/>',
      ]
    ) {
      assertThrows(() => assertSafeIntegrationIconSvg(svg), TypeError);
    }
  });

  it("rejects malformed roots and oversized SVGs", () => {
    assertThrows(() => assertSafeIntegrationIconSvg("<div>not an icon</div>"), TypeError);
    assertThrows(
      () => assertSafeIntegrationIconSvg(`<svg>${" ".repeat(256 * 1024)}</svg>`),
      TypeError,
    );
  });
});

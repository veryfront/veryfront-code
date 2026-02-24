import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateTrustedHtml } from "./html-sanitizer.ts";

describe("validateTrustedHtml", () => {
  describe("allows safe HTML", () => {
    it("passes clean SVG through", () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>';
      assertEquals(validateTrustedHtml(svg, { strict: true }), svg);
    });

    it("passes normal HTML elements", () => {
      const html = "<div><p>Hello <strong>world</strong></p></div>";
      assertEquals(validateTrustedHtml(html, { strict: true }), html);
    });
  });

  describe("blocks inline scripts", () => {
    it("throws on script tags in SVG", () => {
      const svg = '<svg><script>alert("xss")</script></svg>';
      assertThrows(
        () => validateTrustedHtml(svg, { strict: true }),
        Error,
        "inline script",
      );
    });

    it("throws on script tags with attributes", () => {
      const svg = '<svg><script type="text/javascript">alert(1)</script></svg>';
      assertThrows(
        () => validateTrustedHtml(svg, { strict: true }),
        Error,
        "inline script",
      );
    });
  });

  describe("blocks javascript: URLs", () => {
    it("throws on javascript: in href", () => {
      const svg = '<svg><a href="javascript:alert(1)"><text>click</text></a></svg>';
      assertThrows(
        () => validateTrustedHtml(svg, { strict: true }),
        Error,
        "javascript: URL",
      );
    });
  });

  describe("blocks event handlers", () => {
    it("throws on onload attribute", () => {
      const svg = '<svg onload="alert(1)"><rect/></svg>';
      assertThrows(
        () => validateTrustedHtml(svg, { strict: true }),
        Error,
        "event handler",
      );
    });

    it("throws on onerror attribute", () => {
      const html = '<img onerror="alert(1)" src="x">';
      assertThrows(
        () => validateTrustedHtml(html, { strict: true }),
        Error,
        "event handler",
      );
    });

    it("throws on onclick attribute", () => {
      const svg = '<svg><rect onclick="alert(1)"/></svg>';
      assertThrows(
        () => validateTrustedHtml(svg, { strict: true }),
        Error,
        "event handler",
      );
    });
  });

  describe("blocks data: HTML URLs", () => {
    it("throws on data:text/html", () => {
      const html = '<iframe src="data: text/html,<h1>injected</h1>">';
      assertThrows(
        () => validateTrustedHtml(html, { strict: true }),
        Error,
        "data: HTML URL",
      );
    });
  });
});

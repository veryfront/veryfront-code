import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { jsonForInlineScript, validateTrustedHtml } from "./html-sanitizer.ts";

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

  describe("allows inline scripts only when explicitly requested", () => {
    it("passes framework-managed script tags with allowInlineScripts", () => {
      const html =
        '<div><script nonce="">document.documentElement.dataset.theme="dark"</script></div>';
      assertEquals(validateTrustedHtml(html, { allowInlineScripts: true, strict: true }), html);
    });

    it("still blocks javascript: URLs when inline scripts are allowed", () => {
      const html = '<div><script>init()</script><a href="javascript:alert(1)">link</a></div>';
      assertThrows(
        () => validateTrustedHtml(html, { allowInlineScripts: true, strict: true }),
        Error,
        "javascript: URL",
      );
    });

    it("still blocks event handlers when inline scripts are allowed", () => {
      const html = '<div><script>init()</script><button onclick="alert(1)">Open</button></div>';
      assertThrows(
        () => validateTrustedHtml(html, { allowInlineScripts: true, strict: true }),
        Error,
        "event handler",
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

  describe("default (no options) call shape", () => {
    // Every case above opts into strict mode, but the three innerHTML sinks
    // (rsc/client-dom.ts, rsc/client-boot.ts, routing/client/page-transition.ts)
    // call this with no options at all, so the no-options shape is pinned here.
    //
    // The dev/production arms of that shape cannot be pinned from a unit test:
    // the module-private isDevMode() reads globalThis.__VERYFRONT_DEV__ and
    // Deno.env.get("VERYFRONT_ENV") directly and the options bag exposes no
    // override, so those arms live in
    // tests/integration/security/html-sanitizer-dev-mode.test.ts.
    it("returns clean HTML unchanged when called without options", () => {
      const html = "<div><p>Hello <strong>world</strong></p></div>";
      assertEquals(
        validateTrustedHtml(html),
        html,
        "production callers pass no options and must get their HTML back untouched",
      );
    });

    it("throws in strict mode even when warnings are disabled", () => {
      assertThrows(
        () => validateTrustedHtml('<svg onload="alert(1)"></svg>', { strict: true, warn: false }),
        Error,
        "event handler",
        "warn only controls logging; strict alone decides whether the call throws",
      );
    });
  });
});

describe("jsonForInlineScript", () => {
  it("escapes script-breaking and JavaScript separator characters", () => {
    const value = {
      script: "</script><script>alert(1)</script>",
      separators: "\u2028\u2029",
      ampersand: "a&b",
    };

    const result = jsonForInlineScript(value);

    assertEquals(result.includes("</script>"), false);
    assertEquals(result.includes("<script>"), false);
    assertEquals(result.includes("\u2028"), false);
    assertEquals(result.includes("\u2029"), false);
    assertStringIncludes(result, "\\u003c/script\\u003e");
    assertStringIncludes(result, "\\u2028");
    assertStringIncludes(result, "\\u2029");
    assertStringIncludes(result, "\\u0026");
    assertEquals(JSON.parse(result), value);
  });

  it("rejects top-level values that JSON cannot serialize", () => {
    for (const value of [undefined, () => undefined, Symbol("value")]) {
      assertThrows(
        () => jsonForInlineScript(value),
        TypeError,
        "must be JSON-serializable",
      );
    }
  });
});

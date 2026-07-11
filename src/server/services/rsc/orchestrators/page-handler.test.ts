import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PageHandler } from "./page-handler.ts";

describe("server/services/rsc/orchestrators/page-handler", () => {
  describe("handle", () => {
    it("should return HTML response with correct content type", () => {
      const handler = new PageHandler();
      const response = handler.handle("/test", new URLSearchParams());
      assertEquals(response.headers.get("content-type"), "text/html; charset=utf-8");
    });

    it("should return 200 status", () => {
      const handler = new PageHandler();
      const response = handler.handle("/test", new URLSearchParams());
      assertEquals(response.status, 200);
    });

    it("should include render URL for the given pathname", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/about", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.includes("/_veryfront/rsc/render/about"), true);
    });

    it("does not replace a failed route render with the generic payload endpoint", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/about", new URLSearchParams());
      const html = await response.text();

      assertEquals(html.includes("fetchPayload('/_veryfront/rsc/payload')"), false);
    });

    it("should include query string in render URL", async () => {
      const handler = new PageHandler();
      const params = new URLSearchParams({ name: "World", id: "42" });
      const response = handler.handle("/page", params);
      const html = await response.text();
      assertEquals(html.includes("name=World"), true);
      assertEquals(html.includes("id=42"), true);
    });

    it("should not include query separator when no search params", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/page", new URLSearchParams());
      const html = await response.text();
      // The render URL should not have a ? when no params
      assertEquals(html.includes("/_veryfront/rsc/render/page?"), false);
    });

    it("should include rsc-root div", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.includes('id="rsc-root"'), true);
    });

    it("should include dev mode flag", async () => {
      const handler = new PageHandler(true);
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.includes("window.__VERYFRONT_DEV__ = true"), true);
    });

    it("disables dev mode for non-local responses", async () => {
      const handler = new PageHandler(false);
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();

      assertEquals(html.includes("window.__VERYFRONT_DEV__ = false"), true);
      assertEquals(html.includes("window.__VERYFRONT_DEV__ = true"), false);
    });

    it("publishes the configured React version and module strategy for hydration", async () => {
      const handler = new PageHandler(false, "18.3.1", "rsc-module");
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();

      assertEquals(html.includes('id="veryfront-hydration-data"'), true);
      assertEquals(html.includes('"reactVersion":"18.3.1"'), true);
      assertEquals(html.includes('"clientModuleStrategy":"rsc-module"'), true);
      assertEquals(html.includes('"dev":false'), true);
    });

    it("should not include legacy hydrate.js import", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.includes("/_veryfront/rsc/hydrate.js"), false);
    });

    it("should import the canonical client in hydrate-only mode after payload injection", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.includes("import('/_veryfront/rsc/client.js?hydrate=1')"), true);
    });

    it("should add nonce attributes to inline scripts when provided", async () => {
      const handler = new PageHandler(true);
      const response = handler.handle("/", new URLSearchParams(), "nonce-123");
      const html = await response.text();

      assertEquals(
        html.includes('<script nonce="nonce-123">window.__VERYFRONT_DEV__ = true;</script>'),
        true,
      );
      assertEquals(html.includes('<script type="module" nonce="nonce-123">'), true);
    });

    it("should include security validation function", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.includes("validateTrustedHtml"), true);
    });

    it("should be a valid HTML document", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.startsWith("<!DOCTYPE html>"), true);
      assertEquals(html.includes("<html"), true);
      assertEquals(html.includes("</html>"), true);
    });
  });

  describe("reflected XSS hardening (VULN-INJ-1)", () => {
    it("should not allow single-quote pathname to break out of the JS string literal", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/x';alert(1);//", new URLSearchParams());
      const html = await response.text();
      // The known-bad pattern: the original code emitted
      //   const renderUrl = '/_veryfront/rsc/renderx';alert(1);//';
      // which closes the single-quoted JS string literal and executes alert(1).
      assertEquals(
        html.includes("'/_veryfront/rsc/renderx';alert(1);//'"),
        false,
        "unescaped single quote leaked into inline script",
      );
      // The exploit payload `;alert(1);//` must only appear as inert characters
      // *inside* the JSON string, never as JS tokens after a closing quote.
      assertEquals(
        /=\s*'[^']*';alert\(1\)/.test(html),
        false,
        "alert(1) payload escaped the JSON string literal",
      );
      assertEquals(
        /=\s*"[^"]*";\s*alert\(1\)/.test(html),
        false,
        "alert(1) payload escaped the JSON string literal (double-quoted)",
      );
    });

    it("should not allow </script> injection to break out of the inline <script> block", async () => {
      const handler = new PageHandler();
      const response = handler.handle(
        "/a</script><script>alert(2)</script>",
        new URLSearchParams(),
      );
      const html = await response.text();
      // The injected `</script>` (literal lowercase with no leading backslash)
      // must not appear on the renderUrl assignment line - the `<` must be
      // encoded as \u003c inside the JSON string.
      const renderUrlLine = html
        .split("\n")
        .find((line) => line.includes("const renderUrl ="));
      assertEquals(renderUrlLine !== undefined, true);
      assertEquals(
        renderUrlLine!.includes("</script>"),
        false,
        "</script> must not appear on the renderUrl line",
      );
      assertEquals(
        renderUrlLine!.includes("<script>"),
        false,
        "<script> must not appear on the renderUrl line",
      );
    });

    it("should defeat </SCRIPT > case/space variants used by browser parsers", async () => {
      const handler = new PageHandler();
      const response = handler.handle(
        "/a</SCRIPT ><script>alert('case')</script>",
        new URLSearchParams(),
      );
      const html = await response.text();
      const renderUrlLine = html
        .split("\n")
        .find((line) => line.includes("const renderUrl ="));
      assertEquals(renderUrlLine !== undefined, true);
      // Case-insensitive check: no `</script...` variant may appear on the
      // renderUrl line since `<` is `\u003c`.
      assertEquals(
        /<\/script/i.test(renderUrlLine!),
        false,
        "case-variant </SCRIPT must not appear on the renderUrl line",
      );
    });

    it("should defeat <ScRiPt> mixed-case breakout attempts", async () => {
      const handler = new PageHandler();
      const response = handler.handle(
        "/a<ScRiPt>alert('mixed')</ScRiPt>",
        new URLSearchParams(),
      );
      const html = await response.text();
      const renderUrlLine = html
        .split("\n")
        .find((line) => line.includes("const renderUrl ="));
      assertEquals(renderUrlLine !== undefined, true);
      // No additional `<script...` opening tags (any case) on the renderUrl line.
      assertEquals(
        /<script/i.test(renderUrlLine!),
        false,
        "mixed-case <ScRiPt> must not appear on the renderUrl line",
      );
    });

    it("should block <!--<script> HTML comment breakout attempts", async () => {
      const handler = new PageHandler();
      const response = handler.handle(
        "/a<!--<script>alert('comment')</script>",
        new URLSearchParams(),
      );
      const html = await response.text();
      // The only `<!--` tokens allowed are inside our own comments (we emit none
      // in this template). Inside the JSON-encoded renderUrl string, `<` must
      // be encoded as \u003c so `<!--` cannot appear literally.
      assertEquals(
        html.includes("<!--"),
        false,
        "raw <!-- HTML comment must not appear in output",
      );
      // And the injected `<script>` opener must not appear on the renderUrl line.
      const renderUrlLine = html
        .split("\n")
        .find((line) => line.includes("const renderUrl ="));
      assertEquals(renderUrlLine !== undefined, true);
      assertEquals(
        /<script/i.test(renderUrlLine!),
        false,
        "<script breakout must not appear on the renderUrl line",
      );
    });

    it("should escape U+2028 as \\u2028 (JS line terminator in older browsers)", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/a\u2028b", new URLSearchParams());
      const html = await response.text();
      assertEquals(
        html.includes("\u2028"),
        false,
        "raw U+2028 must be escaped in inline <script>",
      );
      assertEquals(html.includes("\\u2028"), true, "U+2028 should render as \\u2028");
    });

    it("should escape U+2029 as \\u2029 (JS line terminator in older browsers)", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/a\u2029b", new URLSearchParams());
      const html = await response.text();
      assertEquals(
        html.includes("\u2029"),
        false,
        "raw U+2029 must be escaped in inline <script>",
      );
      assertEquals(html.includes("\\u2029"), true, "U+2029 should render as \\u2029");
    });

    it("should encode & as \\u0026 in the inline script (defense-in-depth)", async () => {
      const handler = new PageHandler();
      const params = new URLSearchParams({ a: "1&evil" });
      const response = handler.handle("/p&q", params);
      const html = await response.text();
      // Extract the inline <script type="module"> body (best-effort).
      const scriptStart = html.indexOf('<script type="module"');
      const scriptBody = html.slice(scriptStart);
      const endIdx = scriptBody.indexOf("</script>");
      const inlineBody = scriptBody.slice(0, endIdx);
      assertEquals(
        inlineBody.includes("&"),
        false,
        "raw & must not appear inside inline script",
      );
      assertEquals(
        inlineBody.includes("\\u0026"),
        true,
        "& should be JSON-encoded as \\u0026",
      );
    });

    it("should JSON-encode null bytes without terminating the string", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/a\x00b", new URLSearchParams());
      const html = await response.text();
      // JSON encodes NUL as \u0000; no raw NUL in the body.
      assertEquals(html.includes("\x00"), false, "raw NUL byte leaked into HTML");
      assertEquals(html.includes("\\u0000"), true, "NUL should render as \\u0000");
    });

    it("should keep backslashes inside the JSON string literal", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/a\\b'c", new URLSearchParams());
      const html = await response.text();
      // Backslash must be doubled so the JS literal is still valid.
      assertEquals(
        html.includes("\\\\"),
        true,
        "backslash should be escaped as \\\\ inside the JSON literal",
      );
      // The renderUrl must be enclosed in a double-quoted JSON string (JSON
      // never uses single quotes), preventing the lone `'` from breaking out.
      const renderUrlLine = html
        .split("\n")
        .find((line) => line.includes("const renderUrl ="));
      assertEquals(renderUrlLine !== undefined, true);
      assertEquals(
        renderUrlLine!.includes('"'),
        true,
        "renderUrl line must use double quotes (JSON literal)",
      );
    });

    it("should escape newline and carriage return in the pathname", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/a\r\nalert(4)", new URLSearchParams());
      const html = await response.text();
      const scriptStart = html.indexOf('<script type="module"');
      const scriptBody = html.slice(scriptStart);
      const endIdx = scriptBody.indexOf("</script>");
      const inlineBody = scriptBody.slice(0, endIdx);
      // Raw CR/LF would terminate a JS string literal.
      assertEquals(inlineBody.includes("\r"), false, "raw CR leaked into inline script");
      // The JSON-encoded URL must contain the escapes.
      assertEquals(inlineBody.includes("\\r"), true, "CR should be escaped as \\r");
      assertEquals(inlineBody.includes("\\n"), true, "LF should be escaped as \\n");
    });

    it("should render unicode/emoji pathnames without corruption", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/hello-\u{1F600}", new URLSearchParams());
      const html = await response.text();
      // The emoji should round-trip (either literal or JSON \uXXXX surrogate pair).
      const hasLiteral = html.includes("\u{1F600}");
      const hasEscaped = html.includes("\\ud83d\\ude00") || html.includes("\\uD83D\\uDE00");
      assertEquals(
        hasLiteral || hasEscaped,
        true,
        "emoji pathname should round-trip (literal or JSON-escaped)",
      );
      // And the document must still be valid.
      assertEquals(html.startsWith("<!DOCTYPE html>"), true);
    });

    it("should render an empty pathname without producing broken script", async () => {
      const handler = new PageHandler();
      const response = handler.handle("", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.startsWith("<!DOCTYPE html>"), true);
      // The URL should be the JSON-encoded empty-path variant.
      assertEquals(
        html.includes('"/_veryfront/rsc/render"'),
        true,
        "empty pathname should produce a bare render URL",
      );
    });

    it("should JSON-encode a malicious query string", async () => {
      const handler = new PageHandler();
      // URLSearchParams percent-encodes most things, but let's stress the
      // pipeline end-to-end: the rendered string must not contain raw '.
      const params = new URLSearchParams();
      params.set("q", "';alert(5);//");
      const response = handler.handle("/page", params);
      const html = await response.text();
      const scriptStart = html.indexOf('<script type="module"');
      const scriptBody = html.slice(scriptStart);
      const endIdx = scriptBody.indexOf("</script>");
      const inlineBody = scriptBody.slice(0, endIdx);
      assertEquals(
        inlineBody.includes("alert(5)"),
        false,
        "query-string payload executed outside of JSON-encoded string",
      );
      // Whatever URLSearchParams produced, it must live inside a quoted JSON string.
      assertEquals(
        /renderUrl\s*=\s*"/.test(inlineBody),
        true,
        "renderUrl must be assigned from a double-quoted JSON string literal",
      );
    });

    it("should assign renderUrl from a JSON string (double quotes), not a single-quoted literal", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/ok", new URLSearchParams());
      const html = await response.text();
      assertEquals(
        /const\s+renderUrl\s*=\s*'/.test(html),
        false,
        "single-quoted renderUrl literal is the known-bad pattern",
      );
      assertEquals(
        /const\s+renderUrl\s*=\s*"[^"]*";/.test(html),
        true,
        "renderUrl should be a double-quoted JSON string",
      );
    });
  });
});

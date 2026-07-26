import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { injectElementSelectors, isStudioEmbed } from "./element-selector-injector.ts";

describe("studio/element-selector-injector", () => {
  describe("injectElementSelectors", () => {
    it("should inject data-vf-selector into elements", () => {
      const html = `<div id="root"><p>Hello</p></div>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes('data-vf-selector="vf-div-1"'), true);
      assertEquals(result.includes('data-vf-selector="vf-p-2"'), true);
    });

    it("should skip script elements", () => {
      const html = `<div id="root"><script>alert(1)</script></div>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes('data-vf-selector="vf-script'), false);
    });

    it("should skip style elements", () => {
      const html = `<div id="root"><style>body{}</style></div>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes('data-vf-selector="vf-style'), false);
    });

    it("should use custom prefix", () => {
      const html = `<div id="root"><span>Hi</span></div>`;
      const result = injectElementSelectors(html, { prefix: "test" });

      assertEquals(result.includes('data-vf-selector="test-'), true);
    });

    it("should skip elements with data-vf-ignore", () => {
      const html = `<div id="root"><div data-vf-ignore>skip</div></div>`;
      const result = injectElementSelectors(html);

      assertEquals((result.match(/data-vf-selector/g) ?? []).length, 1);
    });

    it("should handle void elements", () => {
      const html = `<div id="root"><img src="test.png"><br></div>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes('data-vf-selector="vf-img-'), true);
    });

    it("should skip custom elements", () => {
      const html = `<div id="root"><section><p>content</p></section><p>kept</p></div>`;
      const result = injectElementSelectors(html, { skipElements: ["section"] });

      assertEquals(result.includes('data-vf-selector="vf-section'), false);
      assertEquals(result.includes("content</p>"), true);
      assertEquals((result.match(/data-vf-selector=/g) ?? []).length, 2);
    });

    it("rewrites a full document without treating html as an ignored subtree", () => {
      const html = `<!doctype html><html><head><script>const fake = "<div>";</script></head>` +
        `<body><div id="root"><main data-label="a > b"><p>Hello</p></main></div></body></html>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes('data-vf-selector="vf-main-2"'), true);
      assertEquals(result.includes('data-label="a > b" data-vf-selector='), true);
      assertEquals(result.includes("vf-script"), false);
      assertEquals(result.includes('const fake = "<div data-vf-selector='), false);
    });

    it("injects only the root subtree when a root is present", () => {
      const html =
        `<aside>before</aside><div class="shell" id='root'><p>inside</p></div><footer>after</footer>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes("vf-aside"), false);
      assertEquals(result.includes('data-vf-selector="vf-div-1"'), true);
      assertEquals(result.includes('data-vf-selector="vf-p-2"'), true);
      assertEquals(result.includes("vf-footer"), false);
    });

    it("ignores comments, raw text, and data-vf-ignore subtrees", () => {
      const html = `<!-- <div id="root"><p>fake</p></div> -->` +
        `<div id=root><textarea><span>text</span></textarea>` +
        `<div data-vf-ignore><p>ignored</p></div><p>kept</p></div>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes("vf-span"), false);
      assertEquals(result.includes("vf-textarea"), true);
      assertEquals(result.includes("vf-div-"), true);
      assertEquals(result.includes("vf-p-3"), true);
      assertEquals((result.match(/data-vf-selector=/g) ?? []).length, 3);
    });

    it("preserves Unicode raw text offsets and the non-terminating plaintext state", () => {
      const html = `<div id=root><textarea>İ<span>text</span></TEXTAREA>` +
        `<p>kept</p><plaintext><p>not markup</p></plaintext><p>also text</p></div>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes("İ<span>text</span></TEXTAREA>"), true);
      assertEquals(result.includes('<p data-vf-selector="vf-p-3">kept</p>'), true);
      assertEquals(result.includes("vf-span"), false);
      assertEquals(result.includes("vf-plaintext-4"), true);
      assertEquals(result.includes("vf-p-5"), false);
    });

    it("matches selector-control attributes by name rather than attribute text", () => {
      const html = `<div id="root"><p data-info="data-vf-ignore">kept</p>` +
        `<p data-vf-id="authored">owned</p></div>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes('data-info="data-vf-ignore" data-vf-selector='), true);
      assertEquals((result.match(/data-vf-selector=/g) ?? []).length, 2);
    });

    it("avoids collisions with authored selector identifiers", () => {
      const html = `<div id="root"><p data-vf-selector="vf-p-2">authored</p><p>generated</p></div>`;
      const result = injectElementSelectors(html);

      assertEquals(result.includes('data-vf-selector="vf-div-1"'), true);
      assertEquals(result.includes('data-vf-selector="vf-p-2"'), true);
      assertEquals(result.includes('data-vf-selector="vf-p-3"'), true);
    });

    it("rejects unsafe or accessor-backed options without executing accessors", () => {
      assertThrows(
        () =>
          injectElementSelectors(`<div id="root"></div>`, {
            prefix: `unsafe" onclick="alert(1)`,
          }),
        TypeError,
        "prefix",
      );

      let getterCalls = 0;
      const options = Object.defineProperty({}, "prefix", {
        enumerable: true,
        get() {
          getterCalls++;
          return "unsafe";
        },
      });
      assertThrows(
        () => injectElementSelectors(`<div id="root"></div>`, options),
        TypeError,
        "data properties",
      );
      assertEquals(getterCalls, 0);
    });

    it("preserves malformed trailing markup instead of corrupting it", () => {
      const html = `<div id="root"><p title="unterminated>text`;
      assertEquals(
        injectElementSelectors(html),
        `<div id="root" data-vf-selector="vf-div-1"><p title="unterminated>text`,
      );
    });
  });

  describe("isStudioEmbed", () => {
    it("should return true when studio_embed=true", () => {
      assertEquals(isStudioEmbed("http://localhost:3000?studio_embed=true"), true);
    });

    it("should return false when param is missing", () => {
      assertEquals(isStudioEmbed("http://localhost:3000"), false);
    });

    it("should return false when param is not true", () => {
      assertEquals(isStudioEmbed("http://localhost:3000?studio_embed=false"), false);
    });

    it("should accept URL object", () => {
      assertEquals(isStudioEmbed(new URL("http://localhost:3000?studio_embed=true")), true);
    });

    it("should fail closed for malformed URL strings", () => {
      assertEquals(isStudioEmbed("not a URL"), false);
    });
  });
});

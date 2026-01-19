import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isFullHTMLDocument } from "./html-detection.ts";

describe("html-detection", () => {
  describe("isFullHTMLDocument", () => {
    it("should detect full HTML5 document", () => {
      const html = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>Content</body>
</html>`;
      assertEquals(isFullHTMLDocument(html), true);
    });

    it("should detect HTML document with lang attribute", () => {
      const html = `<!doctype html>
<html lang="en">
<head></head>
<body></body>
</html>`;
      assertEquals(isFullHTMLDocument(html), true);
    });

    it("should be case-insensitive for doctype", () => {
      const html = `<!DOCTYPE HTML>
<HTML>
<HEAD></HEAD>
<BODY></BODY>
</HTML>`;
      assertEquals(isFullHTMLDocument(html), true);
    });

    it("should handle lowercase doctype", () => {
      const html = `<!doctype html><html><head></head><body></body></html>`;
      assertEquals(isFullHTMLDocument(html), true);
    });

    it("should return false for fragment without doctype", () => {
      const html = `<html><head></head><body></body></html>`;
      assertEquals(isFullHTMLDocument(html), false);
    });

    it("should return false for simple div", () => {
      const html = `<div>Hello World</div>`;
      assertEquals(isFullHTMLDocument(html), false);
    });

    it("should return false for React component output", () => {
      const html = `<div id="root"><h1>Welcome</h1><p>Content here</p></div>`;
      assertEquals(isFullHTMLDocument(html), false);
    });

    it("should return false for empty string", () => {
      assertEquals(isFullHTMLDocument(""), false);
    });

    it("should return false for doctype without html tags", () => {
      const html = `<!DOCTYPE html><div>No html tags</div>`;
      assertEquals(isFullHTMLDocument(html), false);
    });

    it("should return false for doctype without closing html tag", () => {
      const html = `<!DOCTYPE html><html><body>Missing closing</body>`;
      assertEquals(isFullHTMLDocument(html), false);
    });

    it("should handle whitespace before doctype", () => {
      const html = `
  <!DOCTYPE html>
<html><head></head><body></body></html>`;
      assertEquals(isFullHTMLDocument(html), true);
    });

    it("should return false for content containing html tags as text", () => {
      const html = `<p>Learn about <html></html> tags</p>`;
      assertEquals(isFullHTMLDocument(html), false);
    });
  });
});

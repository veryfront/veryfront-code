import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { isFullHTMLDocument } from "./html-detection.ts";

describe("html-detection", () => {
  describe("isFullHTMLDocument", () => {
    it("should return true for complete HTML document", () => {
      const html = `<!DOCTYPE html>
<html>
  <head><title>Test</title></head>
  <body>Content</body>
</html>`;
      assertEquals(isFullHTMLDocument(html), true);
    });

    it("should return true for minimal HTML document", () => {
      const html = "<html></html>";
      assertEquals(isFullHTMLDocument(html), true);
    });

    it("should return true for HTML document with whitespace", () => {
      const html = "  \n  <html>\n  <body>Content</body>\n  </html>  \n  ";
      assertEquals(isFullHTMLDocument(html), true);
    });

    it("should return true for uppercase HTML tags", () => {
      const html = "<HTML><BODY>Content</BODY></HTML>";
      assertEquals(isFullHTMLDocument(html), true);
    });

    it("should return true for mixed case HTML tags", () => {
      const html = "<HtMl><body>Content</body></HtMl>";
      assertEquals(isFullHTMLDocument(html), true);
    });

    it("should return false for fragment without html tags", () => {
      const html = "<div>Some content</div>";
      assertEquals(isFullHTMLDocument(html), false);
    });

    it("should return false for content without closing html tag", () => {
      const html = "<html><body>Content</body>";
      assertEquals(isFullHTMLDocument(html), false);
    });

    it("should return false for content without opening html tag", () => {
      const html = "<body>Content</body></html>";
      assertEquals(isFullHTMLDocument(html), false);
    });

    it("should return false for empty string", () => {
      const html = "";
      assertEquals(isFullHTMLDocument(html), false);
    });

    it("should return false for whitespace only", () => {
      const html = "   \n  \t  ";
      assertEquals(isFullHTMLDocument(html), false);
    });

    it("should return false for plain text content", () => {
      const html = "This is just plain text content";
      assertEquals(isFullHTMLDocument(html), false);
    });

    it("should return false for HTML-like text in string", () => {
      const html = "The <html> tag should be lowercase and needs </html> too";
      assertEquals(isFullHTMLDocument(html), false); // Must start with DOCTYPE or <html tag
    });

    it("should handle HTML with attributes", () => {
      const html = '<html lang="en" dir="ltr"><body>Content</body></html>';
      assertEquals(isFullHTMLDocument(html), true);
    });

    it("should handle HTML with DOCTYPE", () => {
      const html = '<!DOCTYPE html><html><head></head><body></body></html>';
      assertEquals(isFullHTMLDocument(html), true);
    });
  });
});

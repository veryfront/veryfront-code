import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isFullHTMLDocument } from "./html-detection.ts";

type TestCase = { name: string; html: string; expected: boolean };

describe("html-detection", () => {
  describe("isFullHTMLDocument", () => {
    const cases: TestCase[] = [
      {
        name: "should detect full HTML5 document",
        html: `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>Content</body>
</html>`,
        expected: true,
      },
      {
        name: "should detect HTML document with lang attribute",
        html: `<!doctype html>
<html lang="en">
<head></head>
<body></body>
</html>`,
        expected: true,
      },
      {
        name: "should be case-insensitive for doctype",
        html: `<!DOCTYPE HTML>
<HTML>
<HEAD></HEAD>
<BODY></BODY>
</HTML>`,
        expected: true,
      },
      {
        name: "should handle lowercase doctype",
        html: `<!doctype html><html><head></head><body></body></html>`,
        expected: true,
      },
      {
        name: "should return false for fragment without doctype",
        html: `<html><head></head><body></body></html>`,
        expected: false,
      },
      {
        name: "should return false for simple div",
        html: `<div>Hello World</div>`,
        expected: false,
      },
      {
        name: "should return false for React component output",
        html: `<div id="root"><h1>Welcome</h1><p>Content here</p></div>`,
        expected: false,
      },
      {
        name: "should return false for empty string",
        html: "",
        expected: false,
      },
      {
        name: "should return false for doctype without html tags",
        html: `<!DOCTYPE html><div>No html tags</div>`,
        expected: false,
      },
      {
        name: "should return false for doctype without closing html tag",
        html: `<!DOCTYPE html><html><body>Missing closing</body>`,
        expected: false,
      },
      {
        name: "should handle whitespace before doctype",
        html: `
  <!DOCTYPE html>
<html><head></head><body></body></html>`,
        expected: true,
      },
      {
        name: "should return false for content containing html tags as text",
        html: `<p>Learn about <html></html> tags</p>`,
        expected: false,
      },
    ];

    for (const testCase of cases) {
      it(testCase.name, () => {
        assertEquals(isFullHTMLDocument(testCase.html), testCase.expected);
      });
    }
  });
});

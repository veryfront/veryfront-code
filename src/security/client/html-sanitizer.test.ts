import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertThrows } from "std/assert/mod.ts";
import { escapeHtml, validateTrustedHtml } from "./html-sanitizer.ts";

describe("escapeHtml", () => {
  it("should escape ampersands", () => {
    assertEquals(escapeHtml("Tom & Jerry"), "Tom &amp; Jerry");
  });

  it("should escape less than signs", () => {
    assertEquals(escapeHtml("1 < 2"), "1 &lt; 2");
  });

  it("should escape greater than signs", () => {
    assertEquals(escapeHtml("2 > 1"), "2 &gt; 1");
  });

  it("should escape double quotes", () => {
    assertEquals(escapeHtml('Say "Hello"'), "Say &quot;Hello&quot;");
  });

  it("should escape single quotes", () => {
    assertEquals(escapeHtml("It's working"), "It&#39;s working");
  });

  it("should escape multiple characters", () => {
    assertEquals(
      escapeHtml('<script>alert("XSS")</script>'),
      "&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;",
    );
  });

  it("should handle empty strings", () => {
    assertEquals(escapeHtml(""), "");
  });

  it("should handle strings without special characters", () => {
    assertEquals(escapeHtml("Hello World"), "Hello World");
  });
});

describe("validateTrustedHtml", () => {
  it("should pass clean HTML", () => {
    const cleanHtml = "<div>Hello World</div>";
    assertEquals(validateTrustedHtml(cleanHtml), cleanHtml);
  });

  it("should detect javascript: URLs", () => {
    const htmlWithJsUrl = '<a href="javascript:alert(\'XSS\')">Click</a>';
    assertThrows(
      () => validateTrustedHtml(htmlWithJsUrl),
      Error,
      "javascript: URL",
    );
  });

  it("should detect event handler attributes", () => {
    const htmlWithEvent = '<div onclick="alert(\'XSS\')">Click</div>';
    assertThrows(
      () => validateTrustedHtml(htmlWithEvent),
      Error,
      "event handler attribute",
    );
  });

  it("should detect data: HTML URLs", () => {
    const htmlWithDataUrl = '<iframe src="data:text/html,<h1>test</h1>"></iframe>';
    assertThrows(
      () => validateTrustedHtml(htmlWithDataUrl),
      Error,
      "data: HTML URL",
    );
  });
});

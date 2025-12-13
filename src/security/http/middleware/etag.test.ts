import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import { computeEtag } from "./etag.ts";

describe("computeEtag", () => {
  it("should compute etag for simple text", () => {
    const text = "Hello World";
    const etag = computeEtag(text);
    assertEquals(typeof etag, "string");
    assert(etag.startsWith('W/"'));
    assert(etag.endsWith('"'));
  });

  it("should compute consistent etags for same text", () => {
    const text = "consistent text";
    const etag1 = computeEtag(text);
    const etag2 = computeEtag(text);
    assertEquals(etag1, etag2);
  });

  it("should compute different etags for different text", () => {
    const text1 = "text one";
    const text2 = "text two";
    const etag1 = computeEtag(text1);
    const etag2 = computeEtag(text2);
    assert(etag1 !== etag2);
  });

  it("should handle empty string", () => {
    const etag = computeEtag("");
    assertEquals(typeof etag, "string");
    assert(etag.length > 0);
  });

  it("should handle long text", () => {
    const longText = "a".repeat(10000);
    const etag = computeEtag(longText);
    assertEquals(typeof etag, "string");
    assert(etag.startsWith('W/"'));
  });

  it("should handle special characters", () => {
    const text = "Hello\nWorld\t!@#$%^&*()";
    const etag = computeEtag(text);
    assertEquals(typeof etag, "string");
    assert(etag.length > 0);
  });

  it("should produce weak etag format", () => {
    const etag = computeEtag("test");
    assert(etag.startsWith('W/"'), "Should start with W/ for weak etag");
    assert(etag.match(/^W\/\"[0-9a-f]+\"$/), "Should match weak etag format");
  });

  it("should handle unicode characters", () => {
    const text = "Hello 世界 🌍";
    const etag = computeEtag(text);
    assertEquals(typeof etag, "string");
    assert(etag.length > 0);
  });

  it("should be case sensitive", () => {
    const etag1 = computeEtag("Hello");
    const etag2 = computeEtag("hello");
    assert(etag1 !== etag2);
  });
});

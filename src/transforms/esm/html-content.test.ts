import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { looksLikeHtmlContent } from "./html-content.ts";

describe("transforms/esm/html-content", () => {
  describe("looksLikeHtmlContent", () => {
    it("returns true for DOCTYPE html", () => {
      assertEquals(looksLikeHtmlContent("<!DOCTYPE html><html>..."), true);
    });

    it("returns true for DOCTYPE with leading whitespace", () => {
      assertEquals(looksLikeHtmlContent("   <!DOCTYPE html>"), true);
    });

    it("returns true for html tag", () => {
      assertEquals(looksLikeHtmlContent("<html><head>"), true);
    });

    it("returns true for HTML uppercase tag", () => {
      assertEquals(looksLikeHtmlContent("<HTML><HEAD>"), true);
    });

    it("returns true for esm.sh error page with ESM title", () => {
      assertEquals(
        looksLikeHtmlContent(
          "<html><head><title>ESM Build Error</title></head></html>",
        ),
        true,
      );
    });

    it("returns false for normal JavaScript code", () => {
      assertEquals(
        looksLikeHtmlContent("export default function App() { return 1; }"),
        false,
      );
    });

    it("returns false for empty string", () => {
      assertEquals(looksLikeHtmlContent(""), false);
    });

    it("returns true with leading newlines before DOCTYPE", () => {
      assertEquals(looksLikeHtmlContent("\n\n  <!DOCTYPE html>"), true);
    });

    it("returns false when ESM title is beyond first 500 characters", () => {
      const padding = "x".repeat(500);
      assertEquals(
        looksLikeHtmlContent(padding + "<title>ESM Error</title>"),
        false,
      );
    });
  });
});

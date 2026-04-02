import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { addNonceToHtmlTags } from "./nonce-injection.ts";

describe("html/nonce-injection", () => {
  it("adds a nonce to inline script and style tags", () => {
    const html = addNonceToHtmlTags(
      `<style>.chat{color:red}</style><script>window.__vf=1</script>`,
      "nonce-123",
    );

    assertEquals(html.includes('<style nonce="nonce-123">.chat{color:red}</style>'), true);
    assertEquals(html.includes('<script nonce="nonce-123">window.__vf=1</script>'), true);
  });

  it("does not duplicate an existing nonce attribute", () => {
    const html = addNonceToHtmlTags(
      `<script nonce="existing">window.__vf=1</script>`,
      "nonce-123",
    );

    assertEquals((html.match(/nonce="/g) ?? []).length, 1);
    assertEquals(html.includes('nonce="nonce-123" nonce="existing"'), false);
  });

  it("does not inject nonce markup into script or style literals inside scripts", () => {
    const html = addNonceToHtmlTags(
      `<script>window.tpl="<script>alert(1)";window.css="<style>.x{color:red}";</script><style>.chat{color:red}</style>`,
      "nonce-123",
    );

    assertEquals(
      html.includes(
        '<script nonce="nonce-123">window.tpl="<script>alert(1)";window.css="<style>.x{color:red}";</script>',
      ),
      true,
    );
    assertEquals(html.includes('<style nonce="nonce-123">.chat{color:red}</style>'), true);
    assertEquals(html.includes('<script nonce="nonce-123">alert(1)'), false);
    assertEquals(html.includes('<style nonce="nonce-123">.x{color:red}'), false);
  });

  it("does not terminate raw-text mode on lookalike closing-tag prefixes inside script literals", () => {
    const html = addNonceToHtmlTags(
      `<script>window.tpl="</scripture><style>.x{color:red}</style>";</script><style>.chat{color:red}</style>`,
      "nonce-123",
    );

    assertEquals(
      html.includes(
        '<script nonce="nonce-123">window.tpl="</scripture><style>.x{color:red}</style>";</script>',
      ),
      true,
    );
    assertEquals(html.includes('<style nonce="nonce-123">.chat{color:red}</style>'), true);
    assertEquals(html.includes('<style nonce="nonce-123">.x{color:red}</style>'), false);
  });

  it("does not treat data-nonce as an existing nonce attribute", () => {
    const html = addNonceToHtmlTags(
      `<script data-nonce="existing">window.__vf=1</script>`,
      "nonce-123",
    );

    assertEquals(
      html.includes('<script data-nonce="existing" nonce="nonce-123">window.__vf=1</script>'),
      true,
    );
  });
});

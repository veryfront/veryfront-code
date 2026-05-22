import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { addNonceToHtmlStream, addNonceToHtmlTags } from "./nonce-injection.ts";

async function readUtf8Stream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return result + decoder.decode();
    result += decoder.decode(value, { stream: true });
  }
}

describe("html/nonce-injection", () => {
  it("adds a nonce to inline script and style tags", () => {
    const html = addNonceToHtmlTags(
      `<style>.chat{color:red}</style><script>window.__vf=1</script>`,
      "nonce-123",
    );

    assertEquals(html.includes('<style nonce="nonce-123">.chat{color:red}</style>'), true);
    assertEquals(html.includes('<script nonce="nonce-123">window.__vf=1</script>'), true);
  });

  it("replaces an existing nonce attribute with the response nonce", () => {
    const html = addNonceToHtmlTags(
      `<script nonce="existing">window.__vf=1</script>`,
      "nonce-123",
    );

    assertEquals((html.match(/nonce="/g) ?? []).length, 1);
    assertEquals(html.includes('<script nonce="nonce-123">window.__vf=1</script>'), true);
    assertEquals(html.includes('nonce="existing"'), false);
    assertEquals(html.includes('nonce="nonce-123" nonce="existing"'), false);
  });

  it("replaces an empty nonce attribute with the response nonce", () => {
    const html = addNonceToHtmlTags(
      `<script nonce="">window.__vf=1</script><style nonce='   '>.chat{color:red}</style>`,
      "nonce-123",
    );

    assertEquals(html.includes('<script nonce="nonce-123">window.__vf=1</script>'), true);
    assertEquals(html.includes('<style nonce="nonce-123">.chat{color:red}</style>'), true);
    assertEquals(html.includes('nonce=""'), false);
    assertEquals(html.includes("nonce='   '"), false);
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

  it("ignores nonce-like text inside another attribute value", () => {
    const html = addNonceToHtmlTags(
      `<script data-info="prefix nonce='' suffix">window.__vf=1</script>`,
      "nonce-123",
    );

    assertEquals(
      html.includes(
        '<script data-info="prefix nonce=\'\' suffix" nonce="nonce-123">window.__vf=1</script>',
      ),
      true,
    );
  });

  it("adds nonces to streamed tags split across chunks", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      "<scr",
      'ipt>window.tpl="<style>.x{color:red}</style>";</script><sty',
      "le>.chat{color:red}</style>",
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const html = await readUtf8Stream(addNonceToHtmlStream(stream, "nonce-123"));

    assertEquals(
      html,
      '<script nonce="nonce-123">window.tpl="<style>.x{color:red}</style>";</script>' +
        '<style nonce="nonce-123">.chat{color:red}</style>',
    );
  });
});

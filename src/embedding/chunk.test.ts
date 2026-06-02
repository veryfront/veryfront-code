import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { chunk } from "./chunk.ts";

describe("embedding/chunk", () => {
  it("returns the whole text as one chunk when within maxChars", async () => {
    assertEquals(await chunk("short text", { maxChars: 100 }), ["short text"]);
  });

  it("returns text under the default maxChars (2000) as a single chunk", async () => {
    const text = "a".repeat(1999);
    assertEquals(await chunk(text), [text]);
  });

  it("handles empty input", async () => {
    assertEquals(await chunk(""), [""]);
  });

  it("prefers the paragraph separator and keeps paragraphs intact", async () => {
    // maxChars large enough for one paragraph but not two → split on "\n\n".
    const chunks = await chunk("para-one\n\npara-two", { maxChars: 10, overlap: 0 });
    assertEquals(chunks, ["para-one", "para-two"]);
  });

  it("splits on lines when there are no paragraph breaks", async () => {
    const chunks = await chunk("line-one\nline-two\nline-three", { maxChars: 10, overlap: 0 });
    // Each emitted chunk is within the limit and built from whole lines.
    for (const c of chunks) assertEquals(c.length <= 10, true);
    assertEquals(chunks.join("").includes("line-one"), true);
  });

  it("recurses to finer separators so no chunk exceeds maxChars", async () => {
    // A single paragraph far larger than maxChars forces recursion
    // paragraph → line → word → character.
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const maxChars = 12;
    const chunks = await chunk(text, { maxChars, overlap: 0 });
    assertEquals(chunks.length > 1, true);
    for (const c of chunks) assertEquals(c.length <= maxChars, true);
  });

  it("falls back to character splitting when a single token exceeds maxChars", async () => {
    // No separators present and one long token → char-level split (sep = "").
    const text = "x".repeat(25);
    const chunks = await chunk(text, { maxChars: 10, overlap: 0, separators: [""] });
    assertEquals(chunks.length > 1, true);
    for (const c of chunks) assertEquals(c.length <= 10, true);
    // Char-split chunks are substrings that reconstruct the original.
    assertEquals(chunks.join(""), text);
  });

  it("carries an overlap tail from each chunk into the next", async () => {
    const overlap = 3;
    const text = "abcdefghijklmnopqrstuvwxyz";
    const chunks = await chunk(text, { maxChars: 8, overlap, separators: [""] });
    assertEquals(chunks.length > 1, true);
    // Each non-first chunk begins with the trailing `overlap` chars of the prior chunk.
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1].slice(-overlap);
      assertEquals(chunks[i].startsWith(prevTail), true, `chunk ${i} should carry overlap`);
    }
  });

  it("overlap: 0 produces clean, non-cascading chunks (regression)", async () => {
    // Regression for the `slice(-0)` bug: with overlap 0 the splitter must NOT
    // carry the whole previous chunk forward (which cascaded into an explosion
    // of ever-growing duplicated chunks).
    const chunks = await chunk("a".repeat(30), { maxChars: 10, overlap: 0, separators: [""] });
    assertEquals(chunks, ["aaaaaaaaaa", "aaaaaaaaaa", "aaaaaaaaaa"]);
  });

  it("respects a custom separators list", async () => {
    // Only split on '|'; spaces are not separators here.
    const chunks = await chunk("aa|bb|cc", { maxChars: 4, overlap: 0, separators: ["|", ""] });
    for (const c of chunks) assertEquals(c.length <= 4, true);
    assertEquals(chunks.includes("aa"), true);
  });
});

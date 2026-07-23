import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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
    // maxChars is large enough for one paragraph but not two, so split on "\n\n".
    const chunks = await chunk("para-one\n\npara-two", { maxChars: 10, overlap: 0 });
    assertEquals(chunks, ["para-one", "para-two"]);
  });

  it("splits on lines when there are no paragraph breaks", async () => {
    const chunks = await chunk("line-one\nline-two\nline-three", { maxChars: 10, overlap: 0 });
    // Each emitted chunk is within the limit and built from whole lines.
    for (const c of chunks) assertEquals(c.length <= 10, true);
    assertEquals(chunks.join("").includes("line-one"), true);
  });

  it("does not emit whitespace-only chunks", async () => {
    const chunks = await chunk("x\n \ny", { maxChars: 2, overlap: 0 });

    assertEquals(chunks, ["x", "y"]);
  });

  it("recurses to finer separators so no chunk exceeds maxChars", async () => {
    // A single paragraph far larger than maxChars forces recursion
    // paragraph, line, word, then character.
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const maxChars = 12;
    const chunks = await chunk(text, { maxChars, overlap: 0 });
    assertEquals(chunks.length > 1, true);
    for (const c of chunks) assertEquals(c.length <= maxChars, true);
  });

  it("falls back to character splitting when a single token exceeds maxChars", async () => {
    // No separators are present, so one long token uses character-level splitting.
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
      const prevTail = chunks[i - 1]!.slice(-overlap);
      assertEquals(chunks[i]!.startsWith(prevTail), true, `chunk ${i} should carry overlap`);
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

  it("keeps custom-separator chunks within maxChars when overlap is enabled", async () => {
    const chunks = await chunk("aaaa bbbb", {
      maxChars: 5,
      overlap: 2,
      separators: [" "],
    });

    assertEquals(chunks.length > 1, true);
    for (const value of chunks) assertEquals(value.length <= 5, true);
  });

  it("does not split surrogate pairs when applying overlap", async () => {
    const chunks = await chunk("😀😀😀😀", {
      maxChars: 4,
      overlap: 1,
      separators: [""],
    });

    assertEquals(chunks.length > 1, true);
    for (const value of chunks) {
      assertEquals(value.length <= 4, true);
      assertEquals(hasUnpairedSurrogate(value), false);
    }
  });

  it("rejects invalid size and overlap options", async () => {
    await assertRejects(
      () => chunk("content", { maxChars: 0 }),
      Error,
      "maxChars must be a positive integer",
    );
    await assertRejects(
      () => chunk("content", { maxChars: 4, overlap: 4 }),
      Error,
      "overlap must be smaller than maxChars",
    );
    await assertRejects(
      () => chunk("content", { maxChars: 4, overlap: -1 }),
      Error,
      "overlap must be a non-negative integer",
    );
    await assertRejects(
      () => chunk("content", { maxChars: 1024 * 1024 + 1 }),
      Error,
      "maxChars must not exceed 1048576",
    );
  });

  it("rejects malformed custom separators", async () => {
    await assertRejects(
      () => chunk("content", null as never),
      Error,
      "Chunk options must be an object",
    );
    await assertRejects(
      () => chunk("content", { separators: ["\n", "\n"] }),
      Error,
      "separators must not contain duplicates",
    );
    await assertRejects(
      () => chunk("content", { separators: new Array(17).fill("x") }),
      Error,
      "separators supports at most 16 entries",
    );
  });

  it("rejects non-string and oversized text inputs", async () => {
    await assertRejects(
      () => chunk(42 as never),
      Error,
      "chunk text must be a string",
    );
    await assertRejects(
      () => chunk("x".repeat(16 * 1024 * 1024 + 1)),
      Error,
      "chunk text exceeds",
    );
  });

  it("rejects input that would create too many chunks", async () => {
    await assertRejects(
      () => chunk("x".repeat(10_001), { maxChars: 1, overlap: 0 }),
      Error,
      "at most 10000 chunks",
    );
  });

  it("rejects overlap settings that amplify total chunk output beyond the embedding limit", async () => {
    await assertRejects(
      () =>
        chunk("x".repeat(10_500), {
          maxChars: 2_000,
          overlap: 1_999,
          separators: [""],
        }),
      Error,
      "Chunking output exceeds the supported total size",
    );
  });
});

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeWebSearchQuery, shouldGuardWebSearchLoop } from "./index.ts";

describe("web-search loop guard", () => {
  it("does not guard ordinary search counts", () => {
    assertEquals(
      shouldGuardWebSearchLoop([
        "WebAssembly overview",
        "WebAssembly performance",
        "WebAssembly use cases",
      ]),
      false,
    );
  });

  it("guards after too many web searches in one turn", () => {
    assertEquals(
      shouldGuardWebSearchLoop([
        "q1",
        "q2",
        "q3",
        "q4",
        "q5",
        "q6",
        "q7",
        "q8",
      ]),
      true,
    );
  });

  it("guards repeated near-duplicate queries after normalization", () => {
    assertEquals(
      shouldGuardWebSearchLoop([
        "WebAssembly history how it works technical overview",
        "webassembly history how it works technical overview",
        "WebAssembly history, how it works: technical overview!",
      ]),
      true,
    );
  });

  it("normalizes punctuation and whitespace consistently", () => {
    assertEquals(
      normalizeWebSearchQuery("  WebAssembly history,   how it works!  "),
      "webassembly history how it works",
    );
  });
});

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { MAX_HTML_HEAD_PARSE_BYTES } from "veryfront/extensions/parser";
import { Parse5HTMLHeadLocator, PARSER_MAX_HTML_HEAD_PARSE_BYTES } from "./parser-only.ts";
import { utf8LengthWithinLimit } from "./utf8-limit.ts";

const CONSERVATIVE_LOCATION = {
  ok: true,
  placement: {
    contentStart: 0,
    importMapInsertion: {
      status: "unavailable",
      reason: "unsafe-insertion-state",
    },
    endInsertion: {
      status: "unavailable",
      reason: "unsafe-insertion-state",
    },
    importMapPreludeEndOffset: 0,
    moduleResolutionOrdering: {
      status: "unavailable",
      reason: "unsafe-insertion-state",
    },
    authoredImportMapState: {
      status: "invalid",
      reason: "unusable-element",
    },
    hasLocatedStartTag: false,
    hasLocatedEndTag: false,
  },
} as const;

describe("utf8LengthWithinLimit", () => {
  const samples = [
    { name: "BMP ASCII text", input: "Veryfront" },
    { name: "two-byte BMP text", input: "räksmörgås" },
    { name: "three-byte BMP text", input: "漢字" },
    { name: "a valid astral pair", input: "😀" },
    { name: "a lone high surrogate", input: "\uD83D" },
    { name: "a lone low surrogate", input: "\uDE00" },
    {
      name: "a high and low surrogate in successive code units",
      input: "x\uD83D\uDE00y",
    },
    {
      name: "mixed BMP, astral, and malformed input",
      input: "Aé😀\uD83DZ\uDE00漢",
    },
  ];

  for (const { name, input } of samples) {
    it(`reports TextEncoder bytes and enforces the exact limit for ${name}`, () => {
      const byteLength = new TextEncoder().encode(input).byteLength;

      assertEquals(utf8LengthWithinLimit(input, byteLength), {
        ok: true,
        bytes: byteLength,
      });
      assertEquals(utf8LengthWithinLimit(input, byteLength - 1), {
        ok: false,
      });
    });
  }

  it("does not double-count or skip a surrogate pair at the limit", () => {
    const prefixWithFinalHighSurrogate = "a\uD83D";
    const samePrefixWithLowSurrogate = `${prefixWithFinalHighSurrogate}\uDE00`;

    assertEquals(utf8LengthWithinLimit(prefixWithFinalHighSurrogate, 4), {
      ok: true,
      bytes: 4,
    });
    assertEquals(utf8LengthWithinLimit(samePrefixWithLowSurrogate, 4), {
      ok: false,
    });
    assertEquals(utf8LengthWithinLimit(samePrefixWithLowSurrogate, 5), {
      ok: true,
      bytes: 5,
    });
  });
});

describe("Parse5HTMLHeadLocator", () => {
  const locator = new Parse5HTMLHeadLocator();

  it("shares the core parser byte limit", () => {
    assertEquals(
      PARSER_MAX_HTML_HEAD_PARSE_BYTES,
      MAX_HTML_HEAD_PARSE_BYTES,
    );
  });

  it("admits exactly 8 MiB of ASCII and rejects the first byte over", () => {
    assertEquals(locator.locate("a".repeat(8_388_608)), CONSERVATIVE_LOCATION);
    assertEquals(locator.locate("a".repeat(8_388_609)), {
      ok: false,
      reason: "input-too-large",
    });
  });

  it("admits exactly 8 MiB of astral text and rejects the first byte over", () => {
    assertEquals(locator.locate("😀".repeat(2_097_152)).ok, true);
    assertEquals(locator.locate("😀".repeat(2_097_152) + "a"), {
      ok: false,
      reason: "input-too-large",
    });
  });

  it("returns the exact conservative unavailable placement", () => {
    assertEquals(locator.locate("<!doctype html><html><head></head></html>"), {
      ok: true,
      placement: {
        contentStart: 0,
        importMapInsertion: {
          status: "unavailable",
          reason: "unsafe-insertion-state",
        },
        endInsertion: {
          status: "unavailable",
          reason: "unsafe-insertion-state",
        },
        importMapPreludeEndOffset: 0,
        moduleResolutionOrdering: {
          status: "unavailable",
          reason: "unsafe-insertion-state",
        },
        authoredImportMapState: {
          status: "invalid",
          reason: "unusable-element",
        },
        hasLocatedStartTag: false,
        hasLocatedEndTag: false,
      },
    });
  });

  it("has no parse callback or vendor execution surface", () => {
    assertEquals(Object.getOwnPropertyNames(locator), []);
    assertEquals(
      Object.getOwnPropertyNames(Parse5HTMLHeadLocator.prototype),
      ["constructor", "locate"],
    );
    assertEquals(Parse5HTMLHeadLocator.length, 0);
    assertEquals(Parse5HTMLHeadLocator.prototype.locate.length, 1);
  });
});

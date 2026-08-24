import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  decodeCacheKeyLiteralSegment,
  decodeCacheKeyPercentSegment,
  decodeCacheKeySegment,
  encodeCacheKeyLiteralSegment,
  encodeCacheKeyPercentSegment,
  encodeCacheKeySegment,
} from "./segment-codec.ts";

describe("cache key literal segment codec", () => {
  it("round-trips API-safe literals, metacharacters, Unicode, and lone surrogates", () => {
    const values = [
      "",
      "plain/path-1.0",
      "*?:_[]",
      "Malmö/東京",
      "\ud800",
      "\udc00",
      "�",
      "\\ud800",
      "tenant-vf-sanitized",
    ];
    const encodings = values.map(encodeCacheKeyLiteralSegment);

    assertEquals(encodings.map(decodeCacheKeyLiteralSegment), values);
    assertEquals(new Set(encodings).size, values.length);
    assertEquals(encodings.every((value) => /^[A-Za-z0-9_./-]+$/.test(value)), true);
    assertEquals(encodings.every((value) => value.endsWith("_")), true);
    assertEquals(encodings.every((value) => !`${value}:`.includes("vf-sanitized:")), true);
    assertEquals(encodeCacheKeyLiteralSegment(""), "s_");
    assertEquals(encodeCacheKeyLiteralSegment("*"), "s_002a_");
    assertEquals(encodeCacheKeyLiteralSegment(":"), "s_003a_");
    assertEquals(encodeCacheKeyLiteralSegment("_"), "s_005f_");
    assertNotEquals(
      encodeCacheKeyLiteralSegment("\ud800"),
      encodeCacheKeyLiteralSegment("�"),
    );
  });

  it("preserves every UTF-16 code unit without aliases", () => {
    const values = Array.from(
      { length: 0x1_0000 },
      (_, codeUnit) => String.fromCharCode(codeUnit),
    );
    const encodings = values.map(encodeCacheKeyLiteralSegment);

    assertEquals(new Set(encodings).size, values.length);
    assertEquals(encodings.map(decodeCacheKeyLiteralSegment), values);
  });

  it("rejects malformed and non-canonical literal encodings", () => {
    for (
      const encoded of [
        "",
        "plain",
        "s",
        "s__",
        "s_123_",
        "s_00F6_",
        "s_zzzz_",
        "s_0061_",
        "splain",
      ]
    ) {
      assertEquals(decodeCacheKeyLiteralSegment(encoded), null);
    }
  });
});

describe("cache key base64url segment codec", () => {
  it("round-trips wildcard, Unicode, and lone-surrogate strings without aliases", () => {
    const values = [
      "*",
      "?",
      "tenant:branch",
      "Malmö/東京",
      "\ud800",
      "\udc00",
      "�",
      "\\ud800",
    ];
    const encodings = values.map(encodeCacheKeySegment);

    assertEquals(encodings.map(decodeCacheKeySegment), values);
    assertEquals(new Set(encodings).size, values.length);
    assertEquals(encodings.every((value) => /^[A-Za-z0-9_-]+$/.test(value)), true);
    assertNotEquals(encodeCacheKeySegment("\ud800"), encodeCacheKeySegment("�"));
  });

  it("rejects malformed and non-canonical base64url encodings", () => {
    const toBase64Url = (binary: string) =>
      btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

    for (
      const [encoded, reason] of [
        ["a", "a base64url length of one modulo four must be refused"],
        ["a+b/c", "standard base64 characters must be refused"],
        ["a=", "padding characters must be refused"],
        [
          toBase64Url(String.fromCharCode(0xff, 0xfe)),
          "invalid UTF-8 bytes must be refused",
        ],
        [
          toBase64Url("123"),
          "a non-string JSON payload must not decode to a tenant identifier",
        ],
        [
          toBase64Url("null"),
          "a non-string JSON payload must not decode to a tenant identifier",
        ],
      ] as const
    ) {
      assertEquals(decodeCacheKeySegment(encoded), null, reason);
    }
  });
});

describe("cache key percent segment codec", () => {
  it("round-trips arbitrary JavaScript strings without aliases", () => {
    const values = [
      "",
      "plain",
      "with:delimiter/and spaces",
      "emoji-\u{1f642}",
      "high-\ud800",
      "low-\udc00",
      "literal-%uD800",
    ];
    const encodings = values.map(encodeCacheKeyPercentSegment);

    assertEquals(
      encodings.map(decodeCacheKeyPercentSegment),
      values,
    );
    assertEquals(new Set(encodings).size, values.length);
    assertNotEquals(
      encodeCacheKeyPercentSegment("\ud800"),
      encodeCacheKeyPercentSegment("\udc00"),
    );
  });

  it("rejects malformed and non-canonical encodings", () => {
    for (
      const encoded of [
        "%",
        "%FF",
        "%u0041",
        "%ud800",
        "%uD83D%uDE42",
        "%70lain",
      ]
    ) {
      assertEquals(decodeCacheKeyPercentSegment(encoded), null);
    }
  });
});

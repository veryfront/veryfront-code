import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertCSSPipelineIdentity,
  assertStyleProfileHash,
  isCSSPipelineIdentity,
  isStyleProfileHash,
  MAX_CSS_PIPELINE_IDENTITY_CODE_UNITS,
  MAX_CSS_PIPELINE_IDENTITY_UTF8_BYTES,
} from "./css-artifact-identity.ts";

describe("CSS artifact identities", () => {
  it("accepts canonical bounded pipeline identities", () => {
    const identity = '["veryfront.css-pipeline.v1","compiler@1","optimizer@1"]';
    assertEquals(isCSSPipelineIdentity(identity), true);
    assertEquals(assertCSSPipelineIdentity(identity), identity);
  });

  it("rejects blank, padded, non-NFC, control, and malformed Unicode identities", () => {
    for (
      const identity of [
        "",
        "   ",
        " pipeline@1",
        "pipeline@1 ",
        "pipeline\n@1",
        "pipeline\u0085@1",
        "pipeline-e\u0301",
        "pipeline-\ud800",
      ]
    ) {
      assertEquals(isCSSPipelineIdentity(identity), false);
      assertThrows(() => assertCSSPipelineIdentity(identity), TypeError);
    }
  });

  it("enforces both code-unit and encoded-byte limits", () => {
    assertEquals(
      isCSSPipelineIdentity("x".repeat(MAX_CSS_PIPELINE_IDENTITY_CODE_UNITS)),
      true,
    );
    assertEquals(
      isCSSPipelineIdentity("x".repeat(MAX_CSS_PIPELINE_IDENTITY_CODE_UNITS + 1)),
      false,
    );

    const threeByteScalar = "\u20ac";
    const byteOversized = threeByteScalar.repeat(
      Math.floor(MAX_CSS_PIPELINE_IDENTITY_UTF8_BYTES / 3) + 1,
    );
    assertEquals(byteOversized.length <= MAX_CSS_PIPELINE_IDENTITY_CODE_UNITS, true);
    assertEquals(isCSSPipelineIdentity(byteOversized), false);
  });

  it("accepts only canonical lowercase SHA-256 style profile hashes", () => {
    const hash = "a".repeat(64);
    assertEquals(isStyleProfileHash(hash), true);
    assertEquals(assertStyleProfileHash(hash), hash);

    for (const invalid of ["profile-1", "A".repeat(64), `${hash}\n`, "a".repeat(65)]) {
      assertEquals(isStyleProfileHash(invalid), false);
      assertThrows(() => assertStyleProfileHash(invalid), TypeError);
    }
  });
});

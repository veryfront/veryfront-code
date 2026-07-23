import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { decodePathSegmentFully, isSafeModulePathSegment } from "./path-safety.ts";

describe("html/path-safety", () => {
  it("fully decodes nested percent encoding", () => {
    assertEquals(decodePathSegmentFully("%25252e%25252e"), "..");
  });

  it("allows ordinary and encoded non-structural path characters", () => {
    assertEquals(isSafeModulePathSegment("hello-world.tsx"), true);
    assertEquals(isSafeModulePathSegment("hello%20world.tsx"), true);
  });

  it("rejects structural characters at every encoding depth", () => {
    for (const segment of ["..", "%2e%2e", "%252e%252e", "%252fprivate"]) {
      assertEquals(isSafeModulePathSegment(segment), false);
    }
  });

  it("rejects invalid and oversized percent-encoded segments", () => {
    assertThrows(() => decodePathSegmentFully("invalid%"), TypeError, "percent encoding");
    assertThrows(
      () => decodePathSegmentFully("a".repeat(4097)),
      TypeError,
      "size limit",
    );
  });
});

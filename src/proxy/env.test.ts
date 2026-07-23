import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  parseHttpBaseUrl,
  parseIntegerSetting,
  parseLocalProjectsSetting,
  parseProxyBindingSetting,
} from "./env.ts";

describe("proxy environment parsing", () => {
  it("parses bounded integers without partial or non-finite values", () => {
    assertEquals(parseIntegerSetting("PORT", undefined, 8080, 1, 65_535), 8080);
    assertEquals(parseIntegerSetting("PORT", " 9090 ", 8080, 1, 65_535), 9090);
    for (const value of ["8080oops", "1.5", "Infinity", "0", "65536"]) {
      assertThrows(
        () => parseIntegerSetting("PORT", value, 8080, 1, 65_535),
        RangeError,
      );
    }
  });

  it("validates proxy binding and upstream HTTP URLs", () => {
    assertEquals(parseProxyBindingSetting("https://127.0.0.1"), {
      hostname: "127.0.0.1",
      port: 443,
    });
    assertEquals(
      parseHttpBaseUrl("SERVER_URL", "https://renderer.example.test/base"),
      "https://renderer.example.test/base",
    );
    for (
      const value of [
        "ftp://example.test",
        "https://user:secret@example.test",
        "https://example.test/?token=secret",
      ]
    ) {
      assertThrows(() => parseHttpBaseUrl("SERVER_URL", value), TypeError);
    }
    assertThrows(
      () => parseProxyBindingSetting("https://127.0.0.1/admin"),
      TypeError,
    );
  });

  it("copies and validates local project maps", () => {
    const parsed = parseLocalProjectsSetting('{"demo":"project-path"}');
    assertEquals(parsed, { demo: "project-path" });
    assertThrows(() => parseLocalProjectsSetting("[]"), TypeError);
    assertThrows(() => parseLocalProjectsSetting('{"demo":42}'), TypeError);
    assertThrows(
      () => parseLocalProjectsSetting('{"demo":"unsafe\\npath"}'),
      TypeError,
    );
    assertThrows(
      () => parseLocalProjectsSetting('{"unsafe\\nslug":"project-path"}'),
      TypeError,
    );
    assertThrows(() => parseLocalProjectsSetting("not json"), TypeError);
  });
});

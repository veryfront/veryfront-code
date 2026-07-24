import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromFileUrl, toFileUrl } from "./url-conversion.ts";

describe("url-conversion", () => {
  describe("fromFileUrl", () => {
    it("should convert a file:// URL string to a path", () => {
      assertEquals(fromFileUrl("file:///home/user/file.ts"), "/home/user/file.ts");
    });

    it("should convert a URL object to a path", () => {
      assertEquals(fromFileUrl(new URL("file:///tmp/test.txt")), "/tmp/test.txt");
    });

    it("should decode URI-encoded characters", () => {
      assertEquals(fromFileUrl("file:///home/user/my%20file.ts"), "/home/user/my file.ts");
    });

    it("should handle paths with special characters", () => {
      assertEquals(
        fromFileUrl("file:///path/to/%E6%97%A5%E6%9C%AC%E8%AA%9E.ts"),
        "/path/to/\u65E5\u672C\u8A9E.ts",
      );
    });

    it("rejects non-file URL schemes", () => {
      assertThrows(
        () => fromFileUrl("https://example.com/file.ts"),
        TypeError,
        "scheme file",
      );
    });
  });

  describe("toFileUrl", () => {
    it("should convert an absolute path to a file URL", () => {
      const result = toFileUrl("/home/user/file.ts");
      assertEquals(result.protocol, "file:");
      assertEquals(result.pathname, "/home/user/file.ts");
    });

    it("should return a URL instance", () => {
      assertEquals(toFileUrl("/tmp/test.txt") instanceof URL, true);
    });

    it("should produce href starting with file://", () => {
      assertEquals(toFileUrl("/some/path").href.startsWith("file://"), true);
    });

    it("should handle paths with spaces", () => {
      const result = toFileUrl("/path/with spaces/file.ts");
      assertEquals(result.href.includes("spaces"), true);
    });

    it("should round-trip URL-significant path characters", () => {
      const path = "/path/with #hash ?query %percent/file.ts";
      const result = toFileUrl(path);

      assertEquals(result.hash, "");
      assertEquals(result.search, "");
      assertEquals(fromFileUrl(result), path);
    });

    it("preserves literal backslashes in POSIX paths", () => {
      if (Deno.build.os === "windows") return;
      const path = "/tmp/literal\\backslash.ts";
      assertEquals(fromFileUrl(toFileUrl(path)), path);
    });

    it("round-trips Windows drive and UNC paths on Windows", () => {
      if (Deno.build.os !== "windows") return;

      for (
        const path of [
          String.raw`C:\workspace\file.ts`,
          String.raw`\\server\share\file.ts`,
        ]
      ) {
        assertEquals(fromFileUrl(toFileUrl(path)), path);
      }
    });

    it("should handle relative path by resolving", () => {
      const result = toFileUrl("relative/path.ts");
      assertEquals(result.protocol, "file:");
    });
  });

  describe("fromFileUrl edge cases", () => {
    it("should handle standard file URL", () => {
      const result = fromFileUrl("file:///path/to/file.ts");
      assertEquals(result, "/path/to/file.ts");
    });

    it("should handle root path", () => {
      assertEquals(fromFileUrl("file:///"), "/");
    });

    it("should handle URL object with encoded characters", () => {
      const url = new URL("file:///path/to/my%20file.ts");
      assertEquals(fromFileUrl(url), "/path/to/my file.ts");
    });
  });
});

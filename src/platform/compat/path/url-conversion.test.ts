import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromFileUrl, toFileUrl } from "./url-conversion.ts";

describe("url-conversion", () => {
  describe("fromFileUrl", () => {
    it("should convert a file:// URL string to a path", () => {
      const result = fromFileUrl("file:///home/user/file.ts");
      assertEquals(result, "/home/user/file.ts");
    });

    it("should convert a URL object to a path", () => {
      const url = new URL("file:///tmp/test.txt");
      const result = fromFileUrl(url);
      assertEquals(result, "/tmp/test.txt");
    });

    it("should decode URI-encoded characters", () => {
      const result = fromFileUrl("file:///home/user/my%20file.ts");
      assertEquals(result, "/home/user/my file.ts");
    });

    it("should handle paths with special characters", () => {
      const result = fromFileUrl("file:///path/to/%E6%97%A5%E6%9C%AC%E8%AA%9E.ts");
      assertEquals(result, "/path/to/\u65E5\u672C\u8A9E.ts");
    });
  });

  describe("toFileUrl", () => {
    it("should convert an absolute path to a file URL", () => {
      const result = toFileUrl("/home/user/file.ts");
      assertEquals(result.protocol, "file:");
      assertEquals(result.pathname, "/home/user/file.ts");
    });

    it("should return a URL instance", () => {
      const result = toFileUrl("/tmp/test.txt");
      assertEquals(result instanceof URL, true);
    });

    it("should produce href starting with file://", () => {
      const result = toFileUrl("/some/path");
      assertEquals(result.href.startsWith("file://"), true);
    });
  });
});

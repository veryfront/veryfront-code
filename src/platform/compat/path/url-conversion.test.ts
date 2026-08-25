import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runtimeUsesWindowsPaths } from "./portable.ts";
import { resolve } from "./resolution.ts";
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

    it("should ignore URL search and fragment data", () => {
      assertEquals(
        fromFileUrl("file:///tmp/_pins/on%253Asnapshot/file.ts?v=1#module"),
        "/tmp/_pins/on%3Asnapshot/file.ts",
      );
    });

    it("should handle paths with special characters", () => {
      assertEquals(
        fromFileUrl("file:///path/to/%E6%97%A5%E6%9C%AC%E8%AA%9E.ts"),
        "/path/to/\u65E5\u672C\u8A9E.ts",
      );
    });

    it("should reject non-file URLs", () => {
      assertThrows(
        () => fromFileUrl("https://example.com/x"),
        TypeError,
        "Must be a file URL",
        "a non-file protocol must be rejected",
      );
    });

    it("should reject encoded path separators instead of decoding them", () => {
      assertThrows(
        () => fromFileUrl("file:///srv/a%2Fb"),
        TypeError,
        "File URL path must not include encoded path separators",
        "an encoded forward slash must be rejected, not decoded",
      );
      if (runtimeUsesWindowsPaths()) {
        assertThrows(
          () => fromFileUrl("file:///srv/a%5Cb"),
          TypeError,
          "File URL path must not include encoded path separators",
          "an encoded backslash must be rejected on Windows",
        );
      }
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

    it("should preserve percent signs as literal path characters", () => {
      const path = "/tmp/_pins/on%3Asnapshot/file.ts";
      const result = toFileUrl(path);

      assertEquals(result.href, "file:///tmp/_pins/on%253Asnapshot/file.ts");
      assertEquals(fromFileUrl(result), path);
    });

    it("should preserve query and fragment delimiters as literal path characters", () => {
      const path = "/tmp/cache?variant#module.ts";
      const result = toFileUrl(path);

      assertEquals(result.href, "file:///tmp/cache%3Fvariant%23module.ts");
      assertEquals(fromFileUrl(result), path);
    });

    it("should preserve colons inside POSIX path segments", () => {
      const path = "/srv/app/node_modules/example/C:/entry.mjs";
      assertEquals(
        toFileUrl(path).href,
        "file:///srv/app/node_modules/example/C:/entry.mjs",
      );
    });

    it("should handle relative path by resolving", () => {
      const result = toFileUrl("relative/path.ts");
      assertEquals(result.protocol, "file:");
      const expected = resolve("relative/path.ts");
      assertEquals(
        fromFileUrl(result),
        runtimeUsesWindowsPaths() ? expected.replaceAll("/", "\\") : expected,
      );
    });

    it("preserves explicit UNC hosts without inventing ambiguous POSIX paths", () => {
      const result = toFileUrl(String.raw`\\server\share\extension.ts`);
      assertEquals(result.href, "file://server/share/extension.ts");
      if (runtimeUsesWindowsPaths()) {
        assertEquals(fromFileUrl(result), String.raw`\\server\share\extension.ts`);
      } else {
        assertThrows(
          () => fromFileUrl(result),
          TypeError,
          "File URL host must be empty or localhost on non-Windows runtimes",
        );
      }
    });

    it("treats localhost file URLs as local paths", () => {
      if (!runtimeUsesWindowsPaths()) {
        assertEquals(fromFileUrl("file://localhost/tmp/file.ts"), "/tmp/file.ts");
      }
    });

    it("keeps redundant POSIX root separators local", () => {
      assertEquals(toFileUrl("//").href, "file:///");
      if (!runtimeUsesWindowsPaths()) {
        assertEquals(toFileUrl("//tmp/file.ts").href, "file:///tmp/file.ts");
        assertEquals(
          toFileUrl("//server/share/file.ts").href,
          "file:///server/share/file.ts",
        );
      }
      assertEquals(toFileUrl("///tmp/file.ts").href, "file:///tmp/file.ts");
      assertEquals(toFileUrl("////tmp/file.ts").href, "file:///tmp/file.ts");
    });

    it("preserves literal backslashes in POSIX paths", () => {
      if (runtimeUsesWindowsPaths()) return;
      const path = String.raw`/tmp/literal\backslash.ts`;
      assertEquals(fromFileUrl(toFileUrl(path)), path);
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

import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertRejects } from "std/assert/mod.ts";
import { fromFileUrl, toFileUrl } from "./url-conversion.ts";

describe("platform/compat/path/url-conversion", () => {
  describe("fromFileUrl", () => {
    it("should convert file URL string to path", async () => {
      const result = await fromFileUrl("file:///path/to/file.txt");
      assertEquals(result, "/path/to/file.txt");
    });

    it("should convert file URL object to path", async () => {
      const url = new URL("file:///path/to/file.txt");
      const result = await fromFileUrl(url);
      assertEquals(result, "/path/to/file.txt");
    });

    it("should handle encoded characters", async () => {
      const result = await fromFileUrl("file:///path%20with%20spaces/file.txt");
      assertEquals(result, "/path with spaces/file.txt");
    });

    it("should throw for non-file URLs", async () => {
      await assertRejects(
        async () => await fromFileUrl("http://example.com/file.txt"),
        TypeError,
        // Deno throws "The URL must be of scheme file"
      );
    });

    it("should throw for invalid URLs", async () => {
      await assertRejects(
        async () => await fromFileUrl("not-a-url"),
        TypeError,
        // Different error message for invalid URL format
      );
    });

    it("should handle root path", async () => {
      const result = await fromFileUrl("file:///");
      assertEquals(result, "/");
    });

    it("should handle complex paths", async () => {
      const result = await fromFileUrl("file:///home/user/documents/file.pdf");
      assertEquals(result, "/home/user/documents/file.pdf");
    });
  });

  describe("toFileUrl", () => {
    it("should convert absolute path to file URL", () => {
      const result = toFileUrl("/path/to/file.txt");
      assertEquals(result.protocol, "file:");
      assertEquals(result.pathname, "/path/to/file.txt");
    });

    it("should handle root path", () => {
      const result = toFileUrl("/");
      assertEquals(result.protocol, "file:");
      assertEquals(result.pathname, "/");
    });

    it("should handle paths with spaces", () => {
      const result = toFileUrl("/path with spaces/file.txt");
      assertEquals(result.protocol, "file:");
      // URL encoding happens automatically
      assertEquals(result.pathname, "/path%20with%20spaces/file.txt");
    });

    it("should handle complex paths", () => {
      const result = toFileUrl("/home/user/documents/file.pdf");
      assertEquals(result.protocol, "file:");
      assertEquals(result.pathname, "/home/user/documents/file.pdf");
    });

    it("should convert relative paths to absolute", () => {
      // This test depends on current working directory
      // So we just verify it returns a file URL
      const result = toFileUrl("file.txt");
      assertEquals(result.protocol, "file:");
    });

    it("should return URL object", () => {
      const result = toFileUrl("/path/to/file.txt");
      assertEquals(result instanceof URL, true);
    });
  });

  describe("round-trip", () => {
    it("should be reversible for absolute paths", async () => {
      const originalPath = "/path/to/file.txt";
      const url = toFileUrl(originalPath);
      const resultPath = await fromFileUrl(url);

      assertEquals(resultPath, originalPath);
    });

    it("should handle paths with special characters", async () => {
      const originalPath = "/path/with spaces/and-dashes/file_name.txt";
      const url = toFileUrl(originalPath);
      const resultPath = await fromFileUrl(url);

      assertEquals(resultPath, originalPath);
    });
  });
});

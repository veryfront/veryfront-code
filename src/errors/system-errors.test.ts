import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert";
import {
  ConfigError,
  FileSystemError,
  NetworkError,
  NotSupportedError,
  PermissionError,
} from "./system-errors.ts";
import { VeryfrontError } from "./types.ts";

describe("system-errors", () => {
  describe("FileSystemError", () => {
    it("should create error with correct slug", () => {
      const error = new FileSystemError("File not found");
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.name, "FileSystemError");
      assertEquals(error.slug, "file-not-found");
    });

    it("should include context", () => {
      const error = new FileSystemError("Not found", { path: "/test" });
      assertEquals((error.context as { path?: string } | undefined)?.path, "/test");
    });
  });

  describe("ConfigError", () => {
    it("should create error with correct slug", () => {
      const error = new ConfigError("Invalid config");
      assertEquals(error.name, "ConfigError");
      assertEquals(error.slug, "config-invalid");
    });
  });

  describe("NetworkError", () => {
    it("should create error with correct slug", () => {
      const error = new NetworkError("Connection refused");
      assertEquals(error.name, "NetworkError");
      assertEquals(error.slug, "network-error");
    });
  });

  describe("PermissionError", () => {
    it("should create error with correct slug", () => {
      const error = new PermissionError("Access denied");
      assertEquals(error.name, "PermissionError");
      assertEquals(error.slug, "permission-denied");
    });
  });

  describe("NotSupportedError", () => {
    it("should create error with correct slug", () => {
      const error = new NotSupportedError("Feature not supported");
      assertEquals(error.name, "NotSupportedError");
      assertEquals(error.slug, "not-supported");
    });
  });
});

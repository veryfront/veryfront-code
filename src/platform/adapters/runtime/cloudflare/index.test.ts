import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  CloudflareAdapter,
  CloudflareEnvironmentAdapter,
  CloudflareFileSystemAdapter,
  CloudflareServer,
  CloudflareServerAdapter,
  CloudflareShellAdapter,
  createWorker,
} from "./index.ts";

describe("runtime/cloudflare/index.ts exports", () => {
  describe("CloudflareAdapter", () => {
    it("should export CloudflareAdapter class", () => {
      assertExists(CloudflareAdapter);
      assertEquals(typeof CloudflareAdapter, "function");
    });
  });

  describe("CloudflareEnvironmentAdapter", () => {
    it("should export CloudflareEnvironmentAdapter class", () => {
      assertExists(CloudflareEnvironmentAdapter);
      assertEquals(typeof CloudflareEnvironmentAdapter, "function");
    });
  });

  describe("CloudflareFileSystemAdapter", () => {
    it("should export CloudflareFileSystemAdapter class", () => {
      assertExists(CloudflareFileSystemAdapter);
      assertEquals(typeof CloudflareFileSystemAdapter, "function");
    });
  });

  describe("CloudflareServer", () => {
    it("should export CloudflareServer class", () => {
      assertExists(CloudflareServer);
      assertEquals(typeof CloudflareServer, "function");
    });
  });

  describe("CloudflareServerAdapter", () => {
    it("should export CloudflareServerAdapter class", () => {
      assertExists(CloudflareServerAdapter);
      assertEquals(typeof CloudflareServerAdapter, "function");
    });
  });

  describe("CloudflareShellAdapter", () => {
    it("should export CloudflareShellAdapter class", () => {
      assertExists(CloudflareShellAdapter);
      assertEquals(typeof CloudflareShellAdapter, "function");
    });
  });

  describe("createWorker", () => {
    it("should export createWorker function", () => {
      assertExists(createWorker);
      assertEquals(typeof createWorker, "function");
    });
  });
});

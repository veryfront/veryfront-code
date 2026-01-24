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

function assertExport(value: unknown, type: string): void {
  assertExists(value);
  assertEquals(typeof value, type);
}

describe("runtime/cloudflare/index.ts exports", () => {
  it("should export CloudflareAdapter class", () => {
    assertExport(CloudflareAdapter, "function");
  });

  it("should export CloudflareEnvironmentAdapter class", () => {
    assertExport(CloudflareEnvironmentAdapter, "function");
  });

  it("should export CloudflareFileSystemAdapter class", () => {
    assertExport(CloudflareFileSystemAdapter, "function");
  });

  it("should export CloudflareServer class", () => {
    assertExport(CloudflareServer, "function");
  });

  it("should export CloudflareServerAdapter class", () => {
    assertExport(CloudflareServerAdapter, "function");
  });

  it("should export CloudflareShellAdapter class", () => {
    assertExport(CloudflareShellAdapter, "function");
  });

  it("should export createWorker function", () => {
    assertExport(createWorker, "function");
  });
});

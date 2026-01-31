import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as exports from "./index.ts";

function assertExport(value: unknown, type: string): void {
  assertExists(value);
  assertEquals(typeof value, type);
}

describe("runtime/cloudflare/index.ts exports", () => {
  const cases: Array<[string, unknown]> = [
    ["CloudflareAdapter", exports.CloudflareAdapter],
    ["CloudflareEnvironmentAdapter", exports.CloudflareEnvironmentAdapter],
    ["CloudflareFileSystemAdapter", exports.CloudflareFileSystemAdapter],
    ["CloudflareServer", exports.CloudflareServer],
    ["CloudflareServerAdapter", exports.CloudflareServerAdapter],
    ["CloudflareShellAdapter", exports.CloudflareShellAdapter],
    ["createWorker", exports.createWorker],
  ];

  for (const [name, value] of cases) {
    it(`should export ${name}`, () => {
      assertExport(value, "function");
    });
  }
});

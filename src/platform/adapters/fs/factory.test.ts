import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createFSAdapter } from "./factory.ts";

describe("createFSAdapter", () => {
  it("should export createFSAdapter function", () => {
    assertExists(createFSAdapter);
    assertEquals(typeof createFSAdapter, "function");
  });

  it("should throw for local type", async () => {
    await assertRejects(
      () => createFSAdapter({ type: "local" }),
      Error,
      'FSAdapter type "local" should not use this factory',
    );
  });

  it("should throw for unsupported type", async () => {
    await assertRejects(
      () => createFSAdapter({ type: "unsupported" as any }),
      Error,
      'FSAdapter type "unsupported" is not implemented',
    );
  });

  it("should throw for github type without config", async () => {
    await assertRejects(
      () => createFSAdapter({ type: "github" }),
      Error,
      "GitHub adapter requires github configuration",
    );
  });

  // Note: Tests for creating actual adapters (veryfront-api, github) are skipped
  // because they require network connections or complex setup.
  // Those are covered in integration tests.
});

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { createKVStore, MemoryKv, openKv, polyfillDenoKv, SqliteKv } from "./index.ts";

describe("compat/kv/index.ts exports", () => {
  it("should export openKv function", () => {
    assertExists(openKv);
    assertEquals(typeof openKv, "function");
  });

  it("should export createKVStore function", () => {
    assertExists(createKVStore);
    assertEquals(typeof createKVStore, "function");
  });

  it("should export polyfillDenoKv function", () => {
    assertExists(polyfillDenoKv);
    assertEquals(typeof polyfillDenoKv, "function");
  });

  it("should export MemoryKv class", () => {
    assertExists(MemoryKv);
    assertEquals(typeof MemoryKv, "function");
  });

  it("should export SqliteKv class", () => {
    assertExists(SqliteKv);
    assertEquals(typeof SqliteKv, "function");
  });
});

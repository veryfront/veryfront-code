import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { BunAdapter, bunAdapter, BunEnvironmentAdapter, BunFileSystemAdapter } from "./bun.ts";

describe("bun.ts exports", () => {
  it("exports BunAdapter class and it is instantiable", () => {
    assertExists(BunAdapter);
    assertEquals(typeof BunAdapter, "function");
    assertExists(new BunAdapter());
  });

  it("exports bunAdapter singleton with expected shape", () => {
    assertExists(bunAdapter);

    assertEquals(bunAdapter.id, "bun");
    assertEquals(bunAdapter.name, "bun");

    assertExists(bunAdapter.fs?.readFile);
    assertExists(bunAdapter.fs?.writeFile);
    assertExists(bunAdapter.fs?.exists);

    assertExists(bunAdapter.env?.get);
    assertExists(bunAdapter.env?.set);
    assertExists(bunAdapter.env?.toObject);

    assertExists(bunAdapter.capabilities);
    assertEquals(bunAdapter.capabilities.typescript, true);
    assertEquals(bunAdapter.capabilities.jsx, true);
    assertEquals(bunAdapter.capabilities.websocket, true);
    assertEquals(bunAdapter.capabilities.http2, false);

    assertEquals(typeof bunAdapter.serve, "function");
  });

  it("exports BunEnvironmentAdapter class", () => {
    assertExists(BunEnvironmentAdapter);
    assertEquals(typeof BunEnvironmentAdapter, "function");
  });

  it("exports BunFileSystemAdapter class", () => {
    assertExists(BunFileSystemAdapter);
    assertEquals(typeof BunFileSystemAdapter, "function");
  });
});

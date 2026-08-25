import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  BunAdapter,
  bunAdapter,
  BunEnvironmentAdapter,
  BunFileSystemAdapter,
  BunServer,
  BunServerAdapter,
  BunWebSocket,
  createBunServer,
} from "./index.ts";
import { BunAdapter as ConcreteBunAdapter } from "./adapter.ts";
import { BunEnvironmentAdapter as ConcreteBunEnvironmentAdapter } from "./environment-adapter.ts";
import { BunFileSystemAdapter as ConcreteBunFileSystemAdapter } from "./filesystem-adapter.ts";
import {
  BunServer as ConcreteBunServer,
  createBunServer as concreteCreateBunServer,
} from "./http-server.ts";
import {
  BunServerAdapter as ConcreteBunServerAdapter,
  BunWebSocket as ConcreteBunWebSocket,
} from "./websocket-adapter.ts";

describe("runtime/bun/index.ts exports", () => {
  it("should export BunAdapter class", () => {
    assertStrictEquals(
      BunAdapter,
      ConcreteBunAdapter,
      "the barrel must re-export the Bun platform adapter class itself",
    );
  });

  it("should export bunAdapter singleton", () => {
    assertExists(bunAdapter);
    assertEquals(bunAdapter.id, "bun");
    assertEquals(bunAdapter.name, "bun");
  });

  it("should export BunFileSystemAdapter class", () => {
    assertStrictEquals(
      BunFileSystemAdapter,
      ConcreteBunFileSystemAdapter,
      "the barrel must re-export the file system adapter class itself",
    );
  });

  it("should export BunEnvironmentAdapter class", () => {
    assertStrictEquals(
      BunEnvironmentAdapter,
      ConcreteBunEnvironmentAdapter,
      "the barrel must re-export the environment adapter class itself",
    );
  });

  it("should export BunServerAdapter class", () => {
    assertStrictEquals(
      BunServerAdapter,
      ConcreteBunServerAdapter,
      "the barrel must re-export the server adapter class itself",
    );
  });

  it("should export BunWebSocket class", () => {
    assertStrictEquals(
      BunWebSocket,
      ConcreteBunWebSocket,
      "the barrel must re-export the WebSocket class itself",
    );
  });

  it("should export BunServer class", () => {
    assertStrictEquals(
      BunServer,
      ConcreteBunServer,
      "the barrel must re-export the HTTP server class itself",
    );
  });

  it("should export createBunServer function", () => {
    assertStrictEquals(
      createBunServer,
      concreteCreateBunServer,
      "the barrel must re-export the server factory itself",
    );
  });
});

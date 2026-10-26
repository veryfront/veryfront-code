import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { needsDenoNodeHttpTransport, resolveDenoNodeHttpOptions } from "./http-transport.ts";
import { WsNodeWebSocketServerProvider } from "../../../../../extensions/ext-node-websocket-ws/src/index.ts";

it("Deno transport selection is bounded to source-proven affected versions", () => {
  for (const version of ["2.9.7", "2.9.8"]) assertEquals(needsDenoNodeHttpTransport(version), true);
  for (const version of ["2.7.12", "2.9.6", "2.9.9", "3.0.0"]) {
    assertEquals(needsDenoNodeHttpTransport(version), false);
  }
});

it("explicit disabled and custom provider intent bypasses the Deno default loader", async () => {
  const disabled = { nodeWebSocketServerProvider: null };
  assertStrictEquals(await resolveDenoNodeHttpOptions(disabled), disabled);
  const custom = { nodeWebSocketServerProvider: WsNodeWebSocketServerProvider };
  assertStrictEquals(await resolveDenoNodeHttpOptions(custom), custom);
  assertEquals(
    (await resolveDenoNodeHttpOptions({})).nodeWebSocketServerProvider?.supportsIdleTimeout,
    true,
  );
});

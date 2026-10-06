import { Socket } from "node:net";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { disarmOwnedSocketOnDestroy } from "./owned-socket-teardown.ts";

it("disarms only teardown and keeps a late native timer refresh inert", async () => {
  const socket = new Socket();
  socket.setTimeout(60_000);
  disarmOwnedSocketOnDestroy(socket);
  assertEquals(socket.timeout, 60_000);
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  assertEquals(socket.destroy(), socket);
  await closed;
  assertEquals(socket.timeout, 0);
  const refresh = Reflect.get(socket, "_unrefTimer");
  assert(typeof refresh === "function");
  // Reproduce Deno's late onStreamRead update without a network connection or private timer symbols.
  Reflect.apply(refresh, socket, []);
});

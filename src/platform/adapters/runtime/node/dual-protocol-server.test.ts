import { Socket } from "node:net";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { DualProtocolServer } from "./dual-protocol-server.ts";

it("dual protocol ownership does not expose raw sockets to authored Set observers", async () => {
  const server = new DualProtocolServer(() => {});
  const socket = new Socket();
  const closed = new Promise<void>((resolve) => socket.once("close", resolve));
  const descriptors = Object.getOwnPropertyDescriptors(Set.prototype);
  const apply = Reflect.apply;
  const originals = { add: Set.prototype.add, delete: Set.prototype.delete };
  const forEach = Set.prototype.forEach;
  let observations = 0;
  try {
    for (const key of ["add", "delete"] as const) {
      const original = originals[key];
      Object.defineProperty(Set.prototype, key, {
        ...descriptors[key],
        value(value: unknown) {
          if (value === socket) observations++;
          return apply(original, this, [value]);
        },
      });
    }

    Object.defineProperty(Set.prototype, "forEach", {
      ...descriptors.forEach,
      value(callback: (value: unknown) => void) {
        return apply(forEach, this, [(value: unknown) => {
          if (value === socket) observations++;
          callback(value);
        }]);
      },
    });
    server.emit("connection", socket);
    server.closeAllConnections();
  } finally {
    Object.defineProperties(Set.prototype, descriptors);
    socket.destroy();
  }
  await closed;
  assertEquals(observations, 0);
});

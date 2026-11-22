import { Socket } from "node:net";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { DualProtocolServer } from "#veryfront/platform/adapters/runtime/node/dual-protocol-server.ts";

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

it("dual protocol dispatch does not expose sockets to authored instance observers", async () => {
  const server = new DualProtocolServer(() => {});
  const socket = new Socket();
  const closed = new Promise<void>((resolve) => socket.once("close", resolve));
  const descriptor = Object.getOwnPropertyDescriptor(Socket, Symbol.hasInstance);
  const instanceOf = Function.prototype[Symbol.hasInstance];
  const apply = Reflect.apply;
  let observations = 0;
  Object.defineProperty(Socket, Symbol.hasInstance, {
    configurable: true,
    value(value: unknown) {
      if (value === socket) observations++;
      return apply(instanceOf, Socket, [value]);
    },
  });
  try {
    server.emit("connection", socket);
  } finally {
    if (descriptor) Object.defineProperty(Socket, Symbol.hasInstance, descriptor);
    else Reflect.deleteProperty(Socket, Symbol.hasInstance);
    server.closeAllConnections();
    socket.destroy();
  }
  await closed;
  assertEquals(observations, 0);
});

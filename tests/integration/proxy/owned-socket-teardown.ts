import type { Socket } from "node:net";

/** Keep Deno 2.7.7's node idle timer from refreshing after an owned socket is destroyed. */
export function disarmOwnedSocketOnDestroy(socket: Socket): void {
  const destroy = socket.destroy;
  socket.destroy = function (...args: Parameters<Socket["destroy"]>) {
    // Only teardown changes the timeout; connection establishment and active I/O keep their configured deadlines.
    if (this === socket) this.setTimeout(0);
    return Reflect.apply(destroy, this, args);
  };
}

import { assertEquals } from "#veryfront/testing/assert.ts";
import { DenoNodeWebSocket } from "./node-websocket.ts";
import { NodeWebSocket } from "../node/websocket-adapter.ts";

class ControlledTransport extends NodeWebSocket {
  constructor() {
    super();
    this.readyState = 1;
  }
  amount = 0;
  failSend = false;
  readonly sent: Array<string | ArrayBuffer> = [];
  override _getBufferedAmount(): number {
    return this.amount;
  }
  override send(data: string | ArrayBuffer): void {
    if (this.failSend) throw new Error("synthetic send failure");
    this.sent.push(data);
    this.amount += typeof data === "string"
      ? new TextEncoder().encode(data).length
      : data.byteLength;
  }
  override close(): void {
    this.emitClose(1000, "", true);
  }
}

function heldBlob() {
  const conversion = Promise.withResolvers<ArrayBuffer>();
  class HeldBlob extends Blob {
    override slice(): Blob {
      return this;
    }
    override arrayBuffer(): Promise<ArrayBuffer> {
      return conversion.promise;
    }
  }
  return { blob: new HeldBlob([new Uint8Array([1, 2])]), conversion };
}

Deno.test("Deno facade counts every queued payload and transfers ownership without double counting", async () => {
  const transport = new ControlledTransport();
  const socket = new DenoNodeWebSocket(transport);
  const { blob, conversion } = heldBlob();
  socket.send(blob);
  assertEquals(socket.bufferedAmount, 2);
  socket.send("é");
  socket.send(new Uint8Array([3, 4, 5]).buffer);
  socket.send(new Uint8Array([6]));
  socket.send(new SharedArrayBuffer(4));
  socket.send(new Uint8Array(new SharedArrayBuffer(5)));
  assertEquals(socket.bufferedAmount, 17);
  assertEquals(transport.sent.length, 0);
  conversion.resolve(new Uint8Array([1, 2]).buffer);
  await conversion.promise;
  await Promise.resolve();
  assertEquals(transport.sent.length, 6);
  assertEquals(socket.bufferedAmount, 17);
  transport.amount = 0;
  assertEquals(socket.bufferedAmount, 0);
  socket.close();
  assertEquals(socket.bufferedAmount, 0);
});

for (const failure of ["conversion", "send", "close"] as const) {
  Deno.test(`Deno facade releases queued byte accounting on ${failure}`, async () => {
    const transport = new ControlledTransport();
    const socket = new DenoNodeWebSocket(transport);
    const { blob, conversion } = heldBlob();
    const errors: number[] = [];
    socket.onerror = () => errors.push(socket.bufferedAmount);
    socket.send(blob);
    socket.send("queued");
    assertEquals(socket.bufferedAmount, 8);
    if (failure === "close") transport.close();
    if (failure === "send") transport.failSend = true;
    if (failure === "conversion") conversion.reject(new Error("synthetic conversion failure"));
    else conversion.resolve(new Uint8Array([1, 2]).buffer);
    await conversion.promise.catch(() => {});
    await Promise.resolve();
    assertEquals(socket.bufferedAmount, 0);
    assertEquals(transport.sent.length, 0);
    assertEquals(errors, failure === "close" ? [] : [0]);
  });
}

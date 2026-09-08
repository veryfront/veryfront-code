import { randomBytes } from "node:crypto";
import { getEventListeners } from "node:events";
import { connect as connectTcp, createServer as createTcpServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  connectExecutorTransport,
  type ExecutorNodeTransport,
  listenExecutorTransport,
} from "#veryfront/agent/hosted/executor-node-transport.ts";

const binding = { allocationId: "synthetic-allocation", generation: 1, invocationId: "invocation" };
const host = "127.0.0.1";
const timeoutMs = 3_000;

async function pair(signal?: AbortSignal, lifetime = timeoutMs) {
  const key = randomBytes(32);
  const listener = await listenExecutorTransport({
    host,
    port: 0,
    binding,
    key,
    timeoutMs: lifetime,
  });
  try {
    const client = await connectExecutorTransport({
      podIp: host,
      port: listener.address.port,
      binding,
      key,
      signal,
      timeoutMs: lifetime,
    });
    const server = await listener.connection;
    return { listener, client, server };
  } catch (error) {
    listener.close();
    throw error;
  } finally {
    key.fill(0);
  }
}

async function readBytes(transport: ExecutorNodeTransport, length: number) {
  const reader = transport.readable.getReader();
  const bytes = new Uint8Array(length);
  let offset = 0;
  try {
    while (offset < length) {
      const chunk = await reader.read();
      assert(!chunk.done);
      assert(chunk.value.byteLength <= 1024 * 1024);
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
    return bytes;
  } finally {
    reader.releaseLock();
  }
}

// Deno's TLS compatibility layer does not implement PSK. Keep this local socket
// integration suite in the normal test:file workflow by running its Node lane.
if (typeof Deno !== "undefined") {
  it(
    "runs executor TLS authentication and lifecycle coverage on Node",
    { timeout: 30_000 },
    async () => {
      const root = new URL("../../../", import.meta.url);
      const child = spawn("node", [
        "--import",
        fileURLToPath(new URL("tests/node/resolver.mjs", root)),
        "--test",
        fileURLToPath(import.meta.url),
      ], { cwd: fileURLToPath(root), stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => output += chunk);
      child.stderr.on("data", (chunk) => output += chunk);
      const timer = setTimeout(() => child.kill(), 25_000);
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", resolve);
        });
        assertEquals(code, 0, output);
      } finally {
        clearTimeout(timer);
        child.kill();
      }
    },
  );
} else {
  describe("Node executor TLS transport", () => {
    it("exchanges bounded binary chunks in both directions", { timeout: 5_000 }, async () => {
      const { listener, client, server } = await pair();
      const bytes = randomBytes(1024 * 1024);
      try {
        const receiving = readBytes(server, bytes.byteLength);
        const writer = client.writable.getWriter();
        await writer.write(bytes);
        assertEquals<Uint8Array>(await receiving, bytes);
        const reply = new Uint8Array([0, 1, 255]);
        const response = readBytes(client, reply.byteLength);
        await server.writable.getWriter().write(reply);
        assertEquals(await response, reply);
      } finally {
        listener.close();
        client.close();
      }
    });

    it("keeps the TLS attachment available after a plain TCP startup probe", async () => {
      const key = randomBytes(32);
      const listener = await listenExecutorTransport({ host, port: 0, binding, key, timeoutMs });
      let attachment = "pending";
      void listener.connection.then(() => attachment = "resolved", () => attachment = "rejected");
      const probe = connectTcp({ host, port: listener.address.port });
      const probeClosed = new Promise<void>((resolve) => probe.once("close", resolve));
      let client: ExecutorNodeTransport | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          probe.once("connect", resolve);
          probe.once("error", reject);
        });
        probe.end();
        await probeClosed;
        await setImmediate();
        assertEquals(attachment, "pending");
        client = await connectExecutorTransport({
          podIp: host,
          port: listener.address.port,
          binding,
          key,
          timeoutMs,
        });
        const server = await listener.connection;
        const receiving = readBytes(client, 1);
        await server.writable.getWriter().write(new Uint8Array([7]));
        assertEquals(await receiving, new Uint8Array([7]));
      } finally {
        probe.destroy();
        client?.close();
        listener.close();
        key.fill(0);
      }
    });

    for (const mismatch of ["key", "allocationId", "generation", "invocationId"] as const) {
      it(`rejects an incorrect ${mismatch} before exposing a connection`, async () => {
        const key = randomBytes(32);
        const listener = await listenExecutorTransport({ host, port: 0, binding, key, timeoutMs });
        let attached = false;
        void listener.connection.then(() => attached = true, () => {});
        try {
          const changed = { ...binding };
          if (mismatch === "generation") changed.generation++;
          else if (mismatch !== "key") changed[mismatch] += "-other";
          await assertRejects(
            () =>
              connectExecutorTransport({
                podIp: host,
                port: listener.address.port,
                binding: changed,
                key: mismatch === "key" ? randomBytes(32) : key,
                timeoutMs,
              }),
            Error,
            "Executor transport authentication failed",
          );
          assertEquals(attached, false);
          const valid = await connectExecutorTransport({
            podIp: host,
            port: listener.address.port,
            binding,
            key,
            timeoutMs,
          });
          await listener.connection;
          valid.close();
        } finally {
          listener.close();
          key.fill(0);
        }
      });
    }

    it("permits one authenticated attachment and no reconnect", async () => {
      const key = randomBytes(32);
      const listener = await listenExecutorTransport({ host, port: 0, binding, key, timeoutMs });
      const options = { podIp: host, port: listener.address.port, binding, key, timeoutMs };
      const client = await connectExecutorTransport(options);
      try {
        const server = await listener.connection;
        await assertRejects(() => connectExecutorTransport(options), Error);
        const receiving = readBytes(server, 1);
        await client.writable.getWriter().write(new Uint8Array([7]));
        assertEquals(await receiving, new Uint8Array([7]));
        client.close();
        await assertRejects(() => connectExecutorTransport(options), Error);
      } finally {
        client.close();
        listener.close();
        key.fill(0);
      }
    });

    it("rejects DNS names, URLs, invalid keys, bindings, and deadlines", async () => {
      const valid = { podIp: host, port: 1, binding, key: randomBytes(32), timeoutMs };
      for (
        const invalid of [
          { podIp: "localhost" },
          { podIp: "https://127.0.0.1" },
          { port: 0 },
          { port: 65536 },
          { key: randomBytes(31) },
          { timeoutMs: 0 },
          { timeoutMs: 24 * 60 * 60 * 1000 + 1 },
          { binding: { ...binding, generation: 0 } },
          { binding: { ...binding, generation: 1.5 } },
          { binding: { ...binding, allocationId: "" } },
          { binding: { ...binding, extra: "unexpected" } },
        ]
      ) {
        await assertRejects(() => connectExecutorTransport({ ...valid, ...invalid }), TypeError);
      }
    });

    it("settles pending reads and queued writes when aborted after attachment", async () => {
      const controller = new AbortController();
      const { listener, client, server } = await pair(controller.signal);
      try {
        const read = assertRejects(() => client.readable.getReader().read(), Error);
        const writer = client.writable.getWriter();
        const chunk = new Uint8Array(1024 * 1024);
        const writes = Array.from({ length: 64 }, () => writer.write(chunk));
        const results = Promise.allSettled(writes);
        await writes[0];
        controller.abort(new Error("synthetic-private-reason"));
        await read;
        assertEquals(getEventListeners(controller.signal, "abort").length, 0);
        assert((await results).some((result) => result.status === "rejected"));
        const peerReader = server.readable.getReader();
        await assertRejects(
          async () => {
            while (!(await peerReader.read()).done) {
              /* Drain bytes written before cancellation. */
            }
          },
          Error,
          "Executor transport",
        );
      } finally {
        listener.close();
        client.close();
      }
    });

    it("writable abort interrupts an active blocked write", async () => {
      const { listener, client } = await pair();
      try {
        const writer = client.writable.getWriter();
        const chunk = new Uint8Array(1024 * 1024);
        const queued = Array.from({ length: 64 }, () => writer.write(chunk));
        const writes = Promise.allSettled(queued);
        await queued[0];
        await writer.abort(new Error("synthetic-private-reason"));
        assert((await writes).some((result) => result.status === "rejected"));
        await assertRejects(() => client.readable.getReader().read(), Error);
      } finally {
        listener.close();
        client.close();
      }
    });

    it("rejects oversized writes and closes the connection", async () => {
      const { listener, client } = await pair();
      try {
        await assertRejects(
          () => client.writable.getWriter().write(new Uint8Array(1024 * 1024 + 1)),
          Error,
          "Executor transport chunk exceeds byte limit",
        );
        await assertRejects(() => client.readable.getReader().read(), Error);
      } finally {
        listener.close();
        client.close();
      }
    });

    it("bounds attachment wait and the established connection lifetime", async () => {
      const listener = await listenExecutorTransport({
        host,
        port: 0,
        binding,
        key: randomBytes(32),
        timeoutMs: 50,
      });
      await assertRejects(() => listener.connection, Error, "Executor transport deadline exceeded");
      listener.close();
      const connected = await pair(undefined, 100);
      try {
        await assertRejects(
          () => connected.client.readable.getReader().read(),
          Error,
          "Executor transport",
        );
      } finally {
        connected.listener.close();
        connected.client.close();
      }
    });

    it("revokes an attached transport when the listener is aborted", async () => {
      const signalController = new AbortController();
      const key = randomBytes(32);
      const listener = await listenExecutorTransport({
        host,
        port: 0,
        binding,
        key,
        signal: signalController.signal,
        timeoutMs,
      });
      const client = await connectExecutorTransport({
        podIp: host,
        port: listener.address.port,
        binding,
        key,
        timeoutMs,
      });
      const server = await listener.connection;
      try {
        const serverRead = assertRejects(() => server.readable.getReader().read(), Error);
        const clientRead = assertRejects(() => client.readable.getReader().read(), Error);
        signalController.abort();
        await Promise.all([serverRead, clientRead]);
        assertEquals(getEventListeners(signalController.signal, "abort").length, 0);
      } finally {
        listener.close();
        client.close();
        key.fill(0);
      }
    });

    it("read cancellation destroys the peer connection", async () => {
      const { listener, client, server } = await pair();
      try {
        const peerRead = assertRejects(() => server.readable.getReader().read(), Error);
        await client.readable.cancel();
        await peerRead;
        await assertRejects(() => client.writable.getWriter().write(new Uint8Array([1])), Error);
      } finally {
        listener.close();
        client.close();
      }
    });

    it("aborts a pending client handshake and closes the TCP socket", async () => {
      const tcp = createTcpServer();
      const accepted = new Promise<import("node:net").Socket>((resolve) =>
        tcp.once("connection", resolve)
      );
      await new Promise<void>((resolve) => tcp.listen(0, host, resolve));
      const address = tcp.address();
      assert(address && typeof address !== "string");
      const controller = new AbortController();
      const connecting = connectExecutorTransport({
        podIp: host,
        port: address.port,
        binding,
        key: randomBytes(32),
        signal: controller.signal,
        timeoutMs,
      });
      const rejected = assertRejects(() => connecting, Error, "Executor transport aborted");
      const raw = await accepted;
      raw.resume();
      const closed = new Promise<void>((resolve) => raw.once("close", resolve));
      controller.abort();
      try {
        await rejected;
        await closed;
      } finally {
        raw.destroy();
        await new Promise<void>((resolve) => tcp.close(() => resolve()));
      }
    });

    it("bounds unauthenticated sockets and destroys them on listener close", async () => {
      const listener = await listenExecutorTransport({
        host,
        port: 0,
        binding,
        key: randomBytes(32),
        timeoutMs,
      });
      const sockets = Array.from(
        { length: 5 },
        () => connectTcp({ host, port: listener.address.port }),
      );
      const closed = sockets.map((socket) =>
        new Promise<void>((resolve) => {
          socket.on("error", () => {});
          socket.once("close", resolve);
        })
      );
      try {
        await closed[4];
        listener.close();
        await Promise.all(closed);
        await assertRejects(() => listener.connection, Error, "Executor transport closed");
      } finally {
        listener.close();
        for (const socket of sockets) socket.destroy();
      }
    });

    it("rejects already-aborted setup without opening a listener", async () => {
      const signal = AbortSignal.abort(new Error("synthetic-private-reason"));
      await assertRejects(
        () =>
          listenExecutorTransport({
            host,
            port: 0,
            binding,
            key: randomBytes(32),
            signal,
            timeoutMs,
          }),
        Error,
        "Executor transport aborted",
      );
    });
  });
}

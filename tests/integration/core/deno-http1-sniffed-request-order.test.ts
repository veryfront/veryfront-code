import { connect, type Socket } from "node:net";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createHttpServer } from "#veryfront/platform/compat/http/index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BODY_LENGTH = 65536;
const SEGMENT = 1024;

async function writeAll(connection: Deno.Conn, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) offset += await connection.write(bytes.subarray(offset));
}

async function readUntilClosed(connection: Deno.Conn): Promise<string> {
  let response = "";
  const buffer = new Uint8Array(65536);
  while (true) {
    const read = await connection.read(buffer);
    if (read === null) return response;
    response += decoder.decode(buffer.subarray(0, read));
  }
}

async function startServer() {
  const server = createHttpServer();
  const listening = Promise.withResolvers<number>();
  const running = server.serve(async (request: Request) => {
    const length = request.body ? (await request.arrayBuffer()).byteLength : 0;
    return new Response(`read ${length}`);
  }, {
    hostname: "127.0.0.1",
    port: 0,
    onListen: ({ port }: { port: number }) => listening.resolve(port),
  });
  const port = await listening.promise;
  return {
    port,
    async close() {
      await server.close();
      await running;
    },
  };
}

const request = encoder.encode(
  "POST /api/control-plane/runs/run-1/execute HTTP/1.1\r\n" +
    "Host: project.example.test\r\n" +
    "Content-Type: application/json\r\n" +
    "Connection: close\r\n" +
    `Content-Length: ${BODY_LENGTH}\r\n\r\n` +
    "z".repeat(BODY_LENGTH),
);

/** Send one request in small writes on a fresh connection; return a failure description or "". */
async function sendSegmented(port: number): Promise<string> {
  const connection = await Deno.connect({ hostname: "127.0.0.1", port });
  try {
    const response = readUntilClosed(connection).catch((error) => `<read failed: ${error}>`);
    // A rejected request closes the connection mid-upload. Record the write
    // failure with the response that caused it instead of losing either.
    let writeError = "";
    try {
      for (let offset = 0; offset < request.length; offset += SEGMENT) {
        await writeAll(connection, request.subarray(offset, offset + SEGMENT));
      }
    } catch (error) {
      writeError = ` (upload failed: ${error})`;
    }
    const raw = await response;
    const separator = raw.indexOf("\r\n\r\n");
    const statusLine = raw.slice(0, raw.indexOf("\r\n"));
    const body = separator < 0 ? "" : raw.slice(separator + 4);
    if (
      writeError || !/^HTTP\/1\.1 200 /.test(statusLine) || !body.includes(`read ${BODY_LENGTH}`)
    ) {
      return `${JSON.stringify(raw.slice(0, 120))}${writeError}`;
    }
    return "";
  } finally {
    connection.close();
  }
}

// The proxy serves through createHttpServer. On Deno 2.9.7/2.9.8 that selects
// the node:http transport behind DualProtocolServer, which reads the first
// bytes of every connection to detect h2c. A request whose bytes keep arriving
// during that hand-off must still reach the handler in order instead of being
// answered with node:http's bare `400 Bad Request` parse-error response.
describe("DualProtocolServer HTTP/1 hand-off", () => {
  it("keeps request bytes in order when a sniffed HTTP/1 request spans many reads", async () => {
    const server = await startServer();
    const failures: string[] = [];
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        const failure = await sendSegmented(server.port);
        if (failure) failures.push(failure);
      }
    } finally {
      await server.close();
    }
    assertEquals(failures, []);
  });

  it("does not run authored _consumed setters on the shared TCP handle prototype", async () => {
    const server = await startServer();
    const probe: Socket = connect({ host: "127.0.0.1", port: server.port });
    const probeClosed = new Promise<void>((resolve) => probe.once("close", resolve));
    await new Promise<void>((resolve, reject) => {
      probe.once("connect", resolve);
      probe.once("error", reject);
    });
    const handle = (probe as Socket & { _handle?: object | null })._handle;
    const prototype = handle ? Object.getPrototypeOf(handle) : null;
    probe.destroy();
    await probeClosed;
    if (!prototype) {
      await server.close();
      throw new Error("Client socket exposed no TCP handle to observe");
    }

    const original = Object.getOwnPropertyDescriptor(prototype, "_consumed");
    let observations = 0;
    Object.defineProperty(prototype, "_consumed", {
      configurable: true,
      get: () => undefined,
      set: () => {
        observations++;
      },
    });
    let failure = "";
    try {
      failure = await sendSegmented(server.port);
    } finally {
      if (original) Object.defineProperty(prototype, "_consumed", original);
      else Reflect.deleteProperty(prototype, "_consumed");
      await server.close();
    }
    assertEquals({ failure, observations }, { failure: "", observations: 0 });
  });
});

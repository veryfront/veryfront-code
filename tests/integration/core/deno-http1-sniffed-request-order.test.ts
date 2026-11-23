import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createHttpServer } from "#veryfront/platform/compat/http/index.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

// The proxy serves through createHttpServer. On Deno 2.9.7/2.9.8 that selects
// the node:http transport behind DualProtocolServer, which reads the first
// bytes of every connection to detect h2c. A request whose bytes keep arriving
// during that hand-off must still reach the handler in order instead of being
// answered with node:http's bare `400 Bad Request` parse-error response.
it("keeps request bytes in order when a sniffed HTTP/1 request spans many reads", async () => {
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
  const bodyLength = 65536;
  const segment = 1024;
  const request = encoder.encode(
    "POST /api/control-plane/runs/run-1/execute HTTP/1.1\r\n" +
      "Host: project.preview.veryfront.org\r\n" +
      "Content-Type: application/json\r\n" +
      "Connection: close\r\n" +
      `Content-Length: ${bodyLength}\r\n\r\n` +
      "z".repeat(bodyLength),
  );
  const failures: string[] = [];
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      const connection = await Deno.connect({ hostname: "127.0.0.1", port });
      try {
        const response = readUntilClosed(connection).catch((error) => `<read failed: ${error}>`);
        // A rejected request closes the connection mid-upload. Record the write
        // failure with the response that caused it instead of losing either.
        let writeError = "";
        try {
          for (let offset = 0; offset < request.length; offset += segment) {
            await writeAll(connection, request.subarray(offset, offset + segment));
          }
        } catch (error) {
          writeError = ` (upload failed: ${error})`;
        }
        const raw = await response;
        if (
          writeError ||
          !raw.startsWith("HTTP/1.1 200") ||
          !raw.endsWith(`read ${bodyLength}\r\n0\r\n\r\n`)
        ) {
          failures.push(`${JSON.stringify(raw.slice(0, 120))}${writeError}`);
        }
      } finally {
        connection.close();
      }
    }
  } finally {
    await server.close();
    await running;
  }
  assertEquals(failures, []);
});

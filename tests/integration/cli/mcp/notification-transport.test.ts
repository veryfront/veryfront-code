import { assertEquals } from "#veryfront/testing/assert";
import { MCPDevServer } from "../../../../cli/mcp/server.ts";
import { fileURLToPath } from "node:url";

Deno.test("stdio executes notifications without responses while preserving request and validation errors", async () => {
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--frozen",
      "--allow-all",
      fileURLToPath(new URL("./notification-stdio.fixture.ts", import.meta.url)),
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    env: { LOG_LEVEL: "ERROR", VF_DISABLE_LRU_INTERVAL: "1" },
  }).spawn();
  const writer = child.stdin.getWriter();
  const output = child.output();
  await writer.write(new TextEncoder().encode(
    [
      JSON.stringify({ jsonrpc: "2.0", method: "notify" }),
      JSON.stringify({ jsonrpc: "2.0", method: "fail" }),
      JSON.stringify({ jsonrpc: "2.0", id: 0, method: "request" }),
      JSON.stringify({ jsonrpc: "2.0", id: null, method: "null-request" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "fail" }),
      "{",
      JSON.stringify({ jsonrpc: "2.0" }),
    ].join("\n") + "\n",
  ));
  await writer.close();
  const result = await output;
  assertEquals(result.code, 0);
  const records = new TextDecoder().decode(result.stdout).trim().split("\n").map((line) =>
    JSON.parse(line)
  );
  assertEquals(records.length, 5);
  assertEquals(records[0].id, 0);
  assertEquals(records[0].result.handled, "request");
  assertEquals(records[1].id, null);
  assertEquals(records[1].result.handled, "null-request");
  assertEquals(records[2].error.code, -32603);
  assertEquals(records[3].error.code, -32700);
  assertEquals(records[4].error.code, -32600);
  const stderr = new TextDecoder().decode(result.stderr);
  assertEquals(stderr.includes("handled:notify"), true);
  assertEquals(stderr.split("handled:fail").length - 1, 2);
});

Deno.test("HTTP valid notifications return empty202; requests and malformed inputs retain responses", async () => {
  let resolve!: (port: number) => void;
  const ready = new Promise<number>((done) => {
    resolve = done;
  });
  const server = new MCPDevServer({ httpPort: 0, onHttpListen: ({ port }) => resolve(port) });
  server.start();
  try {
    const port = await ready;
    const post = (body: unknown) =>
      fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    for (const method of ["notifications/initialized", "missing-notification-method"]) {
      const response = await post({ jsonrpc: "2.0", method });
      assertEquals(response.status, 202);
      assertEquals(await response.text(), "");
    }
    for (const id of [0, null]) {
      const response = await post({ jsonrpc: "2.0", id, method: "initialize" });
      assertEquals(response.status, 200);
      const record = await response.json();
      assertEquals(record.id, id);
      assertEquals(typeof record.result.serverInfo.name, "string");
    }
    for (const [body, code] of [["{", -32700], [{ jsonrpc: "2.0" }, -32600]]) {
      const response = await post(body);
      assertEquals(response.status, 400);
      assertEquals((await response.json()).error.code, code);
    }
  } finally {
    await server.stop();
  }
});

// Native subprocess fixture. Exercises module lifetime, not rendering parity.
import { createServer } from "node:http";
import process from "node:process";

const [moduleUrl, coordinator] = process.argv.slice(2);
const page = await import(moduleUrl);
const server = createServer(async (_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.write("<main>");
  try {
    const gate = await fetch(`${coordinator}/continue`);
    await gate.arrayBuffer();
    response.end(`${await page.load()}</main>`);
  } catch {
    response.destroy();
  }
});
server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  const ready = await fetch(`${coordinator}/ready`, {
    method: "POST",
    body: String(address.port),
  });
  await ready.arrayBuffer();
});
